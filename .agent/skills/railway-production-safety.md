# Railway Production Safety

Use this skill when a task touches Railway production, production DB, production env, Messenger webhook behavior, credentials, or production `/data`.

## Hard Rules

- Never deploy production without explicit user approval in the current session.
- Never change production env without explicit user approval in the current session.
- Never write production DB without explicit user approval in the current session.
- Never touch production `/data`.
- Never print tokens, DB URLs, raw `page_id`, customer IDs, message bodies, or `encrypted_value`.
- Treat authenticated production smoke as production access. Do not run it without approval.
- Keep final answers sanitized. Summarize counts, statuses, flags, and safe refs only.

## Known Feature Flags

Before any production-impacting work, read current flag values from `.agent/project-state.md`.
Do not assume flag state from memory or prior sessions.

Key flags to confirm:

| Flag | Purpose | Risk if wrong |
|------|---------|---------------|
| `MULTI_SHOP_DB_CONFIG_ENABLED` | DB-backed runtime config | Disabling drops all shop routing to fallback |
| `WEBHOOK_QUEUE_ENABLED` | Durable webhook queue | Enabling before queue infra is ready drops messages |
| `MESSENGER_DRY_RUN` | Disables real Messenger sends | Must be `false` in production; `true` silently drops sends |

If `.agent/project-state.md` does not exist or flag values are absent, ask the user before proceeding.

## Preflight Checklist

Before any production-impacting work, state the intended action and verify each item:

- [ ] User explicitly approved this exact production action in the current session.
- [ ] Git state is understood; unrelated local changes are not included.
- [ ] Target Railway service/environment is confirmed as production, not staging.
- [ ] Production auto-deploy state is known (on/off).
- [ ] Current flag values read from `.agent/project-state.md` or confirmed with user.
- [ ] Public read-only checks are sufficient unless authenticated smoke was explicitly approved.
- [ ] Logs and command output will be aggregated or redacted before sharing.
- [ ] No command will read, write, copy, or delete production `/data`.

Do not proceed if any item cannot be confirmed.

## Production DB Write Backup Requirement

Before a production DB write, require all of the following:

- A fresh production backup or exported rollback artifact (timestamp confirmed).
- The exact SQL or migration plan reviewed before execution.
- A rollback plan that does not depend on hidden chat context.
- A clear statement of expected row counts or schema effects.
- Post-write verification based on safe counts/statuses only.

If any item is missing, stop and ask for approval or missing artifacts before proceeding.

## Feature Flag Rollback Pattern

Prefer reversible feature flags over code rollback for runtime issues:

- If DB-backed runtime becomes unsafe: disable `MULTI_SHOP_DB_CONFIG_ENABLED` only after production env-change approval.
- If queue behavior becomes unsafe: disable `WEBHOOK_QUEUE_ENABLED` only after production env-change approval.
- If real sends must be halted immediately: enable `MESSENGER_DRY_RUN=true` only after production env-change approval. Remove it before restoring normal traffic.
- Keep additive schema in place unless a reviewed rollback requires otherwise.

After any flag change:

1. Verify public `/healthz` returns `ok`.
2. Report flag state, HTTP status, storage readiness, and aggregate error counts.
3. Do not run authenticated smoke unless separately approved.
4. Update `.agent/project-state.md` with the new flag values and timestamp.
