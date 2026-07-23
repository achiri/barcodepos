/* ═══════════════════════════════════════════════
   IndexedDB Data Access Layer
   ═══════════════════════════════════════════════ */

const DB_NAME = 'BarcodePOS';
const DB_VERSION = 2;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        const ps = db.createObjectStore('products', { keyPath: 'barcode' });
        ps.createIndex('name', 'productName', { unique: false });
        ps.createIndex('category', 'category', { unique: false });
        ps.createIndex('stockQuantity', 'stockQuantity', { unique: false });
      }
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

/* ── Products ── */
function saveProduct(product) {
  const now = new Date().toISOString();
  product.createdAt = product.createdAt || now;
  product.updatedAt = now;
  return dbPut('products', product);
}

function getAllProducts() {
  return dbGetAll('products').then(products => {
    return products.filter(p => !p.isArchived);
  });
}

function getProductByBarcode(barcode) {
  return dbGetByKey('products', barcode);
}

function deleteProduct(barcode) {
  return dbPut('products', { barcode, isArchived: true, updatedAt: new Date().toISOString() });
}

function updateStock(barcode, quantityChange) {
  return getProductByBarcode(barcode).then(product => {
    if (!product) throw new Error(`Product ${barcode} not found`);
    product.stockQuantity = Math.max(0, (product.stockQuantity || 0) + quantityChange);
    product.updatedAt = new Date().toISOString();
    return dbPut('products', product).then(() => product);
  });
}

/* ── Transactions ── */
function saveTransaction(transaction) {
  transaction.createdAt = transaction.createdAt || new Date().toISOString();
  return dbPut('transactions', transaction);
}

function getAllTransactions() {
  return dbGetAll('transactions').then(txs => {
    return txs.filter(t => t.status !== 'voided')
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  });
}

function getTransactionsForPeriod(period) {
  return getAllTransactions().then(txs => {
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

function getTransactionById(id) {
  return dbGetByKey('transactions', id);
}

/* ── Sync Queue ── */
function enqueueSync(action, payload) {
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

function getPendingSyncItems() {
  return getDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readonly');
      const req = tx.objectStore('syncQueue').getAll();
      req.onsuccess = () => resolve(req.result.filter(i => i.status === 'pending'));
      req.onerror = (e) => reject(e.target.error);
    });
  });
}

function markSyncDone(id) {
  return dbDelete('syncQueue', id);
}

function markSyncFailed(id) {
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

function clearSyncQueue() {
  return dbClear('syncQueue');
}

/* ── Settings ── */
function saveSetting(key, value) {
  return dbPut('settings', { key, value, updatedAt: new Date().toISOString() });
}

function getSetting(key) {
  return dbGetByKey('settings', key).then(s => s ? s.value : null);
}

function getAllSettings() {
  return dbGetAll('settings').then(settings => {
    const map = {};
    settings.forEach(s => map[s.key] = s.value);
    return map;
  });
}

/* ── Reset ── */
function resetAllData() {
  _db = null;
  return openDB().then(db => {
    return Promise.all([
      dbClear('products'),
      dbClear('transactions'),
      dbClear('syncQueue'),
      dbClear('settings')
    ]);
  });
}

/* ── Export ── */
function exportAllData() {
  return Promise.all([
    getAllProducts(),
    getAllTransactions(),
    getAllSettings()
  ]).then(([products, transactions, settings]) => ({
    exportedAt: new Date().toISOString(),
    storeName: settings.storeName || 'My Store',
    products,
    transactions,
    settings
  }));
}
