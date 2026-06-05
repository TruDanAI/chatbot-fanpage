# Fanpage Connection Cutover Checkpoint

This P1.2f checkpoint is documentation-only. It is not approval to deploy,
change environment variables, write any database, touch `/data`, touch
production, call Meta Graph API, run token health checks, or send Messenger
messages.

## Summary

P1.2f documents the staging-complete Fanpage Connection workflow, credential
replacement UX, readiness-stale behavior after connection changes, and the
staging-only Page cutover service. Production UI cutover remains disabled and
production cutover still requires explicit operator approval and a runbook.

## P1.2f1 Fanpage Connection State UI

- Commit: `4b91d48`.
- Staging deployment: `8d50a5b7-9893-482e-970b-20186b76c7d4`.
- The Fanpage Connection UI shows localized connection states:
  - `CHƯA KẾT NỐI`
  - `THIẾU QUYỀN GỬI TIN`
  - `ĐÃ KẾT NỐI`
  - `XUNG ĐỘT KẾT NỐI`
  - `CẦN KIỂM TRA`

## P1.2f2 Credential Replacement UX

- Commit: `208f1fe`.
- Staging deployment: `e084cedb-747e-407f-9658-3d62b6d64410`.
- Token input is password-only and is never prefilled.
- Replacement is gated by a danger modal.
- Confirmation requires a checkbox, exact shop slug entry, and countdown.
- The UX shows environment and encryption warnings before replacement.
- Replacement performs no automatic token health check.

## P1.2f2b Readiness Stale After Connection Changes

- Commit: `534bd92`.
- Staging deployment: `971eaa9e-edb1-43bc-aa31-1e5f2718b368`.
- Page mapping and credential mutations mark readiness as unknown/stale.
- `dry_run`, `live_enabled`, `lifecycle`, and `status` remain unchanged by the
  stale-readiness marker.

## P1.2f3 Staging-Only Page Cutover Service

- Commit: `a5df5b5`.
- Staging deployment: `125463cb-5507-4bcf-9768-42086c3b48a8`.
- API-only route:

  ```http
  POST /admin/api/shops/:shopId/pages/cutover
  ```

- Production is blocked.
- The cutover runs in an atomic transaction.
- Post-condition requires exactly one active mapping and exactly one active
  credential for the shop.
- The old mapping and old credential are archived.
- The new mapping and new credential are active.
- Readiness is marked stale after cutover.
- Rollback and negative checks pass.
- The service makes no Meta Graph API call, runs no token health check, and
  sends no Messenger message.

## Staging Smoke Note

- `wizard-smoke-shop` was cut over from old safe ref `p:421ca33965` to new safe
  ref `p:94bf9048cd`.
- Cleanup option B was used.
- Final staging state remained safe:
  - `active mappings=1`
  - `active credentials=1`
  - `dry_run=true`
  - `live_enabled=false`
  - `lifecycle=draft`
  - `messenger.dryRun=true`

## Production Policy

- No production UI cutover is enabled yet.
- Production cutover still requires explicit operator approval and a runbook.
- Production credentials must be encrypted only in the production runtime
  context.
- Never use a staging key or staging token for production credentials.

## Safety Boundary

- No deployment was performed for this documentation checkpoint.
- No environment variable was changed.
- No database or `/data` write was performed.
- No production system was touched.
- No Meta Graph API call, token health check, or Messenger send was performed.
