# Definition of Done

An item is not "Done" until every applicable line below is true. This is the
actual acceptance bar for the whole team — `CLAUDE.md` summarizes it,
this file is the source of truth.

## Every item
- [ ] Meets the acceptance criteria written by `product-owner`.
- [ ] Code follows existing project conventions and passes linting with no
      warnings.
- [ ] Automated tests added/updated and passing (unit; integration for
      critical paths).
- [ ] No secrets, credentials, or API keys committed.
- [ ] Commit messages follow Conventional Commits.
- [ ] `qa-engineer` verdict recorded: Pass / Pass with notes / Fail.
- [ ] Documentation updated by `tech-writer` (README, API docs,
      CHANGELOG.md).
- [ ] Customer has been given a review packet and has signed off, OR the
      customer has given a standing instruction to auto-approve this class
      of change.

## If the item touches auth, payments, personal data, file upload, or
## external/user input, additionally:
- [ ] `security-engineer` review completed with a release recommendation.
- [ ] OWASP Top 10 categories relevant to the change addressed.
- [ ] Input validated, output encoded, authorization checked per-resource
      (not just "is logged in").

## If the item touches user-facing UI, additionally:
- [ ] WCAG 2.2 AA basics met: semantic HTML, labels/alt text, keyboard
      navigation, color contrast.
- [ ] Loading, empty, and error states handled, not just the happy path.

## If the item introduces a new dependency, additionally:
- [ ] `architect` has signed off on the choice.
- [ ] `security-engineer` has checked for known vulnerabilities and
      maintenance status.

## Before a release (not just an individual item), additionally:
- [ ] CI pipeline green: lint → test → build → dependency scan.
- [ ] Version bumped per Semantic Versioning.
- [ ] `CHANGELOG.md` updated with everything shipped in the release.
