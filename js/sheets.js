/* ═══════════════════════════════════════════════
   Google Sheets Sync Engine
   ═══════════════════════════════════════════════ */

import { getSetting, saveSetting, getPendingSyncItems, markSyncDone, markSyncFailed, dbSaveProduct, saveUser, saveStore } from './db.js';
import { showToast, updateSyncStatus, renderDashboard, setOfflineBanner } from './ui.js';

let syncTimer = null;
const SYNC_INTERVAL = 60000; // Every 60 seconds

/* ── Get the GAS Web App URL ── */
async function getGasUrl() {
  const url = await getSetting('gasUrl');
  return url || null;
}

/* ── Get the shared-secret API token for the GAS Web App ── */
async function getApiToken() {
  const t = await getSetting('apiToken');
  return (t || '').trim() || null;
}

/* Append the token to a GET URL when one is configured. Without a token we
   still make the call — GAS replies TOKEN_NOT_CONFIGURED, which the caller's
   catch swallows for now. */
async function withToken(url) {
  const token = await getApiToken();
  if (!token) return url;
  return url + '&token=' + encodeURIComponent(token);
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

    // Only surface the "check your API token" toast once per cycle, no
    // matter how many queued items fail with the same root cause.
    let tokenToastShown = false;

    for (const item of pending) {
      // Exponential backoff — skip items scheduled for a future retry
      if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) continue;

      try {
        await sendToSheet(gasUrl, item.action, item.payload);
        await markSyncDone(item.id);
      } catch (err) {
        console.error('Sync item failed:', item.id, err.message);
        const msg = err.message || 'Unknown sync error';
        if (!tokenToastShown && (msg.includes('INVALID_TOKEN') || msg.includes('TOKEN_NOT_CONFIGURED'))) {
          tokenToastShown = true;
          showToast('⚠️ ' + msg + ' — check Settings → API Token', 'error', 6000);
        }
        await markSyncFailed(item.id, msg);
        // Continue with next item
      }
    }

    // Any items left? Items scheduled for a future retry are "waiting",
    // not erroring — only show 'error' if something actually still fails.
    const remaining = await getPendingSyncItems();
    if (remaining.length === 0) {
      updateSyncStatus('ok');
      // Refresh dashboard after sync
      renderDashboard();
    } else if (remaining.every(i => i.nextAttemptAt && i.nextAttemptAt > Date.now())) {
      updateSyncStatus('pending');
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
  const token = await getApiToken();
  const response = await fetch(gasUrl, {
    method: 'POST',
    // text/plain avoids the CORS preflight that GAS web apps can't handle
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload, token })
  });

  // GAS serves responses as text/plain so they're readable cross-origin.
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Unreadable response from sheet: ' + text.slice(0, 120));
  }
  if (data.status !== 'ok') {
    throw new Error(data.message || 'Unknown sync error');
  }
  return data;
}

/* ── Sync products from sheet on initial load ── */
export async function pullProductsFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(await withToken(gasUrl + '?action=getProducts'), {
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
      return data.products;
    }
    return [];
  } catch (err) {
    console.log('Pull from sheet failed:', err.message);
    return [];
  }
}

/* ── Sync product categories from sheet ── */
export async function pullCategoriesFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(await withToken(gasUrl + '?action=getCategories'), {
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.status === 'ok' && Array.isArray(data.categories) && data.categories.length > 0) {
      await saveSetting('categories', data.categories);
      return data.categories;
    }
    // Reached the sheet fine but got nothing back — most likely the deployed
    // Apps Script is an older version (no getCategories action) or the
    // "Categories" tab exists but has no rows under the header.
    console.log('Categories sync returned no data — check the Apps Script deployment is up to date and the "Categories" sheet has rows.');
    return [];
  } catch (err) {
    console.log('Pull categories from sheet failed:', err.message);
    return [];
  }
}

/* ── Sync users (the employee roster) from sheet ── */
export async function pullUsersFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(await withToken(gasUrl + '?action=getUsers'), {
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.status === 'ok' && Array.isArray(data.users)) {
      for (const user of data.users) {
        if (user.userId) await saveUser(user);
      }
      return data.users;
    }
    return [];
  } catch (err) {
    console.log('Pull users from sheet failed:', err.message);
    return [];
  }
}

/* ── Sync stores from sheet ── */
export async function pullStoresFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(await withToken(gasUrl + '?action=getStores'), {
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.status === 'ok' && Array.isArray(data.stores)) {
      for (const store of data.stores) {
        if (store.storeId) await saveStore(store);
      }
      return data.stores;
    }
    return [];
  } catch (err) {
    console.log('Pull stores from sheet failed:', err.message);
    return [];
  }
}

/* ── Sync sales from sheet (read-only backup) ── */
export async function pullSalesFromSheet() {
  const gasUrl = await getGasUrl();
  if (!gasUrl) return [];

  try {
    const response = await fetch(await withToken(gasUrl + '?action=getSales'), {
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
  // Reflect the initial connectivity state in the offline banner once.
  setOfflineBanner(!navigator.onLine);

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
    setOfflineBanner(false);
    showToast('📡 Back online — syncing...', 'info');
    triggerSync();
  });
  window.addEventListener('offline', () => {
    setOfflineBanner(true);
    updateSyncStatus('offline');
    showToast('📡 Offline mode — sales will sync when connected', 'warning');
  });
}

/* ── Attach functions referenced by inline HTML on* handlers ── */
Object.assign(window, { forceSync });
