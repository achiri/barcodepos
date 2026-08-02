# Sprint: Phase 2 — Feature Completeness — 2026-08-02

**Goal:** Close the SRS functional gaps in the app UI: product archive,
voided-sale records, dashboard completeness, and CSV sales export.

## Committed items
| ID | Item | Owner(s) | Status |
|---|---|---|---|
| BL-104 | Product archive/delete UI (INV-08) | frontend-engineer | Ready for customer review |
| BL-105 | Record voided sales (POS-14) | backend-engineer, frontend-engineer | Ready for customer review |
| BL-107 | Dashboard completeness (DASH-02/03/04/05) | frontend-engineer | Ready for customer review |
| BL-108 | CSV export of sales (DASH-07) | frontend-engineer | Ready for customer review |

Status values: `Not started` → `In progress` → `In QA` → `In security
review` (if applicable) → `In docs` → `Ready for customer review` →
`Done`.

## Review packets

### BL-104 — Product archive/delete UI
- **What changed:** Managers can archive a product (soft delete) from the
  edit-product modal ("🗄 Archive Product") or from a product card (🗄
  button). Archived products are hidden from product lists, dashboard
  counts, alerts, and cannot be scanned or typed into checkout. A
  manager-only "Show archived" checkbox on the Products page lists
  archived items with a "↩️ Restore" button. Archive/restore sync to the
  sheet via `updateProduct`.
- **Why:** INV-08 requires products be removable without breaking
  historical sales data; soft delete preserves the ledger and sheet.
- **How it was tested:** QA review PASS after fix round — verified arg
  order at both call sites, restore fallback from warehouse view, and
  list hiding; `node --check` + `npm run build` clean.
- **Security review:** PASS with fixes — archive/restore now gated to
  `ROLES.MANAGER` (card button, modal button, and function-level guard);
  archived products blocked from scan checkout (scanner.js). Prior XSS
  class re-verified closed (escapeHtml/escJs on all new sinks).
- **Docs updated:** README (Inventory features), CHANGELOG (BL-104).
- **Risks/tradeoffs:** Archived rows are still counted in some historical
  aggregation paths that read raw transactions; catalog edits stay
  client-side only (no server-side role enforcement — GAS gates only on
  the shared token). Restore is manager-only, matching the toggle.
- **Needs customer decision on:** none.

### BL-105 — Record voided sales
- **What changed:** Cancelling a sale with items in the basket now records
  a transaction with `status: 'voided'` / `paymentMethod: 'cancelled'`
  instead of silently discarding it. Sales History gains a
  Completed/Voided filter with a "🚫 VOIDED" badge. Voided sales never
  touch stock and are excluded from dashboard totals, shift summaries,
  and top-products aggregation. They sync to the GAS Sales sheet where a
  `status` column marks them 'voided'.
- **Why:** POS-14 requires cancelled sales to leave an audit trail.
- **How it was tested:** QA review PASS — transaction shape mirrors
  `finalizeSale`, sync payload matches GAS `SALE_HEADERS`, status filter
  logic verified (voided path restricts to `status==='voided'`, completed
  path excludes voided), no stock deltas, shift summaries exclude voided.
- **Security review:** PASS — no new secrets; `enqueueSync` errors carry
  no payloads; void flow made crash-safe (no duplicate voids, store lookup
  moved inside try). LOW finding: voided rows carry non-zero totals into
  the Sales sheet — app-side sums correctly exclude them, but sheet
  consumers must filter `status <> 'voided'` (documented in CHANGELOG).
- **Docs updated:** README (Sales history / Voided sales), CHANGELOG
  (BL-105).
- **Risks/tradeoffs:** If a customer pays and the sale is later voided,
  the record keeps its original totals (good for audit) but a plain
  `SUM` over the Sales sheet would include it — consumers must filter by
  status. Voided records are readable by anyone with the shared GAS
  token.
- **Needs customer decision on:** none (sheet consumers should filter by
  status).

### BL-107 — Dashboard completeness
- **What changed:** New stat cards: "Out of Stock" (qty = 0) and "This
  Month" total; low-stock now excludes out-of-stock items (no double
  count). "Recent Transactions" shows the last 10 sales of all time
  (was: today's first 5). New "⭐ Top Selling Products" card (top 5 by
  revenue, aggregated from completed sales).
- **Why:** DASH-02 (month total), DASH-03 (separate out-of-stock vs
  low-stock), DASH-04 (top products), DASH-05 (last 10 sales) were
  missing or partial.
- **How it was tested:** QA review PASS — out/low split non-overlapping,
  recent slice is newest-10 desc, top-5 by revenue with safe fallback
  arithmetic, voided excluded from all sums.
- **Security review:** PASS with fixes — aggregation switched from a
  plain object to a `Map` (prototype pollution via `__proto__`/
  `constructor` barcode/name keys closed).
- **Docs updated:** README (Dashboard), CHANGELOG (BL-107).
- **Risks/tradeoffs:** Dashboard re-reads all transactions per render
  (4 period scans); fine at current scale, flagged for optimization in a
  future sprint (BL-201/BL-202 groundwork).
- **Needs customer decision on:** none.

### BL-108 — CSV export of sales
- **What changed:** "⬇️ Export CSV" button in Sales History exports
  exactly the currently filtered view (period/store/status/cashier) as
  `barcodepos-sales-YYYY-MM-DD.csv` — UTF-8 BOM for Excel, all fields
  double-quoted with internal quotes doubled, CRLF rows, itemCount sums
  quantities, items joined as `name x{qty}`. Filter logic shared between
  the list and the export so they can't drift.
- **Why:** DASH-07 (CSV export) was missing.
- **How it was tested:** QA review PASS — filtering parity between
  rendered list and CSV verified; BOM/quoting/escaping/headers checked;
  empty-export toast path tested by inspection.
- **Security review:** PASS with fixes — formula injection (leading
  `= + - @` cells executing in Excel/Sheets) neutralized by prefixing an
  apostrophe; field content is text-context safe; no token exposure.
- **Docs updated:** README (Sales history), CHANGELOG (BL-108).
- **Risks/tradeoffs:** Dates/times use locale-dependent formatting;
  numeric decimals are `.` (may reinterpret per-locale in Excel) — noted,
  acceptable. Exports are scoped to what the current user can see
  (cashiers export only their own sales).
- **Needs customer decision on:** none.

## Blockers
- [ ] none — all four items ready for customer review

## Sprint close-out
When every committed item is Done or explicitly deferred, move a summary
to `CHANGELOG.md`, log lessons in `retros.md`, and start a fresh
`sprint-current.md` for the next sprint.
