/* ═══════════════════════════════════════════════
   Auth / Roles / Sessions
   Pure logic layer — no DOM. UI lives in app.js (login/check-in)
   and ui.js (in-app pages, user/store management).
   ═══════════════════════════════════════════════ */

import {
  getSetting, saveSetting, saveUser, getUserById,
  saveStore, getStoreById, saveSession, getSessionById,
  getActiveSessionForUser, getTransactionsForSession
} from './db.js';

export const ROLES = {
  MANAGER: 'manager',
  STOCK_MANAGER: 'stock_manager',
  CASHIER: 'cashier'
};

export const ROLE_LABELS = {
  manager: 'Manager',
  stock_manager: 'Stock Manager',
  cashier: 'Cashier'
};

/* Which pages each role may open. navigate() in ui.js enforces this. */
const ROLE_PAGES = {
  manager: ['dashboard', 'checkout', 'add-product', 'products', 'sales', 'alerts', 'users', 'stores', 'settings'],
  stock_manager: ['add-product', 'products', 'alerts'],
  cashier: ['checkout', 'sales']
};

export function canAccess(role, page) {
  return (ROLE_PAGES[role] || []).includes(page);
}

export function roleHomePage(role) {
  if (role === ROLES.CASHIER) return 'checkout';
  if (role === ROLES.STOCK_MANAGER) return 'products';
  return 'dashboard';
}

export function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── PIN hashing (SHA-256) ──
   This is a light deterrent, not real security: with a 4-6 digit PIN
   the keyspace is small enough to brute-force if someone already has
   read access to the sheet. It stops casual reading of PINs, no more. */
export async function hashPin(pin) {
  const data = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Current session state ── */
let currentUser = null;
let currentSession = null; // active cashier shift, if any
let currentStoreId = null; // "working store" for the logged-in user

export function getCurrentUser() { return currentUser; }
export function getCurrentSession() { return currentSession; }
export function getCurrentStoreId() { return currentStoreId; }

export async function setCurrentStoreId(storeId) {
  currentStoreId = storeId;
  await saveSetting('currentStoreId', storeId);
}

async function clearStoredSession() {
  await saveSetting('currentUserId', null);
  await saveSetting('currentSessionId', null);
  await saveSetting('currentStoreId', null);
}

/* Re-attach to whoever was logged in before a page reload. */
export async function restoreSession() {
  const userId = await getSetting('currentUserId');
  if (!userId) return null;

  const user = await getUserById(userId);
  if (!user || user.isActive === false) {
    await clearStoredSession();
    return null;
  }
  currentUser = user;

  const sessionId = await getSetting('currentSessionId');
  if (sessionId) {
    const session = await getSessionById(sessionId);
    currentSession = (session && session.status === 'active') ? session : null;
  }

  currentStoreId = (currentSession && currentSession.storeId)
    || await getSetting('currentStoreId')
    || (user.storeIds && user.storeIds[0])
    || null;

  return user;
}

export async function loginUser(userId, pin) {
  const user = await getUserById(userId);
  if (!user || user.isActive === false) throw new Error('User not found');

  const hash = await hashPin(pin);
  if (hash !== user.pinHash) throw new Error('Incorrect PIN');

  currentUser = user;
  await saveSetting('currentUserId', userId);
  user.lastLoginAt = new Date().toISOString();
  await saveUser(user);

  if (user.role === ROLES.CASHIER) {
    // Resume an existing shift if the app was closed mid-shift.
    const existing = await getActiveSessionForUser(userId);
    if (existing) {
      currentSession = existing;
      await setCurrentStoreId(existing.storeId);
    }
  } else if (user.storeIds && user.storeIds.length > 0) {
    await setCurrentStoreId(user.storeIds[0]);
  }

  return user;
}

export async function startShift(storeId) {
  if (!currentUser) throw new Error('Not logged in');
  const store = await getStoreById(storeId);
  const session = {
    sessionId: generateId('SES'),
    cashierId: currentUser.userId,
    cashierName: currentUser.name,
    storeId,
    storeName: store ? store.storeName : storeId,
    checkIn: new Date().toISOString(),
    checkOut: null,
    saleCount: 0,
    totalAmount: 0,
    status: 'active'
  };
  await saveSession(session);
  currentSession = session;
  await setCurrentStoreId(storeId);
  await saveSetting('currentSessionId', session.sessionId);
  return session;
}

export async function endShift() {
  if (!currentSession) return null;
  const txs = await getTransactionsForSession(currentSession.sessionId);
  currentSession.checkOut = new Date().toISOString();
  currentSession.saleCount = txs.length;
  currentSession.totalAmount = txs.reduce((s, t) => s + (t.total || 0), 0);
  currentSession.status = 'closed';
  await saveSession(currentSession);

  const summary = { ...currentSession };
  currentSession = null;
  await saveSetting('currentSessionId', null);
  return summary;
}

export async function logout() {
  currentUser = null;
  currentSession = null;
  currentStoreId = null;
  await clearStoredSession();
}
