/* ═══════════════════════════════════════════════
   Google Apps Script — BarcodePOS Sheet API
   ═══════════════════════════════════════════════
   Deploy this script as a Web App:
   1. Open Extensions > Apps Script in your Google Sheet
   2. Paste this entire file
   3. Deploy > New Deployment > Web App
   4. Set "Execute as" to "Me" and "Who has access" to "Anyone"
   5. Copy the Web App URL into the BarcodePOS app settings
   ═══════════════════════════════════════════════ */

/* ── Sheet Names ── */
var SHEET_PRODUCTS = 'Products';
var SHEET_SALES = 'Sales';
var SHEET_SETTINGS = 'Settings';

/* ── Headers ── */
var PRODUCT_HEADERS = ['barcode','productName','category','sellingPrice','costPrice','unit','stockQuantity','lowStockThreshold','isArchived','createdAt','updatedAt'];
var SALE_HEADERS = ['transactionId','items','itemCount','subtotal','taxAmount','total','amountTendered','change','paymentMethod','status','createdAt'];
var SETTINGS_HEADERS = ['key','value','updatedAt'];

/* ── GET handler: reads data from sheets ── */
function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    var sheet = SpreadsheetApp.getActiveSpreadsheet();

    switch (action) {
      case 'ping':
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', message: 'BarcodePOS API is live', time: new Date().toISOString() }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getProducts':
        var products = readProducts(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', count: products.length, products: products }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getSales':
        var sales = readSales(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', count: sales.length, sales: sales }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getSettings':
        var settings = readSettingsMap(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', settings: settings }))
          .setMimeType(ContentService.MimeType.JSON);

      default:
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', message: 'BarcodePOS API. Use action=getProducts, getSales, getSettings, or POST data.' }))
          .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ── POST handler: writes data to sheets ── */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || '';
    var payload = data.payload || {};
    var sheet = SpreadsheetApp.getActiveSpreadsheet();

    switch (action) {
      case 'addProduct':
        return handleAddProduct(sheet, payload);

      case 'updateProduct':
        return handleUpdateProduct(sheet, payload);

      case 'addSale':
        return handleAddSale(sheet, payload);

      case 'updateStock':
        return handleUpdateStock(sheet, payload);

      case 'bulkSync':
        return handleBulkSync(sheet, payload);

      default:
        return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

/* ═══════════════════════════════════════════
   Sheet Helpers
   ═══════════════════════════════════════════ */

function ensureSheet_(sheet, name, headers) {
  var s = sheet.getSheetByName(name);
  if (!s) {
    s = sheet.insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

function getLastRow_(s) {
  var lr = s.getLastRow();
  return lr < 1 ? 1 : lr;
}

function findRowByKey_(s, keyCol, value) {
  var data = s.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]) === String(value)) {
      return i + 1; // 1-indexed row number
    }
  }
  return -1;
}

/* ═══════════════════════════════════════════
   Products
   ═══════════════════════════════════════════ */

function readProducts(sheet) {
  var s = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var data = s.getDataRange().getValues();
  var products = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue; // Skip empty rows
    var product = {
      barcode: String(row[0]),
      productName: String(row[1] || ''),
      category: String(row[2] || ''),
      sellingPrice: Number(row[3]) || 0,
      costPrice: Number(row[4]) || 0,
      unit: String(row[5] || 'piece'),
      stockQuantity: Number(row[6]) || 0,
      lowStockThreshold: Number(row[7]) || 5,
      isArchived: row[8] === true || row[8] === 'true',
      createdAt: String(row[9] || ''),
      updatedAt: String(row[10] || '')
    };
    products.push(product);
  }
  return products;
}

function handleAddProduct(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var row = findRowByKey_(s, 0, payload.barcode);

  var now = new Date().toISOString();
  var values = [
    String(payload.barcode),
    String(payload.productName || ''),
    String(payload.category || ''),
    Number(payload.sellingPrice) || 0,
    Number(payload.costPrice) || 0,
    String(payload.unit || 'piece'),
    Number(payload.stockQuantity) || 0,
    Number(payload.lowStockThreshold) || 5,
    false,
    now,
    now
  ];

  if (row > 0) {
    // Update existing row
    s.getRange(row, 1, 1, values.length).setValues([values]);
    return jsonResponse({ status: 'ok', message: 'Product updated', barcode: payload.barcode });
  } else {
    // Append new row
    s.appendRow(values);
    return jsonResponse({ status: 'ok', message: 'Product added', barcode: payload.barcode });
  }
}

function handleUpdateProduct(sheet, payload) {
  // Same as addProduct — upsert
  return handleAddProduct(sheet, payload);
}

function handleUpdateStock(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var row = findRowByKey_(s, 0, payload.barcode);
  if (row > 0) {
    var currentQty = Number(s.getRange(row, 7).getValue()) || 0;
    var change = Number(payload.quantity) || 0;
    var newQty = Math.max(0, currentQty + change);
    s.getRange(row, 7).setValue(newQty);
    s.getRange(row, 11).setValue(new Date().toISOString());
    return jsonResponse({ status: 'ok', message: 'Stock updated', barcode: payload.barcode, newQuantity: newQty });
  } else {
    return jsonResponse({ status: 'error', message: 'Product not found: ' + payload.barcode });
  }
}

/* ═══════════════════════════════════════════
   Sales
   ═══════════════════════════════════════════ */

function readSales(sheet) {
  var s = ensureSheet_(sheet, SHEET_SALES, SALE_HEADERS);
  var data = s.getDataRange().getValues();
  var sales = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue;
    var sale = {
      transactionId: String(row[0]),
      items: parseItems_(String(row[1])),
      itemCount: Number(row[2]) || 0,
      subtotal: Number(row[3]) || 0,
      taxAmount: Number(row[4]) || 0,
      total: Number(row[5]) || 0,
      amountTendered: Number(row[6]) || 0,
      change: Number(row[7]) || 0,
      paymentMethod: String(row[8] || 'cash'),
      status: String(row[9] || 'completed'),
      createdAt: String(row[10] || '')
    };
    sales.push(sale);
  }
  return sales;
}

function handleAddSale(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_SALES, SALE_HEADERS);
  var itemsStr = JSON.stringify(payload.items || []);
  var itemCount = payload.items ? payload.items.reduce(function(sum, i) { return sum + (i.quantity || 0); }, 0) : 0;

  var values = [
    String(payload.transactionId),
    itemsStr,
    itemCount,
    Number(payload.subtotal) || 0,
    Number(payload.taxAmount) || 0,
    Number(payload.total) || 0,
    Number(payload.amountTendered) || 0,
    Number(payload.change) || 0,
    String(payload.paymentMethod || 'cash'),
    String(payload.status || 'completed'),
    String(payload.createdAt || new Date().toISOString())
  ];

  s.appendRow(values);
  return jsonResponse({ status: 'ok', message: 'Sale recorded', transactionId: payload.transactionId });
}

function parseItems_(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return [];
  }
}

/* ═══════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════ */

function readSettingsMap(sheet) {
  var s = ensureSheet_(sheet, SHEET_SETTINGS, SETTINGS_HEADERS);
  var data = s.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] !== '') {
      settings[String(data[i][0])] = String(data[i][1] || '');
    }
  }
  return settings;
}

/* ═══════════════════════════════════════════
   Bulk Sync
   ═══════════════════════════════════════════ */

function handleBulkSync(sheet, payload) {
  var results = [];
  var actions = payload.actions || [];

  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    try {
      switch (a.action) {
        case 'addProduct':
        case 'updateProduct':
          results.push(handleAddProduct(sheet, a.payload));
          break;
        case 'addSale':
          results.push(handleAddSale(sheet, a.payload));
          break;
        case 'updateStock':
          results.push(handleUpdateStock(sheet, a.payload));
          break;
        default:
          results.push({ status: 'skipped', action: a.action });
      }
    } catch (e) {
      results.push({ status: 'error', action: a.action, message: e.toString() });
    }
  }

  return jsonResponse({ status: 'ok', processed: results.length, results: results });
}

/* ═══════════════════════════════════════════
   Utility
   ═══════════════════════════════════════════ */

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════════════════════════════════
   Sheet Setup (Run once to create template)
   ═══════════════════════════════════════════ */

function createTemplateSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Create Products sheet
  var prodSheet = ensureSheet_(ss, SHEET_PRODUCTS, PRODUCT_HEADERS);
  prodSheet.getRange(2, 1, 1, PRODUCT_HEADERS.length)
    .setValues([['ExampleBarcode001', 'Sample Product', 'Other', 1500, 1000, 'piece', 50, 5, false, new Date().toISOString(), new Date().toISOString()]]);

  // Create Sales sheet
  var salesSheet = ensureSheet_(ss, SHEET_SALES, SALE_HEADERS);

  // Create Settings sheet
  var settingsSheet = ensureSheet_(ss, SHEET_SETTINGS, SETTINGS_HEADERS);
  settingsSheet.getRange(2, 1, 5, 3).setValues([
    ['storeName', 'My Store', new Date().toISOString()],
    ['currency', 'XAF', new Date().toISOString()],
    ['taxRate', '0', new Date().toISOString()],
    ['taxEnabled', 'false', new Date().toISOString()],
    ['setupDate', new Date().toISOString(), new Date().toISOString()]
  ]);
}
