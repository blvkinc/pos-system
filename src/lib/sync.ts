import { supabase, Database } from './supabase';
import * as db from './db';
import { Product, Transaction } from '../types';

export class SyncService {
  private isOnline: boolean;
  private isSyncing: boolean;
  private maxRetries: number;
  private retryDelay: number;
  private dbState: {
    lastSync: string | null;
    pendingTransactions: string[];
  };

  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    this.dbState = {
      lastSync: null,
      pendingTransactions: []
    };

    // Listen for online/offline events
    window.addEventListener('online', () => {
      console.log('App is online');
      this.isOnline = true;
      this.sync();
    });
    
    window.addEventListener('offline', () => {
      console.log('App is offline');
      this.isOnline = false;
    });
  }

  async init() {
    try {
      const state = await db.getSyncState();
      if (state) {
        this.dbState = {
          lastSync: state.lastSync,
          pendingTransactions: state.pendingTransactions
        };
      }
    } catch (error) {
      console.error('Failed to initialize sync service:', error);
    }
  }

  async sync() {
    if (!this.isOnline || this.isSyncing) {
      console.log(`Skipping sync: ${!this.isOnline ? 'Offline' : 'Already syncing'}`);
      return;
    }

    this.isSyncing = true;
    console.log('Starting sync...');

    try {
      // Force a full product refresh
      await this.syncProducts(true);
      
      await this._syncTransactions();
      
      // Update last sync time
      const state = await db.getSyncState();
      state.lastSync = new Date().toISOString();
      await db.updateSyncState(state);
      
      console.log('Sync completed successfully');
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  async syncProducts(forceRefresh = false) {
    try {
      console.log('Syncing products...');
      
      // Get products from Supabase
      const { data: supabaseProducts, error } = await supabase
        .from('products')
        .select('*');
      
      if (error) {
        throw new Error(`Failed to fetch products: ${error.message}`);
      }
      
      if (!supabaseProducts || supabaseProducts.length === 0) {
        console.log('No products found in Supabase');
        return;
      }
      
      console.log(`Fetched ${supabaseProducts.length} products from Supabase`);
      
      if (forceRefresh) {
        console.log('Forcing full product refresh');
        // Clear all existing products first
        await db.clearProducts();
        // Then save all new products
        await db.saveProducts(supabaseProducts as Product[]);
      } else {
        // Update products individually
        for (const product of supabaseProducts) {
          await db.saveProduct(product);
        }
      }
      
      console.log('Products synced successfully');
    } catch (error) {
      console.error('Failed to sync products:', error);
      throw error;
    }
  }

  async syncTransactions() {
    if (!this.isOnline) {
      console.log('Cannot sync transactions while offline');
      throw new Error('Cannot sync transactions while offline');
    }
    
    if (this.isSyncing) {
      console.log('Sync already in progress');
      throw new Error('Sync already in progress');
    }
    
    this.isSyncing = true;
    
    try {
      await this._syncTransactions();
      
      // Update last sync time
      const state = await db.getSyncState();
      state.lastSync = new Date().toISOString();
      await db.updateSyncState(state);
      
      console.log('Transaction sync completed successfully');
    } catch (error) {
      console.error('Transaction sync failed:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  private async _syncTransactions() {
    console.log('Starting transaction sync...');
    const state = await db.getSyncState();
    const pendingTransactions = await Promise.all(
      state.pendingTransactions.map(id => db.getTransaction(id))
    );

    console.log(`Found ${pendingTransactions.length} pending transactions`);

    for (const transaction of pendingTransactions) {
      if (!transaction) continue;

      let retries = 0;
      let lastError: Error | null = null;

      while (retries < this.maxRetries) {
        try {
          console.log(`Attempting to sync transaction ${transaction.id} (attempt ${retries + 1}/${this.maxRetries})`);
          
          // Get the current user
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            throw new Error('No authenticated user found');
          }
          
          // Format transaction for Supabase
          const supabaseTransaction = {
            id: transaction.id,
            user_id: user.id,
            date: transaction.date,
            subtotal: transaction.subtotal,
            tax: transaction.tax,
            total: transaction.total,
            status: transaction.status
          };
          
          // Upload transaction to Supabase
          const { error: transactionError } = await supabase
            .from('transactions')
            .upsert(supabaseTransaction);

          if (transactionError) {
            console.error(`Supabase error for transaction ${transaction.id}:`, transactionError);
            throw transactionError;
          }
          
          // Upload transaction items
          const transactionItems = transaction.items.map(item => ({
            transaction_id: transaction.id,
            product_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity
          }));
          
          const { error: itemsError } = await supabase
            .from('transaction_items')
            .upsert(transactionItems);
            
          if (itemsError) {
            console.error(`Supabase error for transaction items ${transaction.id}:`, itemsError);
            throw itemsError;
          }

          // Remove from pending transactions
          await db.removePendingTransaction(transaction.id);
          console.log(`Successfully synced transaction ${transaction.id}`);
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error as Error;
          retries++;
          if (retries === this.maxRetries) {
            console.error(`Failed to sync transaction ${transaction.id} after ${this.maxRetries} attempts:`, error);
            // Don't break here, let it continue to the next transaction
          } else {
            console.log(`Retrying transaction ${transaction.id} (attempt ${retries + 1}/${this.maxRetries})`);
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          }
        }
      }

      // If all retries failed, log the error but continue with other transactions
      if (retries === this.maxRetries && lastError) {
        console.error(`Transaction ${transaction.id} failed to sync after all retries:`, lastError);
      }
    }
  }

  async saveTransaction(transaction: Transaction) {
    console.log('Saving transaction:', transaction.id);
    
    // Save locally first
    await db.saveTransaction(transaction);

    const state = await db.getSyncState();
    if (state.isOnline) {
      try {
        console.log(`Attempting to sync transaction ${transaction.id} immediately`);
        
        // Get the current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          throw new Error('No authenticated user found');
        }
        
        // Format transaction for Supabase
        const supabaseTransaction = {
          id: transaction.id,
          user_id: user.id,
          date: transaction.date,
          subtotal: transaction.subtotal,
          tax: transaction.tax,
          total: transaction.total,
          status: transaction.status
        };
        
        // Upload transaction to Supabase
        const { error: transactionError } = await supabase
          .from('transactions')
          .upsert(supabaseTransaction);

        if (transactionError) {
          console.error(`Supabase error for transaction ${transaction.id}:`, transactionError);
          throw transactionError;
        }
        
        // Upload transaction items
        const transactionItems = transaction.items.map(item => ({
          transaction_id: transaction.id,
          product_id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        }));
        
        const { error: itemsError } = await supabase
          .from('transaction_items')
          .upsert(transactionItems);
          
        if (itemsError) {
          console.error(`Supabase error for transaction items ${transaction.id}:`, itemsError);
          throw itemsError;
        }
        
        console.log(`Transaction ${transaction.id} synced successfully`);
        
        // Update last sync time
        state.lastSync = new Date().toISOString();
        await db.updateSyncState(state);
      } catch (error) {
        console.error(`Error syncing transaction ${transaction.id}:`, error);
        // If sync fails, add to pending transactions
        await db.addPendingTransaction(transaction.id);
        console.log(`Transaction ${transaction.id} added to pending sync`);
        throw error; // Re-throw to handle in the UI
      }
    } else {
      // If offline, add to pending transactions
      await db.addPendingTransaction(transaction.id);
      console.log(`Transaction ${transaction.id} saved offline`);
      throw new Error('Offline mode: Transaction saved locally');
    }
  }

  async getTransactionSyncStatus(transactionId: string): Promise<'synced' | 'pending' | 'error'> {
    const state = await db.getSyncState();
    if (state.pendingTransactions.includes(transactionId)) {
      return 'pending';
    }
    return 'synced';
  }

  async getLastSyncTime(): Promise<string | null> {
    const state = await db.getSyncState();
    return state.lastSync;
  }
}

export const syncService = new SyncService(); 