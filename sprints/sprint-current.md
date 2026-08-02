# Sprint: Phase 3 — Feature Finishing — 2026-08-02

**Goal:** Close the remaining SRS feature gaps: invoice unit-price/subtotal,
last-receipt quick view + past-receipt share/print, Help/FAQ page, offline
banner + low-stock notifications, and manager stock-zero override.

## Committed items
| ID | Item | Owner(s) | Status |
|---|---|---|---|
| BL-106 | Invoice unit price + Subtotal row (POS-04) | frontend-engineer | Ready for customer review |
| BL-109 | Last receipt + re-share/re-print past receipts (POS-15/REC-06) | frontend-engineer | Ready for customer review |
| BL-110 | Help/FAQ page (SET-04) | frontend-engineer | Ready for customer review |
| BL-111 | Offline banner (OFF-06) + Notifications (ALR-05) | frontend-engineer | Ready for customer review |
| BL-112 | Manager stock-zero override (POS-13) | frontend-engineer | Ready for customer review |

Status values: `Not started` → `In progress` → `In QA` → `In security
review` (if applicable) → `In docs` → `Ready for customer review` →
`Done`.

## Review packets

### BL-106 — Invoice unit price + subtotal row
- **What changed:** Each invoice line item now shows the unit price
  (`@ <price>`); the invoice footer has a Subtotal row above the Total.
- **Why:** POS-04 requires unit price visibility and a subtotal line.
- **How it was tested:** QA PASS — subtotal element always present, equals
  Total (no tax yet); stale figures cleared on empty checkout (fixed in
  review round).
- **Security review:** no user-data sinks; unit price rendered via
  `formatCurrency` (numeric), name via `escapeHtml`.
- **Docs updated:** CHANGELOG (BL-106), README (Checkout bullet).
- **Risks/tradeoffs:** Subtotal == Total until tax is ever added; label
  reads "Total" (not "Grand Total") to match the rest of the UI.
- **Needs customer decision on:** none.

### BL-109 — Last receipt + past receipt share/print
- **What changed:** "🧾 Last Receipt" buttons on the checkout screen reopen
  the most recent completed sale's receipt. Sale Details modal gained
  **Download / Share / Print** for any past receipt. Closing a reopened
  receipt no longer wipes an in-progress basket.
- **Why:** POS-15 (last-receipt quick view) and REC-06 (re-share/re-print
  past receipts) were missing.
- **How it was tested:** QA PASS after fixes — share/print refactor keeps
  one implementation (`shareReceiptText`/`printReceiptText` in receipt.js);
  download unchanged; basket preserved when viewing a past receipt while
  the live-sale close still resets checkout.
- **Security review:** must-fix closed — `showLastReceipt` now filters
  cashiers to their OWN sales (privacy leak fixed); `showSaleDetail`/
  `getSaleDetailTransaction` gate cashiers to own `cashierId` at the data
  boundary (Share/Print/Download can't be driven against other cashiers'
  sales via console). Share-failure toast corrected (user cancel silent).
- **Docs updated:** CHANGELOG (BL-109), README (Receipts bullet).
- **Risks/tradeoffs:** transaction IDs remain guessable, but the ownership
  gate now enforces at fetch time; shared-device cashiers only ever see
  their own receipts.
- **Needs customer decision on:** none.

### BL-110 — Help/FAQ page
- **What changed:** New "❓ Help & FAQ" nav item (visible to all roles)
  with static cards: Setup, Roles, Scanning & checkout, Stock, Sync &
  offline, Troubleshooting.
- **Why:** SET-04 required an in-app help resource.
- **How it was tested:** QA PASS — page registered in nav config for all
  roles, navigate() case added, no ID collisions, no data binding.
- **Security review:** static content, no user-data sinks; external links
  now carry `rel="noopener noreferrer"`.
- **Docs updated:** CHANGELOG (BL-110), README (new Help bullet).
- **Risks/tradeoffs:** content is static — needs periodic review as
  features change.
- **Needs customer decision on:** none.

### BL-111 — Offline banner + notifications
- **What changed:** Sidebar shows "📡 Offline — changes will sync later"
  when the device drops offline (clears on reconnect, correct initial
  state on boot). Settings gains "🔔 Enable Stock Alerts": on opt-in, ONE
  summary browser notification per batch when products are out of stock
  or low — only while the app is visible, max once per 5 minutes, never
  auto-requested. Also fixed a pre-existing index.html bug (duplicate
  `class` attribute) that made the old offline indicator permanently
  visible.
- **Why:** OFF-06 (offline banner was dead markup) and ALR-05 (notifications
  absent).
- **How it was tested:** QA PASS — banner toggles on online/offline/boot;
  notification guards (permission, visible tab, logged-in, debounce)
  verified; no double-fire at boot; TOCTOU double-fire race fixed in
  review round (in-flight guard).
- **Security review:** notification body is counts-only (no product
  names); permission only on user gesture; per-origin permission is
  shared across users on one device (counts-only, no disclosure).
- **Docs updated:** CHANGELOG (BL-111), README (alerts/offline bullets).
- **Risks/tradeoffs:** notifications are per-device/browser, not per-user;
  counts-only summaries.
- **Needs customer decision on:** none.

### BL-112 — Manager stock-zero override
- **What changed:** Settings toggle "Allow selling out-of-stock items
  (manager only)". When on, managers can add a zero-stock item to a sale
  with an explicit warning; cashiers and stock managers remain blocked.
- **Why:** POS-13 specified a configurable manager override instead of the
  hard-coded block.
- **How it was tested:** QA PASS — single gate in
  `addScannedItemToCheckout` (all scan/type/search paths funnel through
  it); `isOutOfStockAllowed()` fails closed (setting AND manager role);
  checkbox state restored in Settings; quick-add path cannot bypass
  (only stock managers reach quick-add, and they have no checkout page).
- **Security review:** no bypass found; setting is stored locally
  (per-device), not synced to the sheet.
- **Docs updated:** CHANGELOG (BL-112), README (Checkout bullet).
- **Risks/tradeoffs:** setting is per-device (doesn't follow the manager
  across machines); global, not per-store.
- **Needs customer decision on:** whether the override should sync across
  devices/stores (currently local-only) — noted as future option.

## Blockers
- [ ] none — all five items ready for customer review

## Sprint close-out
When every committed item is Done or explicitly deferred, move a summary
to `CHANGELOG.md`, log lessons in `retros.md`, and start a fresh
`sprint-current.md` for the next sprint (Phase 4: BL-201/202/203/205/206/207).
