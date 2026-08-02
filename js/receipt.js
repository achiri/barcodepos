/* ═══════════════════════════════════════════════
   Receipt Generation Module
   ═══════════════════════════════════════════════ */

import { $, showToast, formatCurrency, escapeHtml } from './ui.js';

const RECEIPT_WIDTH = 34; // inner content width, between the | | borders

/* ── Padding helpers (ASCII-only so columns stay aligned in every font/printer) ── */
function padLine(str, width = RECEIPT_WIDTH) {
  str = String(str);
  if (str.length > width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function centerLine(str, width = RECEIPT_WIDTH) {
  str = String(str);
  if (str.length > width) str = str.slice(0, width);
  const pad = width - str.length;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + str + ' '.repeat(pad - left);
}

function twoColLine(left, right, width = RECEIPT_WIDTH) {
  left = String(left);
  right = String(right);
  const gap = Math.max(1, width - left.length - right.length);
  return padLine(left + ' '.repeat(gap) + right, width);
}

/* ── Build the receipt as an array of plain-text lines (shared by screen + print + share) ── */
function buildReceiptLines(transaction, storeName, currency) {
  const date = new Date(transaction.createdAt);
  const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const items = transaction.items || [];
  const methodLabels = { cash: 'Cash', mobile_money: 'Mobile Money', bank_transfer: 'Bank Transfer' };

  const border = '+' + '-'.repeat(RECEIPT_WIDTH + 2) + '+';
  const line = (text) => '| ' + padLine(text) + ' |';
  const centered = (text) => '| ' + centerLine(text) + ' |';
  const twoCol = (l, r) => '| ' + twoColLine(l, r) + ' |';

  const lines = [];
  lines.push(border);
  lines.push(centered(storeName || 'MY STORE'));
  lines.push(centered('BarcodePOS Receipt'));
  lines.push(border);
  lines.push(line(`${dateStr}  ${timeStr}`));
  lines.push(line(`ID: ${transaction.transactionId || ''}`));
  if (transaction.cashierName) lines.push(line(`Served by: ${transaction.cashierName}`));
  lines.push(border);
  lines.push(line('ITEMS'));
  lines.push(border);

  items.forEach(i => {
    const name = i.productName || i.barcode || 'Item';
    const qty = i.quantity || 1;
    const price = i.unitPrice || 0;
    const total = i.lineTotal || (qty * price);
    lines.push(line(name));
    lines.push(twoCol(`  ${qty} x ${formatCurrency(price, currency)}`, formatCurrency(total, currency)));
  });

  lines.push(border);
  lines.push(twoCol('TOTAL', formatCurrency(transaction.total, currency)));
  lines.push(twoCol('Tendered', formatCurrency(transaction.amountTendered, currency)));
  lines.push(twoCol('Change', formatCurrency(transaction.change, currency)));
  lines.push(border);
  lines.push(line(`Payment: ${methodLabels[transaction.paymentMethod] || transaction.paymentMethod || 'cash'}`));
  lines.push(border);
  lines.push(centered('Thank you for your'));
  lines.push(centered('patronage!'));
  lines.push(border);

  return lines;
}

/* ── Generate receipt HTML and show it ── */
export function showReceipt(transaction, storeName, currency) {
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
  // When dismissing the receipt, reset the checkout ONLY for live sale
  // receipts (the normal finalize flow). A reopened past receipt
  // (window._lastReceiptView) must not wipe an in-progress basket.
  if (window._lastReceiptView) {
    window._lastReceiptView = false;
  } else if (typeof window.startNewCheckout === 'function') {
    window.startNewCheckout();
  }
}

/* ── Generate Receipt HTML ── */
function generateReceiptHtml(transaction, storeName, currency) {
  return escapeHtml(buildReceiptLines(transaction, storeName, currency).join('\n')).replace(/\n/g, '<br>');
}

/* ── Share plain text via Native Share ──
   Shared by the live receipt (receipt modal) and past receipts
   (sale detail modal) so the logic lives in exactly one place. */
export async function shareReceiptText(plainText, title) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text: plainText });
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
    if (err.name === 'AbortError') {
      return; // user cancelled the native share sheet — silent, not an error
    }
    showToast('Share failed', 'error');
  }
}

/* ── Print plain text / Save as PDF ── */
// Printed via an in-page hidden element + @media print (see css/style.css),
// rather than window.open() — popup windows steal focus and can get
// blocked or stranded on mobile, leaving the receipt modal looking "stuck".
export function printReceiptText(plainText) {
  let printArea = document.getElementById('print-area');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'print-area';
    document.body.appendChild(printArea);
  }
  printArea.textContent = plainText;

  window.print();
}

/* ── Share Receipt (live receipt modal — uses the last shown receipt) ── */
async function shareReceipt() {
  const receipt = window._lastReceipt;
  if (!receipt) return;
  const plainText = generatePlainTextReceipt(receipt.transaction, receipt.storeName, receipt.currency);
  await shareReceiptText(plainText, `Receipt - ${receipt.storeName}`);
}

/* ── Print Receipt (live receipt modal — uses the last shown receipt) ── */
function printReceipt() {
  const receipt = window._lastReceipt;
  if (!receipt) return;
  const plainText = generatePlainTextReceipt(receipt.transaction, receipt.storeName, receipt.currency);
  printReceiptText(plainText);
}

/* ── Generate Plain Text Receipt ── */
export function generatePlainTextReceipt(transaction, storeName, currency) {
  return buildReceiptLines(transaction, storeName, currency).join('\n') + '\n';
}

/* ── Attach functions referenced by inline HTML on* handlers ── */
Object.assign(window, { closeReceiptModal, shareReceipt, printReceipt });
