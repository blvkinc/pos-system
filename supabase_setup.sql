-- Enable RLS (Row Level Security)
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO 'your-jwt-secret';

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  image TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  subtotal DECIMAL(10, 2) NOT NULL,
  tax DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transaction_items table
CREATE TABLE IF NOT EXISTS transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sync_status table to track last sync
CREATE TABLE IF NOT EXISTS sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security on all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY;

-- Create policies for products
CREATE POLICY "Products are viewable by authenticated users"
  ON products FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Products are insertable by authenticated users"
  ON products FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Products are updatable by authenticated users"
  ON products FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Create policies for transactions
CREATE POLICY "Transactions are viewable by the user who created them"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Transactions are insertable by authenticated users"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Transactions are updatable by the user who created them"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id);

-- Create policies for transaction_items
CREATE POLICY "Transaction items are viewable by the user who created the transaction"
  ON transaction_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM transactions
      WHERE transactions.id = transaction_items.transaction_id
      AND transactions.user_id = auth.uid()
    )
  );

CREATE POLICY "Transaction items are insertable by authenticated users"
  ON transaction_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM transactions
      WHERE transactions.id = transaction_items.transaction_id
      AND transactions.user_id = auth.uid()
    )
  );

-- Create policies for sync_status
CREATE POLICY "Sync status is viewable by the user who created it"
  ON sync_status FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Sync status is insertable by authenticated users"
  ON sync_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Sync status is updatable by the user who created it"
  ON sync_status FOR UPDATE
  USING (auth.uid() = user_id);

-- Sample product data
INSERT INTO products (name, description, price, stock, category, image)
VALUES 
  ('Coffee', 'Freshly brewed coffee', 2.99, 100, 'beverages', 'https://images.unsplash.com/photo-1509042239860-f550ce710b93'),
  ('Tea', 'Organic herbal tea', 1.99, 100, 'beverages', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3'),
  ('Sandwich', 'Turkey and cheese sandwich', 5.99, 20, 'food', 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af'),
  ('Salad', 'Fresh garden salad', 4.99, 15, 'food', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd'),
  ('Notebook', 'Lined notebook', 3.99, 50, 'stationery', 'https://images.unsplash.com/photo-1531346878377-a5be20888e57'),
  ('Pen', 'Black ink pen', 1.49, 100, 'stationery', 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd'),
  ('Water Bottle', 'Reusable water bottle', 9.99, 30, 'accessories', 'https://images.unsplash.com/photo-1602143407151-7111542de6e8'),
  ('Phone Charger', 'USB-C phone charger', 14.99, 25, 'electronics', 'https://images.unsplash.com/photo-1583394838336-acd977736f90'),
  ('Headphones', 'Wireless headphones', 49.99, 10, 'electronics', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e'),
  ('Chocolate Bar', 'Dark chocolate', 2.49, 40, 'snacks', 'https://images.unsplash.com/photo-1511381939415-e44015466834');

-- Create function to handle transaction creation with items
CREATE OR REPLACE FUNCTION create_transaction(
  p_transaction_id UUID,
  p_user_id UUID,
  p_date TIMESTAMP WITH TIME ZONE,
  p_subtotal DECIMAL,
  p_tax DECIMAL,
  p_total DECIMAL,
  p_status TEXT,
  p_items JSONB
) RETURNS UUID AS $$
DECLARE
  v_item JSONB;
  v_transaction_id UUID;
BEGIN
  -- Insert transaction
  INSERT INTO transactions (id, user_id, date, subtotal, tax, total, status)
  VALUES (p_transaction_id, p_user_id, p_date, p_subtotal, p_tax, p_total, p_status)
  RETURNING id INTO v_transaction_id;
  
  -- Insert transaction items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO transaction_items (
      transaction_id, 
      product_id, 
      name, 
      price, 
      quantity
    )
    VALUES (
      v_transaction_id,
      (v_item->>'id')::UUID,
      v_item->>'name',
      (v_item->>'price')::DECIMAL,
      (v_item->>'quantity')::INTEGER
    );
  END LOOP;
  
  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update product stock after transaction
CREATE OR REPLACE FUNCTION update_product_stock() RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stock = stock - NEW.quantity
  WHERE id = NEW.product_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update product stock after transaction item insert
CREATE TRIGGER after_transaction_item_insert
AFTER INSERT ON transaction_items
FOR EACH ROW
EXECUTE FUNCTION update_product_stock();

-- Create function to get user's transactions with items
CREATE OR REPLACE FUNCTION get_transactions_with_items(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  date TIMESTAMP WITH TIME ZONE,
  subtotal DECIMAL,
  tax DECIMAL,
  total DECIMAL,
  status TEXT,
  items JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.date,
    t.subtotal,
    t.tax,
    t.total,
    t.status,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ti.id,
          'product_id', ti.product_id,
          'name', ti.name,
          'price', ti.price,
          'quantity', ti.quantity
        )
      )
      FROM transaction_items ti
      WHERE ti.transaction_id = t.id
    ) AS items
  FROM transactions t
  WHERE t.user_id = p_user_id
  ORDER BY t.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 