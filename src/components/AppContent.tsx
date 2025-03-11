import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  Settings,
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Receipt,
  Menu,
  X,
  Plus,
  Minus,
  Trash2,
  AlertCircle,
  LogOut
} from 'lucide-react';
import { initDB } from '../lib/db';
import { syncService } from '../lib/sync';
import { Product, Transaction } from '../types';
import { getProducts, saveTransaction, getTransactions } from '../lib/db';
import { useAuth } from '../contexts/AuthContext';

export function AppContent() {
  const { signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [activeTab, setActiveTab] = useState('pos');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSync, setLastSync] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionSyncStatus, setTransactionSyncStatus] = useState<Record<string, 'synced' | 'pending' | 'error'>>({});

  useEffect(() => {
    // Initialize database
    initDB().then(async () => {
      console.log('Database initialized');
      
      // Initial sync
      await syncService.sync();
      console.log('Initial sync completed');
      
      // Load products and transactions
      try {
        const [loadedProducts, loadedTransactions] = await Promise.all([
          getProducts(),
          getTransactions()
        ]);
        console.log(`Loaded ${loadedProducts.length} products and ${loadedTransactions.length} transactions`);
        
        setProducts(loadedProducts);
        setTransactions(loadedTransactions);
        
        // Load sync status for all transactions
        const statuses: Record<string, 'synced' | 'pending' | 'error'> = {};
        for (const transaction of loadedTransactions) {
          statuses[transaction.id] = await syncService.getTransactionSyncStatus(transaction.id);
        }
        setTransactionSyncStatus(statuses);

        // Load last sync time
        const lastSyncTime = await syncService.getLastSyncTime();
        setLastSync(lastSyncTime || '');
      } catch (error) {
        console.error('Error loading data:', error);
        setNotification({
          type: 'error',
          message: 'Failed to load products and transactions'
        });
      }
    });

    // Listen for online/offline events
    const handleOnline = async () => {
      setIsOnline(true);
      // Sync when coming back online
      await syncService.sync();
      // Reload products and transactions
      try {
        const [loadedProducts, loadedTransactions] = await Promise.all([
          getProducts(),
          getTransactions()
        ]);
        setProducts(loadedProducts);
        setTransactions(loadedTransactions);
        
        // Update sync status
        const statuses: Record<string, 'synced' | 'pending' | 'error'> = {};
        for (const transaction of loadedTransactions) {
          statuses[transaction.id] = await syncService.getTransactionSyncStatus(transaction.id);
        }
        setTransactionSyncStatus(statuses);
        
        // Update last sync time
        const lastSyncTime = await syncService.getLastSyncTime();
        setLastSync(lastSyncTime || '');
      } catch (error) {
        console.error('Error reloading data:', error);
        setNotification({
          type: 'error',
          message: 'Failed to reload data after coming online'
        });
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const addToCart = (product: Product) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.product.id === product.id);
      if (existingItem) {
        if (existingItem.quantity >= product.stock) return prevCart;
        return prevCart.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prevCart, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    setCart(prevCart =>
      prevCart.map(item =>
        item.product.id === productId
          ? { ...item, quantity: Math.min(newQuantity, item.product.stock) }
          : item
      )
    );
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;

    const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const tax = subtotal * 0.1; // 10% tax
    const total = subtotal + tax;

    const transaction: Transaction = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      items: cart.map(item => ({
        ...item.product,
        quantity: item.quantity
      })),
      subtotal,
      tax,
      total,
      status: 'completed'
    };

    try {
      // Save transaction locally first
      await saveTransaction(transaction);
      
      // Add to transactions list
      setTransactions(prev => [transaction, ...prev]);
      
      // Set initial sync status
      setTransactionSyncStatus(prev => ({
        ...prev,
        [transaction.id]: 'pending'
      }));
      
      // Try to sync with Supabase
      try {
        await syncService.saveTransaction(transaction);
        setTransactionSyncStatus(prev => ({
          ...prev,
          [transaction.id]: 'synced'
        }));
        setNotification({
          type: 'success',
          message: 'Transaction completed and synced successfully!'
        });
        
        // Update last sync time
        const lastSyncTime = await syncService.getLastSyncTime();
        setLastSync(lastSyncTime || '');
      } catch (syncError) {
        // If sync fails but local save succeeds, show offline message
        setNotification({
          type: 'success',
          message: 'Transaction saved offline. Will sync when online.'
        });
      }

      // Clear cart after successful local save
      setCart([]);
    } catch (error) {
      console.error('Failed to complete sale:', error);
      setNotification({
        type: 'error',
        message: 'Failed to complete sale. Please try again.'
      });
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...new Set(products.map(p => p.category))];

  // Add notification component
  const Notification = () => {
    if (!notification) return null;

    return (
      <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${
        notification.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}>
        <AlertCircle size={20} />
        <span>{notification.message}</span>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Notification />
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} bg-white shadow-lg transition-all duration-300`}>
        <div className="p-4 flex items-center justify-between">
          {isSidebarOpen && <h1 className="text-xl font-bold">POS System</h1>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        <nav className="mt-8">
          <ul className="space-y-2">
            <li>
              <button
                onClick={() => setActiveTab('pos')}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'pos' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ShoppingCart size={20} />
                {isSidebarOpen && <span className="ml-3">POS</span>}
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('products')}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'products' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Package size={20} />
                {isSidebarOpen && <span className="ml-3">Products</span>}
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('customers')}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'customers' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Users size={20} />
                {isSidebarOpen && <span className="ml-3">Customers</span>}
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('reports')}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'reports' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <BarChart3 size={20} />
                {isSidebarOpen && <span className="ml-3">Reports</span>}
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('transactions')}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'transactions' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Receipt size={20} />
                {isSidebarOpen && <span className="ml-3">Transactions</span>}
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('settings')}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'settings' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Settings size={20} />
                {isSidebarOpen && <span className="ml-3">Settings</span>}
              </button>
            </li>
            <li>
              <button
                onClick={signOut}
                className={`w-full flex items-center px-4 py-2 ${
                  activeTab === 'signout' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <LogOut size={20} />
                {isSidebarOpen && <span className="ml-3">Sign Out</span>}
              </button>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="bg-white shadow-sm p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-800">
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </h2>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-600">
                Last synced: {lastSync ? new Date(lastSync).toLocaleString() : 'Never'}
              </div>
              <div className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
            </div>
          </div>
        </header>

        <div className="p-6">
          {activeTab === 'pos' && (
            <div className="grid grid-cols-3 gap-6">
              {/* Product Grid */}
              <div className="col-span-2 bg-white rounded-lg shadow p-4">
                <div className="flex gap-4 mb-4">
                  <input
                    type="text"
                    placeholder="Search products..."
                    className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <select
                    className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {filteredProducts.map((product) => (
                    <div
                      key={product.id}
                      className="bg-gray-50 p-4 rounded-lg cursor-pointer hover:bg-gray-100"
                      onClick={() => addToCart(product)}
                    >
                      <div className="h-24 bg-gray-200 rounded mb-2 flex items-center justify-center">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-cover rounded"
                          />
                        ) : (
                          <span className="text-gray-400 text-4xl">📦</span>
                        )}
                      </div>
                      <h3 className="font-medium">{product.name}</h3>
                      <p className="text-gray-600">${product.price.toFixed(2)}</p>
                      <p className="text-sm text-gray-500">Stock: {product.stock}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cart */}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="text-lg font-semibold mb-4">Current Order</h3>
                <div className="space-y-4">
                  {cart.length === 0 ? (
                    <p className="text-gray-500 text-center">No items in cart</p>
                  ) : (
                    <>
                      <div className="space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto">
                        {cart.map((item) => (
                          <div key={item.product.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                            <div className="flex-1">
                              <h4 className="font-medium">{item.product.name}</h4>
                              <p className="text-sm text-gray-600">${item.product.price.toFixed(2)}</p>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.product.id, item.quantity - 1);
                                }}
                                className="p-1 hover:bg-gray-200 rounded"
                                disabled={item.quantity <= 1}
                              >
                                <Minus size={16} />
                              </button>
                              <span className="w-8 text-center">{item.quantity}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.product.id, item.quantity + 1);
                                }}
                                className="p-1 hover:bg-gray-200 rounded"
                                disabled={item.quantity >= item.product.stock}
                              >
                                <Plus size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFromCart(item.product.id);
                                }}
                                className="p-1 hover:bg-red-100 rounded text-red-600"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="border-t pt-4 space-y-2">
                        <div className="flex justify-between text-gray-600">
                          <span>Subtotal</span>
                          <span>${cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span>Tax (10%)</span>
                          <span>${(cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0) * 0.1).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-lg">
                          <span>Total</span>
                          <span>${(cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0) * 1.1).toFixed(2)}</span>
                        </div>
                      </div>

                      <button
                        onClick={handleCompleteSale}
                        className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Complete Sale
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'products' && (
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Product Management</h3>
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                  Add Product
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-left">Price</th>
                      <th className="px-4 py-2 text-left">Stock</th>
                      <th className="px-4 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="px-4 py-2">Sample Product</td>
                      <td className="px-4 py-2">Category</td>
                      <td className="px-4 py-2">$9.99</td>
                      <td className="px-4 py-2">100</td>
                      <td className="px-4 py-2">
                        <button className="text-blue-600 hover:text-blue-800">Edit</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'customers' && (
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Customer Management</h3>
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                  Add Customer
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Email</th>
                      <th className="px-4 py-2 text-left">Phone</th>
                      <th className="px-4 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="px-4 py-2">John Doe</td>
                      <td className="px-4 py-2">john@example.com</td>
                      <td className="px-4 py-2">(555) 123-4567</td>
                      <td className="px-4 py-2">
                        <button className="text-blue-600 hover:text-blue-800">Edit</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-4">Sales Reports</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="text-sm text-blue-600">Today's Sales</h4>
                  <p className="text-2xl font-bold">$1,234.56</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h4 className="text-sm text-green-600">Weekly Sales</h4>
                  <p className="text-2xl font-bold">$8,765.43</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h4 className="text-sm text-purple-600">Monthly Sales</h4>
                  <p className="text-2xl font-bold">$32,109.87</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Transaction ID</th>
                      <th className="px-4 py-2 text-left">Items</th>
                      <th className="px-4 py-2 text-left">Total</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Sync Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr key={transaction.id} className="border-t">
                        <td className="px-4 py-2">
                          {new Date(transaction.date).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">{transaction.id}</td>
                        <td className="px-4 py-2">{transaction.items.length} items</td>
                        <td className="px-4 py-2">${transaction.total.toFixed(2)}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded-full text-sm ${
                            transaction.status === 'completed' 
                              ? 'bg-green-100 text-green-800'
                              : transaction.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {transaction.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded-full text-sm ${
                            transactionSyncStatus[transaction.id] === 'synced'
                              ? 'bg-green-100 text-green-800'
                              : transactionSyncStatus[transaction.id] === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {transactionSyncStatus[transaction.id] || 'unknown'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-4">System Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Store Name</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Enter store name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Tax Rate (%)</label>
                  <input
                    type="number"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Enter tax rate"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Currency</label>
                  <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                    <option>USD</option>
                    <option>EUR</option>
                    <option>GBP</option>
                  </select>
                </div>
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                  Save Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
} 