# Backlog

All known work, prioritized, not yet scheduled into a sprint. Add new
customer requests here as soon as they come in, even before they're fully
groomed.

Priority key: **Must** (blocking) / **Should** (important) / **Could** (nice
to have)

Audit basis: SRS `system-requirements-specification.md` (v1.0, Draft) +
`docs/DEFINITION_OF_DONE.md` + code audit, 2026-08-02.

---

## Standards Alignment epic (audit findings)

### BL-101 — GAS endpoint authentication (NFR-SEC-05) — CRITICAL
**Priority:** Must
**Status:** Backlog
**Requested by:** Standards audit, 2026-08-02

**Problem:** `gas/Code.gs` `doPost`/`doGet` validate **no requests**. Anyone
with the deployed web-app URL can read all data (incl. `pinHash` of every
user) and write arbitrary rows. Client `js/sheets.js` sends no auth header.
Directly violates SRS NFR-SEC-05 and the DoD security bar.

**Acceptance criteria:**
- A shared secret token is configured (stored client-side in IndexedDB
  settings, never committed to git).
- Every GAS request carries the token; `doGet`/`doPost` reject requests
  without a valid token (HTTP 401 / JSON error).
- The app shows a clear setup error when the token is wrong/missing.
- Existing manual deployment instructions updated (SETUP.md).

**Dependencies:** none
**Notes:** Requires `security-engineer` review. Also surfaces real sync
errors (see BL-103).

---

### BL-102 — Fix XSS via unescaped barcodes in inline onclick — CRITICAL
**Priority:** Must
**Status:** Backlog
**Requested by:** Standards audit, 2026-08-02

**Problem:** User/attacker-controlled barcodes and storeIds are interpolated
into inline `onclick="…('${barcode}')"` attributes without escaping:
`js/scanner.js:234,259`, `js/ui.js:218,448`, `js/app.js:193,268`,
`js/ui.js:1142-1143,1306,1988`. The scanner accepts QR/Code-128/39/93, so a
printed code can carry `');alert(1)//`. No barcode format validation exists.

**Acceptance criteria:**
- No product- or user-derived string is ever interpolated into an inline
  handler unescaped. All dynamic identifiers pass through a safe escape
  (or handlers switch to event delegation / data-* attributes).
- Barcodes are sanitized/validated at ingest (scanner + manual entry).
- Spot-audit: grep shows zero `onclick="...${` injections.

**Dependencies:** none

---

### BL-103 — Replace `mode:'no-cors'` sheet writes with CORS so sync errors surface
**Priority:** Must
**Status:** Backlog
**Requested by:** Standards audit, 2026-08-02

**Problem:** `js/sheets.js:89` sends all GAS writes with `mode:'no-cors'` so
the client can never read the response — "sync OK" is assumed even when the
write failed. Quota/validation errors (GAS-06) are invisible, and the
`sync-ok` indicator is optimistic.

**Acceptance criteria:**
- GAS web app returns JSON with CORS headers (`ContentService` +
  `text/plain` workaround) and the client reads responses.
- Failed writes show the real error and re-enter the retry queue with
  exponential backoff (1s, 2s, 4s, 8s… max 60s).
- Sync status indicator reflects true success/failure.

---

### BL-104 — Product archive/delete UI (INV-08)
**Priority:** Should
**Status:** Backlog
**Requested by:** Audit — SRS INV-08 partial

**Problem:** `db.js:deleteProduct` (soft-delete `isArchived=true`) exists and
the sheet + lists honor the flag, but **no UI calls it** — users can't
archive a product.

**Acceptance criteria:**
- "Archive" button on product cards / edit modal with confirmation.
- Archived products disappear from lists/dashboard; no data loss.
- Un-archive option for manager in a filterable view (or documented as
  sheet-only).

---

### BL-105 — Record voided sales (POS-14)
**Priority:** Should
**Status:** Backlog
**Requested by:** Audit — SRS POS-14 partial

**Problem:** `voidCheckout()` clears the basket but never persists a
`status:'voided'` transaction, though `db.js` filters on that status.

**Acceptance criteria:**
- Voiding a sale persists a transaction with `status:'voided'` (items,
  totals, cashier, timestamp) instead of silently discarding.
- Voided sales appear in Sales History marked "Voided", excluded from
  revenue totals and dashboard sums.
- Confirmation dialog retained.

---

### BL-106 — Checkout invoice UI: unit price + subtotal row (POS-04)
**Priority:** Should
**Status:** Backlog
**Requested by:** Audit — SRS POS-04 partial

**Problem:** Invoice line items show name/qty/line total but **not unit
price**, and there is no subtotal row (SRS 7.2 footer: subtotal + total).

**Acceptance criteria:**
- Each line item shows unit price.
- Invoice footer shows Subtotal (before any future tax) and Grand Total.

---

### BL-107 — Dashboard completeness (DASH-02/03/04/05)
**Priority:** Should
**Status:** Backlog
**Requested by:** Audit — SRS DASH partials

**Problem:** Dashboard lacks: month total (DASH-02), separate out-of-stock
vs low-stock counts (DASH-03), top-5 selling products (DASH-04), and shows
only today's last 5 sales instead of last 10 overall (DASH-05).

**Acceptance criteria:**
- Dashboard cards: Today / This Week / This Month totals.
- Out-of-stock and Low-stock shown as separate counts.
- "Top Selling" list (top 5 by revenue or quantity, label which).
- Recent transactions = last 10 sales across all time.

---

### BL-108 — CSV export of sales (DASH-07)
**Priority:** Should
**Status:** Backlog
**Requested by:** Audit — SRS DASH-07 not implemented

**Problem:** No CSV export; Settings "Export Data" only produces a JSON
backup.

**Acceptance criteria:**
- "Export Sales CSV" button on Sales History page downloads current filter
  result as UTF-8 CSV (with BOM for Excel) with headers, openable in Excel/
  Google Sheets.

---

### BL-109 — Last-receipt quick view (POS-15) + re-share/re-print past receipts (REC-06)
**Priority:** Could
**Status:** Backlog
**Requested by:** Audit — SRS POS-15/REC-06

**Problem:** No "last receipt" button on checkout; past receipts can be
downloaded as .txt but not re-shared or re-printed (share/print only work
for `window._lastReceipt`).

**Acceptance criteria:**
- "Last Receipt" action on checkout re-opens the most recent receipt modal.
- Sales History detail modal gains Share and Print buttons alongside
  Download.

---

### BL-110 — Help/FAQ page (SET-04)
**Priority:** Could
**Status:** Backlog
**Requested by:** Audit — SRS SET-04 not implemented

**Problem:** No help/FAQ page; only an About card in Settings.

**Acceptance criteria:**
- Help page reachable from nav/settings covering: setup, roles, scanning,
  sync/offline, troubleshooting common issues.

---

### BL-111 — Offline indicator (OFF-06) + Notification API (ALR-05)
**Priority:** Could
**Status:** Backlog
**Requested by:** Audit — SRS OFF-06 partial / ALR-05 not implemented

**Problem:** `#offline-indicator` is dead markup (never toggled); browser
Notification API unused.

**Acceptance criteria:**
- Header shows a clear "Offline — changes will sync later" banner when
  offline; clears on reconnect.
- Optional: request permission and send a browser notification for
  low-stock/out-of-stock when the page is open (ALR-05).

---

### BL-112 — Configurable stock-zero override for manager (POS-13)
**Priority:** Could
**Status:** Backlog
**Requested by:** Audit — SRS POS-13 partial

**Problem:** Stock-zero add block is hard-coded in `addScannedItemToCheckout`;
the SRS-specified configurable manager override setting doesn't exist.

**Acceptance criteria:**
- Settings toggle "Allow selling out-of-stock items (manager)".
- When on, managers (not cashiers) may add out-of-stock items with a
  warning; cashiers remain blocked.

---

## Engineering standards epic

### BL-201 — Add ESLint + Prettier, fix all warnings
**Priority:** Must
**Status:** Backlog
**Requested by:** DoD / CLAUDE.md global standards

**Problem:** No lint/format tooling; ~2,900 lines JS + 911 lines GAS
unenforced.

**Acceptance criteria:** `npm run lint` passes with zero warnings; `npm run
format` available; config committed.

---

### BL-202 — Automated tests (unit + integration for critical paths)
**Priority:** Must
**Status:** Backlog
**Requested by:** DoD

**Problem:** Zero tests. Critical logic (db.js stock reconciliation,
auth.js PIN/sessions, sheets.js sync queue, finalizeSale math) untested.

**Acceptance criteria:**
- Vitest unit tests for db.js, auth.js, receipt.js, checkout math.
- Integration tests for the sync queue → GAS payload contract.
- `npm test` green in CI.

---

### BL-203 — CI/CD pipeline (lint → test → build → deploy)
**Priority:** Should
**Status:** Backlog
**Requested by:** CLAUDE.md global standards

**Problem:** No pipeline; deploys are manual temp-dir pushes to gh-pages.

**Acceptance criteria:**
- GitHub Actions workflow: lint → test → build → deploy to gh-pages on
  push to main. Status badge in README.

---

### BL-204 — Rewrite README for BarcodePOS
**Priority:** Must
**Status:** Backlog
**Requested by:** Audit

**Problem:** README is still the generic "AI Dev Team Starter Kit" template
— describes nothing about this app.

**Acceptance criteria:** README covers: what the app does, features per
role, quick start, setup, deployment, tech stack, project layout,
development commands.

---

### BL-205 — Backfill CHANGELOG + sprints + ADRs
**Priority:** Should
**Status:** Backlog
**Requested by:** Audit

**Problem:** CHANGELOG empty; backlog/sprint/retro all templates; zero ADRs
despite major decisions (Sheets backend, GAS "Anyone" access, IndexedDB
offline-first, SHA-256 PINs, warehouse/shop normalized stock).

**Acceptance criteria:**
- CHANGELOG with real `[Unreleased]` + 1.0.0 entries.
- Backlog populated (this file); a real sprint planned in
  `sprints/sprint-current.md`; retro entry after first sprint.
- ADRs: 0001 Sheets-as-backend, 0002 GAS web API + auth decision,
  0003 IndexedDB offline-first, 0004 PIN hashing, 0005 warehouse/shop
  stock schema.

---

### BL-206 — Accessibility pass (WCAG 2.2 AA basics)
**Priority:** Should
**Status:** Backlog
**Requested by:** DoD / SRS NFR-USE-02/03/04

**Problem:** Pinch-zoom disabled (`user-scalable=no`); touch targets
32–44px vs 48px required; `<label for>` never used; icon-only buttons lack
accessible names; gray text ~2.7–3.7:1 fails AA.

**Acceptance criteria:**
- Zoom re-enabled (viewport `user-scalable=yes`).
- Interactive targets ≥ 48×48px (buttons, qty steppers, close buttons,
  scanner tabs).
- All inputs have programmatically-associated labels; icon-only buttons
  have aria-labels.
- Text contrast ≥ 4.5:1 for normal text (darken gray palette).

---

### BL-207 — SRS refresh (remove stale contradictions)
**Priority:** Could
**Status:** Backlog
**Requested by:** Audit

**Problem:** SRS §8.2.3/8.1 states "no user login/role system" and
"single-user per device" — contradicts the implemented multi-role system.

**Acceptance criteria:** SRS updated to describe roles, PIN login, multi-store,
warehouse; status moved out of "Draft".
