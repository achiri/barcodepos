/* ═══════════════════════════════════════════════
   IndexedDB Data Access Layer
   ═══════════════════════════════════════════════ */

const DB_NAME = 'BarcodePOS';
const DB_VERSION = 4;
export const DEFAULT_STORE_ID = 'default-store';

let _db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;

      if (!db.objectStoreNames.contains('transactions')) {
        const ts = db.createObjectStore('transactions', { keyPath: 'transactionId' });
        ts.createIndex('createdAt', 'createdAt', { unique: false });
        ts.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // New in v3: multi-store + user accounts + shift sessions
      if (!db.objectStoreNames.contains('stores')) {
        db.createObjectStore('stores', { keyPath: 'storeId' });
      }
      if (!db.objectStoreNames.contains('users')) {
        const us = db.createObjectStore('users', { keyPath: 'userId' });
        us.createIndex('role', 'role', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const ss = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        ss.createIndex('cashierId', 'cashierId', { unique: false });
        ss.createIndex('status', 'status', { unique: false });
      }

      // New in v4: stock movement audit trail (warehouse receipts, transfers)
      if (!db.objectStoreNames.contains('stockMovements')) {
        const sm = db.createObjectStore('stockMovements', { keyPath: 'movementId' });
        sm.createIndex('type', 'type', { unique: false });
        sm.createIndex('barcode', 'barcode', { unique: false });
        sm.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Products move from a barcode-only key to a storeId::barcode
      // compound key (id) so the same barcode can exist independently
      // in different stores. Existing rows (pre-multi-store) are
      // migrated into DEFAULT_STORE_ID so nothing is lost.
      if (db.objectStoreNames.contains('products')) {
        const oldStore = tx.objectStore('products');
        if (oldStore.keyPath === 'barcode') {
          const existing = [];
          oldStore.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) {
              existing.push(cursor.value);
              cursor.continue();
            } else {
              db.deleteObjectStore('products');
              const ps = db.createObjectStore('products', { keyPath: 'id' });
              ps.createIndex('storeId', 'storeId', { unique: false });
              ps.createIndex('barcode', 'barcode', { unique: false });
              ps.createIndex('name', 'productName', { unique: false });
              ps.createIndex('category', 'category', { unique: false });
              ps.createIndex('stockQuantity', 'stockQuantity', { unique: false });
              const newStore = tx.objectStore('products');
              existing.forEach(p => {
                p.storeId = p.storeId || DEFAULT_STORE_ID;
                p.id = p.storeId + '::' + p.barcode;
                newStore.put(p);
              });
            }
          };
        }
      } else {
        const ps = db.createObjectStore('products', { keyPath: 'id' });
        ps.createIndex('storeId', 'storeId', { unique: false });
        ps.createIndex('barcode', 'barcode', { unique: false });
        ps.createIndex('name', 'productName', { unique: false });
        ps.createIndex('category', 'category', { unique: false });
        ps.createIndex('stockQuantity', 'stockQuantity', { unique: false });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => { console.error('DB open error:', e.target.error); reject(e.target.error); };
  });
}

function getDB() {
  if (_db) return Promise.resolve(_db);
  return openDB();
}

/* ── Generic helpers ── */
function dbPut(storeName, value) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

function dbGetAll(storeName) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

function dbGetAllByIndex(storeName, indexName, value) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

function dbGetByKey(storeName, key) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

function dbDelete(storeName, key) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

function dbClear(storeName) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

/* ── Products (scoped per store) ── */
export function dbSaveProduct(product) {
  const now = new Date().toISOString();
  product.storeId = product.storeId || DEFAULT_STORE_ID;
  product.id = product.storeId + '::' + product.barcode;
  product.createdAt = product.createdAt || now;
  product.updatedAt = now;
  return dbPut('products', product);
}

export function getAllProducts(storeId) {
  const list = storeId ? dbGetAllByIndex('products', 'storeId', storeId) : dbGetAll('products');
  return list.then(products => products.filter(p => !p.isArchived));
}

export function getProductByBarcode(storeId, barcode) {
  return dbGetByKey('products', storeId + '::' + barcode);
}

export function deleteProduct(storeId, barcode) {
  return getProductByBarcode(storeId, barcode).then(product => {
    if (!product) return;
    product.isArchived = true;
    product.updatedAt = new Date().toISOString();
    return dbPut('products', product);
  });
}

export function updateStock(storeId, barcode, quantityChange) {
  return getProductByBarcode(storeId, barcode).then(product => {
    if (!product) throw new Error(`Product ${barcode} not found`);
    product.stockQuantity = Math.max(0, (product.stockQuantity || 0) + quantityChange);
    product.updatedAt = new Date().toISOString();
    return dbPut('products', product).then(() => product);
  });
}

/* ── Transactions ── */
export function saveTransaction(transaction) {
  transaction.createdAt = transaction.createdAt || new Date().toISOString();
  return dbPut('transactions', transaction);
}

export function getAllTransactions(storeId) {
  return dbGetAll('transactions').then(txs => {
    return txs.filter(t => t.status !== 'voided' && (!storeId || t.storeId === storeId))
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  });
}

export function getTransactionsForPeriod(period, storeId) {
  return getAllTransactions(storeId).then(txs => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return txs.filter(t => {
      const d = new Date(t.createdAt);
      switch (period) {
        case 'today': return d >= startOfDay;
        case 'week': return d >= startOfWeek;
        case 'month': return d >= startOfMonth;
        default: return true; // 'all'
      }
    });
  });
}

export function getTransactionsForSession(sessionId) {
  return dbGetAll('transactions').then(txs =>
    txs.filter(t => t.sessionId === sessionId && t.status !== 'voided')
  );
}

export function getTransactionById(id) {
  return dbGetByKey('transactions', id);
}

/* ── Sync Queue ── */
export function enqueueSync(action, payload) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      const req = tx.objectStore('syncQueue').add({
        action,
        payload,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString()
      });
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

export function getPendingSyncItems() {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readonly');
      const req = tx.objectStore('syncQueue').getAll();
      req.onsuccess = () => resolve(req.result.filter(i => i.status === 'pending'));
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

export function markSyncDone(id) {
  return dbDelete('syncQueue', id);
}

export function markSyncFailed(id) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      const store = tx.objectStore('syncQueue');
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          item.status = 'failed';
          item.retryCount = (item.retryCount || 0) + 1;
          store.put(item);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

export function clearSyncQueue() {
  return dbClear('syncQueue');
}

/* ── Settings ── */
export function saveSetting(key, value) {
  return dbPut('settings', { key, value, updatedAt: new Date().toISOString() });
}

export function getSetting(key) {
  return dbGetByKey('settings', key).then(s => s ? s.value : null);
}

export function getAllSettings() {
  return dbGetAll('settings').then(settings => {
    const map = {};
    settings.forEach(s => map[s.key] = s.value);
    return map;
  });
}

/* ── Stores ── */
export function saveStore(store) {
  store.createdAt = store.createdAt || new Date().toISOString();
  return dbPut('stores', store);
}

export function getAllStores() {
  return dbGetAll('stores');
}

export function getStoreById(storeId) {
  return dbGetByKey('stores', storeId);
}

/* ── Users ── */
export function saveUser(user) {
  const now = new Date().toISOString();
  user.createdAt = user.createdAt || now;
  user.updatedAt = now;
  return dbPut('users', user);
}

export function getAllUsers() {
  return dbGetAll('users');
}

export function getUserById(userId) {
  return dbGetByKey('users', userId);
}

/* ── Sessions (cashier shifts) ── */
export function saveSession(session) {
  return dbPut('sessions', session);
}

export function getSessionById(sessionId) {
  return dbGetByKey('sessions', sessionId);
}

export function getActiveSessionForUser(userId) {
  return dbGetAllByIndex('sessions', 'cashierId', userId).then(sessions =>
    sessions.find(s => s.status === 'active') || null
  );
}

export function getAllSessions() {
  return dbGetAll('sessions').then(sessions =>
    sessions.sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn))
  );
}

/* ── Stock Movements (warehouse receipts + transfers) ── */
export function saveStockMovement(movement) {
  movement.movementId = movement.movementId || 'MOV-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  movement.createdAt = movement.createdAt || new Date().toISOString();
  return dbPut('stockMovements', movement);
}

export function getAllStockMovements(filters) {
  return dbGetAll('stockMovements').then(movements => {
    let result = movements.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (filters) {
      if (filters.type) result = result.filter(m => m.type === filters.type);
      if (filters.barcode) result = result.filter(m => m.barcode === filters.barcode);
      if (filters.storeId) result = result.filter(m => m.fromStore === filters.storeId || m.toStore === filters.storeId);
    }
    return result;
  });
}

/* ── Warehouse Stock ──
   warehouseStock is a field on product objects. Unlike per-store stock
   (stockQuantity), updating the warehouse stock for a barcode updates
   EVERY product row with that barcode — warehouse is cross-store. ── */
export function updateWarehouseStock(barcode, quantityChange) {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');
      const index = store.index('barcode');
      const req = index.getAllKeys(barcode);
      req.onsuccess = () => {
        const keys = req.result;
        let completed = 0;
        keys.forEach(key => {
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            const product = getReq.result;
            if (product) {
              product.warehouseStock = Math.max(0, (product.warehouseStock || 0) + quantityChange);
              product.updatedAt = new Date().toISOString();
              store.put(product);
            }
            completed++;
            if (completed === keys.length) resolve();
          };
          getReq.onerror = (e) => reject(e.target.error);
        });
        if (keys.length === 0) resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

/* ── Compound: transfer stock between warehouse and/or shops ──
   type: 'warehouse_in' | 'warehouse_to_shop' | 'direct_to_shop'
   Returns the created movement record. ── */
export async function transferStock({ type, barcode, productName, quantity, fromStore, toStore, reference, performedBy, performedByName, notes }) {
  const movement = {
    type,
    barcode,
    productName: productName || '',
    quantity: Number(quantity) || 0,
    fromStore: fromStore || '',
    toStore: toStore || '',
    reference: reference || '',
    performedBy: performedBy || '',
    performedByName: performedByName || '',
    notes: notes || ''
  };

  switch (type) {
    case 'warehouse_in':
      // Goods arrive at warehouse → increase warehouse stock
      await updateWarehouseStock(barcode, movement.quantity);
      break;

    case 'warehouse_to_shop':
      // Move from warehouse to shop → decrease warehouse, increase shop
      await updateWarehouseStock(barcode, -movement.quantity);
      if (toStore) {
        await updateStock(toStore, barcode, movement.quantity);
      }
      break;

    case 'direct_to_shop':
      // Goods go directly to shop (bypass warehouse)
      if (toStore) {
        await updateStock(toStore, barcode, movement.quantity);
      }
      break;
  }

  await saveStockMovement(movement);
  await enqueueSync('addStockMovement', movement);
  return movement;
}

/* ── Reset ── */
export function resetAllData() {
  _db = null;
  return openDB().then(db => {
    return Promise.all([
      dbClear('products'),
      dbClear('transactions'),
      dbClear('syncQueue'),
      dbClear('settings'),
      dbClear('stores'),
      dbClear('users'),
      dbClear('sessions'),
      dbClear('stockMovements')
    ]);
  });
}

/* ── Export ── */
export function exportAllData() {
  return Promise.all([
    getAllProducts(),
    getAllTransactions(),
    getAllSettings(),
    getAllStores(),
    getAllUsers(),
    getAllStockMovements()
  ]).then(([products, transactions, settings, stores, users, stockMovements]) => ({
    exportedAt: new Date().toISOString(),
    storeName: settings.storeName || 'My Store',
    products,
    transactions,
    settings,
    stores,
    users: users.map(u => ({ ...u, pinHash: undefined })), // never export PIN hashes
    stockMovements
  }));
}
