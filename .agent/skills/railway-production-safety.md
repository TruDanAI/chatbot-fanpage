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

## Current Important Flags

- `MULTI_SHOP_DB_CONFIG_ENABLED`: enables DB-backed runtime config. Production is currently enabled and stable.
- `WEBHOOK_QUEUE_ENABLED`: durable webhook queue gate. Keep false until a separate approved queue rollout.
- `MESSENGER_DRY_RUN`: disables real Messenger sends when true. Production must not use staging-only dry-run settings.

## Preflight Checklist

Before any production-impacting work, state the intended action and verify:

- User explicitly approved this exact production action.
- Git state is understood and unrelated local changes are not included.
- Target Railway service/environment is production, not staging.
- Production auto-deploy state is known.
- Public read-only checks are sufficient unless authenticated smoke was explicitly approved.
- Required flags are known: `MULTI_SHOP_DB_CONFIG_ENABLED`, `WEBHOOK_QUEUE_ENABLED`, `MESSENGER_DRY_RUN`.
- Logs and command output will be aggregated or redacted before sharing.
- No command will read, write, copy, or delete production `/data`.

## Production DB Write Backup Requirement

Before a production DB write, require:

- A fresh production backup or exported rollback artifact.
- The exact SQL or migration plan reviewed before execution.
- A rollback plan that does not depend on hidden chat context.
- A clear statement of expected row counts or schema effects.
- Post-write verification based on safe counts/statuses only.

If any item is missing, stop and ask for approval or missing artifacts before proceeding.

## Feature Flag Rollback Pattern

Prefer reversible feature flags over code rollback for runtime rollout:

- If DB-backed runtime becomes unsafe, disable `MULTI_SHOP_DB_CONFIG_ENABLED` only after production env-change approval.
- If queue behavior becomes unsafe, disable `WEBHOOK_QUEUE_ENABLED` only after production env-change approval.
- Keep additive schema in place unless a reviewed rollback requires otherwise.
- Verify public `/healthz` after rollback. Do not run authenticated smoke unless separately approved.
- Report rollback using safe summaries: flag state, HTTP status, `ok`, storage readiness, and aggregate error counts.
