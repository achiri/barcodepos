/* ═══════════════════════════════════════════════
   Main Application — Init, Routing, Onboarding
   ═══════════════════════════════════════════════ */

/* ── App Initialization ── */
document.addEventListener('DOMContentLoaded', async function() {
  try {
    // 1. Open IndexedDB
    await openDB();

    // 2. Check if onboarding is complete
    const storeName = await getSetting('storeName');
    const gasUrl = await getSetting('gasUrl');

    if (storeName && gasUrl) {
      // Already set up — go to app
      finishOnboarding();
    } else if (storeName) {
      // Has store name but no sheet — show step 3
      showOnboardingStep(3);
    } else {
      // Fresh start — show onboarding from step 1
      showOnboardingStep(1);
    }

    // 3. Handle hash routing
    window.addEventListener('hashchange', () => {
      const page = location.hash.replace('#', '') || 'dashboard';
      navigate(page);
    });

    // 4. Start periodic sync
    startPeriodicSync();

    // 5. If on a page already via hash (e.g., deep link), navigate
    const initialPage = location.hash.replace('#', '') || 'dashboard';
    if (storeName && gasUrl) {
      navigate(initialPage);
    }

  } catch (err) {
    console.error('App init error:', err);
    showToast('Error starting app: ' + err.message, 'error');
  }
});

/* ── Onboarding Functions ── */

function showOnboardingStep(step) {
  const overlay = $('onboarding-overlay');
  overlay.classList.remove('hidden');

  // Hide all steps
  document.querySelectorAll('.onboarding-step').forEach(s => s.classList.add('hidden'));
  // Show target step
  const target = document.querySelector(`.onboarding-step[data-step="${step}"]`);
  if (target) target.classList.remove('hidden');

  // If step is 3, pre-fill store name
  if (step === 3) {
    const name = $('store-name-input').value.trim() || 'My Store';
    // Store the name if entered
  }

  // Hide the app during onboarding
  $('app').classList.add('hidden');
}

function nextOnboardingStep(step) {
  // If moving from step 2 (store name), save it
  if (step === 3) {
    const name = $('store-name-input').value.trim();
    if (name) {
      saveSetting('storeName', name).catch(() => {});
    }
  }
  showOnboardingStep(step);
}

async function connectGoogleSheet() {
  const url = $('gas-url-input').value.trim();
  if (!url) {
    showToast('Please enter the Google Apps Script Web App URL', 'error');
    return;
  }

  // Validate URL format
  if (!url.startsWith('https://script.google.com/macros/s/')) {
    showToast('Invalid URL. It should start with https://script.google.com/macros/s/', 'error');
    return;
  }

  // Save store name if entered
  const storeName = $('store-name-input').value.trim() || 'My Store';
  await saveSetting('storeName', storeName);
  await saveSetting('gasUrl', url);

  // Test connection
  try {
    const response = await fetch(url + '?action=ping', {
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.status === 'ok') {
      showToast('✅ Connected to Google Sheets!', 'success');
      showOnboardingStep('done');
    } else {
      showToast('Sheet responded but unexpected format. You can continue.', 'warning');
      showOnboardingStep('done');
    }
  } catch (err) {
    // Even if test fails, allow user to continue (might be CORS or no-cors mode)
    showToast('⚠️ Could not verify connection, but saved. You can test it later in Settings.', 'warning');
    showOnboardingStep('done');
  }
}

function finishOnboarding() {
  const overlay = $('onboarding-overlay');
  overlay.classList.add('hidden');
  $('app').classList.remove('hidden');

  // Load settings and data
  loadSettings().then(() => {
    // Try to pull products from sheet
    pullProductsFromSheet().then(() => {
      renderDashboard();
    }).catch(() => {
      renderDashboard();
    });
  });

  // Navigate to dashboard
  navigate('dashboard');

  // Register service worker for PWA
  registerServiceWorker();
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

/* ── Expose global functions for inline HTML onclick ── */
// These are already global from the module-level declarations,
// but ensure they are attached to window for inline event handlers
window.navigate = navigate;
window.toggleSidebar = toggleSidebar;
window.nextOnboardingStep = nextOnboardingStep;
window.connectGoogleSheet = connectGoogleSheet;
window.finishOnboarding = finishOnboarding;
window.startProductScanner = startProductScanner;
window.stopProductScanner = stopProductScanner;
window.showManualProductForm = showManualProductForm;
window.resetProductForm = resetProductForm;
window.saveProduct = saveProduct;
window.filterProducts = filterProducts;
window.openEditProduct = openEditProduct;
window.closeEditModal = closeEditModal;
window.saveEditProduct = saveEditProduct;
window.forceSync = forceSync;
window.testSheetConnection = testSheetConnection;
window.saveStoreSetting = saveStoreSetting;
window.exportData = exportData;
window.resetApp = resetApp;
window.startCheckoutScan = startCheckoutScan;
window.showManualAddItem = showManualAddItem;
window.adjustCheckoutQty = adjustCheckoutQty;
window.removeCheckoutItem = removeCheckoutItem;
window.voidCheckout = voidCheckout;
window.showPaymentModal = showPaymentModal;
window.closePaymentModal = closePaymentModal;
window.calculateChange = calculateChange;
window.finalizeSale = finalizeSale;
window.closeReceiptModal = closeReceiptModal;
window.shareReceipt = shareReceipt;
window.printReceipt = printReceipt;
window.copyTemplateLink = copyTemplateLink;
window.manualCheckoutScan = manualCheckoutScan;
