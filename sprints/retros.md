# Retrospectives

Short entries only — 3–5 lines per sprint. This is a working log, not a
report.

## Sprint Phase 1 — Critical Security & Docs (2026-08-02)
- **Worked well:** Security audit caught real critical issues (unauthenticated
  GAS API, XSS sinks, silent sync data loss); the security-gate review (BL-102)
  failed once and the fix was small and mechanical — the gate works.
- **Worked well:** Escaping helper (`escJs`) + barcode sanitization closed the
  whole class of injection bugs in one pass, including pre-existing sinks found
  during review.
- **Didn't work:** Previous developer never committed the operating-model files
  (README/sprints/CLAUDE.md) — they were untracked; now committed.
- **Change next sprint:** Customer must redeploy `gas/Code.gs` + run
  `setApiToken()` before BL-101 is truly live — follow up at sprint close-out.
- **Change next sprint:** Consider adding the lint + test tooling (BL-201/202)
  before Phase 3 grows the codebase further.

## Template
### Sprint [name] — [date]
- **Worked well:** …
- **Didn't work:** …
- **Change next sprint:** …
