/* ═══════════════════════════════════════════════
   UI Helpers & Rendering
   ═══════════════════════════════════════════════ */

import {
  getAllProducts, getProductByBarcode, dbSaveProduct, updateStock,
  saveTransaction, getAllTransactions, getTransactionsForPeriod, enqueueSync,
  getAllSettings, saveSetting, getSetting, exportAllData,
  getAllStores, saveStore, getStoreById, getAllUsers, getUserById, saveUser,
  transferStock, getAllStockMovements, updateWarehouseStock,
  getTransactionById
} from './db.js';
import { triggerSync } from './sheets.js';
import { showReceipt, generatePlainTextReceipt } from './receipt.js';
import { onQuickAddResolved } from './scanner.js';
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
   Stock manager at warehouse sees every store (global view);
   everyone else is scoped to whichever store they're currently working. ── */
function scopeStoreId() {
  const user = getCurrentUser();
  if (!user) return null;
  const storeId = getCurrentStoreId();
  if (user.role === ROLES.MANAGER) return null;
  if (user.role === ROLES.STOCK_MANAGER && storeId === '__warehouse__') return null;
  return storeId;
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

export function formatShortDate(isoString) {
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

/* A row stored at the virtual __warehouse__ location has no shop-facing
   stockQuantity — its real quantity is warehouseStock. Everywhere stock
   level (out/low/ok) is computed for a product row, use this instead of
   reading stockQuantity directly, so warehouse-only items aren't shown
   as falsely "out of stock". */
export function effectiveQty(p) {
  return p.storeId === '__warehouse__' ? (p.warehouseStock || 0) : (p.stockQuantity || 0);
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
    const lowStock = products.filter(p => effectiveQty(p) <= (p.lowStockThreshold || 5));

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
        <div class="sale-card" style="margin-bottom:0.4rem;cursor:pointer;" onclick="showSaleDetail('${t.transactionId}')">
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
    const scopedStoreId = scopeStoreId();
    let products = await getAllProducts(scopedStoreId);
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
      const aStock = effectiveQty(a) <= (a.lowStockThreshold || 5) ? 0 : 1;
      const bStock = effectiveQty(b) <= (b.lowStockThreshold || 5) ? 0 : 1;
      if (aStock !== bStock) return aStock - bStock;
      return (a.productName || '').localeCompare(b.productName || '');
    });

    const container = $('products-list');
    if (products.length === 0) {
      container.innerHTML = '<p class="text-muted">No products yet. Scan your first item!</p>';
      return;
    }

    // Aggregated (no single-store scope) — show which store each row
    // belongs to so a click always edits the right one.
    const isGlobalView = !scopedStoreId;
    const storeNameMap = isGlobalView ? await buildStoreNameMap() : {};

    container.innerHTML = products.map(p => {
      const qty = effectiveQty(p);
      const slClass = stockLevelClass(qty, p.lowStockThreshold);
      const slLabel = stockLabel(qty, p.lowStockThreshold);
      const storeTag = isGlobalView
        ? `<span class="p-store-tag">${escapeHtml(storeNameMap[p.storeId] || p.storeId || '—')}</span>`
        : '';
      return `
        <div class="product-card" onclick="openEditProduct('${p.barcode}', '${p.storeId}')">
          <div class="p-color ${slClass}"></div>
          <div class="p-info">
            <div class="p-name">${escapeHtml(p.productName || 'Unknown')} ${storeTag}</div>
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

/* Store names keyed by storeId, plus a friendly label for the virtual
   warehouse location — used to label rows in aggregated (all-store) views. */
async function buildStoreNameMap() {
  const stores = await getAllStores();
  const map = {};
  stores.forEach(s => { map[s.storeId] = s.storeName; });
  map['__warehouse__'] = '🏭 Warehouse';
  return map;
}

function filterProducts() {
  renderProducts($('product-search').value);
}

/* ── Sales History (role-aware — cashier sees only own sales) ── */
async function renderSales() {
  try {
    const user = getCurrentUser();
    const isCashier = user && user.role === ROLES.CASHIER;

    // Hide store filter for cashiers — they only see their own sales
    const storeFilterEl = $('sales-store-filter');
    if (storeFilterEl) {
      if (isCashier) {
        storeFilterEl.classList.add('hidden');
      } else {
        storeFilterEl.classList.remove('hidden');
        if (storeFilterEl.dataset.loaded !== 'true') {
          const stores = await getAllStores();
          storeFilterEl.innerHTML = '<option value="">All Stores</option>' +
            stores.map(s => `<option value="${s.storeId}">${escapeHtml(s.storeName)}</option>`).join('');
          storeFilterEl.dataset.loaded = 'true';
        }
      }
    }

    const filter = $('sales-filter').value;
    const storeId = storeFilterEl && !isCashier ? storeFilterEl.value : '';
    let txs = await getTransactionsForPeriod(filter, storeId || null);

    // Cashier: filter to only their own sales
    if (isCashier && user) {
      txs = txs.filter(t => t.cashierId === user.userId);
    }

    $('sales-count').textContent = txs.length + ' sale(s)';

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
        <div class="sale-card" onclick="showSaleDetail('${t.transactionId}')" style="cursor:pointer;">
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

/* ── Sale Detail Modal (view-only + download) ── */
async function showSaleDetail(transactionId) {
  try {
    const t = await getTransactionById(transactionId);
    if (!t) { showToast('Transaction not found', 'error'); return; }

    const store = await getStoreById(t.storeId || '');
    const storeName = t.storeName || (store ? store.storeName : '—');
    const items = t.items || [];
    const methodLabels = { cash: 'Cash', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer' };

    const content = $('sale-detail-content');
    content.innerHTML = `
      <div class="sale-detail-header">
        <div class="sale-detail-id">${t.transactionId}</div>
        <div class="sale-detail-date">${formatDate(t.createdAt)}</div>
      </div>
      <div class="sale-detail-info">
        <div><strong>Store:</strong> ${escapeHtml(storeName)}</div>
        <div><strong>Cashier:</strong> ${escapeHtml(t.cashierName || '—')}</div>
        <div><strong>Payment:</strong> ${methodLabels[t.paymentMethod] || t.paymentMethod || 'cash'}</div>
      </div>
      <hr>
      <div class="sale-detail-items">
        <div class="sale-detail-items-header">
          <span>Item</span><span>Qty</span><span>Price</span><span>Total</span>
        </div>
        ${items.map(i => {
          const lineTotal = i.lineTotal || (i.quantity * i.unitPrice);
          return `<div class="sale-detail-item-row">
            <span class="sale-detail-item-name">${escapeHtml(i.productName || i.barcode || 'Item')}</span>
            <span>×${i.quantity}</span>
            <span>${formatCurrency(i.unitPrice)}</span>
            <span>${formatCurrency(lineTotal)}</span>
          </div>`;
        }).join('')}
      </div>
      <hr>
      <div class="sale-detail-totals">
        <div class="sale-detail-total-row"><span>Subtotal</span><span>${formatCurrency(t.subtotal || t.total)}</span></div>
        <div class="sale-detail-total-row"><span>Tendered</span><span>${formatCurrency(t.amountTendered || 0)}</span></div>
        <div class="sale-detail-total-row"><span>Change</span><span>${formatCurrency(t.change || 0)}</span></div>
        <div class="sale-detail-total-row sale-detail-grand-total"><span>Total</span><span>${formatCurrency(t.total)}</span></div>
      </div>
    `;

    $('sale-detail-modal').classList.remove('hidden');
  } catch (err) {
    console.error('Show sale detail error:', err);
    showToast('Error loading sale details', 'error');
  }
}

function closeSaleDetailModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('sale-detail-modal').classList.add('hidden');
}

async function downloadSaleReceipt() {
  try {
    const content = $('sale-detail-content');
    if (!content) return;

    // Generate plain text receipt from the sale data
    // Extract transaction info from the rendered detail
    const idEl = content.querySelector('.sale-detail-id');
    const dateEl = content.querySelector('.sale-detail-date');
    if (!idEl) return;

    // Reconstruct transaction from DB
    const text = idEl.textContent;
    const t = await getTransactionById(text);
    if (!t) return;

    const storeName = t.storeName || (await getSetting('storeName')) || 'Receipt';
    const currency = await getSetting('currency') || 'XAF';

    // Build plain text receipt
    const plainText = generatePlainTextReceipt(t, storeName, currency);

    // Download as .txt
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${t.transactionId || 'sale'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Receipt downloaded!', 'success');
  } catch (err) {
    console.error('Download receipt error:', err);
    showToast('Error downloading receipt', 'error');
  }
}

/* ── Stock Alerts ── */
export async function renderAlerts() {
  try {
    const scopedStoreId = scopeStoreId();
    const products = await getAllProducts(scopedStoreId);
    const outOfStock = products.filter(p => effectiveQty(p) === 0);
    const lowStock = products.filter(p => {
      const q = effectiveQty(p);
      return q > 0 && q <= (p.lowStockThreshold || 5);
    });

    $('alert-out-of-stock').textContent = outOfStock.length;
    $('alert-low-stock').textContent = lowStock.length;

    const allAlerts = [...outOfStock, ...lowStock];
    const container = $('alerts-list');

    const isGlobalView = !scopedStoreId;
    const storeNameMap = isGlobalView ? await buildStoreNameMap() : {};

    if (allAlerts.length === 0) {
      container.innerHTML = '<p class="text-muted">No alerts — everything is well stocked!</p>';
    } else {
      container.innerHTML = allAlerts.map(p => {
        const qty = effectiveQty(p);
        const isOut = qty === 0;
        const storeTag = isGlobalView
          ? `<div class="text-muted small">📍 ${escapeHtml(storeNameMap[p.storeId] || p.storeId || '—')}</div>`
          : '';
        return `
          <div class="alert-card">
            <span class="alert-icon">${isOut ? '🚫' : '⚠️'}</span>
            <div class="alert-info">
              <div class="alert-name">${escapeHtml(p.productName || 'Unknown')}</div>
              ${storeTag}
              <div class="alert-detail">
                ${isOut ? 'Out of stock!' : `Only ${qty} left (threshold: ${p.lowStockThreshold || 5})`}
                · Price: ${formatCurrency(p.sellingPrice)}
              </div>
            </div>
            <button class="btn btn-ghost small alert-action" onclick="restockProduct('${p.barcode}', '${p.storeId}')">📷 Restock</button>
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
    const count = products.filter(p => effectiveQty(p) <= (p.lowStockThreshold || 5)).length;
    updateAlertsBadge(count);
  } catch (err) { /* non-critical */ }
}

/* ── Restock Product — navigate to add-product with form pre-filled ── */
async function restockProduct(barcode, explicitStoreId) {
  try {
    // A specific storeId (from a rendered card in an aggregated view)
    // always wins — otherwise fall back to searching locally, then globally.
    let storeId = explicitStoreId || getCurrentStoreId();
    let product = await getProductByBarcode(storeId, barcode);
    if (!product) {
      const allProducts = await getAllProducts();
      product = allProducts.find(p => p.barcode === barcode && (!explicitStoreId || p.storeId === explicitStoreId));
      if (product) storeId = product.storeId;
    }
    if (!product) { showToast('Product not found', 'error'); return; }

    // Remember exactly which store this restock is for, so saveProduct()
    // writes back there even if the stock manager is currently viewing
    // an aggregated (warehouse) list.
    window._restockTargetStoreId = storeId;

    // Navigate to add-product page
    navigate('add-product');

    // Wait for navigation to render, then pre-fill
    setTimeout(async () => {
      // Stop any running scanner
      window.stopProductScanner?.();

      // Show the form
      $('product-form').classList.remove('hidden');

      // Pre-fill all fields with existing product data
      $('pf-barcode').value = product.barcode;
      $('pf-barcode').readOnly = true;
      $('pf-name').value = product.productName || '';
      $('pf-category').value = product.category || '';
      $('pf-price').value = product.sellingPrice || '';
      $('pf-cost').value = product.costPrice || '';
      // Set stock to current + a default restock amount
      const currentStock = product.stockQuantity || 0;
      $('pf-stock').value = currentStock > 0 ? currentStock + 10 : 10;
      $('pf-threshold').value = product.lowStockThreshold || 5;
      $('pf-unit').value = product.unit || 'piece';

      window._restockTargetStoreId = storeId;
      await updateProductFormDestinationBanner();

      // Highlight and focus the stock field
      $('pf-stock').focus();
      $('pf-stock').select();

      showToast(`Restocking: ${product.productName}`, 'info');
    }, 300);
  } catch (err) {
    console.error('Restock product error:', err);
    showToast('Error loading product: ' + err.message, 'error');
  }
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
          <input type="number" class="qty-input" value="${item.quantity}" min="1" step="1"
                 onchange="setCheckoutQty(${idx}, this.value)"
                 onfocus="this.select()" inputmode="numeric">
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

function setCheckoutQty(idx, value) {
  const item = checkoutItems[idx];
  if (!item) return;
  const qty = parseInt(value) || 1;
  item.quantity = Math.max(1, qty);
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

    // Reset checkout immediately — sold items belong to the receipt now,
    // not the basket. This prevents stale items reappearing if the user
    // dismisses the receipt by clicking its backdrop or navigates away.
    resetCheckout();

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
async function openEditProduct(barcode, explicitStoreId) {
  try {
    // A specific storeId (from a rendered card in an aggregated view)
    // always wins — it identifies exactly which row was clicked.
    let storeId = explicitStoreId || scopeStoreId() || getCurrentStoreId();
    let product = await getProductByBarcode(storeId, barcode);
    if (!product) {
      // Fallback: search globally (stock manager at warehouse, or cross-store product)
      const allProds = await getAllProducts();
      product = allProds.find(p => p.barcode === barcode && (!explicitStoreId || p.storeId === explicitStoreId));
      if (product) {
        storeId = product.storeId;
      }
    }
    if (!product) { showToast('Product not found', 'error'); return; }

    const user = getCurrentUser();
    const curStoreId = getCurrentStoreId();
    const isAtWarehouse = user && (user.role === ROLES.STOCK_MANAGER || user.role === ROLES.MANAGER) && curStoreId === '__warehouse__';

    // When at warehouse, get all stock info across stores for this product
    let shopInfoHtml = '';
    if (isAtWarehouse) {
      const allProds = await getAllProducts();
      const sameBarcode = allProds.filter(p => p.barcode === barcode);
      const stores = await getAllStores();
      const shopLines = sameBarcode
        .filter(p => p.storeId && p.storeId !== '__warehouse__')
        .map(p => {
          const s = stores.find(st => st.storeId === p.storeId);
          const name = s ? s.storeName : p.storeId.slice(0,8);
          return `<span>${escapeHtml(name)}: <strong>${p.stockQuantity || 0}</strong></span>`;
        });
      shopInfoHtml = `
        <div class="form-group">
          <label class="text-muted small">Warehouse Stock: <strong>${product.warehouseStock || 0}</strong></label>
          ${shopLines.length > 0 ? `<div class="text-muted small">Shops: ${shopLines.join(' · ')}</div>` : '<div class="text-muted small">Not in any shop yet</div>'}
        </div>
      `;
    }

    const categories = await getCategoryList();
    const form = $('edit-product-form');
    form.innerHTML = `
      <div class="form-group">
        <label>Barcode</label>
        <input type="text" id="ep-barcode" class="input" value="${escapeHtml(product.barcode)}" readonly>
      </div>
      ${shopInfoHtml}
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
          <label>Stock Qty (${isAtWarehouse ? 'this location' : 'shop'})</label>
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
    window._editingProduct = product;
    $('edit-product-modal').classList.remove('hidden');

    // Show/hide warehouse transfer button based on role and location
    const transferBtn = document.getElementById('ep-transfer-btn');
    if (transferBtn) {
      const hasWarehouseStock = (product.warehouseStock || 0) > 0;
      if (isAtWarehouse && hasWarehouseStock) {
        transferBtn.classList.remove('hidden');
        transferBtn.textContent = `📦 Transfer ${product.warehouseStock} from Warehouse → Shop`;
      } else {
        transferBtn.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Edit product error:', err);
  }
}

/* ── Transfer from product edit: pre-fill stock mgmt transfer form ── */
async function openEditProductTransfer() {
  const product = window._editingProduct;
  if (!product) return;
  $('edit-product-modal').classList.add('hidden');
  // Navigate to stock management and pre-fill transfer
  navigate('stock-mgmt');
  setTimeout(() => {
    const barcodeInput = document.getElementById('sm-transfer-barcode');
    if (barcodeInput) {
      barcodeInput.value = product.barcode;
      barcodeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const qtyInput = document.getElementById('sm-transfer-qty');
    if (qtyInput) {
      qtyInput.value = Math.min(product.warehouseStock || 1, 1);
      qtyInput.focus();
      qtyInput.select();
    }
  }, 400);
}

function closeEditModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('edit-product-modal').classList.add('hidden');
}

async function saveEditProduct() {
  try {
    const barcode = window._editingBarcode;
    let storeId = window._editingStoreId;
    let product = await getProductByBarcode(storeId, barcode);
    // If at warehouse, search globally for the real product store
    if (!product) {
      const allProds = await getAllProducts();
      product = allProds.find(p => p.barcode === barcode);
      if (product) storeId = product.storeId;
    }
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
  window._restockTargetStoreId = null;
  updateProductFormDestinationBanner();
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
  window._restockTargetStoreId = null;
}

/* Resolve the correct store ID for saving a product.
   A pending restock target (set when restocking from an alert/list card,
   or when a direct scan matches an existing product elsewhere) always wins.
   Otherwise: if at the warehouse and the barcode is genuinely new, it goes
   into warehouse stock rather than being guessed onto an arbitrary shop. */
export async function resolveStoreIdForProduct(barcode) {
  if (window._restockTargetStoreId) {
    return window._restockTargetStoreId;
  }
  let sid = getCurrentStoreId();
  if (sid === '__warehouse__') {
    // Search globally for this barcode to see if it exists in any shop
    const allProds = await getAllProducts();
    const match = allProds.find(p => p.barcode === barcode);
    if (match) {
      return match.storeId; // use the shop where this product already exists
    }
    // Brand-new product while checked in at the warehouse: it belongs
    // to warehouse stock, to be transferred to a shop later — not
    // silently assigned to whichever shop happens to be first.
    return '__warehouse__';
  }
  return sid;
}

/* Persistent banner on the Add Product page showing where new stock
   will be saved — only meaningful for Stock Manager, whose save
   destination depends on their current check-in location. */
export async function updateProductFormDestinationBanner() {
  const banner = $('pf-destination-banner');
  if (!banner) return;
  const user = getCurrentUser();
  if (!user || user.role !== ROLES.STOCK_MANAGER) { banner.classList.add('hidden'); return; }

  const storeId = window._restockTargetStoreId || getCurrentStoreId();
  let label;
  if (storeId === '__warehouse__') {
    label = '🏭 Adding to: Warehouse stock';
  } else {
    const stores = await getAllStores();
    const store = stores.find(s => s.storeId === storeId);
    label = `🏪 Adding to: ${store ? store.storeName : 'shop'}`;
  }
  banner.textContent = label;
  banner.classList.remove('hidden');
}

async function saveProduct() {
  const barcode = $('pf-barcode').value.trim();
  const name = $('pf-name').value.trim();
  const price = parseFloat($('pf-price').value);
  const cost = parseFloat($('pf-cost').value) || 0;
  const stock = parseInt($('pf-stock').value) || 0;
  const threshold = parseInt($('pf-threshold').value) || 5;
  const storeId = await resolveStoreIdForProduct(barcode);

  if (!barcode) { showToast('Please enter a barcode', 'error'); return; }
  if (!name) { showToast('Please enter product name', 'error'); return; }
  if (!price || price <= 0) { showToast('Please enter a valid selling price', 'error'); return; }
  if (!storeId) { showToast('No store selected', 'error'); return; }

  try {
    const existing = await getProductByBarcode(storeId, barcode);
    if (existing && existing.productName !== name) {
      if (!confirm(`Product "${existing.productName}" already exists with this barcode. Update it?`)) return;
    }

    // Preserve warehouseStock from existing product so sync doesn't wipe it
    const existingWH = existing ? (existing.warehouseStock || 0) : 0;
    // A row stored at the virtual __warehouse__ location represents
    // warehouse stock, not shop stock — the entered quantity goes into
    // warehouseStock, and stockQuantity (shop-facing) stays at 0.
    const isWarehouseOnly = storeId === '__warehouse__';

    const product = {
      barcode,
      storeId,
      productName: name,
      category: $('pf-category').value || 'Other',
      sellingPrice: price,
      costPrice: cost,
      unit: $('pf-unit').value || 'piece',
      stockQuantity: isWarehouseOnly ? 0 : stock,
      lowStockThreshold: threshold,
      isArchived: false,
      warehouseStock: isWarehouseOnly ? stock : existingWH
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
  onQuickAddResolved(); // resume continuous camera scanning, if it was paused for this
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
      isArchived: false,
      warehouseStock: 0
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
          <div style="display:flex;gap:0.3rem;">
            <button class="btn btn-ghost small" onclick="openEditUser('${u.userId}')">✏️</button>
            <button class="btn btn-ghost small" onclick="toggleUserActive('${u.userId}')">${u.isActive === false ? 'Reactivate' : 'Deactivate'}</button>
          </div>
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

/* ── Edit User Modal — Manager only ── */
async function openEditUser(userId) {
  try {
    const [user, stores] = await Promise.all([getUserById(userId), getAllStores()]);
    if (!user) { showToast('User not found', 'error'); return; }

    const container = $('edit-user-form');
    container.innerHTML = `
      <input type="hidden" id="eu-userId" value="${user.userId}">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="eu-name" class="input" value="${escapeHtml(user.name)}" maxlength="50">
      </div>
      <div class="form-group">
        <label>Role</label>
        <select id="eu-role" class="input">
          <option value="cashier" ${user.role === 'cashier' ? 'selected' : ''}>Cashier</option>
          <option value="stock_manager" ${user.role === 'stock_manager' ? 'selected' : ''}>Stock Manager</option>
          <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
        </select>
      </div>
      <div class="form-group">
        <label>Assigned Store(s)</label>
        <div id="eu-stores" class="checkbox-list">
          ${stores.length > 0
            ? stores.map(s => `<label class="checkbox-row"><input type="checkbox" value="${s.storeId}" class="eu-store-cb" ${(user.storeIds || []).includes(s.storeId) ? 'checked' : ''}> ${escapeHtml(s.storeName)}</label>`).join('')
            : '<p class="text-muted small">No stores available.</p>'}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>New PIN <span class="text-muted small">(leave blank to keep current)</span></label>
          <input type="password" inputmode="numeric" pattern="[0-9]*" id="eu-pin" class="input" placeholder="4+ digits" maxlength="8">
        </div>
        <div class="form-group">
          <label>Confirm PIN</label>
          <input type="password" inputmode="numeric" pattern="[0-9]*" id="eu-pin-confirm" class="input" placeholder="4+ digits" maxlength="8">
        </div>
      </div>
    `;
    window._editingUserId = userId;
    $('edit-user-modal').classList.remove('hidden');
  } catch (err) {
    console.error('Open edit user error:', err);
    showToast('Error loading user: ' + err.message, 'error');
  }
}

function closeEditUserModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('edit-user-modal').classList.add('hidden');
}

async function saveEditUser() {
  try {
    const userId = window._editingUserId;
    const user = await getUserById(userId);
    if (!user) { showToast('User not found', 'error'); return; }

    const name = $('eu-name').value.trim();
    const role = $('eu-role').value;
    const pin = $('eu-pin').value.trim();
    const pinConfirm = $('eu-pin-confirm').value.trim();
    const storeIds = Array.from(document.querySelectorAll('.eu-store-cb:checked')).map(cb => cb.value);

    if (!name) { showToast('Name is required', 'error'); return; }
    if (storeIds.length === 0) { showToast('Assign at least one store', 'error'); return; }

    const minLen = role === ROLES.MANAGER ? 6 : 4;
    if (pin && !new RegExp(`^\\d{${minLen},8}$`).test(pin)) {
      showToast(`PIN must be at least ${minLen} digits`, 'error'); return;
    }
    if (pin && pin !== pinConfirm) { showToast('PINs do not match', 'error'); return; }

    user.name = name;
    user.role = role;
    user.storeIds = storeIds;
    if (pin) {
      user.pinHash = await hashPin(pin);
    }

    await saveUser(user);
    await enqueueSync('updateUser', user);

    $('edit-user-modal').classList.add('hidden');
    showToast('✅ User updated', 'success');
    renderUsers();
    triggerSync();
  } catch (err) {
    console.error('Save edit user error:', err);
    showToast('Error saving user: ' + err.message, 'error');
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
        <button class="btn btn-ghost small" onclick="openEditStore('${s.storeId}')">✏️</button>
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

/* ── Edit Store Modal — Manager only ── */
async function openEditStore(storeId) {
  try {
    const store = await getStoreById(storeId);
    if (!store) { showToast('Store not found', 'error'); return; }

    $('es-storeId').value = store.storeId;
    $('es-name').value = store.storeName || '';
    $('es-location').value = store.location || '';
    $('edit-store-modal').classList.remove('hidden');
    setTimeout(() => $('es-name').focus(), 200);
  } catch (err) {
    console.error('Open edit store error:', err);
  }
}

function closeEditStoreModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('edit-store-modal').classList.add('hidden');
}

async function saveEditStore() {
  try {
    const storeId = $('es-storeId').value;
    const store = await getStoreById(storeId);
    if (!store) { showToast('Store not found', 'error'); return; }

    const name = $('es-name').value.trim();
    if (!name) { showToast('Store name is required', 'error'); return; }

    store.storeName = name;
    store.location = $('es-location').value.trim();

    await saveStore(store);
    await enqueueSync('updateStore', store);

    $('edit-store-modal').classList.add('hidden');
    showToast('✅ Store updated', 'success');
    renderStores();
    triggerSync();
  } catch (err) {
    console.error('Save edit store error:', err);
    showToast('Error saving store: ' + err.message, 'error');
  }
}

/* ═══════════════════════════════════════════════
   Stock Management (warehouse receipts, transfers, movements log)
   ═══════════════════════════════════════════════ */

export async function renderStockMgmt() {
  try {
    const [stores, products] = await Promise.all([getAllStores(), getAllProducts()]);
    const user = getCurrentUser();
    const storeId = getCurrentStoreId();

    // Populate store selects
    ['sm-store-target', 'sm-receive-store'].forEach(id => {
      const el = $(id);
      if (el) {
        const currentVal = el.value;
        el.innerHTML = stores.map(s =>
          `<option value="${s.storeId}" ${s.storeId === (id === 'sm-receive-store' ? (storeId || '') : '') ? 'selected' : ''}>${escapeHtml(s.storeName)}</option>`
        ).join('');
        if (currentVal) el.value = currentVal;
      }
    });

    // Populate product search datalist (for barcode entry)
    const productList = $('sm-product-datalist');
    if (productList) {
      productList.innerHTML = products.map(p =>
        `<option value="${p.barcode}">${escapeHtml(p.productName)}</option>`
      ).join('');
    }

    // Show warehouse stock summary
    const whSummary = $('sm-wh-summary');
    if (whSummary) {
      const totalWH = products.reduce((s, p) => s + (p.warehouseStock || 0), 0);
      const lowStock = products.filter(p => (p.warehouseStock || 0) <= (p.lowStockThreshold || 5) && (p.warehouseStock || 0) > 0);
      whSummary.innerHTML = `
        <div class="stat-card small"><span class="stat-label">Warehouse Items</span><span class="stat-value">${totalWH}</span></div>
        <div class="stat-card small"><span class="stat-label">Low in WH</span><span class="stat-value">${lowStock.length}</span></div>
        <div class="stat-card small"><span class="stat-label">Total Products</span><span class="stat-value">${products.length}</span></div>
      `;
    }

    // Load recent movements
    renderStockMovements();
    // Load global stock view
    renderGlobalStockView();
  } catch (err) {
    console.error('Render stock mgmt error:', err);
  }
}

/* ── Handle Receive Stock Form ──
   Receive Stock is the one consistent path for bringing new items into
   the system, whether they already exist somewhere or not — if the
   barcode is genuinely new, inline "New Product" fields capture the
   minimum info needed (name + price) before the movement is logged. */
async function submitReceiveStock() {
  const barcode = $('sm-receive-barcode').value.trim();
  const qty = parseInt($('sm-receive-qty').value) || 0;
  const type = $('sm-receive-type').value; // 'warehouse_in' or 'direct_to_shop'
  const toStore = type === 'direct_to_shop' ? $('sm-receive-store').value : '';
  const ref = $('sm-receive-ref').value.trim();
  const notes = $('sm-receive-notes').value.trim();

  if (!barcode) { showToast('Enter a barcode', 'error'); return; }
  if (qty <= 0) { showToast('Enter a valid quantity', 'error'); return; }
  if (type === 'direct_to_shop' && !toStore) { showToast('Select a target shop', 'error'); return; }

  const user = getCurrentUser();
  const allProducts = await getAllProducts();
  const template = allProducts.find(p => p.barcode === barcode);
  let productName = template ? template.productName : barcode;

  try {
    if (!template) {
      const newName = $('sm-new-name').value.trim();
      const newPrice = parseFloat($('sm-new-price').value);
      if (!newName) { showToast('Enter the product name', 'error'); return; }
      if (!newPrice || newPrice <= 0) { showToast('Enter a valid selling price', 'error'); return; }

      const newProduct = {
        barcode,
        storeId: type === 'direct_to_shop' ? toStore : '__warehouse__',
        productName: newName,
        category: $('sm-new-category').value || 'Other',
        sellingPrice: newPrice,
        costPrice: parseFloat($('sm-new-cost').value) || 0,
        unit: 'piece',
        stockQuantity: 0,
        lowStockThreshold: 5,
        isArchived: false,
        warehouseStock: 0
      };
      await dbSaveProduct(newProduct);
      await enqueueSync('addProduct', newProduct);
      productName = newName;
    }

    await transferStock({
      type,
      barcode,
      productName,
      quantity: qty,
      toStore: type === 'direct_to_shop' ? toStore : '',
      reference: ref,
      performedBy: user ? user.userId : '',
      performedByName: user ? user.name : '',
      notes
    });

    showToast(`✅ ${qty} × ${productName} received`, 'success');
    $('sm-receive-barcode').value = '';
    $('sm-receive-qty').value = '';
    $('sm-receive-ref').value = '';
    $('sm-receive-notes').value = '';
    toggleReceiveNewProductFields(false);
    renderStockMgmt();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

/* Show/hide the inline "New Product" fields on the Receive Stock form,
   populating the category dropdown the first time they're revealed. */
async function toggleReceiveNewProductFields(show) {
  const el = $('sm-receive-new-fields');
  if (!el) return;
  el.classList.toggle('hidden', !show);
  if (show) {
    const catSelect = $('sm-new-category');
    if (catSelect && catSelect.options.length <= 1) {
      catSelect.innerHTML = categoryOptionsHtml(await getCategoryList(), '', '— Select —');
    }
  }
}

/* ── Handle Transfer (Warehouse → Shop) ── */
async function submitTransferStock() {
  const barcode = $('sm-transfer-barcode').value.trim();
  const qty = parseInt($('sm-transfer-qty').value) || 0;
  const toStore = $('sm-store-target').value;
  const ref = $('sm-transfer-ref').value.trim();
  const notes = $('sm-transfer-notes').value.trim();

  if (!barcode) { showToast('Enter a barcode', 'error'); return; }
  if (qty <= 0) { showToast('Enter a valid quantity', 'error'); return; }
  if (!toStore) { showToast('Select a target shop', 'error'); return; }

  const user = getCurrentUser();

  // Check warehouse has enough stock (also gives us the product name,
  // since this may be the first time this barcode reaches toStore)
  const allProducts = await getAllProducts();
  const whItem = allProducts.find(p => p.barcode === barcode);
  const productName = whItem ? whItem.productName : barcode;
  if (!whItem || (whItem.warehouseStock || 0) < qty) {
    showToast(`⚠️ Insufficient warehouse stock (available: ${whItem ? whItem.warehouseStock : 0})`, 'error');
    return;
  }

  try {
    await transferStock({
      type: 'warehouse_to_shop',
      barcode,
      productName,
      quantity: qty,
      fromStore: '__warehouse__',
      toStore,
      reference: ref,
      performedBy: user ? user.userId : '',
      performedByName: user ? user.name : '',
      notes
    });

    showToast(`✅ ${qty} × ${productName} transferred to shop`, 'success');
    $('sm-transfer-barcode').value = '';
    $('sm-transfer-qty').value = '';
    $('sm-transfer-ref').value = '';
    $('sm-transfer-notes').value = '';
    renderStockMgmt();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

/* ── Show/Hide receive destination ── */
function toggleReceiveStore() {
  const type = $('sm-receive-type').value;
  const storeGroup = $('sm-receive-store-group');
  if (storeGroup) storeGroup.style.display = type === 'direct_to_shop' ? 'block' : 'none';
}

/* ── Lookup product info when barcode is entered ── */
async function lookupReceiveProduct() {
  const barcode = $('sm-receive-barcode').value.trim();
  const info = $('sm-receive-product-info');
  if (!barcode) { info.innerHTML = ''; toggleReceiveNewProductFields(false); return; }

  const allProducts = await getAllProducts();
  const product = allProducts.find(p => p.barcode === barcode);
  if (product) {
    info.innerHTML = `<span class="text-muted">${escapeHtml(product.productName)} · Shop: ${product.stockQuantity || 0} · WH: ${product.warehouseStock || 0}</span>`;
    toggleReceiveNewProductFields(false);
  } else {
    info.innerHTML = `<span class="text-muted">🆕 New product — fill in the details below</span>`;
    toggleReceiveNewProductFields(true);
  }
}

async function lookupTransferProduct() {
  const barcode = $('sm-transfer-barcode').value.trim();
  if (!barcode) return;
  const allProducts = await getAllProducts();
  const product = allProducts.find(p => p.barcode === barcode);
  const info = $('sm-transfer-product-info');
  if (product) {
    info.innerHTML = `<span class="text-muted">${escapeHtml(product.productName)} · WH Stock: <strong>${product.warehouseStock || 0}</strong></span>`;
  } else {
    info.innerHTML = `<span class="text-muted">Product not found in any store</span>`;
  }
}

/* ── Render Stock Movements History ── */
async function renderStockMovements() {
  try {
    const movements = await getAllStockMovements();
    const container = $('sm-movements-list');
    if (!container) return;

    if (movements.length === 0) {
      container.innerHTML = '<p class="text-muted">No stock movements yet.</p>';
      return;
    }

    const typeLabels = {
      warehouse_in: '📥 Warehouse In',
      warehouse_to_shop: '📦 → 🏪 To Shop',
      direct_to_shop: '🏪 Direct to Shop'
    };

    container.innerHTML = movements.slice(0, 50).map(m => `
      <div class="movement-card">
        <div class="movement-header">
          <span class="movement-type">${typeLabels[m.type] || m.type}</span>
          <span class="movement-qty">+${m.quantity}</span>
        </div>
        <div class="movement-detail">${escapeHtml(m.productName || m.barcode)}</div>
        <div class="movement-meta">
          ${m.fromStore && m.fromStore !== '__warehouse__' ? 'From: ' + escapeHtml(m.fromStore) : ''}
          ${m.toStore && m.toStore !== '__warehouse__' ? 'To: ' + escapeHtml(m.toStore) : ''}
          · ${m.performedByName || '—'} · ${formatShortDate(m.createdAt)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Render stock movements error:', err);
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
  users: 'Team', stores: 'Stores', 'stock-mgmt': 'Stock Management', settings: 'Settings'
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
    case 'add-product':
      populateProductCategorySelect();
      // A normal visit to this page (not a restock hand-off, which sets
      // the override again right after this) always starts fresh.
      window._restockTargetStoreId = null;
      updateProductFormDestinationBanner();
      break;
    case 'products': renderProducts(); break;
    case 'sales': renderSales(); break;
    case 'alerts': renderAlerts(); break;
    case 'settings': loadSettings(); break;
    case 'users': renderUsers(); break;
    case 'stores': renderStores(); break;
    case 'stock-mgmt': renderStockMgmt(); break;
    case 'checkout':
      // Sync the checkout UI with current state so the DOM matches
      // checkoutItems (cleared after a completed sale via finalize+receipt
      // close, or showing items if the cashier briefly navigated away).
      updateInvoiceUI();
      break;
  }

  refreshAlertsBadge();
}

/* ── Global Stock View (warehouse + all shops) ── */
let _gsvGrouped = []; // cached grouped data for filtering
let _gsvStoreIds = [];

export async function renderGlobalStockView() {
  try {
    const [products, stores] = await Promise.all([getAllProducts(), getAllStores()]);
    const container = document.getElementById('global-stock-list');
    const filterSelect = document.getElementById('gsv-filter-location');
    if (!container) return;

    if (products.length === 0) {
      container.innerHTML = '<p class="text-muted">No products in the system.</p>';
      return;
    }

    // Populate the location filter with shops
    if (filterSelect) {
      const currentVal = filterSelect.value;
      // Keep 'All Locations' and 'Warehouse Only', then add shops
      const shopOpts = stores.map(s =>
        `<option value="${s.storeId}" ${s.storeId === currentVal ? 'selected' : ''}>${escapeHtml(s.storeName)}</option>`
      ).join('');
      filterSelect.innerHTML = `<option value="">🌐 All Locations</option><option value="__warehouse__" ${currentVal === '__warehouse__' ? 'selected' : ''}>🏭 Warehouse Only</option>${shopOpts}`;
    }

    // Group by barcode and collect stock per store
    const grouped = {};
    products.forEach(p => {
      const key = p.barcode;
      if (!grouped[key]) {
        grouped[key] = {
          barcode: p.barcode,
          productName: p.productName || 'Unknown',
          category: p.category || '',
          sellingPrice: p.sellingPrice || 0,
          costPrice: p.costPrice || 0,
          warehouseStock: p.warehouseStock || 0,
          shopStock: {},
          threshold: p.lowStockThreshold || 5,
          unit: p.unit || 'piece'
        };
      }
      grouped[key].productName = p.productName || grouped[key].productName;
      grouped[key].category = p.category || grouped[key].category;
      grouped[key].sellingPrice = p.sellingPrice || grouped[key].sellingPrice;
      grouped[key].costPrice = p.costPrice || grouped[key].costPrice;
      grouped[key].warehouseStock = p.warehouseStock || grouped[key].warehouseStock;
      grouped[key].threshold = p.lowStockThreshold || grouped[key].threshold;
      grouped[key].unit = p.unit || grouped[key].unit;
      if (p.storeId && p.storeId !== '__warehouse__') {
        grouped[key].shopStock[p.storeId] = (p.stockQuantity || 0);
      }
    });

    _gsvGrouped = Object.values(grouped);
    _gsvStoreIds = stores.map(s => s.storeId);

    renderGSVTable();
  } catch (err) {
    console.error('Global stock view error:', err);
  }
}

function renderGSVTable() {
  const container = document.getElementById('global-stock-list');
  const filterVal = document.getElementById('gsv-filter-location')?.value || '';
  const searchQ = document.getElementById('gsv-search')?.value?.toLowerCase().trim() || '';

  let data = _gsvGrouped;

  // Apply location filter
  if (filterVal === '__warehouse__') {
    data = data.filter(g => (g.warehouseStock || 0) > 0);
  } else if (filterVal) {
    // Filter to a specific shop
    data = data.filter(g => (g.shopStock[filterVal] || 0) > 0);
  }

  // Apply search filter
  if (searchQ) {
    data = data.filter(g =>
      (g.productName || '').toLowerCase().includes(searchQ) ||
      (g.barcode || '').toLowerCase().includes(searchQ)
    );
  }

  data.sort((a, b) => a.productName.localeCompare(b.productName));

  const stores = _gsvStoreIds;

  // Build table
  const storeHeader = stores.map(id => {
    const el = document.getElementById('gsv-filter-location');
    const storeName = el ? el.querySelector(`option[value="${id}"]`)?.textContent || id.slice(0,6) : id.slice(0,6);
    return `<th>${escapeHtml(storeName)}</th>`;
  }).join('');

  if (data.length === 0) {
    container.innerHTML = '<p class="text-muted">No products match the current filter.</p>';
    return;
  }

  // When a location filter is active, show a click-to-transfer prompt
  const isFiltered = !!filterVal;

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="global-stock-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>🏭 Warehouse</th>
            ${storeHeader}
            <th>Total</th>
            ${isFiltered ? '<th>Action</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${data.map(g => {
            const wh = g.warehouseStock || 0;
            const shopTotal = Object.values(g.shopStock).reduce((s, v) => s + v, 0);
            const grandTotal = wh + shopTotal;
            const whClass = stockLevelClass(wh, g.threshold);
            return `<tr>
              <td class="gsv-product-name">${escapeHtml(g.productName)}<br><span class="text-muted small">${g.barcode}</span></td>
              <td class="gsv-qty ${whClass}">${wh}</td>
              ${stores.map(id => {
                const qty = g.shopStock[id] || 0;
                const cls = stockLevelClass(qty, g.threshold);
                return `<td class="gsv-qty ${cls}">${qty}</td>`;
              }).join('')}
              <td class="gsv-qty gsv-total">${grandTotal}</td>
              ${isFiltered ? `<td><button class="btn btn-ghost small" onclick="openGlobalTransfer('${g.barcode}','${escapeHtml(g.productName)}',${wh})" style="font-size:0.75rem;padding:0.25rem 0.4rem;min-height:auto;">📦 Transfer</button></td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function filterGlobalStockView() {
  renderGSVTable();
}

/* ── Transfer from global stock view: pre-fill transfer form with barcode ── */
function openGlobalTransfer(barcode, productName, warehouseQty) {
  // Navigate to the transfer form section
  const transferBarcode = document.getElementById('sm-transfer-barcode');
  const transferQty = document.getElementById('sm-transfer-qty');
  const transferInfo = document.getElementById('sm-transfer-product-info');
  if (transferBarcode) {
    transferBarcode.value = barcode;
    transferBarcode.dispatchEvent(new Event('input', { bubbles: true }));
    // Focus quantity and suggest a transfer amount
    if (transferQty) {
      transferQty.value = Math.min(warehouseQty, 1);
      transferQty.focus();
      transferQty.select();
    }
    // Scroll to the transfer card
    const transferCard = document.getElementById('sm-transfer-barcode')?.closest('.card');
    if (transferCard) transferCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`📦 Pre-filled transfer for ${productName} (WH: ${warehouseQty})`, 'info', 4000);
  }
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
  'stock-mgmt': { icon: '🏭', label: 'Stock Management', navLabel: 'Warehouse' },
  settings: { icon: '⚙️', label: 'Settings', navLabel: 'Settings' }
};

const ROLE_SIDEBAR_PAGES = {
  manager: ['dashboard', 'checkout', 'add-product', 'products', 'sales', 'alerts', 'users', 'stores', 'stock-mgmt', 'settings'],
  stock_manager: ['add-product', 'products', 'alerts', 'stock-mgmt'],
  cashier: ['checkout', 'sales']
};

const ROLE_BOTTOM_NAV_PAGES = {
  manager: ['dashboard', 'checkout', 'add-product', 'products', 'sales'],
  stock_manager: ['add-product', 'stock-mgmt', 'products', 'alerts'],
  cashier: ['checkout', 'sales']
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

export async function updateCurrentUserBadge() {
  const user = getCurrentUser();
  const badge = $('current-user-name');
  if (!badge || !user) return;
  const session = getCurrentSession();
  let storeLabel = '';
  if (session) {
    storeLabel = ` · ${session.storeName}`;
  } else if (user.role === ROLES.STOCK_MANAGER) {
    const sid = getCurrentStoreId();
    if (sid === '__warehouse__') {
      storeLabel = ' · 🏭 Warehouse';
    } else if (sid) {
      const stores = await getAllStores().catch(() => []);
      const s = stores.find(st => st.storeId === sid);
      storeLabel = ` · ${s ? s.storeName : sid.slice(0,8)}`;
    }
  }
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
  adjustCheckoutQty, setCheckoutQty, removeCheckoutItem, voidCheckout, showPaymentModal,
  closePaymentModal, calculateChange, finalizeSale, startNewCheckout,
  renderSales, resetProductForm, showManualProductForm, saveProduct,
  copyTemplateLink, closeQuickAddModal, saveQuickAddProduct,
  restockProduct, addTeamMember, toggleUserActive, addStore,
  openEditUser, closeEditUserModal, saveEditUser,
  openEditStore, closeEditStoreModal, saveEditStore,
  submitReceiveStock, submitTransferStock, toggleReceiveStore,
  lookupReceiveProduct, lookupTransferProduct,
  showSaleDetail, closeSaleDetailModal, downloadSaleReceipt,
  filterGlobalStockView, openEditProductTransfer
});
