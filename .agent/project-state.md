# Project State

> This file tracks volatile operational state. Update it whenever flags, URLs, or deploy settings change.
> Do not embed this information in skill files — skills are guidance, not state.
> Never store secrets here: no tokens, DB URLs, app secrets, page access tokens, encrypted values, customer IDs, or message bodies.

Last updated: 2026-05-17

## Feature Flags

| Flag | Environment | Current Value | Notes |
|------|-------------|---------------|-------|
| `MULTI_SHOP_DB_CONFIG_ENABLED` | production | true | Production adult-shop real traffic passed after enable |
| `MULTI_SHOP_DB_CONFIG_ENABLED` | staging | true | Used for staging DB-backed canary |
| `WEBHOOK_QUEUE_ENABLED` | production | false | Keep false until separate queue rollout approved |
| `WEBHOOK_QUEUE_ENABLED` | staging | false | Keep false until staging queue rollout |
| `MESSENGER_DRY_RUN` | production | false | True = Messenger sends are not real |
| `MESSENGER_DRY_RUN` | staging | false | Set false during staging real-send canary |

## Railway Services

| Environment | Service URL | Auto-deploy |
|-------------|-------------|-------------|
| Production | https://chatbot-fanpage-production.up.railway.app | off |
| Staging | https://chatbot-fanpage-staging-staging.up.railway.app | on for staging only; manual deploy preferred when requested |

## Production DB

| Item | Value |
|------|-------|
| Last backup timestamp | 2026-05-16 12:47:40 local, pre-db-runtime-enable |
| Last backup path | `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260516-124740-pre-db-runtime-enable` |
| Last backup SHA256 | `275CDBB312D1B0EE300A7ED6C52BCDD176A38380C109D57AD6A61EA86C81F080` |
| Last production write | 2026-05-16: set `MULTI_SHOP_DB_CONFIG_ENABLED=true` |
| Schema migration pending | no known pending migration for current DB-backed adult-shop runtime |
| Queue rollout pending | yes, `WEBHOOK_QUEUE_ENABLED` still false |

## Meta App

| Item | Value |
|------|-------|
| Staging Meta App | configured, App ID not stored here |
| Production Meta App | configured, App ID not stored here |
| Staging webhook callback URL | https://chatbot-fanpage-staging-staging.up.railway.app/webhook |
| Production webhook callback URL | https://chatbot-fanpage-production.up.railway.app/webhook |

## Current Rollout Status

Production DB-backed runtime is enabled and adult-shop live traffic has been observed healthy. Menu replies, menu images, product images, and post-product handoff were observed working. No visible DB fail-closed, page_not_found, credential, or Messenger send errors were observed in the provided production logs.

Admin onboarding flows are implemented and pushed to `main`:
- create shop shell
- page mapping management
- page credential create/rotate
- onboarding readiness checklist

Latest staging deploy for admin onboarding UI passed public and read-only authenticated UI smoke. Staging `onboarding-demo-shop` was created through the admin API/UI with a real second staging test fanpage, passed readiness, and completed a Messenger end-to-end pass. Incoming `page_ref` matched `p:3d651b6548` and routed only to `onboarding-demo-shop`, with no wrong-shop routing to `test-shop` or `adult-shop`.

Production deployment is intentionally not updated with the latest admin UI commits unless manually deployed. `WEBHOOK_QUEUE_ENABLED` remains false and should be handled as a separate future gate.
