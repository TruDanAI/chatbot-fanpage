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
- Latest production admin audit count after approved login/session smoke and
  token rotation: `admin_audit_log=34`, outcomes `denied=8`, `success=26`.
- Latest production admin audit count after approved pagination smoke:
  `admin_audit_log=38`, outcomes `denied=8`, `success=30`.
- Latest production admin audit count after approved login rate-limit smoke:
  `admin_audit_log=52`, outcomes `denied=19`, `success=33`, `error=0`.
  The rate-limit smoke produced the expected `auditDelta=14` from the fresh
  pre-smoke backup count.
- Latest verified Railway deployment:
  `c2f57a04-9040-4dc4-8d1e-bdc0cb066429 SUCCESS` at commit
  `5989b2e Complete Phase 3.5 identity audit design`
- Previous verified Railway deployment:
  `0d92944b-4aa7-4a84-bdfe-836d01ac2e93 SUCCESS` at commit
  `2841e69 Update handoff docs after login rate limit deploy`
- Latest verified code deployment at that time:
  `31bcf1f Add admin login rate limit`
- Latest verified code Railway deployment:
  `ca5e0770-34bd-40e7-a7a5-61998c06768e SUCCESS` at commit
  `31bcf1f Add admin login rate limit`
- Previous verified code deployment:
  `5e2748b Add admin read pagination`
- Previous verified code Railway deployment:
  `84899ffb-858a-4cec-85fc-bf7d73083359 SUCCESS` at commit
  `5e2748b Add admin read pagination`
- Earlier verified code deployment:
  `0c30a9a Extract admin dashboard repository`
- Previous verified code Railway deployment:
  `85084c38-40a2-44ef-acc1-882035dc89cb SUCCESS` at commit
  `0c30a9a Extract admin dashboard repository`
- Latest verified Railway deployment after token-rotation handoff docs:
  `f8faaaf0-69c2-4988-abc5-cfd13b72bd48 SUCCESS` at commit
  `3c45166 Update handoff docs after token rotation`
- Latest verified Railway deployment after `ADMIN_EXPORT_TOKEN` rotation:
  `255aacfd-1f58-4697-ba1f-378a65ec1f7a SUCCESS` at commit
  `0ac16bf Update handoff docs after repository deploy`
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
  `8baa178 Add admin session login flow`,
  `46ca2d3 Update handoff docs after session deploy`,
  `affaf4b Add admin ops insights API`,
  `8cccc0c Update handoff docs after ops insights deploy`,
  `0c30a9a Extract admin dashboard repository`,
  `0ac16bf Update handoff docs after repository deploy`,
  `3c45166 Update handoff docs after token rotation`,
  `5e2748b Add admin read pagination`,
  `1c35127 Update handoff docs after pagination smoke`,
  `31bcf1f Add admin login rate limit`,
  `2841e69 Update handoff docs after login rate limit deploy`,
  `5989b2e Complete Phase 3.5 identity audit design`
- Latest known backup: `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-180314-postgres-login-rate-smoke`
- Latest known backup SHA256:
  `06828A6B579FA434DD48C7153668E4CB5F3FA7326139095E4097D0BFEAB8DA85`
- Latest backup counts: profiles 1, conversations 4, messages 53, orders 6,
  order_items 7, events 249, processed_mids 94, admin_users 0,
  admin_roles 4, admin_user_roles 0, admin_audit_log 38
- Latest count-only audit stability check after rate-limit smoke:
  admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 52,
  outcomes denied 19, success 33, error 0.

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
- Admin dashboard SQL repository in `core/admin/dashboard-repository.js`.
- Admin PostgreSQL reader/service wrapper in `core/admin/reader.js`.
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
- Dashboard SQL extracted into `core/admin/dashboard-repository.js`, with
  `core/admin/reader.js` keeping filter normalization, limit config,
  PostgreSQL connection lifecycle, and the read-only SQL guard.
- Read-only bounded pagination added for dashboard overview tables and audit
  log in the HTML screens and JSON API. Dashboard sections use independent page
  params for orders, conversations, and events. This was deployed in
  `5e2748b Add admin read pagination` and authenticated pagination smoke passed
  after a fresh backup.
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

Status: production smoke complete as of May 11, 2026. Browser login, session
cookie dashboard/audit access, Bearer automation access, and
`ADMIN_EXPORT_TOKEN` rotation were verified after a fresh PostgreSQL backup and
separate approval.

Goal: replace manual Bearer-header usage for the dashboard with a usable browser
login flow.

Recommended approach:

- Add secure cookie sessions. Initial implementation signs stateless
  HttpOnly/SameSite=Lax cookies and rotates the session token on login.
- Keep `Authorization: Bearer` support for automation.
- `ADMIN_EXPORT_TOKEN` was rotated after browser login smoke; do not print the
  token value in handoffs or logs.
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

### Phase 3.5: identity and login hardening

Status: done for the pre-write design gate as of May 11, 2026. Login rate
limiting is implemented, tested, pushed, deployed, and production-smoked after
a fresh backup. PostgreSQL identity provisioning and audit actor semantics are
documented, but no production admin user has been created.

Goal: make admin identity safer and more traceable before the system allows
operational writes.

Recommended steps:

- Add a small login rate limiter for `/admin/login` with tests. Done in
  `31bcf1f Add admin login rate limit`; it is local memory per process unless
  multi-instance behavior becomes a real production issue.
- Design PostgreSQL-backed admin user provisioning without creating production
  users until there is a rollback plan and separate approval. Done in
  `docs/admin-identity-provisioning.md`.
- Decide how static `ADMIN_EXPORT_TOKEN` maps to an actor while browser
  sessions continue to use the current token-based login. Done in
  `docs/admin-identity-provisioning.md`: Bearer automation should become the
  non-human `automation:admin_export_token` actor when explicitly configured,
  while browser sessions move to real `admin_users.id` actors after identity is
  implemented.
- Keep Bearer automation support, but document actor identity and audit
  semantics clearly. New audit entries include safe `metadata.auth_method`.
- Re-check production audit counts and outcome breakdown using count-only
  queries before enabling any write action. Latest count-only check after
  rate-limit smoke showed `admin_audit_log=52`, outcomes `denied=19`,
  `success=33`, and `error=0`.

Exit criteria before Phase 4:

- Login rate limit is implemented and tested.
- Admin user provisioning design is documented.
- Production audit logging has been observed without unexpected `error`
  outcomes.
- No new production write workflow exists yet.

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

- Keep replacing fixed limits with bounded read-only pagination.
- Extend pagination to user detail timelines if fixed detail limits become too
  restrictive.
- Add targeted indexes for slow dashboard queries.
- Avoid loading full histories into memory for large tenants.
- Keep dashboard insights read-only and bounded; promote them into dedicated
  repository/service modules if query count or complexity grows.
- Cache product config and static shop config.
- Move reminder and outbox workers into separate worker process if traffic grows.
- Add structured logging without secrets.
- Add request IDs to admin and webhook flows.

Refactor targets:

- Extend pagination to user detail timelines if fixed detail limits become too
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
session. Phase 3.5 is now a completed pre-write design gate. The next step is
to design the first Phase 4 write workflow on paper first, then implement only
after there is a separate backup plan, tests, rollback stance, and explicit
production approval for any write.
