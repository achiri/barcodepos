/* ═══════════════════════════════════════════════
   Barcode Scanner Module
   Uses html5-qrcode library for camera scanning
   ═══════════════════════════════════════════════ */

import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { $, showToast, stockLevelClass, formatCurrency, escapeHtml, addToCheckout } from './ui.js';
import { getProductByBarcode, getAllProducts } from './db.js';

let html5Scanner = null;
let currentScannerMode = null; // 'product' or 'checkout'
let isScanning = false;

/* ── Product Scanner (Add Inventory) ── */
function startProductScanner() {
  if (isScanning) return;
  currentScannerMode = 'product';
  startScanner('scanner-container', onProductScanned);
  $('btn-start-scanner').textContent = '⏹️ Stop Scanner';
  $('btn-start-scanner').onclick = stopProductScanner;
}

function stopProductScanner() {
  stopScanner();
  $('btn-start-scanner').textContent = '📷 Start Scanner';
  $('btn-start-scanner').onclick = startProductScanner;
  $('scanner-container').innerHTML = '<p class="text-muted">Camera will appear here</p>';
}

function onProductScanned(barcode) {
  if (!barcode) return;
  stopProductScanner();
  $('pf-barcode').value = barcode;
  $('pf-barcode').readOnly = true;

  // Auto-lookup product name from Open Food Facts
  lookupBarcode(barcode).then(name => {
    if (name) {
      $('pf-name').value = name;
      showToast(`Found: ${name}`, 'success');
    } else {
      showToast('Barcode scanned. Enter product details.', 'info');
      $('pf-name').focus();
    }
    $('product-form').classList.remove('hidden');
  });
}

/* ── Checkout Scanner ── */
function startCheckoutScan() {
  if (isScanning) return;
  currentScannerMode = 'checkout';

  // Show a small overlay modal for scanning (it starts the camera itself)
  showScannerModal(onCheckoutScanned);
}

function onCheckoutScanned(barcode) {
  if (!barcode) return;
  closeScannerModal();
  addScannedItemToCheckout(barcode);
}

async function addScannedItemToCheckout(barcode) {
  try {
    const product = await getProductByBarcode(barcode);
    if (!product) {
      showToast(`Product not found: ${barcode}. Add it first!`, 'error');
      return;
    }
    if ((product.stockQuantity || 0) <= 0) {
      showToast(`${product.productName} is out of stock!`, 'warning');
      return;
    }
    addToCheckout(product);
    showToast(`${product.productName} added ✓`, 'success');
  } catch (err) {
    showToast('Error looking up product: ' + err.message, 'error');
  }
}

/* ── Scanner Modal (for checkout) ── */
function showScannerModal(onScan) {
  // Remove existing scanner modal if any
  closeScannerModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'scanner-modal';
  backdrop.onclick = (e) => { if (e.target === backdrop) closeScannerModal(); };

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '90vw';
  modal.innerHTML = `
    <h3>📷 Scan Barcode</h3>

    <!-- Tab buttons: Scan / Type / Search -->
    <div style="display:flex;gap:0.25rem;margin-bottom:0.75rem;">
      <button id="scan-tab-camera" class="btn btn-primary small" style="flex:1;padding:0.4rem;font-size:0.8rem;" onclick="switchScanTab('camera')">📷 Camera</button>
      <button id="scan-tab-type" class="btn btn-ghost small" style="flex:1;padding:0.4rem;font-size:0.8rem;" onclick="switchScanTab('type')">✏️ Type</button>
      <button id="scan-tab-search" class="btn btn-ghost small" style="flex:1;padding:0.4rem;font-size:0.8rem;" onclick="switchScanTab('search')">🔍 Search</button>
    </div>

    <!-- Camera tab -->
    <div id="scan-panel-camera">
      <div id="scanner-modal-container" style="width:100%;height:220px;background:var(--gray-100);border-radius:8px;overflow:hidden;margin:0 0 0.5rem 0;"></div>
      <p class="text-muted small scanner-hint">📍 Align barcode within the box</p>
    </div>

    <!-- Type barcode tab (hidden by default) -->
    <div id="scan-panel-type" class="hidden">
      <div style="display:flex;gap:0.5rem;">
        <input type="text" id="scanner-manual-input" class="input" placeholder="Enter barcode number..." onkeydown="if(event.key==='Enter')manualCheckoutScan()">
        <button class="btn btn-primary" onclick="manualCheckoutScan()">OK</button>
      </div>
    </div>

    <!-- Search products tab (hidden by default) -->
    <div id="scan-panel-search" class="hidden">
      <input type="text" id="scanner-search-input" class="input" placeholder="Search product name..." oninput="filterCheckoutProducts(this.value)">
      <div id="scanner-search-results" style="max-height:180px;overflow-y:auto;margin-top:0.5rem;">
        <p class="text-muted small">Start typing to search products...</p>
      </div>
    </div>

    <button class="btn btn-ghost" style="margin-top:0.5rem;width:100%;" onclick="closeScannerModal()">Cancel</button>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Wait for container to render, then start scanner
  setTimeout(() => {
    startScanner('scanner-modal-container', onScan);
  }, 400);
}

/* ── Switch between scan/type/search tabs ── */
function switchScanTab(tab) {
  ['camera','type','search'].forEach(t => {
    const panel = document.getElementById('scan-panel-' + t);
    const btn = document.getElementById('scan-tab-' + t);
    if (panel) panel.classList.toggle('hidden', t !== tab);
    if (btn) {
      btn.className = t === tab ? 'btn btn-primary small' : 'btn btn-ghost small';
      btn.style.flex = '1';
      btn.style.padding = '0.4rem';
      btn.style.fontSize = '0.8rem';
    }
  });

  if (tab === 'camera') {
    startScanner('scanner-modal-container', onCheckoutScanned);
  } else {
    stopScanner();
    if (tab === 'type') {
      setTimeout(() => document.getElementById('scanner-manual-input')?.focus(), 100);
    } else if (tab === 'search') {
      setTimeout(() => document.getElementById('scanner-search-input')?.focus(), 100);
      filterCheckoutProducts('');
    }
  }
}

/* ── Search products for checkout ── */
async function filterCheckoutProducts(query) {
  try {
    const results = document.getElementById('scanner-search-results');
    if (!results) return;

    let products = await getAllProducts();
    const q = query.toLowerCase().trim();

    if (!q) {
      // Show first 10 products sorted by stock
      products.sort((a, b) => (b.stockQuantity||0) - (a.stockQuantity||0));
      products = products.slice(0, 10);
      results.innerHTML = products.map(p =>
        `<div class="product-card" style="padding:0.5rem;margin-bottom:0.25rem;" onclick="addSearchProductToCheckout('${p.barcode}')">
          <div class="p-info">
            <div class="p-name">${escapeHtml(p.productName)}</div>
            <div class="p-details">
              <span>${formatCurrency(p.sellingPrice)}</span>
              <span class="p-stock ${stockLevelClass(p.stockQuantity, p.lowStockThreshold)}">${p.stockQuantity || 0} left</span>
            </div>
          </div>
        </div>`
      ).join('');
      return;
    }

    products = products.filter(p =>
      (p.productName || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    ).slice(0, 15);

    if (products.length === 0) {
      results.innerHTML = '<p class="text-muted small">No products found. Add it first!</p>';
      return;
    }

    results.innerHTML = products.map(p =>
      `<div class="product-card" style="padding:0.5rem;margin-bottom:0.25rem;cursor:pointer;" onclick="addSearchProductToCheckout('${p.barcode}')">
        <div class="p-info">
          <div class="p-name">${escapeHtml(p.productName)}</div>
          <div class="p-details">
            <span>${formatCurrency(p.sellingPrice)}</span>
            <span class="p-stock ${stockLevelClass(p.stockQuantity, p.lowStockThreshold)}">${p.stockQuantity || 0} left</span>
          </div>
        </div>
      </div>`
    ).join('');
  } catch (err) {
    console.error('Search error:', err);
  }
}

function addSearchProductToCheckout(barcode) {
  closeScannerModal();
  addScannedItemToCheckout(barcode);
}

function closeScannerModal() {
  const modal = document.getElementById('scanner-modal');
  if (modal) modal.remove();
  stopScanner();
}

function manualCheckoutScan() {
  const input = document.getElementById('scanner-manual-input');
  if (input && input.value.trim()) {
    onCheckoutScanned(input.value.trim());
  }
}

/* ── Core Scanner Engine ── */
function startScanner(containerId, onScan) {
  if (isScanning) stopScanner();

  const container = document.getElementById(containerId);
  if (!container) return;

  // Clear container
  container.innerHTML = '';

  try {
    html5Scanner = new Html5Qrcode(containerId);

    const config = {
      fps: 15,
      qrbox: { width: 250, height: 150 },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF
      ]
    };

    html5Scanner.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        // Success callback
        if (decodedText && onScan) {
          // Debounce: stop scanning after first decode
          stopScanner();
          onScan(decodedText);
        }
      },
      () => { /* No match — continue scanning */ }
    ).then(() => {
      isScanning = true;
    }).catch(err => {
      console.error('Scanner start error:', err);
      showToast('Camera access denied or not available. Use manual entry.', 'warning');
      container.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem;">📷 Camera unavailable.<br>Enter barcode manually below.</p>';
    });
  } catch (err) {
    console.error('Scanner init error:', err);
    showToast('Scanner not supported on this device. Use manual entry.', 'warning');
    container.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem;">📷 Scanner unavailable.<br>Enter barcode manually below.</p>';
  }
}

function stopScanner() {
  if (html5Scanner) {
    try {
      html5Scanner.stop().catch(() => {});
      html5Scanner = null;
    } catch (e) { /* ignore */ }
  }
  isScanning = false;
}

/* ── Barcode Lookup (Open Food Facts) ── */
async function lookupBarcode(barcode) {
  try {
    const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await resp.json();
    if (data.status === 1 && data.product) {
      return data.product.product_name || data.product.generic_name || null;
    }
    return null;
  } catch (err) {
    console.log('Barcode lookup failed (offline or no result):', err.message);
    return null;
  }
}

/* ── Show Manual Add Item Dialog (Checkout) ── */
function showManualAddItem() {
  showScannerModal(onCheckoutScanned);
  // Switch to Type tab after modal renders
  setTimeout(() => switchScanTab('type'), 500);
}

/* ── Attach functions referenced by inline HTML on* handlers ── */
Object.assign(window, {
  startProductScanner, stopProductScanner, showManualAddItem, startCheckoutScan,
  switchScanTab, manualCheckoutScan, filterCheckoutProducts, closeScannerModal,
  addSearchProductToCheckout
});
