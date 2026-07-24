/* ═══════════════════════════════════════════════
   UI Helpers & Rendering
   ═══════════════════════════════════════════════ */

import {
  getAllProducts, getProductByBarcode, dbSaveProduct, updateStock,
  saveTransaction, getAllTransactions, getTransactionsForPeriod, enqueueSync,
  getAllSettings, saveSetting, getSetting, exportAllData,
  getAllStores, saveStore, getAllUsers, getUserById, saveUser
} from './db.js';
import { triggerSync } from './sheets.js';
import { showReceipt } from './receipt.js';
import {
  ROLES, ROLE_LABELS, canAccess, roleHomePage, generateId, hashPin,
  getCurrentUser, getCurrentSession, getCurrentStoreId
} from './auth.js';

export function $(id) { return document.getElementById(id); }

/* ── Product Categories ──
   Falls back to this list until the app has synced a Categories sheet
   (or if no Google Sheet is connected at all). ── */
const DEFAULT_CATEGORIES = ['Beverages', 'Food & Grains', 'Dairy', 'Toiletries', 'Household', 'Electronics', 'Pharmacy', 'Other'];

async function getCategoryList() {
  const stored = await getSetting('categories');
  return (Array.isArray(stored) && stored.length > 0) ? stored : DEFAULT_CATEGORIES;
}

function categoryOptionsHtml(categories, selected, placeholder) {
  const opts = [`<option value="">${placeholder}</option>`];
  categories.forEach(c => {
    opts.push(`<option value="${escapeHtml(c)}" ${selected === c ? 'selected' : ''}>${escapeHtml(c)}</option>`);
  });
  return opts.join('');
}

async function populateProductCategorySelect() {
  const select = $('pf-category');
  if (!select) return;
  const current = select.value;
  select.innerHTML = categoryOptionsHtml(await getCategoryList(), current, '— Select —');
}

/* ── Store scoping helper ──
   Manager sees every store aggregated (storeId = null → no filter);
   everyone else is scoped to whichever store they're currently working. ── */
function scopeStoreId() {
  const user = getCurrentUser();
  if (!user) return null;
  return user.role === ROLES.MANAGER ? null : getCurrentStoreId();
}

/* ── Toast Notifications ── */
export function showToast(message, type = 'info', duration = 3500) {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, duration);
}

/* ── Format Currency ── */
export function formatCurrency(amount, currency = 'XAF') {
  const num = Number(amount) || 0;
  // Use space as thousands separator (French/West African convention)
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 0 }) + ' ' + currency;
}

/* ── Format Date ── */
function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
         ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/* ── Stock Level Class ── */
export function stockLevelClass(quantity, threshold) {
  const q = Number(quantity) || 0;
  const t = Number(threshold) || 5;
  if (q === 0) return 'stock-out';
  if (q <= t) return 'stock-low';
  return 'stock-ok';
}

function stockLabel(quantity, threshold) {
  const q = Number(quantity) || 0;
  const t = Number(threshold) || 5;
  if (q === 0) return 'OUT OF STOCK';
  if (q <= t) return `Low (${q})`;
  return `${q} in stock`;
}

/* ── Generate Transaction ID ── */
function generateTransactionId() {
  const now = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g,'');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${date}-${rand}`;
}

/* ── Dashboard ── */
export async function renderDashboard() {
  try {
    const storeId = scopeStoreId();
    const products = await getAllProducts(storeId);
    const todayTxns = await getTransactionsForPeriod('today', storeId);
    const weekTxns = await getTransactionsForPeriod('week', storeId);

    const todayTotal = todayTxns.reduce((s, t) => s + (t.total || 0), 0);
    const weekTotal = weekTxns.reduce((s, t) => s + (t.total || 0), 0);
    const lowStock = products.filter(p => (p.stockQuantity || 0) <= (p.lowStockThreshold || 5));

    $('dash-today-sales').textContent = formatCurrency(todayTotal);
    $('dash-product-count').textContent = products.length;
    $('dash-low-stock').textContent = lowStock.length;
    $('dash-week-sales').textContent = formatCurrency(weekTotal);

    // Recent sales
    const recent = todayTxns.slice(0, 5);
    const container = $('dash-recent-sales');
    if (recent.length === 0) {
      container.innerHTML = '<p class="text-muted">No sales yet. Start scanning!</p>';
    } else {
      container.innerHTML = recent.map(t => `
        <div class="sale-card" style="margin-bottom:0.4rem;">
          <div class="sale-header">
            <span class="sale-id">${t.transactionId}</span>
            <span class="sale-total">${formatCurrency(t.total)}</span>
          </div>
          <div class="sale-items">${t.items ? t.items.length + ' item(s)' : ''}</div>
          <div class="sale-meta">${formatShortDate(t.createdAt)} · ${t.paymentMethod || 'cash'} · ${escapeHtml(t.cashierName || '—')}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Dashboard render error:', err);
  }
}

/* ── Products List ── */
export async function renderProducts(searchTerm = '') {
  try {
    let products = await getAllProducts(scopeStoreId());
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      products = products.filter(p =>
        (p.productName || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }
    // Sort: stock out first, then low stock, then alphabetically
    products.sort((a, b) => {
      const aStock = (a.stockQuantity || 0) <= (a.lowStockThreshold || 5) ? 0 : 1;
      const bStock = (b.stockQuantity || 0) <= (b.lowStockThreshold || 5) ? 0 : 1;
      if (aStock !== bStock) return aStock - bStock;
      return (a.productName || '').localeCompare(b.productName || '');
    });

    const container = $('products-list');
    if (products.length === 0) {
      container.innerHTML = '<p class="text-muted">No products yet. Scan your first item!</p>';
      return;
    }

    container.innerHTML = products.map(p => {
      const slClass = stockLevelClass(p.stockQuantity, p.lowStockThreshold);
      const slLabel = stockLabel(p.stockQuantity, p.lowStockThreshold);
      return `
        <div class="product-card" onclick="openEditProduct('${p.barcode}')">
          <div class="p-color ${slClass}"></div>
          <div class="p-info">
            <div class="p-name">${escapeHtml(p.productName || 'Unknown')}</div>
            <div class="p-barcode">${p.barcode || ''}</div>
            <div class="p-details">
              <span>${formatCurrency(p.sellingPrice)}</span>
              <span class="p-stock ${slClass}">${slLabel}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Products render error:', err);
  }
}

function filterProducts() {
  renderProducts($('product-search').value);
}

/* ── Sales History (Manager only — store + cashier attribution) ── */
async function renderSales() {
  try {
    const storeFilterEl = $('sales-store-filter');
    if (storeFilterEl && storeFilterEl.dataset.loaded !== 'true') {
      const stores = await getAllStores();
      storeFilterEl.innerHTML = '<option value="">All Stores</option>' +
        stores.map(s => `<option value="${s.storeId}">${escapeHtml(s.storeName)}</option>`).join('');
      storeFilterEl.dataset.loaded = 'true';
    }

    const filter = $('sales-filter').value;
    const storeId = storeFilterEl ? storeFilterEl.value : '';
    const txs = await getTransactionsForPeriod(filter, storeId || null);
    $('sales-count').textContent = txs.length + ' sales';

    const container = $('sales-history-list');
    if (txs.length === 0) {
      container.innerHTML = '<p class="text-muted">No sales recorded yet.</p>';
      return;
    }

    container.innerHTML = txs.map(t => {
      const itemsStr = t.items
        ? t.items.map(i => `${i.productName} ×${i.quantity}`).join(', ')
        : '';
      return `
        <div class="sale-card">
          <div class="sale-header">
            <span class="sale-id">${t.transactionId}</span>
            <span class="sale-total">${formatCurrency(t.total)}</span>
          </div>
          <div class="sale-items">${itemsStr}</div>
          <div class="sale-meta">
            <span>${formatDate(t.createdAt)}</span>
            <span>· ${t.paymentMethod || 'cash'}</span>
            <span>· 👤 ${escapeHtml(t.cashierName || 'Unknown')}${t.storeName ? ' @ ' + escapeHtml(t.storeName) : ''}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Sales render error:', err);
  }
}

/* ── Stock Alerts ── */
export async function renderAlerts() {
  try {
    const products = await getAllProducts(scopeStoreId());
    const outOfStock = products.filter(p => (p.stockQuantity || 0) === 0);
    const lowStock = products.filter(p => {
      const q = p.stockQuantity || 0;
      return q > 0 && q <= (p.lowStockThreshold || 5);
    });

    $('alert-out-of-stock').textContent = outOfStock.length;
    $('alert-low-stock').textContent = lowStock.length;

    const allAlerts = [...outOfStock, ...lowStock];
    const container = $('alerts-list');

    if (allAlerts.length === 0) {
      container.innerHTML = '<p class="text-muted">No alerts — everything is well stocked!</p>';
    } else {
      container.innerHTML = allAlerts.map(p => {
        const isOut = (p.stockQuantity || 0) === 0;
        return `
          <div class="alert-card">
            <span class="alert-icon">${isOut ? '🚫' : '⚠️'}</span>
            <div class="alert-info">
              <div class="alert-name">${escapeHtml(p.productName || 'Unknown')}</div>
              <div class="alert-detail">
                ${isOut ? 'Out of stock!' : `Only ${p.stockQuantity} left (threshold: ${p.lowStockThreshold || 5})`}
                · Price: ${formatCurrency(p.sellingPrice)}
              </div>
            </div>
            <button class="btn btn-ghost small alert-action" onclick="navigate('add-product')">📷 Restock</button>
          </div>
        `;
      }).join('');
    }

    updateAlertsBadge(allAlerts.length);
  } catch (err) {
    console.error('Alerts render error:', err);
  }
}

/* Quiet reorder-notification badge on the Stock Alerts nav item —
   visible without needing to open the page, no popups. */
function updateAlertsBadge(count) {
  ['sidebar-alerts-badge', 'bottom-alerts-badge'].forEach(id => {
    const el = $(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });
}

export async function refreshAlertsBadge() {
  const user = getCurrentUser();
  if (!user || !canAccess(user.role, 'alerts')) return;
  try {
    const products = await getAllProducts(scopeStoreId());
    const count = products.filter(p => (p.stockQuantity || 0) <= (p.lowStockThreshold || 5)).length;
    updateAlertsBadge(count);
  } catch (err) { /* non-critical */ }
}

/* ── Checkout Helpers ── */
let checkoutItems = [];

function resetCheckout() {
  checkoutItems = [];
  updateInvoiceUI();
}

function updateInvoiceUI() {
  if (checkoutItems.length === 0) {
    $('checkout-empty-state').classList.remove('hidden');
    $('checkout-active').classList.add('hidden');
    $('btn-complete-sale').disabled = true;
    return;
  }
  $('checkout-empty-state').classList.add('hidden');
  $('checkout-active').classList.remove('hidden');

  const container = $('invoice-items');
  const total = checkoutItems.reduce((s, i) => s + (i.lineTotal || i.quantity * i.unitPrice), 0);
  const count = checkoutItems.reduce((s, i) => s + i.quantity, 0);

  $('checkout-item-count').textContent = count + ' item(s)';
  $('checkout-total').textContent = formatCurrency(total);
  $('btn-complete-sale').disabled = false;

  container.innerHTML = checkoutItems.map((item, idx) => {
    const lt = item.lineTotal || (item.quantity * item.unitPrice);
    return `
      <div class="invoice-item">
        <span class="item-name">${escapeHtml(item.productName || item.barcode)}</span>
        <div class="item-qty">
          <button onclick="adjustCheckoutQty(${idx}, -1)">−</button>
          <span>${item.quantity}</span>
          <button onclick="adjustCheckoutQty(${idx}, 1)">+</button>
        </div>
        <span class="item-price">${formatCurrency(lt)}</span>
        <button class="item-remove" onclick="removeCheckoutItem(${idx})">✕</button>
      </div>
    `;
  }).join('');
}

export function addToCheckout(product, quantity = 1) {
  const existing = checkoutItems.find(i => i.barcode === product.barcode);
  if (existing) {
    existing.quantity += quantity;
    existing.lineTotal = existing.quantity * existing.unitPrice;
  } else {
    checkoutItems.push({
      barcode: product.barcode,
      productName: product.productName,
      quantity: quantity,
      unitPrice: product.sellingPrice,
      lineTotal: product.sellingPrice * quantity
    });
  }
  updateInvoiceUI();
}

function adjustCheckoutQty(idx, delta) {
  const item = checkoutItems[idx];
  if (!item) return;
  item.quantity = Math.max(1, item.quantity + delta);
  item.lineTotal = item.quantity * item.unitPrice;
  updateInvoiceUI();
}

function removeCheckoutItem(idx) {
  checkoutItems.splice(idx, 1);
  updateInvoiceUI();
}

function voidCheckout() {
  if (checkoutItems.length === 0) return;
  if (!confirm('Cancel this sale? All items will be cleared.')) return;
  resetCheckout();
  showToast('Sale cancelled', 'warning');
}

function showPaymentModal() {
  if (checkoutItems.length === 0) return;
  const total = checkoutItems.reduce((s, i) => s + i.lineTotal, 0);
  $('pay-total-display').textContent = formatCurrency(total);
  $('pay-tendered').value = '';
  $('pay-change').textContent = '0 FCFA';
  $('pay-method').value = 'cash';
  $('btn-finalize').disabled = true;
  $('payment-modal').classList.remove('hidden');
  setTimeout(() => $('pay-tendered').focus(), 300);
}

function closePaymentModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('payment-modal').classList.add('hidden');
}

function calculateChange() {
  const total = checkoutItems.reduce((s, i) => s + i.lineTotal, 0);
  const tendered = parseFloat($('pay-tendered').value) || 0;
  const change = tendered - total;
  $('pay-change').textContent = formatCurrency(Math.max(0, change));
  $('btn-finalize').disabled = (tendered < total || tendered <= 0);
}

async function finalizeSale() {
  const total = checkoutItems.reduce((s, i) => s + i.lineTotal, 0);
  const tendered = parseFloat($('pay-tendered').value) || 0;
  if (tendered < total) {
    showToast('Amount tendered is less than total', 'error');
    return;
  }

  const user = getCurrentUser();
  const session = getCurrentSession();
  const storeId = getCurrentStoreId();
  const store = (await getAllStores()).find(s => s.storeId === storeId);

  const method = $('pay-method').value;
  const change = tendered - total;
  const transactionId = generateTransactionId();

  // Record sale locally — stamped with who sold it, where, and which shift
  const transaction = {
    transactionId,
    storeId: storeId || '',
    storeName: store ? store.storeName : '',
    cashierId: user ? user.userId : '',
    cashierName: user ? user.name : '',
    sessionId: session ? session.sessionId : '',
    items: checkoutItems.map(i => ({ ...i })),
    subtotal: total,
    taxAmount: 0,
    total,
    amountTendered: tendered,
    change,
    paymentMethod: method,
    status: 'completed',
    createdAt: new Date().toISOString()
  };

  try {
    // Decrement stock for each item
    for (const item of checkoutItems) {
      await updateStock(storeId, item.barcode, -item.quantity);
    }
    // Save transaction
    await saveTransaction(transaction);

    // Enqueue for Google Sheets sync
    await enqueueSync('addSale', transaction);
    for (const item of checkoutItems) {
      await enqueueSync('updateStock', { storeId, barcode: item.barcode, quantity: -item.quantity });
    }

    // Show receipt
    const storeName = transaction.storeName || (await getSetting('storeName')) || 'My Store';
    const currency = await getSetting('currency') || 'XAF';
    $('payment-modal').classList.add('hidden');
    showReceipt(transaction, storeName, currency);

    // Trigger sync
    triggerSync();
    refreshAlertsBadge();

  } catch (err) {
    console.error('Finalize sale error:', err);
    showToast('Error saving sale: ' + err.message, 'error');
  }
}

function startNewCheckout() {
  resetCheckout();
}

/* ── Edit Product ── */
async function openEditProduct(barcode) {
  try {
    const storeId = scopeStoreId() || getCurrentStoreId();
    const product = await getProductByBarcode(storeId, barcode);
    if (!product) { showToast('Product not found', 'error'); return; }

    const categories = await getCategoryList();
    const form = $('edit-product-form');
    form.innerHTML = `
      <div class="form-group">
        <label>Barcode</label>
        <input type="text" id="ep-barcode" class="input" value="${escapeHtml(product.barcode)}" readonly>
      </div>
      <div class="form-group">
        <label>Product Name</label>
        <input type="text" id="ep-name" class="input" value="${escapeHtml(product.productName || '')}">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="ep-category" class="input">
          ${categoryOptionsHtml(categories, product.category, '—')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Selling Price (FCFA)</label>
          <input type="number" id="ep-price" class="input" value="${product.sellingPrice || 0}" min="0">
        </div>
        <div class="form-group">
          <label>Cost Price</label>
          <input type="number" id="ep-cost" class="input" value="${product.costPrice || 0}" min="0">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Stock Qty</label>
          <input type="number" id="ep-stock" class="input" value="${product.stockQuantity || 0}" min="0">
        </div>
        <div class="form-group">
          <label>Alert At</label>
          <input type="number" id="ep-threshold" class="input" value="${product.lowStockThreshold || 5}" min="0">
        </div>
      </div>
    `;
    window._editingBarcode = barcode;
    window._editingStoreId = storeId;
    $('edit-product-modal').classList.remove('hidden');
  } catch (err) {
    console.error('Edit product error:', err);
  }
}

function closeEditModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('edit-product-modal').classList.add('hidden');
}

async function saveEditProduct() {
  try {
    const barcode = window._editingBarcode;
    const storeId = window._editingStoreId;
    const product = await getProductByBarcode(storeId, barcode);
    if (!product) { showToast('Product not found', 'error'); return; }

    product.productName = $('ep-name').value.trim() || product.productName;
    product.category = $('ep-category').value;
    product.sellingPrice = parseFloat($('ep-price').value) || 0;
    product.costPrice = parseFloat($('ep-cost').value) || 0;
    product.stockQuantity = parseInt($('ep-stock').value) || 0;
    product.lowStockThreshold = parseInt($('ep-threshold').value) || 5;

    await dbSaveProduct(product);
    await enqueueSync('updateProduct', product);

    $('edit-product-modal').classList.add('hidden');
    showToast('Product updated!', 'success');
    renderProducts();
    renderDashboard();
    renderAlerts();
    triggerSync();
  } catch (err) {
    console.error('Save edit error:', err);
    showToast('Error saving: ' + err.message, 'error');
  }
}

/* ── Product Form (Add Product Page) ── */
function showManualProductForm() {
  $('product-form').classList.remove('hidden');
  $('pf-barcode').value = '';
  $('pf-barcode').readOnly = false;
  $('pf-barcode').focus();
  window.stopProductScanner?.();
}

function resetProductForm() {
  $('product-form').classList.add('hidden');
  ['pf-barcode','pf-name','pf-price','pf-cost','pf-stock','pf-threshold'].forEach(id => {
    const el = $(id);
    if (el) el.value = '';
  });
  $('pf-stock').value = '10';
  $('pf-threshold').value = '5';
  $('pf-category').value = '';
  $('pf-unit').value = 'piece';
}

async function saveProduct() {
  const barcode = $('pf-barcode').value.trim();
  const name = $('pf-name').value.trim();
  const price = parseFloat($('pf-price').value);
  const cost = parseFloat($('pf-cost').value) || 0;
  const stock = parseInt($('pf-stock').value) || 0;
  const threshold = parseInt($('pf-threshold').value) || 5;
  const storeId = getCurrentStoreId();

  if (!barcode) { showToast('Please enter a barcode', 'error'); return; }
  if (!name) { showToast('Please enter product name', 'error'); return; }
  if (!price || price <= 0) { showToast('Please enter a valid selling price', 'error'); return; }
  if (!storeId) { showToast('No store selected', 'error'); return; }

  try {
    const existing = await getProductByBarcode(storeId, barcode);
    if (existing && existing.productName !== name) {
      if (!confirm(`Product "${existing.productName}" already exists with this barcode. Update it?`)) return;
    }

    const product = {
      barcode,
      storeId,
      productName: name,
      category: $('pf-category').value || 'Other',
      sellingPrice: price,
      costPrice: cost,
      unit: $('pf-unit').value || 'piece',
      stockQuantity: stock,
      lowStockThreshold: threshold,
      isArchived: false
    };

    await dbSaveProduct(product);
    await enqueueSync('addProduct', product);

    showToast(`✅ "${name}" saved!`, 'success');
    resetProductForm();
    window.stopProductScanner?.();
    renderProducts();
    renderDashboard();
    refreshAlertsBadge();
    triggerSync();
  } catch (err) {
    console.error('Save product error:', err);
    showToast('Error saving product: ' + err.message, 'error');
  }
}

/* ── Quick Add Product (from Checkout, when a scanned barcode isn't found) ── */
export async function showQuickAddProduct(barcode) {
  $('qa-barcode').value = barcode;
  $('qa-name').value = '';
  $('qa-price').value = '';
  $('qa-stock').value = '10';
  $('qa-category').innerHTML = categoryOptionsHtml(await getCategoryList(), '', '— Select —');
  $('quick-add-modal').classList.remove('hidden');
  setTimeout(() => $('qa-name').focus(), 200);
}

function closeQuickAddModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('quick-add-modal').classList.add('hidden');
}

async function saveQuickAddProduct() {
  const barcode = $('qa-barcode').value.trim();
  const name = $('qa-name').value.trim();
  const price = parseFloat($('qa-price').value);
  const stock = parseInt($('qa-stock').value) || 0;
  const storeId = getCurrentStoreId();

  if (!name) { showToast('Please enter product name', 'error'); return; }
  if (!price || price <= 0) { showToast('Please enter a valid selling price', 'error'); return; }

  try {
    const product = {
      barcode,
      storeId,
      productName: name,
      category: $('qa-category').value || 'Other',
      sellingPrice: price,
      costPrice: 0,
      unit: 'piece',
      stockQuantity: stock,
      lowStockThreshold: 5,
      isArchived: false
    };

    await dbSaveProduct(product);
    await enqueueSync('addProduct', product);

    closeQuickAddModal();
    addToCheckout(product);
    showToast(`✅ "${name}" added to sale`, 'success');
    renderProducts();
    renderDashboard();
    triggerSync();
  } catch (err) {
    console.error('Quick add product error:', err);
    showToast('Error saving product: ' + err.message, 'error');
  }
}

/* ── Team (Users) Management — Manager only ── */
export async function renderUsers() {
  try {
    const [users, stores] = await Promise.all([getAllUsers(), getAllStores()]);

    const storesBox = $('nu-stores');
    if (storesBox) {
      storesBox.innerHTML = stores.length > 0
        ? stores.map(s => `<label class="checkbox-row"><input type="checkbox" value="${s.storeId}" class="nu-store-cb"> ${escapeHtml(s.storeName)}</label>`).join('')
        : '<p class="text-muted small">Add a store first.</p>';
    }

    const storeName = (id) => (stores.find(s => s.storeId === id) || {}).storeName || id;
    const list = $('users-list');
    if (users.length === 0) {
      list.innerHTML = '<p class="text-muted">No team members yet.</p>';
      return;
    }
    list.innerHTML = users
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(u => `
        <div class="product-card">
          <div class="p-info">
            <div class="p-name">${escapeHtml(u.name)} <span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span></div>
            <div class="p-details">
              <span>${(u.storeIds || []).map(storeName).join(', ') || 'No store assigned'}</span>
              <span class="${u.isActive === false ? 'stock-out' : 'stock-ok'}">${u.isActive === false ? 'Inactive' : 'Active'}</span>
            </div>
          </div>
          <button class="btn btn-ghost small" onclick="toggleUserActive('${u.userId}')">${u.isActive === false ? 'Reactivate' : 'Deactivate'}</button>
        </div>
      `).join('');
  } catch (err) {
    console.error('Render users error:', err);
  }
}

async function addTeamMember() {
  const name = $('nu-name').value.trim();
  const role = $('nu-role').value;
  const pin = $('nu-pin').value.trim();
  const pinConfirm = $('nu-pin-confirm').value.trim();
  const storeIds = Array.from(document.querySelectorAll('.nu-store-cb:checked')).map(cb => cb.value);

  if (!name) { showToast('Enter a name', 'error'); return; }
  const minLen = role === ROLES.MANAGER ? 6 : 4;
  if (!new RegExp(`^\\d{${minLen},8}$`).test(pin)) { showToast(`PIN must be at least ${minLen} digits`, 'error'); return; }
  if (pin !== pinConfirm) { showToast('PINs do not match', 'error'); return; }
  if (storeIds.length === 0) { showToast('Assign at least one store', 'error'); return; }

  try {
    const pinHash = await hashPin(pin);
    const user = { userId: generateId('USR'), name, role, pinHash, storeIds, isActive: true };
    await saveUser(user);
    await enqueueSync('addUser', user);

    showToast(`✅ ${name} added as ${ROLE_LABELS[role]}`, 'success');
    $('nu-name').value = '';
    $('nu-pin').value = '';
    $('nu-pin-confirm').value = '';
    document.querySelectorAll('.nu-store-cb').forEach(cb => cb.checked = false);
    renderUsers();
    triggerSync();
  } catch (err) {
    showToast('Error adding team member: ' + err.message, 'error');
  }
}

async function toggleUserActive(userId) {
  try {
    const user = await getUserById(userId);
    if (!user) return;
    user.isActive = user.isActive === false;
    await saveUser(user);
    await enqueueSync('updateUser', user);
    renderUsers();
    triggerSync();
  } catch (err) {
    showToast('Error updating team member: ' + err.message, 'error');
  }
}

/* ── Stores Management — Manager only ── */
export async function renderStores() {
  try {
    const stores = await getAllStores();
    const list = $('stores-list');
    if (stores.length === 0) {
      list.innerHTML = '<p class="text-muted">No stores yet.</p>';
      return;
    }
    list.innerHTML = stores.map(s => `
      <div class="product-card">
        <div class="p-info">
          <div class="p-name">${escapeHtml(s.storeName)}</div>
          <div class="p-details"><span>${escapeHtml(s.location || 'No location set')}</span></div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Render stores error:', err);
  }
}

async function addStore() {
  const name = $('ns-name').value.trim();
  const location = $('ns-location').value.trim();
  if (!name) { showToast('Enter a store name', 'error'); return; }

  try {
    const store = { storeId: generateId('STORE'), storeName: name, location };
    await saveStore(store);
    await enqueueSync('addStore', store);

    showToast(`✅ "${name}" added`, 'success');
    $('ns-name').value = '';
    $('ns-location').value = '';
    renderStores();
    triggerSync();
  } catch (err) {
    showToast('Error adding store: ' + err.message, 'error');
  }
}

/* ── Settings ── */
export async function loadSettings() {
  try {
    const settings = await getAllSettings();
    if (settings.storeName) {
      $('set-store-name').value = settings.storeName;
      $('sidebar-store-name').textContent = settings.storeName;
    }
    if (settings.currency) $('set-currency').value = settings.currency;
    if (settings.gasUrl) $('set-gas-url').value = settings.gasUrl;
  } catch (err) {
    console.error('Load settings error:', err);
  }
}

async function saveStoreSetting(key, value) {
  try {
    await saveSetting(key, value);
    if (key === 'storeName') {
      $('sidebar-store-name').textContent = value || 'My Store';
    }
    showToast('Setting saved', 'success');
  } catch (err) {
    console.error('Save setting error:', err);
  }
}

async function testSheetConnection() {
  const url = $('set-gas-url').value.trim();
  if (!url) { showToast('Please enter the Web App URL', 'error'); return; }

  $('sheet-connection-status').textContent = 'Testing...';
  try {
    const response = await fetch(url + '?action=ping');
    const data = await response.json();
    if (data.status === 'ok') {
      await saveSetting('gasUrl', url);
      $('sheet-connection-status').textContent = '✅ Connected!';
      showToast('Google Sheets connected!', 'success');
      updateSyncStatus('ok');
    } else {
      $('sheet-connection-status').textContent = '❌ Unexpected response';
      showToast('Connection test failed', 'error');
    }
  } catch (err) {
    $('sheet-connection-status').textContent = '❌ Cannot reach URL — redeploy the Apps Script as a new version, or check "Anyone" has access';
    showToast('Connection error: ' + err.message, 'error', 6000);
  }
}

/* ── Role-aware Navigation ── */
const PAGE_TITLES = {
  dashboard: 'Dashboard', checkout: 'Checkout', 'add-product': 'Add Product',
  products: 'Inventory', sales: 'Sales History', alerts: 'Stock Alerts',
  users: 'Team', stores: 'Stores', settings: 'Settings'
};

export function navigate(page) {
  const user = getCurrentUser();
  if (user && !canAccess(user.role, page)) {
    page = roleHomePage(user.role);
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = $('page-' + page);
  if (target) {
    target.classList.add('active');
    $('page-title').textContent = PAGE_TITLES[page] || page.charAt(0).toUpperCase() + page.slice(1);
  }

  // Update nav active state (sidebar + bottom nav both use data-page)
  document.querySelectorAll('[data-page]').forEach(n => n.classList.remove('active'));
  document.querySelectorAll(`[data-page="${page}"]`).forEach(n => n.classList.add('active'));

  closeSidebar();

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'add-product': populateProductCategorySelect(); break;
    case 'products': renderProducts(); break;
    case 'sales': renderSales(); break;
    case 'alerts': renderAlerts(); break;
    case 'settings': loadSettings(); break;
    case 'users': renderUsers(); break;
    case 'stores': renderStores(); break;
    case 'checkout': break; // already rendered
  }

  refreshAlertsBadge();
}

/* ── Role-based sidebar + bottom nav ── */
const PAGE_CONFIG = {
  dashboard: { icon: '📊', label: 'Dashboard', navLabel: 'Home' },
  checkout: { icon: '🛒', label: 'Checkout', navLabel: 'Sell' },
  'add-product': { icon: '📷', label: 'Scan Product', navLabel: 'Scan' },
  products: { icon: '📦', label: 'Inventory', navLabel: 'Stock' },
  sales: { icon: '📄', label: 'Sales History', navLabel: 'Sales' },
  alerts: { icon: '🔔', label: 'Stock Alerts', navLabel: 'Alerts' },
  users: { icon: '👤', label: 'Team', navLabel: 'Team' },
  stores: { icon: '🏪', label: 'Stores', navLabel: 'Stores' },
  settings: { icon: '⚙️', label: 'Settings', navLabel: 'Settings' }
};

const ROLE_SIDEBAR_PAGES = {
  manager: ['dashboard', 'checkout', 'add-product', 'products', 'sales', 'alerts', 'users', 'stores', 'settings'],
  stock_manager: ['add-product', 'products', 'alerts'],
  cashier: ['checkout']
};

const ROLE_BOTTOM_NAV_PAGES = {
  manager: ['dashboard', 'checkout', 'add-product', 'products', 'sales'],
  stock_manager: ['add-product', 'products', 'alerts'],
  cashier: ['checkout']
};

function navItemHtml(page, wrapper) {
  const cfg = PAGE_CONFIG[page];
  const badge = page === 'alerts'
    ? `<span class="nav-badge hidden" id="${wrapper}-alerts-badge"></span>`
    : '';
  return { cfg, badge };
}

export function renderRoleNav(user) {
  const sidebarPages = ROLE_SIDEBAR_PAGES[user.role] || [];
  const sidebarList = $('sidebar-nav-list');
  if (sidebarList) {
    sidebarList.innerHTML = sidebarPages.map(p => {
      const { cfg, badge } = navItemHtml(p, 'sidebar');
      return `<li><a href="#${p}" data-page="${p}" onclick="navigate('${p}')">${cfg.icon} ${cfg.label}${badge}</a></li>`;
    }).join('');
  }

  const bottomPages = ROLE_BOTTOM_NAV_PAGES[user.role] || [];
  const bottomNav = $('bottom-nav');
  if (bottomNav) {
    bottomNav.innerHTML = bottomPages.map(p => {
      const { cfg, badge } = navItemHtml(p, 'bottom');
      return `<button class="nav-item" data-page="${p}" onclick="navigate('${p}')"><span class="nav-icon">${cfg.icon}</span><span class="nav-label">${cfg.navLabel}</span>${badge}</button>`;
    }).join('');
  }

  refreshAlertsBadge();
}

export function updateCurrentUserBadge() {
  const user = getCurrentUser();
  const badge = $('current-user-name');
  if (!badge || !user) return;
  const session = getCurrentSession();
  const storeLabel = session ? ` · ${session.storeName}` : '';
  badge.textContent = `${user.name} (${ROLE_LABELS[user.role] || user.role})${storeLabel}`;
}

/* ── Sidebar ── */
function toggleSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('hidden');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.add('hidden');
}

/* ── Sync Status ── */
export function updateSyncStatus(status) {
  const header = $('app-header');
  const dot = $('sync-dot');
  header.classList.remove('sync-ok', 'sync-pending', 'sync-error', 'sync-offline');
  header.classList.add('sync-' + status);
  const labels = { ok: 'Synced', pending: 'Pending...', error: 'Sync error', offline: 'Offline' };
  dot.title = labels[status] || status;
}

/* ── Utility ── */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── Export Data ── */
async function exportData() {
  try {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barcodepos-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported!', 'success');
  } catch (err) {
    showToast('Export error: ' + err.message, 'error');
  }
}

/* ── Copy Template Link ── */
function copyTemplateLink(e) {
  e.preventDefault();
  const templateUrl = 'https://docs.google.com/spreadsheets/d/1X8cMqTz9qWpBJv5G5xF2nLq5qS8Yk3dRzqPv0oYb7kU/copy';
  // Show the URL and instructions in a toast
  showToast('📋 Template URL copied! Go to: ' + templateUrl, 'info', 8000);
  // Also copy to clipboard if available
  if (navigator.clipboard) {
    navigator.clipboard.writeText(templateUrl).catch(() => {});
  }
}

/* ── Attach functions referenced by inline HTML on* handlers ── */
Object.assign(window, {
  toggleSidebar, navigate, filterProducts, openEditProduct, closeEditModal,
  saveEditProduct, saveStoreSetting, testSheetConnection, exportData,
  adjustCheckoutQty, removeCheckoutItem, voidCheckout, showPaymentModal,
  closePaymentModal, calculateChange, finalizeSale, startNewCheckout,
  renderSales, resetProductForm, showManualProductForm, saveProduct,
  copyTemplateLink, closeQuickAddModal, saveQuickAddProduct,
  addTeamMember, toggleUserActive, addStore
});
