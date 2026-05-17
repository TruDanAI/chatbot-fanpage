# Project Agent Skills

Project-local agent skills live in `.agent/skills/`. They are concise runbooks for future Codex sessions in this repo. They are markdown guidance only and are not auto-loaded by the app.

Use them by naming the needed files at the start of a task. Example:

> Before starting, read `.agent/skills/railway-production-safety.md` and `.agent/skills/admin-onboarding.md`.

> Before coding, read `.agent/skills/grill.md` and grill this plan. Ask one question at a time and give your recommended answer.

## Which Skill To Use

- `railway-production-safety.md`: use for Railway production, production DB, env vars, Messenger webhook, credentials, or `/data`.
- `grill.md`: use to stress-test unclear plans before architecture, production rollout, multi-shop, credential, webhook queue, admin onboarding, or business/pricing decisions.
- `staging-canary.md`: use for risky runtime behavior that should prove out on staging before production.
- `admin-onboarding.md`: use for shop onboarding, shop shell creation, page mappings, credentials, products, assets, readiness, or shop health.
- `credential-safety.md`: use for page tokens, app secrets, `CREDENTIAL_MASTER_KEY`, encryption, credential rotation, audit metadata, or API responses that might expose secrets.
- `messenger-webhook-debugging.md`: use for webhook delivery, Meta subscription, page mapping, DB runtime resolution, credential lookup, Messenger sends, dry-run behavior, or handoff/no-reply diagnosis.
- `tdd-and-review.md`: use for local implementation work, tests, verification, code review, or commit readiness.

## Current Project Status

- Production DB-backed runtime is enabled and stable.
- `WEBHOOK_QUEUE_ENABLED` is still false.
- Railway production auto-deploy is off.
- Admin onboarding core exists: shop shell creation, page mapping, credential rotation, product/asset management, readiness checklist, and per-shop health are present.

## Standing Boundaries

- Do not deploy unless the user explicitly approves it.
- Do not change env unless the user explicitly approves it.
- Do not write production DB unless the user explicitly approves it and a backup exists.
- Do not touch production `/data`.
- Do not run authenticated production smoke unless explicitly approved.
- Do not print secrets, raw customer data, message bodies, raw page IDs, DB URLs, tokens, or encrypted credential values.
