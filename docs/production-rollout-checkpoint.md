# Production Rollout Checkpoint - 2026-05-31

This checkpoint records the successful production rollout after the schema
migration, app deploy, post-deploy observation, and manual Messenger smoke.
It is documentation-only and is not approval to deploy, change production
environment variables, write production PostgreSQL, touch production `/data`,
call Meta Graph API, run token health checks, or send Messenger messages.

## Production Schema Migration

The production schema migration applied successfully.

Required `shops` columns are now present:

- `dry_run`
- `live_enabled`
- `lifecycle`
- `last_readiness_status`
- `last_readiness_checked_at`
- `last_ready_by`

`adult-shop` state after migration:

- `status=active`
- `dry_run=false`
- `lifecycle=live`
- `live_enabled=true`
- `last_readiness_status=unknown`

## Backup

The verified pre-rollout production backup was:

- File: `chatbot-fanpage-prod-20260531-015324.dump`
- SHA256:
  `6FE0F65C479B81E36EE381A533D73EFEBF3D81B3E3F344A3C3DF3AC7ACCDD2B9`
- `pg_restore --list` passed.

## Production App Deploy

- New deployment: `06c629a6-79c2-42a7-9527-bbb7a6fd31b5`
- Previous rollback target: `94905d5c-8d15-45a3-afe4-9edeb94d14f5`
- App commit: `origin/main 54c990e`
- Deployment status: `SUCCESS`
- Replica: `1/1` running

## Health

Public `GET /healthz` passed:

- HTTP `200`
- `ok=true`
- `shop=adult-shop`
- `products=13`
- `storage.adapter=postgres`
- `storage.ready=true`
- `messenger.dryRun=false`

## Observation

The post-deploy observation window passed after 15+ minutes.

Observed results:

- No restart loop.
- No `credential_decrypt_failed`.
- No page routing failures.
- No missing column errors.
- No Messenger send errors.
- No runtime exceptions.
- No HTTP `5xx` observed.

## Manual Messenger Smoke

Manual Messenger smoke was performed by the operator/user, not by the
documentation step.

Observed flow:

- Message `menu` was sent manually.
- Text menu was sent.
- Menu image 1 was sent.
- Menu image 2 was sent.
- Product code `MÃ10` replied with the product image.
- Post-product handoff activated.
- A subsequent message was skipped due to handoff.

Safe references:

- `page_ref=p:17a7a1c50e`
- `shop_ref=s:a7ee4fb634`

Do not record raw Page IDs or sender IDs in docs. Safe refs only.

## Final Status

- Production rollout is fully verified.
- Rollback is not needed.
- Production cutover remains runbook-only.
- Gemini remains off.

## Documentation Safety Boundary

This documentation checkpoint made no production changes:

- No deploy.
- No environment variable change.
- No database access or write.
- No `/data` access.
- No Meta Graph API call.
- No token health check.
- No Messenger message sent.
