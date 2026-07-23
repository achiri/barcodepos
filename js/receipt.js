/* ═══════════════════════════════════════════════
   Receipt Generation Module
   ═══════════════════════════════════════════════ */

/* ── Generate receipt HTML and show it ── */
function showReceipt(transaction, storeName, currency) {
  const receiptHtml = generateReceiptHtml(transaction, storeName, currency);
  const container = $('receipt-content');
  container.innerHTML = receiptHtml;

  // Store receipt data for sharing
  window._lastReceipt = { transaction, storeName, currency, html: receiptHtml };

  $('receipt-modal').classList.remove('hidden');
}

function closeReceiptModal(e) {
  if (e && e.target !== e.currentTarget) return;
  $('receipt-modal').classList.add('hidden');
}

/* ── Generate Receipt HTML ── */
function generateReceiptHtml(transaction, storeName, currency) {
  const date = new Date(transaction.createdAt);
  const dateStr = date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  const timeStr = date.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit'
  });

  const items = transaction.items || [];
  const itemsStr = items.map(i => {
    const name = i.productName || i.barcode || 'Item';
    const qty = i.quantity || 1;
    const price = i.unitPrice || 0;
    const total = i.lineTotal || (qty * price);
    return `${name.padEnd(22)} ${qty} × ${formatCurrency(price, currency).padStart(10)}\n${''.padEnd(22)} ${'→'.padEnd(3)} ${formatCurrency(total, currency).padStart(10)}`;
  }).join('\n');

  const methodLabels = {
    cash: '💵 Cash',
    mobile_money: '📱 Mobile Money',
    bank_transfer: '🏦 Bank Transfer'
  };

  return `
╔══════════════════════════════════╗
║       ${(storeName || 'MY STORE').padEnd(29)}║
║     ${'BarcodePOS Receipt'.padEnd(29)}║
╠══════════════════════════════════╣
║ ${dateStr.padEnd(17)} ${timeStr.padEnd(12)}║
║ ID: ${(transaction.transactionId || '').padEnd(26)}║
╠══════════════════════════════════╣
║ ITEMS                            ║
╠══════════════════════════════════╣
${itemsStr.split('\n').map(line => `║ ${line.padEnd(33)}║`).join('\n')}
╠══════════════════════════════════╣
║ ${'TOTAL'.padEnd(17)} ${formatCurrency(transaction.total, currency).padStart(16)}║
║ ${'Tendered'.padEnd(17)} ${formatCurrency(transaction.amountTendered, currency).padStart(16)}║
║ ${'Change'.padEnd(17)} ${formatCurrency(transaction.change, currency).padStart(16)}║
╠══════════════════════════════════╣
║ Payment: ${(methodLabels[transaction.paymentMethod] || transaction.paymentMethod).padEnd(21)}║
╠══════════════════════════════════╣
║       Thank you for your         ║
║           patronage!             ║
╚══════════════════════════════════╝
  `.replace(/\n/g, '<br>');
}

/* ── Share Receipt via Native Share ── */
async function shareReceipt() {
  const receipt = window._lastReceipt;
  if (!receipt) return;

  const plainText = generatePlainTextReceipt(receipt.transaction, receipt.storeName, receipt.currency);

  try {
    if (navigator.share) {
      await navigator.share({
        title: `Receipt - ${receipt.storeName}`,
        text: plainText,
      });
      showToast('Receipt shared!', 'success');
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(plainText);
      showToast('Receipt copied to clipboard!', 'success');
    } else {
      // Fallback: select text
      const textarea = document.createElement('textarea');
      textarea.value = plainText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast('Receipt copied!', 'success');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Share cancelled', 'warning');
    }
  }
}

/* ── Print Receipt / Save as PDF ── */
function printReceipt() {
  const receipt = window._lastReceipt;
  if (!receipt) return;

  const plainText = generatePlainTextReceipt(receipt.transaction, receipt.storeName, receipt.currency);

  // Create a printable window
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Receipt - ${receipt.storeName}</title>
    <style>
      body { font-family: 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; padding: 20px; max-width: 300px; margin: 0 auto; }
      @media print { body { padding: 0; } }
    </style>
    </head><body>${plainText}</body></html>
  `);
  win.document.close();
  setTimeout(() => {
    win.print();
  }, 500);
}

/* ── Generate Plain Text Receipt ── */
function generatePlainTextReceipt(transaction, storeName, currency) {
  const date = new Date(transaction.createdAt);
  const dateStr = date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  const timeStr = date.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit'
  });

  const items = transaction.items || [];
  let text = '';
  text += '╔══════════════════════════════════╗\n';
  text += `║       ${(storeName || 'MY STORE').padEnd(29)}║\n`;
  text += '╠══════════════════════════════════╣\n';
  text += `║ ${dateStr}  ${timeStr}           ║\n`;
  text += `║ ID: ${(transaction.transactionId || '').padEnd(26)}║\n`;
  text += '╠══════════════════════════════════╣\n';
  text += '║ ITEMS                            ║\n';
  text += '╠══════════════════════════════════╣\n';

  items.forEach(i => {
    const name = i.productName || i.barcode || 'Item';
    const qty = i.quantity || 1;
    const price = i.unitPrice || 0;
    const total = i.lineTotal || (qty * price);
    text += `║ ${name.padEnd(22)} ${qty} x ${String(price).padStart(8)}║\n`;
    text += `║ ${''.padEnd(22)} ${'→' } ${String(total).padStart(8)}║\n`;
  });

  text += '╠══════════════════════════════════╣\n';
  text += `║ ${'TOTAL'.padEnd(17)} ${String(transaction.total).padStart(16)}║\n`;
  text += `║ ${'Tendered'.padEnd(17)} ${String(transaction.amountTendered).padStart(16)}║\n`;
  text += `║ ${'Change'.padEnd(17)} ${String(transaction.change).padStart(16)}║\n`;
  text += '╠══════════════════════════════════╣\n';
  text += `║ ${('Payment: ' + (transaction.paymentMethod || 'cash')).padEnd(33)}║\n`;
  text += '╠══════════════════════════════════╣\n';
  text += '║       Thank you for your         ║\n';
  text += '║           patronage!             ║\n';
  text += '╚══════════════════════════════════╝\n';

  return text;
}

/* ── Also export formatCurrency from ui.js context ── */
// formatCurrency is already defined in ui.js which loads before receipt.js
