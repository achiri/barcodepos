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
| 👥 **Roles & multi-store** | ✅ Manager / Stock Manager / Cashier accounts, PIN login, per-store inventory |

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
11. In the editor, run the function **`setApiToken()`** (or `setApiTokenTo('your-token')`)
12. **Copy the printed token** (starts with `bp_…`) — this is your **API Token**. The API rejects every request without it.

### Step 3: Run the Sheet Setup Script (One-Time)

1. In the Apps Script editor, find the function `createTemplateSheets` in the code
2. Click the dropdown at the top (next to the Debug button) and select `createTemplateSheets`
3. Click **Run**
4. This will add sample data and the Settings sheet
5. You can now close the Apps Script tab

### Step 4: Launch the App

This project uses [Vite](https://vitejs.dev) to bundle the JS and generate the offline service worker. First-time setup:

```bash
npm install
```

**Option A — Develop locally**

```bash
npm run dev
```

Opens a dev server at `http://localhost:5173` with hot-reload. Camera scanning works here since `localhost` counts as a secure context.

**Option B — Test on your phone immediately**

```bash
npm run host
```

Starts the dev server and opens a public HTTPS tunnel (via localtunnel) — open the printed URL on your phone. Camera scanning needs `https://`, which the tunnel provides.

**Option C — Host for free (recommended for production)**

```bash
npm run build
```

This outputs a production-ready bundle to `dist/` (minified JS, hashed filenames, and an auto-generated `sw.js` that's invalidated on every new build). Upload the **`dist/` folder** — not the project root — to **Netlify** (drag-and-drop deploy) or **GitHub Pages**, then open the URL on your phone.

You can preview the production build locally first with `npm run preview`.

### Step 5: Connect the App to Your Sheet

1. Open the app on your phone
2. Go through the onboarding wizard:
   - Enter your store name
   - Paste the **Web App URL** from Step 2
   - Paste the **API Token** from Step 2 (the one printed by `setApiToken()`)
3. Tap **"Connect & Finish"**
4. **Create your Manager account** — your name and a 6-8 digit PIN. This is the account that can add stores, add other team members, and see everything.
5. You're in — you'll land on the Dashboard.

> You can re-enter or change the token later in **Settings → Google Sheets → API Token**, then tap **Test Connection**.

---

## Roles & Multi-Store

The app has three account types, each with their own PIN and their own view — nobody sees more than their job needs:

| Role | Can do | Can't do |
|---|---|---|
| **Manager / Owner** | Everything — dashboard, checkout, add products, manage stock, view all sales across every store, add/deactivate team members, add stores, settings | — |
| **Stock Manager** | Scan/add products, set buying & selling price and stock quantity, view stock alerts — scoped to their assigned store(s) | Checkout, sales history, settings |
| **Cashier** | Check in to a store, scan/sell items, check out at end of shift | Adding or editing products, viewing inventory, settings |

**Adding your team:** as Manager, go to **☰ menu → Team**, enter their name, pick a role, assign which store(s) they can work at, and set a PIN (4+ digits for Cashier/Stock Manager, 6+ for Manager). They can then log in from the "Who's working?" screen with their name and PIN.

**Multiple stores:** as Manager, go to **☰ menu → Stores** to add each shop. Each store has its own product catalog and stock levels — the same barcode can exist independently in different stores with its own price and quantity. A cashier assigned to more than one store picks which one they're working at when they check in for the day; if they're only assigned to one, it's automatic.

**Accountability:** every sale is stamped with who made it, at which store, and during which shift — visible to the Manager in Sales History, filterable by store. Cashiers get a shift summary (sales count + total revenue) when they check out.

**A note on security:** PINs are hashed before being stored or synced, but with a 4-6 digit PIN this is a light deterrent, not real security. The Google Apps Script API is protected by a shared-secret token you set with `setApiToken()` — anyone with both your Web App URL and the token can read and write the sheet, so keep the token private and never share it. Treat in-app roles as operational access control for an honest team on trusted devices.

---

## How to Use

### 🏪 Stock Manager (Setting Up Products)

1. Tap **Scan Product** (bottom navigation 📷)
2. Tap **"Start Scanner"** — point camera at a product barcode
3. The product name will auto-populate (from Open Food Facts database)
4. Enter:
   - **Selling Price** in FCFA (required)
   - **Cost Price** (optional — for profit tracking)
   - **Stock Quantity** (how many you have)
   - **Low Stock Alert At** (e.g., 5 — you'll be notified when stock hits this number)
5. Tap **Save Product**

> **No barcode?** Tap "Enter Barcode Manually" to type it in. Products are added to whichever store you're currently working at.

### 🛒 Checkout (Making a Sale)

1. Log in and check in to your store (if you work more than one)
2. Tap **"Scan Next Item"**
3. Point camera at product barcode → item added to invoice
4. Adjust quantities with **+ / −** buttons
5. Repeat for all items — if a barcode isn't found, a **Quick Add** form lets you add it on the spot without losing your place
6. Tap **"Complete Sale →"**
7. Enter the amount the customer paid
8. Select payment method (Cash / Mobile Money / Bank Transfer)
9. Tap **"Confirm Payment"**
10. **Receipt appears** — share via WhatsApp, save as PDF, or print
11. At the end of your shift, tap your name in the header → **End Shift** to see your sales summary and log out

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
├── index.html              # Main app shell (all views), Vite entry point
├── vite.config.js          # Build config + service worker generation (vite-plugin-pwa)
├── package.json
├── public/                 # Copied as-is to the build output root
│   ├── manifest.json       # PWA manifest (install to home screen)
│   └── assets/
│       └── icon-192.svg    # App icon
├── css/
│   └── style.css           # Complete stylesheet (mobile-first)
├── js/                     # ES modules, bundled by Vite
│   ├── app.js              # Entry point — initialization, routing, onboarding
│   ├── db.js                # IndexedDB data access layer
│   ├── ui.js                # UI rendering, navigation, helpers
│   ├── scanner.js           # Barcode camera scanner + lookup
│   ├── sheets.js             # Google Sheets sync engine
│   └── receipt.js           # Receipt generation & sharing
├── gas/
│   └── Code.gs              # Google Apps Script (Sheet API)
├── launch.js                # `npm run host` — dev server + public tunnel
├── business-case.md         # Business case document
└── system-requirements-specification.md  # SRS document
```

`npm run build` outputs a `dist/` folder (not checked in) containing the production bundle — that's what you deploy.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JS (ES modules), no UI framework |
| **Build tool** | Vite |
| **Barcode Scan** | html5-qrcode library (bundled, no CDN dependency) |
| **Client Storage** | IndexedDB (offline) |
| **Backend DB** | Google Sheets + Google Apps Script |
| **Barcode Lookup** | Open Food Facts API |
| **PWA** | Service worker auto-generated by vite-plugin-pwa (Workbox), cache-busted on every build |
| **Hosting** | Any static host, deploy the `dist/` folder (Netlify, GitHub Pages, etc.) |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **Camera not opening** | Use Chrome or Samsung Internet. Grant camera permission when prompted. Also requires a secure origin — `https://` or `localhost`; plain `http://` (e.g. a raw LAN IP) blocks camera access. Use `npm run dev` (localhost) or `npm run host` (HTTPS tunnel). |
| **App still showing old behavior after an update** | Should no longer happen — every build gets a fresh service worker cache automatically. If you're testing a build from before this fix, uninstall/reinstall the PWA once to clear the stale cache. |
| **Google Sheets not syncing** | Go to Settings → tap "Test Connection". Make sure the **API Token** in Settings matches the one printed by `setApiToken()` in the Apps Script editor, and re-deploy the Apps Script if the URL changed. |
| **"Invalid token" or "TOKEN_NOT_CONFIGURED" message** | The API token is missing or wrong. Run `setApiToken()` in the Apps Script editor and paste the printed token into Settings → API Token. |
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
