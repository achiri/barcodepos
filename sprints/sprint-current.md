# Sprint: Phase 1 — Critical Security & Docs — 2026-08-02

**Goal:** Close the three critical security gaps (unauthenticated GAS endpoint,
XSS via unescaped barcodes, invisible sync failures) and replace the template
README with real project documentation.

## Committed items
| ID | Item | Owner(s) | Status |
|---|---|---|---|
| BL-101 | GAS endpoint authentication (shared secret token) | backend-engineer, security-engineer | Ready for customer review |
| BL-102 | Fix XSS via unescaped barcodes in inline onclick | frontend-engineer, security-engineer | Ready for customer review |
| BL-103 | Replace no-cors sheet writes with CORS + backoff | backend-engineer, devops-engineer | Ready for customer review |
| BL-204 | Rewrite README for BarcodePOS | tech-writer | Ready for customer review |

Status values: `Not started` → `In progress` → `In QA` → `In security
review` (if applicable) → `In docs` → `Ready for customer review` →
`Done`.

## Review packets
Once an item reaches "Ready for customer review", write its packet here
before presenting to the customer.

### BL-101 — GAS endpoint authentication
- **What changed:** `gas/Code.gs` — `doGet`/`doPost` now require a shared-secret token (`BARCODEPOS_TOKEN` in Script Properties) via `requireToken_()`; helpers `setApiToken()` / `setApiTokenTo(token)` added. App: `js/sheets.js` sends the token on every POST body and GET query; `js/app.js` onboarding and `js/ui.js` Settings gained an API Token input; `connectGoogleSheet`/`testSheetConnection` ping with the token and surface UNAUTHORIZED/TOKEN_NOT_CONFIGURED errors instead of advancing.
- **Why:** Anyone with the GAS URL could previously read all data (incl. user PIN hashes) and write arbitrary rows (NFR-SEC-05). Token is unbrute-forceable (96-bit random).
- **How it was tested:** `vite build` green; grep confirms no token-less GAS call path remains; security review PASS.
- **Security review:** PASS (security-engineer).
- **Docs updated:** SETUP.md (deploy steps 11–12, troubleshooting), README getting-started, index.html onboarding instructions.
- **Risks/tradeoffs:** **User must redeploy `gas/Code.gs` and run `setApiToken()` once**, then paste the token into Settings — until then the API refuses all requests (app keeps working offline on local IndexedDB data). Token is stored plaintext in IndexedDB (accepted; local device threat model).
- **Needs customer decision on:** none — action required (redeploy + token), see notes.

### BL-102 — XSS via unescaped barcodes
- **What changed:** New `escJs()` helper (escapes for single-quoted JS string inside HTML attributes) + `sanitizeBarcode()` (strips control chars, caps 128). All ~15 user-controlled interpolations into inline `onclick` handlers wrapped in `escJs()`; barcode/product-name/storeId/userId text contexts escaped; 6 sheet-sourced `value="..."` attributes escaped.
- **Why:** A malicious QR/Code-128 barcode or crafted product name could execute JavaScript on a cashier/manager device (OWASP A03).
- **How it was tested:** Grep audit of every `onclick` template in `js/`; security review PASS after closing all flagged sinks.
- **Security review:** PASS (security-engineer) — initial FAIL on `openGlobalTransfer` productName closed.
- **Docs updated:** none needed (behavior unchanged).
- **Risks/tradeoffs:** none significant.
- **Needs customer decision on:** none.

### BL-103 — CORS + sync backoff
- **What changed:** `js/sheets.js` — POSTs now `text/plain` (no CORS preflight) and parse the real GAS response; failures throw with the server message; token-config toast once per cycle. `js/db.js` — failed sync items stay `pending` with `nextAttemptAt` exponential backoff (1s→60s) + `lastError`; they are no longer dropped. `gas/Code.gs` — all responses via `jsonResponse()` (MimeType.TEXT) so browsers can read them.
- **Why:** `no-cors` writes were invisible — "sync OK" was assumed; failed items were silently discarded (data loss). Now sync status reflects true success/failure and transient failures retry.
- **How it was tested:** `vite build` green; grep confirms zero `no-cors` / zero `MimeType.JSON`; security review PASS.
- **Security review:** PASS (security-engineer).
- **Docs updated:** SETUP.md troubleshooting rows; CHANGELOG.
- **Risks/tradeoffs:** Token travels in GET query strings (in history/logs; HTTPS in transit) — accepted for this architecture.
- **Needs customer decision on:** none.

### BL-204 — README rewrite
- **What changed:** `README.md` fully rewritten from the generic starter-kit template to BarcodePOS documentation (features, roles, getting started, dev commands, layout, deployment, tech stack, docs links). Also: `CHANGELOG.md` backfilled; `sprints/backlog.md` populated with the full audit backlog (BL-101..BL-207); this sprint file now reflects real work.
- **Why:** The repo shipped with a template README and empty process files despite being an operating-model-driven project.
- **How it was tested:** Reviewed by Delivery Lead; facts verified against package.json and repo layout.
- **Security review:** n/a.
- **Docs updated:** README, CHANGELOG, sprints, SETUP.md.
- **Risks/tradeoffs:** none.
- **Needs customer decision on:** none.

## Blockers
- [x] **Customer action required to finish BL-101:** redeploy `gas/Code.gs` + run `setApiToken()` + enter token in app Settings (see review packet).

## Sprint close-out
When every committed item is Done or explicitly deferred, move a summary to
`CHANGELOG.md`, log lessons in `retros.md`, and start a fresh
`sprint-current.md` for the next sprint.
