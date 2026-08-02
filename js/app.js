/* ═══════════════════════════════════════════════
   Main Application — Init, Onboarding, Auth Boot Flow
   ═══════════════════════════════════════════════ */

import {
  openDB, getSetting, saveSetting, resetAllData,
  getAllStores, saveStore, getAllUsers, getUserById, saveUser, enqueueSync,
  getAllProducts, DEFAULT_STORE_ID
} from './db.js';
import { $, showToast, escapeHtml, escJs, formatCurrency, formatShortDate, navigate, loadSettings, renderDashboard, renderRoleNav, updateCurrentUserBadge, effectiveQty, maybeNotifyStockAlerts } from './ui.js';
import { startPeriodicSync, pullProductsFromSheet, pullCategoriesFromSheet, pullUsersFromSheet, pullStoresFromSheet, triggerSync } from './sheets.js';
import {
  ROLES, ROLE_LABELS, hashPin, loginUser, restoreSession, startShift, endShift,
  logout, getCurrentUser, getCurrentSession, getCurrentStoreId, setCurrentStoreId,
  roleHomePage, generateId
} from './auth.js';
import './scanner.js'; // side-effect import: registers its own window.* handlers
import './receipt.js'; // side-effect import: registers its own window.* handlers

/* ── App Initialization ── */
document.addEventListener('DOMContentLoaded', async function() {
  try {
    await openDB();

    const storeName = await getSetting('storeName');
    const gasUrl = await getSetting('gasUrl');

    if (storeName && gasUrl) {
      await bootApp();
    } else if (storeName) {
      showOnboardingStep(3);
    } else {
      showOnboardingStep(1);
    }

    window.addEventListener('hashchange', () => {
      if (!getCurrentUser()) return; // don't route while logged out
      const page = location.hash.replace('#', '') || 'dashboard';
      navigate(page);
    });

    startPeriodicSync();
  } catch (err) {
    console.error('App init error:', err);
    showToast('Error starting app: ' + err.message, 'error');
  }
});

/* ── Onboarding Functions (store setup + Google Sheet connect) ── */

function showOnboardingStep(step) {
  const overlay = $('onboarding-overlay');
  overlay.classList.remove('hidden');
  document.querySelectorAll('.onboarding-step').forEach(s => s.classList.add('hidden'));
  const target = document.querySelector(`.onboarding-step[data-step="${step}"]`);
  if (target) target.classList.remove('hidden');
  $('app').classList.add('hidden');
}

function nextOnboardingStep(step) {
  if (step === 3) {
    const name = $('store-name-input').value.trim();
    if (name) saveSetting('storeName', name).catch(() => {});
  }
  showOnboardingStep(step);
}

async function connectGoogleSheet() {
  const url = $('gas-url-input').value.trim();
  const token = $('api-token-input') ? $('api-token-input').value.trim() : '';
  if (!url) { showToast('Please enter the Google Apps Script Web App URL', 'error'); return; }
  if (!url.startsWith('https://script.google.com/macros/s/')) {
    showToast('Invalid URL. It should start with https://script.google.com/macros/s/', 'error');
    return;
  }

  const storeName = $('store-name-input').value.trim() || 'My Store';
  await saveSetting('storeName', storeName);
  await saveSetting('gasUrl', url);
  await saveSetting('apiToken', token);

  try {
    const response = await fetch(url + '?action=ping&token=' + encodeURIComponent(token), { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (data.status === 'ok') {
      showToast('✅ Connected to Google Sheets!', 'success');
    } else if (data.status === 'error' && (data.code === 'UNAUTHORIZED' || (data.message || '').includes('TOKEN_NOT_CONFIGURED'))) {
      showToast('⚠️ ' + (data.message || 'Connection rejected') + ' — check the API token', 'error', 6000);
      return; // stay on this onboarding step
    } else {
      showToast('Sheet responded but unexpected format. You can continue.', 'warning');
    }
  } catch (err) {
    showToast('⚠️ Could not verify connection, but saved. You can test it later in Settings.', 'warning');
  }
  showOnboardingStep('done');
}

/* ── Boot: figure out what to show — manager setup, login, or the app ── */
async function bootApp() {
  $('onboarding-overlay').classList.add('hidden');

  // Make sure a store exists — either from a fresh install about to
  // create its first manager, or an upgrade from the pre-multi-store
  // version of the app (existing local products/sales get attributed
  // to this default store automatically by the db.js migration).
  const existingStores = await getAllStores();
  if (existingStores.length === 0) {
    const name = (await getSetting('storeName')) || 'My Store';
    await saveStore({ storeId: DEFAULT_STORE_ID, storeName: name, location: '' });
  }

  const gasUrl = await getSetting('gasUrl');
  if (gasUrl) {
    await Promise.all([
      pullStoresFromSheet().catch(() => []),
      pullUsersFromSheet().catch(() => [])
    ]);
  }

  const users = await getAllUsers();
  const hasManager = users.some(u => u.role === ROLES.MANAGER && u.isActive !== false);

  if (!hasManager) {
    showOnboardingStep('manager');
    return;
  }

  const restored = await restoreSession();
  if (restored) {
    await enterApp();
  } else {
    showLoginScreen();
  }
}

/* ── First Manager Account ── */
let creatingManager = false;
async function createManagerAccount() {
  if (creatingManager) return; // guard against double-submit
  const name = $('mgr-name-input').value.trim();
  const pin = $('mgr-pin-input').value.trim();
  const pinConfirm = $('mgr-pin-confirm').value.trim();

  if (!name) { showToast('Please enter your name', 'error'); return; }
  if (!/^\d{6,8}$/.test(pin)) { showToast('PIN must be 6-8 digits', 'error', 5000); return; }
  if (pin !== pinConfirm) { showToast('PINs do not match', 'error'); return; }

  // A manager may already exist if this screen was submitted more than
  // once before the overlay correctly closed — don't create a duplicate.
  const existingUsers = await getAllUsers();
  if (existingUsers.some(u => u.role === ROLES.MANAGER && u.isActive !== false)) {
    await enterApp();
    return;
  }

  creatingManager = true;
  try {
    const stores = await getAllStores();
    const pinHash = await hashPin(pin);
    const user = {
      userId: generateId('USR'),
      name,
      role: ROLES.MANAGER,
      pinHash,
      storeIds: stores.map(s => s.storeId),
      isActive: true
    };
    await saveUser(user);
    await enqueueSync('addUser', user);

    showToast(`Welcome, ${name}! Your manager account is ready.`, 'success');
    await loginUser(user.userId, pin);
    await enterApp();
    triggerSync();
  } finally {
    creatingManager = false;
  }
}

/* ── Login Screen ("Who's working?") ── */
async function showLoginScreen() {
  $('app').classList.add('hidden');
  $('onboarding-overlay').classList.add('hidden');
  $('checkin-overlay').classList.add('hidden');
  $('login-overlay').classList.remove('hidden');
  $('login-user-select').classList.remove('hidden');
  $('login-pin-entry').classList.add('hidden');

  const users = (await getAllUsers()).filter(u => u.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  const list = $('login-user-list');
  if (users.length === 0) {
    list.innerHTML = '<p class="text-muted">No team members found yet. Ask your manager to add you.</p>';
    return;
  }
  list.innerHTML = users.map(u => `
    <button class="user-list-item" onclick="selectLoginUser('${escJs(u.userId)}')">
      <span class="user-list-name">${escapeHtml(u.name)}</span>
      <span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span>
    </button>
  `).join('');
}

let pendingLoginUserId = null;

async function selectLoginUser(userId) {
  pendingLoginUserId = userId;
  const user = await getUserById(userId);
  $('login-user-select').classList.add('hidden');
  $('login-pin-entry').classList.remove('hidden');
  $('login-pin-name').textContent = `Hi ${user ? user.name : ''}, enter your PIN`;
  $('login-pin-input').value = '';
  setTimeout(() => $('login-pin-input').focus(), 100);
}

function cancelPinEntry() {
  pendingLoginUserId = null;
  $('login-pin-entry').classList.add('hidden');
  $('login-user-select').classList.remove('hidden');
}

async function submitLoginPin() {
  if (!pendingLoginUserId) return;
  const pin = $('login-pin-input').value.trim();
  if (!pin) { showToast('Enter your PIN', 'error'); return; }
  try {
    await loginUser(pendingLoginUserId, pin);
    pendingLoginUserId = null;
    await enterApp();
  } catch (err) {
    showToast('Incorrect PIN', 'error');
    $('login-pin-input').value = '';
  }
}

/* ── Check-In (cashiers pick which store they're working today) ── */
async function showCheckInScreen(user) {
  $('onboarding-overlay').classList.add('hidden');
  $('login-overlay').classList.add('hidden');
  $('checkin-overlay').classList.remove('hidden');

  const isStockMgr = user.role === ROLES.STOCK_MANAGER;
  $('checkin-user-label').textContent = isStockMgr
    ? `${user.name}, where are you working today?`
    : `${user.name}, select your store for today`;

  const stores = await getAllStores();
  const assignable = (user.storeIds && user.storeIds.length > 0)
    ? stores.filter(s => user.storeIds.includes(s.storeId))
    : stores;

  // Stock managers see Warehouse as an option plus their assigned stores
  let options = [];
  if (isStockMgr) {
    options = [{ storeId: '__warehouse__', storeName: '🏭 Warehouse (Central Stock)' }];
  }
  options = options.concat(assignable);

  if (options.length === 0) {
    $('checkin-store-list').innerHTML = '<p class="text-muted">No location available. Ask your manager.</p>';
    $('checkin-confirm-btn').disabled = true;
    return;
  }
  if (options.length === 1 && !isStockMgr) {
    // Cashier with only one store: auto-select
    await confirmCheckIn(options[0].storeId);
    return;
  }

  $('checkin-confirm-btn').disabled = true;
  $('checkin-store-list').innerHTML = options.map(s => `
    <button class="user-list-item" id="checkin-store-${escapeHtml(s.storeId)}" onclick="pickCheckInStore('${escJs(s.storeId)}')">
      <span class="user-list-name">${escapeHtml(s.storeName)}</span>
    </button>
  `).join('');
}

let pendingCheckInStoreId = null;
function pickCheckInStore(storeId) {
  pendingCheckInStoreId = storeId;
  document.querySelectorAll('#checkin-store-list .user-list-item').forEach(el => el.classList.remove('selected'));
  $('checkin-store-' + storeId)?.classList.add('selected');
  $('checkin-confirm-btn').disabled = false;
}

async function confirmCheckIn(storeId) {
  const id = storeId || pendingCheckInStoreId;
  if (!id) return;

  const user = getCurrentUser();
  if (user && user.role === ROLES.STOCK_MANAGER) {
    // Stock managers just set their working location (no shift session)
    await setCurrentStoreId(id);
    pendingCheckInStoreId = null;
    const label = id === '__warehouse__' ? 'Warehouse' : '';
    showToast(`📍 Working from ${label || 'shop'}`, 'success');
    await enterApp();
    return;
  }

  await startShift(id);
  pendingCheckInStoreId = null;
  showToast('Shift started ✓', 'success');
  await enterApp();
}

/* ── Enter the app proper, once a user (and store, for cashiers) is set ── */
async function enterApp() {
  const user = getCurrentUser();
  if (!user) { showLoginScreen(); return; }

  if (user.role === ROLES.CASHIER && !getCurrentSession()) {
    await showCheckInScreen(user);
    return;
  }
  if (user.role === ROLES.STOCK_MANAGER && !getCurrentStoreId()) {
    await showCheckInScreen(user);
    return;
  }

  $('onboarding-overlay').classList.add('hidden');
  $('login-overlay').classList.add('hidden');
  $('checkin-overlay').classList.add('hidden');
  $('app').classList.remove('hidden');

  await loadSettings();
  renderRoleNav(user);
  await updateCurrentUserBadge();
  navigate(location.hash.replace('#', '') || roleHomePage(user.role));
  registerServiceWorker();

  // Low-stock notifications: once on boot, and again whenever the user
  // returns to a visible tab (debounced inside maybeNotifyStockAlerts).
  maybeNotifyStockAlerts();
  if (!window._stockNotifListenerRegistered) {
    window._stockNotifListenerRegistered = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') maybeNotifyStockAlerts();
    });
  }

  refreshSyncSummary();
}

/* ── Quiet background sync summary (no popups) ── */
async function refreshSyncSummary() {
  const gasUrl = await getSetting('gasUrl');
  if (!gasUrl) return;
  const [categories, products] = await Promise.all([
    pullCategoriesFromSheet().catch(() => []),
    pullProductsFromSheet().catch(() => [])
  ]);
  const info = $('sidebar-sync-info');
  if (info) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    info.textContent = `✅ ${products.length} products · ${categories.length} categories · ${time}`;
  }
  renderDashboard();
}

/* ── Stock Manager: switch working location (warehouse or shop) ── */
async function switchStockLocation() {
  const user = getCurrentUser();
  if (!user || user.role !== ROLES.STOCK_MANAGER) return;
  // Clear the current store and show check-in without logging out
  await setCurrentStoreId(null);
  await showCheckInScreen(user);
}

/* ── Logout / End Shift ── */
async function handleUserBadgeClick() {
  const user = getCurrentUser();
  if (!user) return;

  if (user.role === ROLES.CASHIER && getCurrentSession()) {
    if (!confirm('End your shift?')) return;
    const summary = await endShift();
    await enqueueSync('updateSession', summary);
    triggerSync();
    showShiftSummary(summary);
  } else if (user.role === ROLES.STOCK_MANAGER) {
    if (!confirm('End your session?')) return;
    await showStockManagerSummary();
    await logout();
  } else {
    if (!confirm('Log out?')) return;
    await logout();
    showLoginScreen();
  }
}

/* ── Stock Manager Session Summary ── */
async function showStockManagerSummary() {
  const user = getCurrentUser();
  if (!user) return;

  // Calculate period: from login time (stored in setting)
  const loginTime = await getSetting('stockMgrLoginAt');
  const since = loginTime ? new Date(loginTime).toISOString() : new Date(Date.now() - 86400000).toISOString();

  // Count products modified since login
  const storeId = getCurrentStoreId();
  const isAtWarehouse = storeId === '__warehouse__';
  const scopeId = isAtWarehouse ? null : storeId; // warehouse sees all
  const allProducts = await getAllProducts(scopeId);
  const modifiedSinceLogin = loginTime
    ? allProducts.filter(p => p.updatedAt && p.updatedAt >= since)
    : [];
  const outOfStock = allProducts.filter(p => effectiveQty(p) === 0);
  const lowStock = allProducts.filter(p => {
    const q = effectiveQty(p);
    return q > 0 && q <= (p.lowStockThreshold || 5);
  });
  const totalWarehouseStock = allProducts.reduce((s, p) => s + (p.warehouseStock || 0), 0);

  $('app').classList.add('hidden');
  const content = $('shift-summary-content');
  content.innerHTML = `
    <div class="shift-stat"><span>Total Products</span><strong>${allProducts.length}</strong></div>
    <div class="shift-stat"><span>Modified Today</span><strong>${modifiedSinceLogin.length}</strong></div>
    <div class="shift-stat"><span>Warehouse Stock (total)</span><strong>${totalWarehouseStock}</strong></div>
    <div class="shift-stat"><span>Out of Stock</span><strong style="color:var(--danger)">${outOfStock.length}</strong></div>
    <div class="shift-stat"><span>Low Stock</span><strong style="color:var(--warning)">${lowStock.length}</strong></div>
    <div class="shift-stat"><span>Session</span><strong>${loginTime ? formatShortDate(loginTime) : 'Today'}</strong></div>
  `;
  $('shift-summary-modal').classList.remove('hidden');

  // Override the close button to just go to login
  window._shiftSummaryDone = async () => {
    $('shift-summary-modal').classList.add('hidden');
    showLoginScreen();
  };
}



function showShiftSummary(summary) {
  if (!summary) { logout().then(showLoginScreen); return; }
  $('app').classList.add('hidden');
  const content = $('shift-summary-content');
  content.innerHTML = `
    <div class="shift-stat"><span>Store</span><strong>${escapeHtml(summary.storeName)}</strong></div>
    <div class="shift-stat"><span>Sales made</span><strong>${summary.saleCount}</strong></div>
    <div class="shift-stat"><span>Total revenue</span><strong>${formatCurrency(summary.totalAmount)}</strong></div>
    <div class="shift-stat"><span>Started</span><strong>${new Date(summary.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
    <div class="shift-stat"><span>Ended</span><strong>${new Date(summary.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
  `;
  $('shift-summary-modal').classList.remove('hidden');
}

async function closeShiftSummary() {
  $('shift-summary-modal').classList.add('hidden');
  // If a custom handler was set (stock manager), use it
  if (window._shiftSummaryDone) {
    const fn = window._shiftSummaryDone;
    window._shiftSummaryDone = null;
    await fn();
    return;
  }
  await logout();
  showLoginScreen();
}

/* ── PWA Service Worker Registration ── */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.log('SW registered:', reg.scope);
    }).catch(err => {
      console.log('SW registration failed:', err);
    });
  }
}

/* ── App Reset ── */
async function resetApp() {
  try {
    await resetAllData();
    showToast('Local data cleared. Refresh the page.', 'info');
    location.reload();
  } catch (err) {
    showToast('Reset failed: ' + err.message, 'error');
  }
}

/* ── Attach functions referenced by inline HTML on* handlers ── */
Object.assign(window, {
  nextOnboardingStep, connectGoogleSheet, resetApp, bootApp,
  createManagerAccount, selectLoginUser, cancelPinEntry, submitLoginPin,
  pickCheckInStore, confirmCheckIn, handleUserBadgeClick, closeShiftSummary,
  switchStockLocation
});
