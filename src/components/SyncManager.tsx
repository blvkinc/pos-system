import React, { useState, useEffect } from 'react';
import { syncService } from '../lib/sync';
import { initDB, clearProducts, getSyncState, getTransactions } from '../lib/db';
import { supabase } from '../lib/supabase';
import { Transaction } from '../types';

export function SyncManager() {
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingTransactions, setPendingTransactions] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    loadSyncStatus();
  }, []);

  const loadSyncStatus = async () => {
    try {
      const state = await getSyncState();
      setPendingTransactions(state.pendingTransactions);
      
      if (state.pendingTransactions.length > 0) {
        const allTransactions = await getTransactions();
        const pendingTxs = allTransactions.filter(tx => 
          state.pendingTransactions.includes(tx.id)
        );
        setTransactions(pendingTxs);
      }
    } catch (error) {
      console.error('Failed to load sync status:', error);
    }
  };

  const handleForceSync = async () => {
    try {
      setIsLoading(true);
      setStatus('Initializing database...');
      await initDB();
      
      setStatus('Forcing full product sync...');
      await syncService.syncProducts(true);
      
      setStatus('Sync completed successfully!');
      await loadSyncStatus();
    } catch (error) {
      console.error('Sync failed:', error);
      setStatus(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncTransactions = async () => {
    try {
      setIsLoading(true);
      setStatus('Syncing pending transactions...');
      await syncService.sync();
      setStatus('Transactions synced successfully!');
      await loadSyncStatus();
    } catch (error) {
      console.error('Transaction sync failed:', error);
      setStatus(`Transaction sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearProducts = async () => {
    try {
      setIsLoading(true);
      setStatus('Clearing local products...');
      await clearProducts();
      setStatus('Products cleared successfully!');
    } catch (error) {
      console.error('Failed to clear products:', error);
      setStatus(`Failed to clear products: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestSupabaseConnection = async () => {
    try {
      setIsLoading(true);
      setStatus('Testing Supabase connection...');
      
      const { data, error } = await supabase.from('products').select('count()', { count: 'exact' });
      
      if (error) {
        throw error;
      }
      
      setStatus(`Connection successful! Found ${data[0].count} products in Supabase.`);
    } catch (error) {
      console.error('Supabase connection test failed:', error);
      setStatus(`Supabase connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckSupabaseTransactions = async () => {
    try {
      setIsLoading(true);
      setStatus('Checking Supabase transactions...');
      
      const { data, error } = await supabase
        .from('transactions')
        .select('*');
      
      if (error) {
        throw error;
      }
      
      console.log('Supabase transactions:', data);
      setStatus(`Found ${data?.length || 0} transactions in Supabase.`);
      
      // Also check transaction_items
      const { data: itemsData, error: itemsError } = await supabase
        .from('transaction_items')
        .select('*');
        
      if (itemsError) {
        throw itemsError;
      }
      
      console.log('Supabase transaction items:', itemsData);
      setStatus(prev => `${prev} Found ${itemsData?.length || 0} transaction items.`);
      
    } catch (error) {
      console.error('Supabase transaction check failed:', error);
      setStatus(`Supabase transaction check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-4">Database Sync Manager</h2>
      
      <div className="space-y-4">
        <button
          onClick={handleTestSupabaseConnection}
          disabled={isLoading}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Test Supabase Connection
        </button>
        
        <button
          onClick={handleForceSync}
          disabled={isLoading}
          className="w-full bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Force Full Product Sync
        </button>
        
        <button
          onClick={handleSyncTransactions}
          disabled={isLoading}
          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Sync Pending Transactions ({pendingTransactions.length})
        </button>
        
        <button
          onClick={handleClearProducts}
          disabled={isLoading}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Clear Local Products
        </button>
        
        <button
          onClick={handleCheckSupabaseTransactions}
          disabled={isLoading}
          className="w-full bg-purple-500 hover:bg-purple-600 text-white py-2 px-4 rounded disabled:opacity-50"
        >
          Check Supabase Transactions
        </button>
      </div>
      
      {pendingTransactions.length > 0 && (
        <div className="mt-4">
          <h3 className="font-medium text-sm mb-2">Pending Transactions:</h3>
          <div className="max-h-40 overflow-y-auto bg-gray-50 p-2 rounded text-xs">
            {transactions.map(tx => (
              <div key={tx.id} className="mb-1 pb-1 border-b border-gray-200">
                <div><strong>ID:</strong> {tx.id.substring(0, 8)}...</div>
                <div><strong>Date:</strong> {new Date(tx.date).toLocaleString()}</div>
                <div><strong>Total:</strong> ${tx.total.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {status && (
        <div className="mt-4 p-3 bg-gray-100 rounded">
          <p className="text-sm">{status}</p>
        </div>
      )}
      
      {isLoading && (
        <div className="mt-4 flex justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
        </div>
      )}
    </div>
  );
} 