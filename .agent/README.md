# Project Agent Skills

Project-local agent skills live in `.agent/skills/`. They are concise runbooks for agent sessions in this repo. They are markdown guidance only and are not auto-loaded by the app.

Use them by naming the needed files at the start of a task. Example:

> Before starting, read `.agent/skills/railway-production-safety.md` and `.agent/skills/admin-onboarding.md`.

> Before coding, read `.agent/skills/grill.md` and grill this plan. Ask one question at a time and give your recommended answer.

## Which Skill To Use

| Task | Skills |
|------|--------|
| Railway production, production DB, env vars, Messenger webhook, credentials, or `/data` | `railway-production-safety.md` |
| Stress-test an unclear plan before architecture, production rollout, credential, webhook queue, admin onboarding, or pricing decisions | `grill.md` |
| Risky runtime behavior that must prove out on staging before production | `staging-canary.md` |
| Shop onboarding: shell creation, page mappings, credentials, products, assets, readiness, health | `admin-onboarding.md` |
| Page tokens, app secrets, `CREDENTIAL_MASTER_KEY`, encryption, credential rotation, audit metadata, API responses | `credential-safety.md` |
| Webhook delivery, Meta subscription, page mapping, DB runtime resolution, credential lookup, Messenger sends, dry-run, or no-reply | `messenger-webhook-debugging.md` |
| Local implementation, tests, verification, code review, or commit readiness | `tdd-and-review.md` |

## Combining Skills

Some tasks require multiple skills. Canonical pairings:

- **Production change** → `railway-production-safety.md` + `tdd-and-review.md`
- **New credential work** → `credential-safety.md` + `admin-onboarding.md`
- **Uncertain plan** → `grill.md` first, then the relevant task skill
- **Risky deploy** → `staging-canary.md` before `railway-production-safety.md`
- **Webhook regression** → `messenger-webhook-debugging.md` + `staging-canary.md`

## Current Project State

**Do not embed operational state in skill files.** Project state changes independently of skill guidance. Maintain current flag values, service URLs, and deployment status in:

```
.agent/project-state.md   ← create this file; update it when state changes
```

Suggested fields for `project-state.md`:
- `MULTI_SHOP_DB_CONFIG_ENABLED` current value and stability
- `WEBHOOK_QUEUE_ENABLED` current value and rollout plan
- `MESSENGER_DRY_RUN` current value per environment
- Railway production auto-deploy state
- Staging service URL
- Last production backup timestamp

## Standing Boundaries

- Do not deploy unless the user explicitly approves it in the current session.
- Do not change env unless the user explicitly approves it in the current session.
- Do not write production DB unless the user explicitly approves it and a backup exists.
- Do not touch production `/data`.
- Do not run authenticated production smoke unless explicitly approved.
- Do not print secrets, raw customer data, message bodies, raw page IDs, DB URLs, tokens, or encrypted credential values.
