# TDD And Review

Use this skill for local coding tasks, tests, verification, review, and commit readiness.

## Local Workflow

1. **Read files first.**
   - Inspect the current implementation, tests, and nearby docs before editing.
   - Check `git status --short --untracked-files=all` so unrelated work is not mixed in.

2. **Choose a minimal slice.**
   - Keep the change scoped to the requested behavior.
   - Prefer existing helpers, route patterns, presenters, and tests over introducing new abstractions.

3. **Write or update tests first.**
   - Cover success, validation, authorization, failure, and redaction paths according to risk.
   - For docs-only changes, tests may not be needed.

4. **Implement the smallest code/docs change** that makes the tests pass.

5. **Run syntax checks** on changed JavaScript.
   ```
   node --check path/to/file.js
   ```

6. **Run the test suite.**
   ```
   npm test
   ```
   On failure: read the error, fix the cause, do not patch the test to hide the failure. If the failure is in an unrelated test, call it out explicitly rather than silently fixing it.

7. **Run dependency audit.**
   ```
   npm audit --omit=dev
   ```
   On new high/critical advisories: do not proceed without resolving or explicitly deferring with user awareness.

8. **Run whitespace/conflict checks.**
   ```
   git diff --check
   ```

9. **Review before commit.**
   - Inspect `git diff`.
   - Verify no secrets, raw customer data, raw page IDs, message bodies, DB URLs, tokens, or `encrypted_value` were introduced.
   - Do not commit until the user approves or explicitly asks for a commit.

## Scope By Risk

Adjust thoroughness to the risk of the change:

| Change type | Test coverage expected |
|------------|----------------------|
| Docs / copy only | None required |
| Local config / helper | Happy path + one failure case |
| Admin UI / route | Success + auth + validation + redaction |
| Credential / token path | Success + auth + validation + redaction + secret-not-in-output |
| Production env / DB / webhook | Full coverage above + production safety review from `railway-production-safety.md` |

## Review Lens

When reviewing changes, prioritize in order:

1. Runtime behavior regressions — does anything that worked before break?
2. Authorization and permission gaps — can a lower-privilege caller reach this?
3. Missing transaction rollback or unchecked `COMMIT` results.
4. Secret or raw identifier exposure in response, log, audit metadata, or test fixture.
5. Missing tests for validation, failure, and redaction paths.
6. Production safety boundary violations.
7. Drift from existing route, presenter, and service patterns.

## Docs-Only Shortcut

For docs-only skill or readme changes:

- Read relevant docs/tests enough to avoid stale guidance.
- Run `git diff --check`.
- Do not run app smoke, deploy, env commands, authenticated production checks, or DB writes unless separately requested and approved.
