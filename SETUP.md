# BarcodePOS — Setup Guide

## What You've Built

BarcodePOS is a **fully functional sales management Progressive Web App** that turns any smartphone into a barcode-scanning point-of-sale system backed by Google Sheets.

### What's in this MVP

| Feature | Status |
|---|---|
| 📷 **Barcode scanning** (camera) | ✅ Working (via html5-qrcode) |
| 🔍 **Auto product lookup** (Open Food Facts) | ✅ Working |
| 📦 **Inventory management** | ✅ Add, edit, search, stock levels |
| 🛒 **Checkout / POS** | ✅ Scan items, build invoice, calculate totals |
| 💵 **Payment handling** | ✅ Cash, Mobile Money, Bank Transfer |
| 🧾 **Digital receipts** | ✅ Share via WhatsApp, Email, or Print/PDF |
| 📊 **Sales dashboard** | ✅ Today/Week totals, recent transactions |
| 🔔 **Stock alerts** | ✅ Out-of-stock and low-stock indicators |
| 📡 **Offline mode** | ✅ Works offline, syncs when connected |
| 📗 **Google Sheets sync** | ✅ All data persisted to your own sheet |
| 📱 **PWA installable** | ✅ Works offline, installs to home screen |

---

## How to Set Up

### Step 1: Copy the Google Sheet Template

1. Open this link: **[Google Sheet Template](https://docs.google.com/spreadsheets/d/1X8cMqTz9qWpBJv5G5xF2nLq5qS8Yk3dRzqPv0oYb7kU/copy)**
2. Click **"Make a copy"** — it will be saved to your Google Drive
3. Rename it to something like `My Store Sales Data`

### Step 2: Deploy the Apps Script

1. In your new sheet, go to **Extensions → Apps Script**
2. Delete any default code in the editor
3. Open the file `gas/Code.gs` from this project and **copy all the code**
4. Paste it into the Apps Script editor
5. Click **Save** (💾 icon) — name the project `BarcodePOS`
6. Click **Deploy → New Deployment**
7. Choose **Web App** as the type
8. Settings:
   - **Execute as:** `Me` (your email)
   - **Who has access:** `Anyone` (the app calls this API on your behalf)
9. Click **Deploy**
10. **Copy the Web App URL** — it looks like:
    `https://script.google.com/macros/s/abc123.../exec`

### Step 3: Run the Sheet Setup Script (One-Time)

1. In the Apps Script editor, find the function `createTemplateSheets` in the code
2. Click the dropdown at the top (next to the Debug button) and select `createTemplateSheets`
3. Click **Run**
4. This will add sample data and the Settings sheet
5. You can now close the Apps Script tab

### Step 4: Launch the App

**Option A — Host for free (recommended for testing)**

1. Upload the project folder to **Netlify** (dragover deploy) or **GitHub Pages**
2. Open the URL on your phone

**Option B — Run locally for development**

Open `index.html` directly in a browser (note: barcode scanning may not work on `file://` — use a local server):

```bash
# Using Python
python3 -m http.server 8080

# Using Node.js
npx serve .
```

**Option C — Test on your phone immediately**

Use a tool like **ngrok** or serve the folder and access via your phone on the same WiFi network.

### Step 5: Connect the App to Your Sheet

1. Open the app on your phone
2. Go through the onboarding wizard:
   - Enter your store name
   - Paste the **Web App URL** from Step 2
3. Tap **"Connect & Finish"**
4. You'll see the Dashboard — your app is ready!

---

## How to Use

### 🏪 Back Office (Setting Up Products)

1. Tap **Scan Product** (bottom navigation 📷)
2. Tap **"Start Scanner"** — point camera at a product barcode
3. The product name will auto-populate (from Open Food Facts database)
4. Enter:
   - **Selling Price** in FCFA (required)
   - **Cost Price** (optional — for profit tracking)
   - **Stock Quantity** (how many you have)
   - **Low Stock Alert At** (e.g., 5 — you'll be notified when stock hits this number)
5. Tap **Save Product**

> **No barcode?** Tap "Enter Barcode Manually" to type it in.

### 🛒 Checkout (Making a Sale)

1. Tap **Sell** (bottom navigation 🛒)
2. Tap **"Scan Next Item"**
3. Point camera at product barcode → item added to invoice
4. Adjust quantities with **+ / −** buttons
5. Repeat for all items
6. Tap **"Complete Sale →"**
7. Enter the amount the customer paid
8. Select payment method (Cash / Mobile Money / Bank Transfer)
9. Tap **"Confirm Payment"**
10. **Receipt appears** — share via WhatsApp, save as PDF, or print

### 📊 Dashboard

- **Today's Sales** — total for today
- **Products** — total products in inventory
- **Low Stock** — count of products needing reorder
- **This Week** — weekly sales total
- Tap any stat card to jump to that section

---

## Offline Mode

- The app works **fully offline** for checkout and inventory management
- Sales and stock changes are queued locally
- When internet returns, data auto-syncs to Google Sheets
- The sync indicator at the top shows status:
  - 🟢 **Synced** — all data pushed to sheet
  - 🟡 **Pending** — waiting to sync
  - 🔴 **Error** — sync failed (will retry)

---

## Stock Alerts

- Products with stock **at or below** the threshold appear under Stock Alerts
- **Red** = Out of stock
- **Amber** = Low stock
- Tap any alert item to restock

---

## File Structure

```
Sales App/
├── index.html              # Main app shell (all views)
├── manifest.json           # PWA manifest (install to home screen)
├── sw.js                   # Service Worker (offline caching)
├── css/
│   └── style.css           # Complete stylesheet (mobile-first)
├── js/
│   ├── app.js              # Initialization, routing, onboarding
│   ├── db.js               # IndexedDB data access layer
│   ├── ui.js               # UI rendering, navigation, helpers
│   ├── scanner.js          # Barcode camera scanner + lookup
│   ├── sheets.js           # Google Sheets sync engine
│   └── receipt.js          # Receipt generation & sharing
├── gas/
│   └── Code.gs             # Google Apps Script (Sheet API)
├── assets/
│   └── icon-192.svg        # App icon
├── business-case.md        # Business case document
└── system-requirements-specification.md  # SRS document
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML/CSS/JS (no frameworks) |
| **Barcode Scan** | html5-qrcode library |
| **Client Storage** | IndexedDB (offline) |
| **Backend DB** | Google Sheets + Google Apps Script |
| **Barcode Lookup** | Open Food Facts API |
| **PWA** | Service Worker + Web App Manifest |
| **Hosting** | Any static host (Netlify, GitHub Pages, etc.) |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **Camera not opening** | Use Chrome or Samsung Internet. Grant camera permission when prompted. |
| **Google Sheets not syncing** | Go to Settings → tap "Test Connection". Re-deploy the Apps Script if URL changed. |
| **"No-CORS" errors in console** | Normal. Google Apps Script web apps use `no-cors` mode. Data is still saved. |
| **Products not appearing** | Tap the sync button in sidebar, or pull down to refresh. |
| **Receipt sharing not working** | On some phones, "Share" opens system share sheet. Receipt also copies to clipboard. |
| **App not installing on phone** | Open in Chrome/Samsung Internet → tap "Add to Home Screen" from browser menu. |

---

## Next Steps (Future Phases)

- [ ] Real-time WhatsApp receipt sending
- [ ] SMS stock alerts
- [ ] Multi-store management
- [ ] Barcode label printing
- [ ] Inventory CSV import/export
- [ ] Sales analytics charts
- [ ] Tax/VAT configuration
- [ ] Customer credit tracking

---

**Built with ❤️ for African micro-retailers.**
*Zero cost. Zero servers. Just a phone and a Google Sheet.*
