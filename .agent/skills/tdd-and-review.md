# TDD And Review

Use this skill for local coding tasks, tests, verification, review, and commit readiness.

## Local Workflow

1. Read files first.
   - Inspect the current implementation, tests, and nearby docs before editing.
   - Check `git status --short --untracked-files=all` so unrelated work is not mixed in.
2. Choose a minimal slice.
   - Keep the change scoped to the requested behavior.
   - Prefer existing helpers, route patterns, presenters, and tests.
3. Write or update tests.
   - Cover success, validation, authorization, failure, and redaction paths according to risk.
   - For docs-only changes, tests may not be needed.
4. Implement the smallest code/docs change.
5. Run syntax checks on changed JavaScript.
   - `node --check path/to/file.js`
6. Run the test suite.
   - `npm test`
7. Run dependency audit.
   - `npm audit --omit=dev`
8. Run whitespace/conflict checks.
   - `git diff --check`
9. Review before commit.
   - Inspect `git diff`.
   - Verify no secrets, raw customer data, raw page IDs, message bodies, DB URLs, tokens, or `encrypted_value` were introduced.
   - Do not commit until the user approves or explicitly asks for a commit.

## Reasoning Effort

- Use High for local/admin/test/docs work.
- Use Extra High for production env, production DB, Messenger webhook, credentials, queue rollout, or anything that can affect live sends or customer data.

## Review Lens

When reviewing changes, prioritize:

- Runtime behavior regressions.
- Authorization and permission gaps.
- Missing transaction rollback or unchecked commit results.
- Secret or raw identifier exposure.
- Missing tests for validation, failure, and redaction.
- Production safety boundary violations.
- Drift from existing route, presenter, and service patterns.

## Docs-Only Shortcut

For docs-only skill changes:

- Read relevant docs/tests enough to avoid stale guidance.
- Run `git diff --check`.
- Do not run app smoke, deploy, env commands, authenticated production checks, or DB writes unless separately requested and approved.
