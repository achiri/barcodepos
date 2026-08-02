# BarcodePOS

BarcodePOS is a Progressive Web App (PWA) that turns any smartphone into a
barcode-scanning point of sale for micro-retailers in Cameroon and across
Africa. It combines point-of-sale checkout, inventory management, receipts,
and multi-store stock control in a single app — with Google Sheets as a
zero-cost, user-owned database backend. All amounts are in FCFA (XAF) by
default.

The app is fully client-side and offline-first: data is stored in the
browser's IndexedDB and synced to your own Google Sheet through a small
Google Apps Script web API (`gas/Code.gs`). There is no server backend, no
per-user fees, and no data leaves your control — every store connects to its
own spreadsheet.

## Key features

- **Barcode scanning** — camera-based scanning (html5-qrcode) plus manual
  barcode entry and product search.
- **Checkout (POS)** — scan-to-sell, live invoice with quantity adjustment,
  cash / mobile money / bank transfer payments, and automatic change
  calculation.
- **Receipts** — printable, shareable (e.g. WhatsApp), and downloadable
  receipts after every sale.
- **Sales history** — filterable history (with a Completed/Voided filter for
  cancelled sales) and per-sale detail, including re-downloading a receipt and
  exporting the current view to CSV.
- **Voided sales** — cancelling a sale with items records it as voided with a
  VOIDED badge in Sales History; voided sales never affect stock, dashboard
  totals, shift summaries, or top-product lists.
- **Inventory** — product catalog with categories, cost/selling price, units,
  and stock levels; managers can archive a product to hide it from lists and
  checkout, then restore it later.
- **Stock alerts** — out-of-stock and low-stock warnings surfaced on the
  dashboard.
- **Dashboard** — today/week/month sales totals, product counts, low-stock and
  out-of-stock counts, top selling products, and the last 10 transactions.
- **Multi-store** — supports a central Warehouse plus multiple shops, with
  global stock visibility filtered by location.
- **Offline checkout** — sales made offline are queued and synced when the
  connection returns.
- **PWA** — installable to the home screen and usable with no internet after
  the first load (service worker offline app shell).

### Roles (PIN-based login)

Login uses a 4–8 digit PIN that is SHA-256 hashed before it is stored. Three
roles are available:

- **Manager** — full control: products, users, stores, sales, stock, and
  settings.
- **Cashier** — checkout / scan-to-sell only; cannot add or edit products, and
  only sees their own sales.
- **Stock Manager** — checks into the central Warehouse (factory icon) and/or
  shops; receives stock from suppliers, transfers stock between warehouse and
  shops, and views global stock across all locations.

## Getting started

**Prerequisites:** a Google account (to copy the sheet template and deploy the
Apps Script backend). That is all — no server, database, or hosting account
needed.

Follow **[SETUP.md](SETUP.md)** for the full walkthrough:

1. Copy the Google Sheet template to your own Drive.
2. Deploy the Apps Script web app (paste `gas/Code.gs`, deploy as a Web App,
   run `createTemplateSheets` once).
3. Copy the Web App URL (`https://script.google.com/macros/s/.../exec`).
4. Launch the app and complete the built-in onboarding: name your store,
   paste the Web App URL, and create your Manager account.

## Development

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd barcodepos
npm install
npm run dev        # start the Vite dev server
```

### Project layout

```
index.html                 App shell (onboarding, login, all screens)
css/style.css              Styling
js/app.js                  Boot / wiring
js/auth.js                 Roles, PIN hashing, sessions, check-in
js/db.js                   IndexedDB data layer (offline-first)
js/ui.js                   Screens and rendering
js/scanner.js              Camera barcode scanning
js/sheets.js               Google Sheets sync engine
js/receipt.js              Receipt generation
gas/Code.gs                Google Apps Script web API backend
public/                    PWA icons and manifest
vite.config.js             Vite + PWA (service worker) configuration
docs/                      SRS, ADRs, definition of done
sprints/                   Backlog, active sprint, retros
SETUP.md                   Step-by-step setup guide
```

### Build commands

```bash
npm run build            # production build (vite)
npm run build:gh-pages   # build with base path /barcodepos/ for GitHub Pages
npm run preview          # preview the production build locally
npm run host             # expose the dev server via localtunnel for phone testing
```

## Deployment

BarcodePOS is a static site and deploys to GitHub Pages (or any static host).

1. Build with the GitHub Pages base path:

   ```bash
   npm run build:gh-pages   # outputs to dist/
   ```

2. Publish the `dist/` folder to the `gh-pages` branch. A reliable approach
   is a temp-dir push that leaves the working tree untouched:

   ```bash
   # from repo root
   git subtree push --prefix dist origin gh-pages
   ```

   If `git subtree` is unavailable, use the equivalent temp-dir flow:

   ```bash
   rm -rf /tmp/gh-pages && mkdir -p /tmp/gh-pages
   git worktree add /tmp/gh-pages gh-pages
   # copy the contents of dist/ into /tmp/gh-pages (after removing its files)
   cd /tmp/gh-pages && git add -A && git commit -m "Deploy"
   git push origin gh-pages
   cd <repo-root> && git worktree remove /tmp/gh-pages
   ```

3. The live site is served at
   **https://achiri.github.io/barcodepos/**.

Note: the deployed app must call the deployed Apps Script Web App URL, not a
localhost dev server.

## Tech stack

| Layer | Technology |
|---|---|
| App | Plain ES modules (no framework) |
| Build | Vite 8 + vite-plugin-pwa (service worker, offline app shell) |
| Scanning | html5-qrcode (camera barcode scanning) |
| Storage | Browser IndexedDB (offline-first local data) |
| Backend | Google Apps Script web API (`gas/Code.gs`) |
| Database | User-owned Google Sheet (tabs: Products, WarehouseStock, ShopStock, GoodsReceived, StockMovements, Sales, Settings, Categories, Users, Stores, Sessions) |
| Hosting | Static site on GitHub Pages |

## Docs

- **[SETUP.md](SETUP.md)** — full setup guide (sheet template, Apps Script deployment, app onboarding).
- **[system-requirements-specification.md](system-requirements-specification.md)** — the SRS.
- **[business-case.md](business-case.md)** — the business case for BarcodePOS.
- **[docs/DEFINITION_OF_DONE.md](docs/DEFINITION_OF_DONE.md)** — the acceptance bar used for all work.
- **[docs/adr/](docs/adr/)** — architecture decision records.
- **[sprints/](sprints/)** — backlog, active sprint, and retros.

## How this repo is managed

Development follows a lightweight, file-based "AI Dev Team" process: customer
requests are turned into backlog items in `sprints/backlog.md`, scheduled in
`sprints/sprint-current.md`, and implemented by role-specific subagents
defined under `.claude/agents/` per the operating model in
[`CLAUDE.md`](CLAUDE.md). See those files for how work is tracked, reviewed,
and verified.

## License

© 2026 — internal project. Not licensed for public distribution; no license
has been granted for reuse by third parties.
