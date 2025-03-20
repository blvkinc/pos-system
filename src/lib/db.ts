import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Product, Transaction } from '../types';

interface POSDatabase extends DBSchema {
  products: {
    key: string;
    value: Product;
    indexes: { 'by-category': string };
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-date': string };
  };
  sync: {
    key: string;
    value: {
      id: string;
      lastSync: string;
      isOnline: boolean;
      pendingTransactions: string[];
    };
  };
}

let db: IDBPDatabase<POSDatabase>;

export async function initDB() {
  db = await openDB<POSDatabase>('pos-db', 1, {
    upgrade(db) {
      // Products store
      const productStore = db.createObjectStore('products', { keyPath: 'id' });
      productStore.createIndex('by-category', 'category');

      // Transactions store
      const transactionStore = db.createObjectStore('transactions', { keyPath: 'id' });
      transactionStore.createIndex('by-date', 'date');

      // Sync store
      const syncStore = db.createObjectStore('sync', { keyPath: 'id' });
      
      // Initialize sync state
      syncStore.put({
        id: 'state',
        lastSync: new Date().toISOString(),
        isOnline: navigator.onLine,
        pendingTransactions: []
      });
    },
  });

  // Ensure sync state exists
  const state = await db.get('sync', 'state');
  if (!state) {
    await db.put('sync', {
      id: 'state',
      lastSync: new Date().toISOString(),
      isOnline: navigator.onLine,
      pendingTransactions: []
    });
  }
}

export async function getProducts(): Promise<Product[]> {
  console.log('Fetching products from IndexedDB...');
  const products = await db.getAll('products');
  console.log(`Retrieved ${products.length} products from IndexedDB`);
  return products;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  return db.get('products', id);
}

export async function saveProduct(product: Product): Promise<void> {
  await db.put('products', product);
}

export async function saveProducts(products: Product[]): Promise<void> {
  console.log(`Saving ${products.length} products to IndexedDB...`);
  const tx = db.transaction('products', 'readwrite');
  await Promise.all(products.map(product => tx.store.put(product)));
  await tx.done;
  console.log('Products saved successfully');
}

export async function getTransactions(): Promise<Transaction[]> {
  return db.getAll('transactions');
}

export async function getTransaction(id: string): Promise<Transaction | undefined> {
  return db.get('transactions', id);
}

export async function saveTransaction(transaction: Transaction): Promise<void> {
  await db.put('transactions', transaction);
}

export async function getSyncState(): Promise<{
  id: string;
  lastSync: string;
  isOnline: boolean;
  pendingTransactions: string[];
}> {
  const state = await db.get('sync', 'state');
  return state || {
    id: 'state',
    lastSync: new Date().toISOString(),
    isOnline: navigator.onLine,
    pendingTransactions: [],
  };
}

export async function updateSyncState(state: {
  id: string;
  lastSync: string;
  isOnline: boolean;
  pendingTransactions: string[];
}): Promise<void> {
  await db.put('sync', state);
}

export async function addPendingTransaction(transactionId: string): Promise<void> {
  const state = await getSyncState();
  state.pendingTransactions.push(transactionId);
  await updateSyncState(state);
}

export async function removePendingTransaction(transactionId: string): Promise<void> {
  const state = await getSyncState();
  state.pendingTransactions = state.pendingTransactions.filter(id => id !== transactionId);
  await updateSyncState(state);
}

export async function clearProducts(): Promise<void> {
  console.log('Clearing all products from IndexedDB...');
  const tx = db.transaction('products', 'readwrite');
  await tx.objectStore('products').clear();
  await tx.done;
  console.log('All products cleared successfully');
} 