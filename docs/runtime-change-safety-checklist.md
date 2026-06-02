# Runtime Change Safety Checklist

Use before any runtime code, routing, env, DB, or deployment change. This file
is a checklist only; it does not approve execution.

Forbidden during this Day 1 docs sprint:

- Deploying.
- Changing env.
- Writing DB.
- Touching `/data`.
- Calling Meta Graph API.
- Running token health checks.
- Sending Messenger messages.
- Modifying runtime code.

## Classic Flow Checks

Classic means file-backed `adult-shop`.

- No diff under `shops/adult-shop/**`.
- No diff in `core/webhook.js`, `core/messenger-client.js`, or image/runtime
  send paths unless the task explicitly targets classic production.
- `SHOP_ID`/`ACTIVE_SHOP` fallback to `adult-shop` is understood.
- Adult config remains `menu_code_handoff`.
- Adult AI fallback, order flow, lead capture, and recommendation settings are
  not accidentally enabled.
- Local image paths and product CSV are unchanged.
- No startup command is run if token health checks are prohibited; runtime
  startup calls `checkPageToken()`.
- No file storage command is run when `/data` is out of scope.

## V2 Flow Checks

V2 means DB-backed per-shop `menu_code_handoff`.

- Incoming Page resolves through `resolveDbShopRuntimeForPage()`.
- Exactly one active Page mapping exists for the pilot Page.
- Exactly one active encrypted `fb_page_token` credential exists for that
  mapping.
- Shop status is active only for the approved test/live window.
- Bot mode is `menu_code_handoff`.
- Products and assets are active for the smoke product code.
- `storage.forContext()` scopes tenant, Page, and shop.
- Effective dry-run decision is known before testing.
- Shop `dry_run=true` for dry-run; shop `dry_run=false` only during approved
  live-send window.
- `live_enabled` and lifecycle match the approved phase.
- Unknown, ambiguous, inactive, unsupported, or credential-missing routing
  fails closed.
- Logs use safe refs and never raw Page IDs/tokens.

## Staging Smoke Checklist

- `git status --short` reviewed.
- `git diff --check` passes.
- Targeted tests for touched area pass.
- Full `npm test` passes before runtime deploy approval.
- Admin/wizard pages render without raw secrets.
- Readiness check passes or records exact blockers.
- Dry-run simulation sends no real Messenger message.
- Menu trigger returns expected menu text and image markers.
- Primary product code resolves to expected product and image.
- Handoff text appears when expected.
- No wrong-shop, `page_not_found`, credential, or storage-context errors.
- Staging is restored to the expected safe dry-run state after any controlled
  live-send test.

## Production Deploy Gate

- Explicit production deploy approval exists.
- Fresh rollback plan exists with operator assigned.
- No unrelated user changes are included in the commit.
- Adult classic blast radius is reviewed.
- V2 pilot blast radius is reviewed.
- Production env changes are separately approved and recorded.
- Production DB writes are separately approved and backed up.
- Token health checks are separately approved if they will run.
- Messenger live sends are separately approved with time window.
- `adult-shop` remains protected from wizard, page cutover, delete, and dry-run
  control changes.
- Production kill switch uses approved shop controls; do not assume
  `MESSENGER_DRY_RUN=true` can boot in production.
- Final predeploy status is clean except intended files.
