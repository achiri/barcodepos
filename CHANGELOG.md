# Changelog

All notable changes to this project are documented here. Format follows
Keep a Changelog conventions; versioning follows Semantic Versioning
(MAJOR.MINOR.PATCH).

## [Unreleased]
### Added
- BL-101: GAS API authentication — shared-secret token (`BARCODEPOS_TOKEN`) required on every GET/POST; `setApiToken()` / `setApiTokenTo()` helper functions; API Token input in onboarding and Settings.
- BL-103: Real CORS sync — GAS responses served as `text/plain` so the client can read them cross-origin; sync failures now surface the actual server message (e.g. INVALID_TOKEN / TOKEN_NOT_CONFIGURED).
- BL-104: Product archive/restore — managers can archive a product (soft delete) from the edit-product modal or a product card; archived products are hidden from product lists, dashboard counts and alerts, cannot be scanned or typed into checkout, and can be shown and restored via a "Show archived" toggle on the Products page.
- BL-105: Voided sale records — cancelling a sale with items now records a transaction with status `'voided'` (paymentMethod `'cancelled'`), visible in Sales History under a Completed/Voided filter with a VOIDED badge and synced to the GAS Sales sheet.
- BL-107: Dashboard completeness — new Out of Stock (0 qty) and This Month stat cards, a Top Selling Products card (top 5 by revenue), and Recent Transactions showing the last 10 sales of all time.
- BL-108: CSV export — Export CSV button in Sales History exports exactly the currently filtered view (period/store/status/cashier) as an Excel-friendly CSV with UTF-8 BOM, quoted+escaped fields, and formula-injection protection (`=`, `+`, `-`, `@` prefixed with an apostrophe).

### Changed
- BL-103: `sendToSheet` sends `text/plain` bodies (no CORS preflight) and parses the real GAS response; failed sync items stay `pending` with exponential backoff retry (1s→60s) and a `lastError` field.
- BL-107: Low-stock counts now exclude out-of-stock products, which have their own dedicated stat card.

### Fixed
- BL-103: Sync items were silently dropped after one failure (`status:'failed'` was invisible to the retry queue) — now they retry with backoff.
- BL-103: The "sync OK" indicator no longer reports success when GAS rejects a request.
- BL-104: Archived products can no longer be scanned or typed into checkout (blocked with an explicit warning).
- BL-104: Archive/restore actions are gated to the Manager role only.
- BL-105: The void flow is crash-safe — a double-click can no longer create a duplicate voided record, and unhandled promise rejections on void are caught.
- BL-107: Top-selling aggregation now uses a `Map`, eliminating prototype-pollution risks in the previous object-keyed aggregation.
