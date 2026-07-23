/* ═══════════════════════════════════════════════
   Google Sheets Sync Engine
   ═══════════════════════════════════════════════ */

import { getSetting, getPendingSyncItems, markSyncDone, markSyncFailed, dbSaveProduct } from './db.js';
import { showToast, updateSyncStatus, renderDashboard } from './ui.js';

let syncTimer = null;
const SYNC_INTERVAL = 60000; // Every 60 seconds

/* ── Get the GAS Web App URL ── */
async function getGasUrl() {
  const url = await getSetting('gasUrl');
  return url || null;
}

/* ── Trigger a sync cycle ── */
export function triggerSync() {
  // Debounce — if a sync was scheduled recently, reset the timer
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(processSyncQueue, 2000);
}

/* ── Force sync immediately ── */
async function forceSync() {
  updateSyncStatus('pending');
  try {
    await processSyncQueue();
    showToast('Sync complete!', 'success');
  } catch (err) {
    showToast('Sync failed: ' + err.message, 'error');
  }
}

/* ── Process the sync queue ── */
async function processSyncQueue() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) {
    // No sheet configured — mark as offline
    updateSyncStatus('offline');
    return;
  }

  // Check connectivity
  if (!navigator.onLine) {
    updateSyncStatus('offline');
    return;
  }

  try {
    const pending = await getPendingSyncItems();
    if (pending.length === 0) {
      updateSyncStatus('ok');
      return;
    }

    updateSyncStatus('pending');

    for (const item of pending) {
      try {
        await sendToSheet(gasUrl, item.action, item.payload);
        await markSyncDone(item.id);
      } catch (err) {
        console.error('Sync item failed:', item.id, err.message);
        await markSyncFailed(item.id);
        // Continue with next item
      }
    }

    // Check if any failed
    const remaining = await getPendingSyncItems();
    if (remaining.length === 0) {
      updateSyncStatus('ok');
      // Refresh dashboard after sync
      renderDashboard();
    } else {
      updateSyncStatus('error');
    }
  } catch (err) {
    console.error('Sync process error:', err);
    updateSyncStatus('error');
  }
}

/* ── Send a single action to the Google Sheet ── */
async function sendToSheet(gasUrl, action, payload) {
  const response = await fetch(gasUrl, {
    method: 'POST',
    mode: 'no-cors',  // GAS web apps don't return CORS headers by default
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });

  // With no-cors, response is opaque. We'll trust it was received.
  // For a production app, deploy the GAS as an API executable with CORS.
  return true;
}

/* ── Sync products from sheet on initial load ── */
export async function pullProductsFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(gasUrl + '?action=getProducts', {
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.status === 'ok' && Array.isArray(data.products)) {
      // Save each product locally
      for (const prod of data.products) {
        if (prod.barcode) {
          await dbSaveProduct(prod);
        }
      }
      showToast(`Loaded ${data.products.length} products from sheet`, 'success');
      return data.products;
    }
    return [];
  } catch (err) {
    console.log('Pull from sheet failed:', err.message);
    return [];
  }
}

/* ── Sync sales from sheet (read-only backup) ── */
export async function pullSalesFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(gasUrl + '?action=getSales', {
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.status === 'ok' && Array.isArray(data.sales)) {
      return data.sales;
    }
    return [];
  } catch (err) {
    console.log('Pull sales from sheet failed:', err.message);
    return [];
  }
}

/* ── Set up periodic sync ── */
export function startPeriodicSync() {
  // Check every 60 seconds
  setInterval(() => {
    if (navigator.onLine) {
      processSyncQueue().catch(() => {});
    } else {
      updateSyncStatus('offline');
    }
  }, SYNC_INTERVAL);

  // Also listen for online/offline events
  window.addEventListener('online', () => {
    showToast('📡 Back online — syncing...', 'info');
    triggerSync();
  });
  window.addEventListener('offline', () => {
    updateSyncStatus('offline');
    showToast('📡 Offline mode — sales will sync when connected', 'warning');
  });
}

/* ── Attach functions referenced by inline HTML on* handlers ── */
Object.assign(window, { forceSync });
