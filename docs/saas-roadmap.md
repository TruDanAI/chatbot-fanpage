# Chatbot Fanpage SaaS Roadmap

This document is the long-term plan for turning the current Messenger shop bot
into a stable internal SaaS-style admin system. It is intentionally conservative:
production data safety is more important than feature speed.

## Safety rules

These rules apply to every future phase:

- Do not deploy without explicit approval in the same session.
- Do not push without explicit approval, unless the owner says push is allowed
  for that exact work.
- Do not change production environment variables without separate approval.
- Do not write production PostgreSQL without a fresh backup and explicit
  production DB write approval.
- Do not delete, truncate, reset, or rewrite production data.
- Do not switch production back to file storage.
- Do not touch production `/data` except read-only inspection.
- Do not print customer data, tokens, `DATABASE_URL`, Facebook tokens, Google
  service account values, or Telegram tokens.
- Add every required setup variable to `.env.example` with clear comments.
- Keep migrations additive and idempotent unless a destructive migration has a
  separate rollback plan and explicit approval.

## Current baseline

Last verified baseline from May 11, 2026:

- Production Railway project: `graceful-harmony`
- Production service: `chatbot-fanpage`
- Production Postgres service: `Postgres-TQuc`
- Production storage: PostgreSQL
- Production runtime health: `ok=true`, `storage.adapter=postgres`,
  `storage.ready=true`, `messenger.dryRun=false`
- Production admin audit schema: applied.
- Production admin audit logging: `ADMIN_AUDIT_LOG_ENABLED=true`.
- Latest production admin audit count after smoke: `admin_audit_log=2`,
  all `success`.
- Latest verified code deployment at that time:
  `8baa178 Add admin session login flow`
- Latest verified Railway deployment:
  `d30fb579-77df-4dda-97ee-4ae291262856 SUCCESS` at commit
  `8baa178 Add admin session login flow`
- Latest verified Railway deployment after audit env enable:
  `2ebbb94b-4f77-489b-a309-db3b0ed04784 SUCCESS` at commit
  `6d21707 Update handoff docs after legacy handler deploy`
- Previous verified Railway code deployment:
  `69552f93-f4ee-4ef6-b382-7e7891e409df SUCCESS`
- Phase commits already pushed:
  `e14692c Add admin RBAC audit scaffolding`,
  `a28c0e5 Add SaaS roadmap and handoff prompt`,
  `c9ff1df Handle missing audit schema gracefully`,
  `b90c5de Update handoff docs after production deploy`,
  `20676a3 Refactor admin dashboard modules`,
  `5851368 Update handoff docs after admin refactor deploy`,
  `5ec0902 Expand next session handoff prompt`,
  `fd5a9a0 Extract admin route handlers`,
  `70ac695 Update handoff docs after route handler deploy`,
  `da48d2a Extract admin legacy handlers`,
  `6d21707 Update handoff docs after legacy handler deploy`,
  `c333388 Update handoff docs after audit rollout`,
  `8baa178 Add admin session login flow`
- Latest known backup: `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-101331`
- Latest known backup SHA256:
  `CEC1076AE2CC131DB136FE81A9EBBE31D9D46D535CEF9779FB59E0F7A2CBF54D`
- Latest known counts: profiles 1, conversations 4, messages 37, orders 6,
  order_items 7, events 223, processed_mids 85

Treat this baseline as a snapshot only. Every future session must re-check git,
Railway deployment, `/healthz`, and backup status before production work.

## Product goal

Build a private SaaS-style operations web app for the owner to run one or more
Messenger sales pages from a single system.

The app should support:

- Bot runtime health and storage status.
- Orders, conversations, events, and customer detail review.
- Admin users, roles, permissions, and audit history.
- Safe operational settings per tenant/page.
- Future write workflows with confirmation and audit.
- Multi-page or multi-shop operation without hard-coded assumptions.

## Architecture direction

The system should evolve in small, reversible steps.

Current shape:

- Express backend.
- Admin route wiring in `core/admin-routes.js`.
- Admin route authorization helper in `core/admin/route-auth.js`.
- Admin session helper in `core/admin/session.js`.
- Admin read-only page handlers in `core/admin/read-routes.js`.
- Admin read-only JSON presenters in `core/admin/api-presenter.js` for the
  future dedicated frontend.
- Admin legacy export/state handlers in `core/admin/legacy-routes.js`.
- Server-rendered admin HTML in `core/admin/views.js`.
- Admin PostgreSQL read model in `core/admin/reader.js`.
- Admin audit writer in `core/admin/audit.js`.
- PostgreSQL storage adapter.
- Rule-based chatbot with optional AI fallback.
- Railway production deployment.

Target shape:

```txt
core/
  admin/
    auth.js
    rbac.js
    audit.js
    routes.js
    views.js
  bot/
    webhook.js
    reply-service.js
    context-service.js
  orders/
    order-service.js
    order-repository.js
  storage/
    postgres-adapter.js
  notifications/
    telegram.js
    sheets.js
db/
  schema.sql
  migrations/
docs/
  runbooks/
  roadmap/
tests/
```

Do not do this refactor in one large commit. Split by module boundary and keep
tests green after each slice.

## Phase plan

### Phase 1: stabilize admin read model

Status: done for the current read-only admin baseline.

Done:

- Read-only dashboard.
- Dashboard filters.
- Bounded user detail view.
- Data masking in admin UI.
- Read-only SQL guard.
- Static-token admin auth hardening.
- RBAC/audit helper scaffolding.
- `/admin/audit` route in code.
- Audit schema proposal and runbook.
- Missing audit schema is handled gracefully in `/admin/audit`; the page can
  render a schema-not-ready message before production schema apply.
- Admin dashboard modules split into route wiring, PostgreSQL reader, audit
  writer, and server-rendered views.
- Admin route authorization/audit request handling extracted to
  `core/admin/route-auth.js`.
- Admin dashboard, user detail, and audit page handlers extracted to
  `core/admin/read-routes.js`.
- Read-only JSON API foundation added for dashboard, user detail, and audit
  routes using masked presenter output for future frontend work.
- Dashboard operational insights added in the read model and API: rolling 24h
  activity, needs-attention orders/handoffs, order status breakdown, and top
  products over 30 days.
- Admin legacy export and state handlers extracted to
  `core/admin/legacy-routes.js`.
- Production smoke checks for `/admin/dashboard` and `/admin/audit` passed
  after the refactor deploy.
- Production audit schema was applied after a fresh PostgreSQL backup.
- `ADMIN_AUDIT_LOG_ENABLED=true` is enabled in production.
- Production smoke checks after enabling audit logging wrote audit records for
  `/admin/dashboard` and `/admin/audit`.

Remaining:

- Keep smoke checks for `/admin/dashboard` and `/admin/audit` after each
  future deploy.

### Phase 2: production audit rollout

Status: done as of May 11, 2026.

Goal: make admin reads auditable without adding business write workflows.

Steps:

1. Re-check git and production deployment state.
2. Create fresh production PostgreSQL backup outside the repo.
3. Verify backup counts and SHA256.
4. Apply `db/admin-auth-rbac-audit-proposal.sql` to a non-production database.
5. Run tests and audit locally.
6. Deploy code only after approval.
7. Apply production schema only after approval.
8. Verify admin audit tables exist using count-only queries.
9. Set `ADMIN_AUDIT_LOG_ENABLED=true` only after separate env approval.
10. Test `/admin/dashboard` and `/admin/audit` with Bearer header.

Rollback stance:

- If code deploy has issues, redeploy previous known-good commit.
- If audit schema exists but audit logging stays disabled, leave empty tables in
  place. Do not drop tables in production without a separate approved rollback.
- If audit logging causes production issues, disable `ADMIN_AUDIT_LOG_ENABLED`
  after separate production env approval. Leave the additive audit tables in
  place unless a separately approved rollback plan exists.

### Phase 3: admin login/session

Status: code deployed. Production session env was observed as set by a safe
metadata check on May 11, 2026, but browser cookie login still needs an
approved production smoke because login/dashboard/audit checks write audit
records.

Goal: replace manual Bearer-header usage for the dashboard with a usable browser
login flow.

Recommended approach:

- Add secure cookie sessions. Initial implementation signs stateless
  HttpOnly/SameSite=Lax cookies and rotates the session token on login.
- Keep `Authorization: Bearer` support for automation.
- Store admin users and roles in PostgreSQL later, after identity provisioning
  and token/session rotation are reviewed.
- Add passwordless magic link or passkey later; avoid rolling custom password
  auth too early unless there is a clear operational need.

Required env keys to add when implemented:

```env
# SESSION_SECRET=change_me_to_64_plus_random_chars
# ADMIN_PUBLIC_BASE_URL=https://your-admin-domain.example
# ADMIN_SESSION_COOKIE_NAME=chatbot_admin_session
# ADMIN_SESSION_TTL_MS=28800000
```

Security requirements:

- `HttpOnly`, `Secure`, `SameSite=Lax` cookies in production.
- Session rotation on login.
- Audit login success/failure.
- Rate limit login endpoints.
- No token in query params.

### Phase 4: admin write workflows

Goal: introduce small, explicit write actions.

Candidate first write actions:

- Mark order as handled.
- Add internal note.
- Trigger one safe staff notification retry.
- Update limited shop setting in staging first.

Rules:

- Every write action needs a UI confirmation.
- Every write action needs an audit record.
- Every write action needs tests.
- Every write action needs a rollback plan.
- Production write approval must be action-specific.

Avoid initially:

- Delete customer/conversation/order.
- Bulk updates.
- Raw SQL admin tools.
- Editing secrets from the admin UI.

### Phase 5: multi-tenant SaaS foundation

Goal: support multiple pages/shops cleanly.

Schema direction:

- `tenants`
- `tenant_memberships`
- `pages`
- `page_runtime_config`
- `admin_users`
- `admin_user_roles`
- `admin_audit_log`

Existing tables already include `tenant_id` and `page_id`; keep using those
keys. Do not hard-code `TENANT_ID=default` in new business logic.

Required env direction:

```env
# DEFAULT_TENANT_ID=default
# DEFAULT_PAGE_ID=1026325343908119
# MULTITENANT_MODE=false
```

Do not add these env keys until code actually consumes them.

### Phase 6: dedicated frontend

Goal: move from server-rendered admin HTML to a fuller SaaS web app only when
the workflow complexity justifies it.

Do not create a marketing landing page first. The first screen should be the
actual operations dashboard.

Recommended frontend stack when needed:

- Vite + React for admin app, or Next.js if server-side routing/auth is useful.
- API routes remain in the backend or move behind `/api/admin/*`.
- Keep backend authorization as the source of truth.

Migration approach:

1. Keep server-rendered admin pages available.
2. Add API endpoints with tests. Basic read-only dashboard, user detail, and
   audit endpoints are already started; expand them only as workflow needs grow.
3. Build frontend pages against those APIs.
4. Switch links gradually.
5. Remove old server-rendered views only after parity.

### Phase 7: performance and maintainability

Priority improvements:

- Add pagination instead of only fixed limits.
- Add targeted indexes for slow dashboard queries.
- Avoid loading full histories into memory for large tenants.
- Keep dashboard insights read-only and bounded; promote them into dedicated
  repository/service modules if query count or complexity grows.
- Cache product config and static shop config.
- Move reminder and outbox workers into separate worker process if traffic grows.
- Add structured logging without secrets.
- Add request IDs to admin and webhook flows.

Refactor targets:

- Extract dashboard SQL into a repository module.
- Add read-only pagination for dashboard tables when fixed limits become too
  restrictive.
- Keep HTML view helpers pure and testable.
- Keep storage writes behind service functions.

## Definition of done for future phases

A phase is done only when:

- Required env keys are documented in `.env.example`.
- Tests are added or updated.
- `npm test` passes.
- `npm audit --omit=dev` passes.
- Production impact is documented.
- Migration/runbook exists if DB or env changes are involved.
- No secrets or raw customer data are printed in chat/logs.
- Git state is reported.
- The owner is told whether deploy/env/DB/data were touched.

## Recommended next session

Use `docs/next-session-prompt.md` as the handoff prompt for the next Codex
session. The next step is to review the Phase 3 code-only admin login/session
foundation already deployed in code, then set the required production session
env variables after separate approval. Production env changes still need
separate approval in that session.
