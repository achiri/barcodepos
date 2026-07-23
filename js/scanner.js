/* ═══════════════════════════════════════════════
   Barcode Scanner Module
   Uses html5-qrcode library for camera scanning
   ═══════════════════════════════════════════════ */

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
  startScanner('scanner-container', onCheckoutScanned);

  // Show a small overlay modal for scanning
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
    <div id="scanner-modal-container" style="width:100%;height:250px;background:var(--gray-100);border-radius:8px;overflow:hidden;margin:1rem 0;"></div>
    <div style="display:flex;gap:0.5rem;">
      <input type="text" id="scanner-manual-input" class="input" placeholder="Type barcode..." onkeydown="if(event.key==='Enter')manualCheckoutScan()">
      <button class="btn btn-primary" onclick="manualCheckoutScan()">OK</button>
    </div>
    <button class="btn btn-ghost" style="margin-top:0.5rem;" onclick="closeScannerModal()">Cancel</button>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Wait for container to render, then start scanner
  setTimeout(() => {
    startScanner('scanner-modal-container', onScan);
  }, 300);
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
      fps: 10,
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
}
