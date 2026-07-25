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
var SHEET_CATEGORIES = 'Categories';
var SHEET_USERS = 'Users';
var SHEET_STORES = 'Stores';
var SHEET_SESSIONS = 'Sessions';
var SHEET_STOCK_MOVEMENTS = 'StockMovements';

/* ── Headers ── */
var PRODUCT_HEADERS = ['storeId','barcode','productName','category','sellingPrice','costPrice','unit','stockQuantity','lowStockThreshold','isArchived','createdAt','updatedAt','warehouseStock'];
var STOCK_MOVEMENT_HEADERS = ['movementId','type','barcode','productName','quantity','fromStore','toStore','reference','performedBy','performedByName','notes','createdAt'];
var SALE_HEADERS = ['transactionId','storeId','storeName','cashierId','cashierName','sessionId','items','itemCount','subtotal','taxAmount','total','amountTendered','change','paymentMethod','status','createdAt'];
var SETTINGS_HEADERS = ['key','value','updatedAt'];
var CATEGORY_HEADERS = ['category'];
var USER_HEADERS = ['userId','name','role','pinHash','storeIds','isActive','createdAt','updatedAt','lastLoginAt'];
var STORE_HEADERS = ['storeId','storeName','location','createdAt'];
var SESSION_HEADERS = ['sessionId','cashierId','cashierName','storeId','storeName','checkIn','checkOut','saleCount','totalAmount','status'];

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

      case 'getCategories':
        var categories = readCategories(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', categories: categories }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getUsers':
        var users = readUsers(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', users: users }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getStores':
        var stores = readStores(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', stores: stores }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getSessions':
        var sessions = readSessions(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', sessions: sessions }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getStockMovements':
        var movements = readStockMovements(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', movements: movements }))
          .setMimeType(ContentService.MimeType.JSON);

      default:
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', message: 'BarcodePOS API. Use action=getProducts, getSales, getSettings, getCategories, getUsers, getStores, getSessions, getStockMovements, or POST data.' }))
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
      case 'updateProduct':
        return handleAddProduct(sheet, payload);

      case 'addSale':
        return handleAddSale(sheet, payload);

      case 'updateStock':
        return handleUpdateStock(sheet, payload);

      case 'addUser':
      case 'updateUser':
        return handleUpsertUser(sheet, payload);

      case 'addStore':
      case 'updateStore':
        return handleUpsertStore(sheet, payload);

      case 'addSession':
      case 'updateSession':
        return handleUpsertSession(sheet, payload);

      case 'addStockMovement':
        return handleAddStockMovement(sheet, payload);

      case 'transferStock':
        // Compound: update shop stock first, then record the movement
        if (payload.quantity) {
          // Decrement source
          if (payload.fromStore && payload.fromStore !== '__warehouse__') {
            var dummyPayload = { storeId: payload.fromStore, barcode: payload.barcode, quantity: -payload.quantity };
            handleUpdateStock(sheet, dummyPayload);
          }
          // Increment destination
          if (payload.toStore && payload.toStore !== '__warehouse__') {
            var dummyPayload2 = { storeId: payload.toStore, barcode: payload.barcode, quantity: payload.quantity };
            handleUpdateStock(sheet, dummyPayload2);
          }
        }
        return handleAddStockMovement(sheet, payload);

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
  } else {
    // Sheet exists — check if headers need upgrading
    // (existing sheets from older versions may have fewer columns)
    var existingHeaders = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    if (existingHeaders.length < headers.length) {
      // Extend headers with any new columns. Existing data rows are not
      // touched — their cells in new columns will be empty, which is fine
      // because appendRow() always writes the full row width going forward.
      s.getRange(1, 1, 1, headers.length).setValues([headers]);
      s.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      s.setFrozenRows(1);
    }
  }
  return s;
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

/* Products are keyed by (storeId, barcode) together, since the same
   barcode can exist independently in different stores. */
function findProductRow_(s, storeId, barcode) {
  var data = s.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(storeId) && String(data[i][1]) === String(barcode)) {
      return i + 1;
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
    if (row[1] === '') continue; // Skip empty rows (barcode column)
    var product = {
      storeId: String(row[0] || ''),
      barcode: String(row[1]),
      productName: String(row[2] || ''),
      category: String(row[3] || ''),
      sellingPrice: Number(row[4]) || 0,
      costPrice: Number(row[5]) || 0,
      unit: String(row[6] || 'piece'),
      stockQuantity: Number(row[7]) || 0,
      lowStockThreshold: Number(row[8]) || 5,
      isArchived: row[9] === true || row[9] === 'true',
      createdAt: String(row[10] || ''),
      updatedAt: String(row[11] || ''),
      warehouseStock: Number(row[12]) || 0
    };
    products.push(product);
  }
  return products;
}

function handleAddProduct(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var row = findProductRow_(s, payload.storeId, payload.barcode);

  var now = new Date().toISOString();
  var values = [
    String(payload.storeId || ''),
    String(payload.barcode),
    String(payload.productName || ''),
    String(payload.category || ''),
    Number(payload.sellingPrice) || 0,
    Number(payload.costPrice) || 0,
    String(payload.unit || 'piece'),
    Number(payload.stockQuantity) || 0,
    Number(payload.lowStockThreshold) || 5,
    payload.isArchived === true,
    payload.createdAt || now,
    now,
    Number(payload.warehouseStock) || 0
  ];

  if (row > 0) {
    s.getRange(row, 1, 1, values.length).setValues([values]);
    return jsonResponse({ status: 'ok', message: 'Product updated', barcode: payload.barcode });
  } else {
    s.appendRow(values);
    return jsonResponse({ status: 'ok', message: 'Product added', barcode: payload.barcode });
  }
}

function handleUpdateStock(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var row = findProductRow_(s, payload.storeId, payload.barcode);

  // Also handle warehouse stock changes — find ALL rows with this barcode
  // (same product may exist in multiple stores) and update warehouseStock on each.
  var warehouseChange = Number(payload.warehouseChange) || 0;
  var change = Number(payload.quantity) || 0;

  if (row < 0) {
    // No row for this product at this store yet — clone its core info
    // (name/price/category) from wherever it already exists, mirroring
    // the local upsert behavior, so receiving/transferring stock to a
    // new location doesn't require the item to already exist there.
    var data = s.getDataRange().getValues();
    var template = null;
    for (var t = 1; t < data.length; t++) {
      if (String(data[t][1]) === String(payload.barcode)) { template = data[t]; break; }
    }
    if (!template) {
      return jsonResponse({ status: 'error', message: 'Product not found: ' + payload.barcode });
    }
    var now0 = new Date().toISOString();
    s.appendRow([
      String(payload.storeId || ''),
      String(payload.barcode),
      template[2], template[3], template[4], template[5], template[6],
      Math.max(0, change),
      template[8], template[9],
      now0, now0,
      template[12]
    ]);
    row = s.getLastRow();
    if (warehouseChange !== 0) {
      var data2 = s.getDataRange().getValues();
      for (var j = 1; j < data2.length; j++) {
        if (String(data2[j][1]) === String(payload.barcode)) {
          var currentWH0 = Number(data2[j][12]) || 0;
          var newWH0 = Math.max(0, currentWH0 + warehouseChange);
          s.getRange(j + 1, 13).setValue(newWH0);
          s.getRange(j + 1, 12).setValue(now0);
        }
      }
    }
    return jsonResponse({ status: 'ok', message: 'Stock updated (product created)', barcode: payload.barcode, newQuantity: Math.max(0, change) });
  }

  var currentQty = Number(s.getRange(row, 8).getValue()) || 0;
  var newQty = Math.max(0, currentQty + change);
  s.getRange(row, 8).setValue(newQty);
  s.getRange(row, 12).setValue(new Date().toISOString());

  // Update warehouse stock on ALL rows with this barcode
  if (warehouseChange !== 0) {
    var data = s.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(payload.barcode)) {
        var currentWH = Number(data[i][12]) || 0;
        var newWH = Math.max(0, currentWH + warehouseChange);
        s.getRange(i + 1, 13).setValue(newWH);
        s.getRange(i + 1, 12).setValue(new Date().toISOString());
      }
    }
  }

  return jsonResponse({ status: 'ok', message: 'Stock updated', barcode: payload.barcode, newQuantity: newQty });
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
      storeId: String(row[1] || ''),
      storeName: String(row[2] || ''),
      cashierId: String(row[3] || ''),
      cashierName: String(row[4] || ''),
      sessionId: String(row[5] || ''),
      items: parseItems_(String(row[6])),
      itemCount: Number(row[7]) || 0,
      subtotal: Number(row[8]) || 0,
      taxAmount: Number(row[9]) || 0,
      total: Number(row[10]) || 0,
      amountTendered: Number(row[11]) || 0,
      change: Number(row[12]) || 0,
      paymentMethod: String(row[13] || 'cash'),
      status: String(row[14] || 'completed'),
      createdAt: String(row[15] || '')
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
    String(payload.storeId || ''),
    String(payload.storeName || ''),
    String(payload.cashierId || ''),
    String(payload.cashierName || ''),
    String(payload.sessionId || ''),
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
   Categories
   ═══════════════════════════════════════════ */

function readCategories(sheet) {
  var s = ensureSheet_(sheet, SHEET_CATEGORIES, CATEGORY_HEADERS);
  var data = s.getDataRange().getValues();
  var categories = [];
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    if (name !== '') categories.push(name);
  }
  return categories;
}

/* ═══════════════════════════════════════════
   Users
   ═══════════════════════════════════════════ */

function readUsers(sheet) {
  var s = ensureSheet_(sheet, SHEET_USERS, USER_HEADERS);
  var data = s.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue;
    users.push({
      userId: String(row[0]),
      name: String(row[1] || ''),
      role: String(row[2] || ''),
      pinHash: String(row[3] || ''),
      storeIds: String(row[4] || '').split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x !== ''; }),
      isActive: row[5] === true || row[5] === 'true',
      createdAt: String(row[6] || ''),
      updatedAt: String(row[7] || ''),
      lastLoginAt: String(row[8] || '')
    });
  }
  return users;
}

function handleUpsertUser(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_USERS, USER_HEADERS);
  var row = findRowByKey_(s, 0, payload.userId);
  var now = new Date().toISOString();
  var values = [
    String(payload.userId),
    String(payload.name || ''),
    String(payload.role || ''),
    String(payload.pinHash || ''),
    (payload.storeIds || []).join(','),
    payload.isActive !== false,
    payload.createdAt || now,
    now,
    payload.lastLoginAt || ''
  ];

  if (row > 0) {
    s.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    s.appendRow(values);
  }
  return jsonResponse({ status: 'ok', message: 'User saved', userId: payload.userId });
}

/* ═══════════════════════════════════════════
   Stores
   ═══════════════════════════════════════════ */

function readStores(sheet) {
  var s = ensureSheet_(sheet, SHEET_STORES, STORE_HEADERS);
  var data = s.getDataRange().getValues();
  var stores = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue;
    stores.push({
      storeId: String(row[0]),
      storeName: String(row[1] || ''),
      location: String(row[2] || ''),
      createdAt: String(row[3] || '')
    });
  }
  return stores;
}

function handleUpsertStore(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_STORES, STORE_HEADERS);
  var row = findRowByKey_(s, 0, payload.storeId);
  var values = [
    String(payload.storeId),
    String(payload.storeName || ''),
    String(payload.location || ''),
    payload.createdAt || new Date().toISOString()
  ];

  if (row > 0) {
    s.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    s.appendRow(values);
  }
  return jsonResponse({ status: 'ok', message: 'Store saved', storeId: payload.storeId });
}

/* ═══════════════════════════════════════════
   Sessions (cashier shifts)
   ═══════════════════════════════════════════ */

function readSessions(sheet) {
  var s = ensureSheet_(sheet, SHEET_SESSIONS, SESSION_HEADERS);
  var data = s.getDataRange().getValues();
  var sessions = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue;
    sessions.push({
      sessionId: String(row[0]),
      cashierId: String(row[1] || ''),
      cashierName: String(row[2] || ''),
      storeId: String(row[3] || ''),
      storeName: String(row[4] || ''),
      checkIn: String(row[5] || ''),
      checkOut: String(row[6] || ''),
      saleCount: Number(row[7]) || 0,
      totalAmount: Number(row[8]) || 0,
      status: String(row[9] || '')
    });
  }
  return sessions;
}

function handleUpsertSession(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_SESSIONS, SESSION_HEADERS);
  var row = findRowByKey_(s, 0, payload.sessionId);
  var values = [
    String(payload.sessionId),
    String(payload.cashierId || ''),
    String(payload.cashierName || ''),
    String(payload.storeId || ''),
    String(payload.storeName || ''),
    payload.checkIn || '',
    payload.checkOut || '',
    Number(payload.saleCount) || 0,
    Number(payload.totalAmount) || 0,
    String(payload.status || '')
  ];

  if (row > 0) {
    s.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    s.appendRow(values);
  }
  return jsonResponse({ status: 'ok', message: 'Session saved', sessionId: payload.sessionId });
}

/* ═══════════════════════════════════════════
   Stock Movements
   ═══════════════════════════════════════════ */

function readStockMovements(sheet) {
  var s = ensureSheet_(sheet, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);
  var data = s.getDataRange().getValues();
  var movements = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0] === '') continue;
    movements.push({
      movementId: String(row[0]),
      type: String(row[1] || ''),
      barcode: String(row[2] || ''),
      productName: String(row[3] || ''),
      quantity: Number(row[4]) || 0,
      fromStore: String(row[5] || ''),
      toStore: String(row[6] || ''),
      reference: String(row[7] || ''),
      performedBy: String(row[8] || ''),
      performedByName: String(row[9] || ''),
      notes: String(row[10] || ''),
      createdAt: String(row[11] || '')
    });
  }
  return movements;
}

function handleAddStockMovement(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);
  var values = [
    String(payload.movementId),
    String(payload.type || ''),
    String(payload.barcode || ''),
    String(payload.productName || ''),
    Number(payload.quantity) || 0,
    String(payload.fromStore || ''),
    String(payload.toStore || ''),
    String(payload.reference || ''),
    String(payload.performedBy || ''),
    String(payload.performedByName || ''),
    String(payload.notes || ''),
    payload.createdAt || new Date().toISOString()
  ];
  s.appendRow(values);
  return jsonResponse({ status: 'ok', message: 'Stock movement recorded', movementId: payload.movementId });
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
        case 'addUser':
        case 'updateUser':
          results.push(handleUpsertUser(sheet, a.payload));
          break;
        case 'addStore':
        case 'updateStore':
          results.push(handleUpsertStore(sheet, a.payload));
          break;
        case 'addSession':
        case 'updateSession':
          results.push(handleUpsertSession(sheet, a.payload));
          break;
        case 'addStockMovement':
          results.push(handleAddStockMovement(sheet, a.payload));
          break;
        case 'transferStock':
          if (a.payload.quantity) {
            if (a.payload.fromStore && a.payload.fromStore !== '__warehouse__') {
              var d1 = { storeId: a.payload.fromStore, barcode: a.payload.barcode, quantity: -a.payload.quantity };
              results.push(handleUpdateStock(sheet, d1));
            }
            if (a.payload.toStore && a.payload.toStore !== '__warehouse__') {
              var d2 = { storeId: a.payload.toStore, barcode: a.payload.barcode, quantity: a.payload.quantity };
              results.push(handleUpdateStock(sheet, d2));
            }
          }
          results.push(handleAddStockMovement(sheet, a.payload));
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
    .setValues([['default-store', 'ExampleBarcode001', 'Sample Product', 'Other', 1500, 1000, 'piece', 50, 5, false, new Date().toISOString(), new Date().toISOString(), 0]]);

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

  // Create Categories sheet — add, remove, or reorder rows here any time;
  // the app picks up the current list every time it loads.
  var categoriesSheet = ensureSheet_(ss, SHEET_CATEGORIES, CATEGORY_HEADERS);
  var defaultCategories = ['Beverages', 'Food & Grains', 'Dairy', 'Toiletries', 'Household', 'Electronics', 'Pharmacy', 'Other'];
  categoriesSheet.getRange(2, 1, defaultCategories.length, 1)
    .setValues(defaultCategories.map(function(c) { return [c]; }));

  // Create Stores sheet, seeded with a default store matching the
  // pre-multi-store single-store setup.
  var storesSheet = ensureSheet_(ss, SHEET_STORES, STORE_HEADERS);
  storesSheet.getRange(2, 1, 1, STORE_HEADERS.length)
    .setValues([['default-store', 'My Store', '', new Date().toISOString()]]);

  // Users and Sessions sheets are created empty — the app's setup
  // wizard creates the first Manager account and syncs it here.
  ensureSheet_(ss, SHEET_USERS, USER_HEADERS);
  ensureSheet_(ss, SHEET_SESSIONS, SESSION_HEADERS);

  // Stock Movements sheet — logs every warehouse receipt, transfer, etc.
  ensureSheet_(ss, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);
}

/* ═══════════════════════════════════════════
   Migration: run this if you upgraded from an older version and existing
   sheets are missing columns. It calls ensureSheet_ on every known sheet
   so new columns are added to the header row (existing data untouched).
   ═══════════════════════════════════════════ */

function upgradeSheetHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_PRODUCTS, PRODUCT_HEADERS);
  ensureSheet_(ss, SHEET_SALES, SALE_HEADERS);
  ensureSheet_(ss, SHEET_SETTINGS, SETTINGS_HEADERS);
  ensureSheet_(ss, SHEET_CATEGORIES, CATEGORY_HEADERS);
  ensureSheet_(ss, SHEET_USERS, USER_HEADERS);
  ensureSheet_(ss, SHEET_STORES, STORE_HEADERS);
  ensureSheet_(ss, SHEET_SESSIONS, SESSION_HEADERS);
  ensureSheet_(ss, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);
}
