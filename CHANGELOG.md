# Changelog

All notable changes to this project are documented here. Format follows
Keep a Changelog conventions; versioning follows Semantic Versioning
(MAJOR.MINOR.PATCH).

## [Unreleased]
### Added
- BL-101: GAS API authentication — shared-secret token (`BARCODEPOS_TOKEN`) required on every GET/POST; `setApiToken()` / `setApiTokenTo()` helper functions; API Token input in onboarding and Settings.
- BL-103: Real CORS sync — GAS responses served as `text/plain` so the client can read them cross-origin; sync failures now surface the actual server message (e.g. INVALID_TOKEN / TOKEN_NOT_CONFIGURED).

### Changed
- BL-103: `sendToSheet` sends `text/plain` bodies (no CORS preflight) and parses the real GAS response; failed sync items stay `pending` with exponential backoff retry (1s→60s) and a `lastError` field.

### Fixed
- BL-103: Sync items were silently dropped after one failure (`status:'failed'` was invisible to the retry queue) — now they retry with backoff.
- BL-103: The "sync OK" indicator no longer reports success when GAS rejects a request.
