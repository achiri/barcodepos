/* ═══════════════════════════════════════════════
   Google Apps Script — BarcodePOS Sheet API
   ═══════════════════════════════════════════════
   Deploy this script as a Web App:
   1. Open Extensions > Apps Script in your Google Sheet
   2. Paste this entire file
   3. Deploy > New Deployment > Web App
   4. Set "Execute as" to "Me" and "Who has access" to "Anyone"
   5. Copy the Web App URL into the BarcodePOS app settings

   ── Data model ──
   Products      catalog only (name/category/price) — keyed by barcode.
   WarehouseStock  current warehouse quantity per barcode.
   ShopStock       current quantity per (store, barcode).
   GoodsReceived   append-only intake ledger — every unit that ever
                   entered the business from the manufacturer, whether
                   delivered to the warehouse or straight to a shop.
                   This is the reconciliation baseline: sum it per
                   barcode to get "how many did we ever receive".
   StockMovements  internal relocations (warehouse<->shop) and manual
                   corrections — never an intake, never a sale.
   Sales           what left shop stock via a completed sale.
   Reconciliation per barcode: GoodsReceived total − returns to
   manufacturer − units sold = WarehouseStock + sum(ShopStock).
   ═══════════════════════════════════════════════ */

/* ── Sheet Names ── */
var SHEET_PRODUCTS = 'Products';
var SHEET_WAREHOUSE_STOCK = 'WarehouseStock';
var SHEET_SHOP_STOCK = 'ShopStock';
var SHEET_GOODS_RECEIVED = 'GoodsReceived';
var SHEET_STOCK_MOVEMENTS = 'StockMovements';
var SHEET_SALES = 'Sales';
var SHEET_SETTINGS = 'Settings';
var SHEET_CATEGORIES = 'Categories';
var SHEET_USERS = 'Users';
var SHEET_STORES = 'Stores';
var SHEET_SESSIONS = 'Sessions';

/* ── Headers ── */
var PRODUCT_HEADERS = ['barcode','productName','category','sellingPrice','costPrice','unit','lowStockThreshold','isArchived','createdAt','updatedAt'];
var WAREHOUSE_STOCK_HEADERS = ['barcode','quantity','updatedAt'];
var SHOP_STOCK_HEADERS = ['storeId','barcode','quantity','updatedAt'];
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
        var movements = readMovementSheet_(sheet, SHEET_STOCK_MOVEMENTS);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', movements: movements }))
          .setMimeType(ContentService.MimeType.JSON);

      case 'getGoodsReceived':
        var goodsReceived = readMovementSheet_(sheet, SHEET_GOODS_RECEIVED);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', movements: goodsReceived }))
          .setMimeType(ContentService.MimeType.JSON);

      default:
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'ok', message: 'BarcodePOS API. Use action=getProducts, getSales, getSettings, getCategories, getUsers, getStores, getSessions, getStockMovements, getGoodsReceived, or POST data.' }))
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

/* Catalog rows are keyed by barcode alone now — the same product has one
   canonical name/price/category regardless of where its stock sits. */
function findCatalogRow_(s, barcode) {
  return findRowByKey_(s, 0, barcode);
}

function findWarehouseStockRow_(s, barcode) {
  return findRowByKey_(s, 0, barcode);
}

function findShopStockRow_(s, storeId, barcode) {
  var data = s.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(storeId) && String(data[i][1]) === String(barcode)) {
      return i + 1;
    }
  }
  return -1;
}

/* ═══════════════════════════════════════════
   Products (catalog) + WarehouseStock + ShopStock
   ═══════════════════════════════════════════ */

/* Joins the catalog with current warehouse/shop levels into the
   per-location product shape the app works with locally — one object per
   (barcode, location). This keeps the client's data model unchanged
   while the sheet storage itself stays normalized for accounting. */
function readProducts(sheet) {
  var catalogSheet = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var catalogData = catalogSheet.getDataRange().getValues();
  var catalog = {};
  for (var i = 1; i < catalogData.length; i++) {
    var row = catalogData[i];
    if (row[0] === '') continue;
    catalog[String(row[0])] = {
      barcode: String(row[0]),
      productName: String(row[1] || ''),
      category: String(row[2] || ''),
      sellingPrice: Number(row[3]) || 0,
      costPrice: Number(row[4]) || 0,
      unit: String(row[5] || 'piece'),
      lowStockThreshold: Number(row[6]) || 5,
      isArchived: row[7] === true || row[7] === 'true',
      createdAt: String(row[8] || ''),
      updatedAt: String(row[9] || '')
    };
  }

  var whSheet = ensureSheet_(sheet, SHEET_WAREHOUSE_STOCK, WAREHOUSE_STOCK_HEADERS);
  var whData = whSheet.getDataRange().getValues();
  var warehouseQty = {};
  for (var w = 1; w < whData.length; w++) {
    if (whData[w][0] === '') continue;
    warehouseQty[String(whData[w][0])] = Number(whData[w][1]) || 0;
  }

  var shopSheet = ensureSheet_(sheet, SHEET_SHOP_STOCK, SHOP_STOCK_HEADERS);
  var shopData = shopSheet.getDataRange().getValues();
  var shopRows = {};
  for (var k = 1; k < shopData.length; k++) {
    if (shopData[k][1] === '') continue;
    var bc = String(shopData[k][1]);
    if (!shopRows[bc]) shopRows[bc] = [];
    shopRows[bc].push({ storeId: String(shopData[k][0]), quantity: Number(shopData[k][2]) || 0 });
  }

  var products = [];
  for (var barcode in catalog) {
    var c = catalog[barcode];
    var wh = warehouseQty[barcode] || 0;
    var rows = shopRows[barcode] || [];

    // Always give a product somewhere to live: a warehouse row when it
    // actually has warehouse stock, or as a fallback when it has no shop
    // presence either (e.g. right after creation, before any movement).
    if (wh > 0 || rows.length === 0) {
      products.push(mergeProduct_(c, '__warehouse__', 0, wh));
    }
    for (var r = 0; r < rows.length; r++) {
      products.push(mergeProduct_(c, rows[r].storeId, rows[r].quantity, wh));
    }
  }
  return products;
}

function mergeProduct_(catalogEntry, storeId, stockQuantity, warehouseStock) {
  return {
    storeId: storeId,
    barcode: catalogEntry.barcode,
    productName: catalogEntry.productName,
    category: catalogEntry.category,
    sellingPrice: catalogEntry.sellingPrice,
    costPrice: catalogEntry.costPrice,
    unit: catalogEntry.unit,
    stockQuantity: stockQuantity,
    lowStockThreshold: catalogEntry.lowStockThreshold,
    isArchived: catalogEntry.isArchived,
    createdAt: catalogEntry.createdAt,
    updatedAt: catalogEntry.updatedAt,
    warehouseStock: warehouseStock
  };
}

/* Catalog fields only — quantities never get written here. Every
   quantity change goes through handleUpdateStock (a delta) or the
   movement ledgers, never a field overwrite on the catalog row. */
function handleAddProduct(sheet, payload) {
  var s = ensureSheet_(sheet, SHEET_PRODUCTS, PRODUCT_HEADERS);
  var row = findCatalogRow_(s, payload.barcode);

  var now = new Date().toISOString();
  var values = [
    String(payload.barcode),
    String(payload.productName || ''),
    String(payload.category || ''),
    Number(payload.sellingPrice) || 0,
    Number(payload.costPrice) || 0,
    String(payload.unit || 'piece'),
    Number(payload.lowStockThreshold) || 5,
    payload.isArchived === true,
    payload.createdAt || now,
    now
  ];

  if (row > 0) {
    s.getRange(row, 1, 1, values.length).setValues([values]);
    return jsonResponse({ status: 'ok', message: 'Product updated', barcode: payload.barcode });
  } else {
    s.appendRow(values);
    return jsonResponse({ status: 'ok', message: 'Product added', barcode: payload.barcode });
  }
}

/* Applies a delta to WarehouseStock and/or ShopStock. payload.quantity is
   the shop-side delta for payload.storeId (skipped when storeId is the
   warehouse sentinel or absent); payload.warehouseChange is the
   warehouse-side delta. Both sheets are keyed for upsert, so the first
   movement for a new (store, barcode) pair creates its row. */
function handleUpdateStock(sheet, payload) {
  var barcode = payload.barcode;
  var storeId = payload.storeId;
  var change = Number(payload.quantity) || 0;
  var warehouseChange = Number(payload.warehouseChange) || 0;
  var now = new Date().toISOString();
  var newShopQty = null;
  var newWarehouseQty = null;

  if (storeId && storeId !== '__warehouse__' && change !== 0) {
    var shopSheet = ensureSheet_(sheet, SHEET_SHOP_STOCK, SHOP_STOCK_HEADERS);
    var shopRow = findShopStockRow_(shopSheet, storeId, barcode);
    var currentShopQty = shopRow > 0 ? (Number(shopSheet.getRange(shopRow, 3).getValue()) || 0) : 0;
    newShopQty = Math.max(0, currentShopQty + change);
    if (shopRow > 0) {
      shopSheet.getRange(shopRow, 3, 1, 2).setValues([[newShopQty, now]]);
    } else {
      shopSheet.appendRow([storeId, barcode, newShopQty, now]);
    }
  }

  if (warehouseChange !== 0) {
    var whSheet = ensureSheet_(sheet, SHEET_WAREHOUSE_STOCK, WAREHOUSE_STOCK_HEADERS);
    var whRow = findWarehouseStockRow_(whSheet, barcode);
    var currentWhQty = whRow > 0 ? (Number(whSheet.getRange(whRow, 2).getValue()) || 0) : 0;
    newWarehouseQty = Math.max(0, currentWhQty + warehouseChange);
    if (whRow > 0) {
      whSheet.getRange(whRow, 2, 1, 2).setValues([[newWarehouseQty, now]]);
    } else {
      whSheet.appendRow([barcode, newWarehouseQty, now]);
    }
  }

  return jsonResponse({
    status: 'ok', message: 'Stock updated', barcode: barcode,
    newShopQuantity: newShopQty, newWarehouseQuantity: newWarehouseQty
  });
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
   GoodsReceived (intake ledger) + StockMovements (internal transfers)
   ═══════════════════════════════════════════ */

/* warehouse_in / direct_to_shop are genuine intake — new stock entering
   the business from the manufacturer — and go on GoodsReceived, the
   reconciliation baseline ("40 units came in on the 1st"). Everything
   else (moving stock that's already in the business, or sending it back
   out to the manufacturer) is a StockMovements entry. */
function movementSheetFor_(type) {
  if (type === 'warehouse_in' || type === 'direct_to_shop') {
    return SHEET_GOODS_RECEIVED;
  }
  return SHEET_STOCK_MOVEMENTS; // warehouse_to_shop, shop_to_warehouse, return_to_manufacturer, adjustment
}

function readMovementSheet_(sheet, sheetName) {
  var s = ensureSheet_(sheet, sheetName, STOCK_MOVEMENT_HEADERS);
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
  var sheetName = movementSheetFor_(payload.type);
  var s = ensureSheet_(sheet, sheetName, STOCK_MOVEMENT_HEADERS);
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
  return jsonResponse({ status: 'ok', message: 'Stock movement recorded', movementId: payload.movementId, sheet: sheetName });
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
   Sheet Setup (Run once to create template — fresh installs only)
   ═══════════════════════════════════════════ */

function createTemplateSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Products catalog, seeded with one example item
  var prodSheet = ensureSheet_(ss, SHEET_PRODUCTS, PRODUCT_HEADERS);
  prodSheet.getRange(2, 1, 1, PRODUCT_HEADERS.length)
    .setValues([['ExampleBarcode001', 'Sample Product', 'Other', 1500, 1000, 'piece', 5, false, new Date().toISOString(), new Date().toISOString()]]);

  ensureSheet_(ss, SHEET_WAREHOUSE_STOCK, WAREHOUSE_STOCK_HEADERS);
  ensureSheet_(ss, SHEET_SHOP_STOCK, SHOP_STOCK_HEADERS);

  var salesSheet = ensureSheet_(ss, SHEET_SALES, SALE_HEADERS);

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

  ensureSheet_(ss, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);
  ensureSheet_(ss, SHEET_GOODS_RECEIVED, STOCK_MOVEMENT_HEADERS);
}

/* ═══════════════════════════════════════════
   Migration: run this once if you upgraded from an older version. It
   ensures every sheet/column this version expects exists — safe to run
   any number of times.
   ═══════════════════════════════════════════ */

function upgradeSheetHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_PRODUCTS, PRODUCT_HEADERS);
  ensureSheet_(ss, SHEET_WAREHOUSE_STOCK, WAREHOUSE_STOCK_HEADERS);
  ensureSheet_(ss, SHEET_SHOP_STOCK, SHOP_STOCK_HEADERS);
  ensureSheet_(ss, SHEET_SALES, SALE_HEADERS);
  ensureSheet_(ss, SHEET_SETTINGS, SETTINGS_HEADERS);
  ensureSheet_(ss, SHEET_CATEGORIES, CATEGORY_HEADERS);
  ensureSheet_(ss, SHEET_USERS, USER_HEADERS);
  ensureSheet_(ss, SHEET_STORES, STORE_HEADERS);
  ensureSheet_(ss, SHEET_SESSIONS, SESSION_HEADERS);
  ensureSheet_(ss, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);
  ensureSheet_(ss, SHEET_GOODS_RECEIVED, STOCK_MOVEMENT_HEADERS);
}

/* ═══════════════════════════════════════════
   ONE-TIME migration: splits an older combined Products sheet (which had
   storeId + stockQuantity + warehouseStock columns baked in) into the
   normalized Products / WarehouseStock / ShopStock sheets above.

   Run this ONCE from the Apps Script editor after pasting this version
   in, if your Products sheet still has a "storeId" column. It is safe —
   your original data is kept, untouched, renamed to "Products_old_backup".
   ═══════════════════════════════════════════ */

function migrateToNormalizedStock() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var oldSheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!oldSheet) {
    Logger.log('No existing Products sheet found — nothing to migrate. Run createTemplateSheets() instead for a fresh setup.');
    return;
  }

  var data = oldSheet.getDataRange().getValues();
  if (data.length === 0) {
    Logger.log('Products sheet is empty — nothing to migrate.');
    return;
  }

  var headers = data[0];
  var isOldSchema = headers[0] === 'storeId' && headers.indexOf('stockQuantity') > -1;
  if (!isOldSchema) {
    Logger.log('Products sheet already looks like the new catalog-only schema — nothing to migrate.');
    return;
  }

  var catalogMap = {};   // barcode -> row values for the new Products sheet
  var warehouseMap = {}; // barcode -> quantity
  var shopRows = [];     // [storeId, barcode, quantity, updatedAt]

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[1] === '') continue; // old layout: storeId=0, barcode=1

    var storeId = String(row[0] || '');
    var barcode = String(row[1]);
    var productName = row[2], category = row[3], sellingPrice = row[4], costPrice = row[5],
        unit = row[6], stockQuantity = Number(row[7]) || 0, lowStockThreshold = row[8],
        isArchived = row[9], createdAt = row[10], updatedAt = row[11],
        warehouseStock = Number(row[12]) || 0;

    if (!catalogMap[barcode] || String(updatedAt) > String(catalogMap[barcode][9])) {
      catalogMap[barcode] = [barcode, productName, category, sellingPrice, costPrice, unit, lowStockThreshold, isArchived, createdAt, updatedAt];
    }
    if (warehouseStock > 0) warehouseMap[barcode] = warehouseStock;
    if (storeId && storeId !== '__warehouse__' && stockQuantity > 0) {
      shopRows.push([storeId, barcode, stockQuantity, updatedAt || new Date().toISOString()]);
    }
  }

  var newProducts = ss.insertSheet(SHEET_PRODUCTS + '_new');
  newProducts.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]).setFontWeight('bold');
  newProducts.setFrozenRows(1);
  var catalogRows = [];
  for (var bc in catalogMap) catalogRows.push(catalogMap[bc]);
  if (catalogRows.length > 0) {
    newProducts.getRange(2, 1, catalogRows.length, PRODUCT_HEADERS.length).setValues(catalogRows);
  }

  var whSheet = ensureSheet_(ss, SHEET_WAREHOUSE_STOCK, WAREHOUSE_STOCK_HEADERS);
  var whRows = [];
  for (var wbc in warehouseMap) whRows.push([wbc, warehouseMap[wbc], new Date().toISOString()]);
  if (whRows.length > 0) {
    whSheet.getRange(2, 1, whRows.length, WAREHOUSE_STOCK_HEADERS.length).setValues(whRows);
  }

  var shopSheet = ensureSheet_(ss, SHEET_SHOP_STOCK, SHOP_STOCK_HEADERS);
  if (shopRows.length > 0) {
    shopSheet.getRange(2, 1, shopRows.length, SHOP_STOCK_HEADERS.length).setValues(shopRows);
  }

  oldSheet.setName(SHEET_PRODUCTS + '_old_backup');
  newProducts.setName(SHEET_PRODUCTS);

  // If an earlier partial upgrade already created a combined "Warehouse"
  // receiving-ledger sheet, rename it to the current GoodsReceived name.
  var legacyLedger = ss.getSheetByName('Warehouse');
  if (legacyLedger && !ss.getSheetByName(SHEET_GOODS_RECEIVED)) {
    legacyLedger.setName(SHEET_GOODS_RECEIVED);
  }

  ensureSheet_(ss, SHEET_GOODS_RECEIVED, STOCK_MOVEMENT_HEADERS);
  ensureSheet_(ss, SHEET_STOCK_MOVEMENTS, STOCK_MOVEMENT_HEADERS);

  Logger.log('Migration complete: ' + catalogRows.length + ' catalog items, ' +
    whRows.length + ' warehouse stock rows, ' + shopRows.length + ' shop stock rows. ' +
    'Original sheet kept as "Products_old_backup" for your records.');
}
