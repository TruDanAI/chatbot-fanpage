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
- Do not use `DATABASE_URL` for schema verification scripts because it may
  point at production; verification must require explicit non-production
  variables such as `CHATBOT_TEST_DATABASE_URL` or
  `CHATBOT_STAGING_DATABASE_URL`.
- Do not delete, truncate, reset, or rewrite production data.
- Do not switch production back to file storage.
- Do not touch production `/data` except read-only inspection.
- Do not run authenticated admin smoke without approval because it writes
  audit rows.
- Do not run authenticated `/admin/api/internal-notes` smoke without approval
  because it writes audit rows.
- Do not create a production internal note without explicit approval because
  it writes business data.
- Do not print customer data, tokens, `DATABASE_URL`, Facebook tokens, Google
  service account values, or Telegram tokens.
- Add every required setup variable to `.env.example` with clear comments.
- Keep migrations additive and idempotent unless a destructive migration has a
  separate rollback plan and explicit approval.

## Current baseline

Last verified baseline from May 12, 2026:

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
- Latest production admin audit count after approved internal-notes read API
  smoke: `admin_audit_log=53`, outcomes `denied=19`, `success=34`.
  The read smoke produced the expected `auditDelta=+1 success`.
- Latest production admin audit count after approved internal-notes POST
  note-create smoke: `admin_audit_log=54`, outcomes `denied=19`,
  `success=35`, `error=0`. The POST smoke created exactly 1 production smoke
  note.
- Latest production admin audit count after approved post-create
  internal-notes GET read smoke: `admin_audit_log=55`, outcomes `denied=19`,
  `success=36`, `error=0`. The GET smoke produced the expected
  `auditDelta=+1 success` and returned `schemaReady=true`, `notes.length=1`.
- Latest verified Railway deployment:
  `71daeacd-015f-4f03-b5fc-b21e72bac1b0 SUCCESS` at commit
  `9f10f24 Add internal notes create API`
- Latest pushed commit:
  `9f10f24 Add internal notes create API`
- Latest git state: clean worktree, `origin/main...HEAD = 0 0`.
- Latest production internal_notes schema apply:
  `db/internal-notes-proposal.sql` has been applied to production PostgreSQL.
- Backup used before internal_notes schema apply/read smoke:
  `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply`
- Backup archive:
  `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply\postgres-base64jsonl.tar.gz`
- Backup SHA256:
  `59CF7048631D86E8F5E5E0CFA5777A0224B41FEB8F09BC79B344F218789E0384`
- Latest local Phase 4 internal notes SQL verification:
  `npm run verify:internal-notes-sql` passed against a local-only Docker
  PostgreSQL container `chatbot-fanpage-internal-notes-pg`, bound to
  `127.0.0.1:55432 -> 5432`. The verifier used
  `CHATBOT_TEST_DATABASE_URL` only inside the PowerShell verifier process,
  removed `DATABASE_URL` from that process, created an isolated schema, applied
  `db/internal-notes-proposal.sql` twice, verified table, columns, indexes, and
  CHECK constraints, dropped the isolated schema, and left 0 remaining
  `internal_notes_verify_%` schemas.
- Latest Phase 4 internal notes test coverage baseline:
  tests cover validation, RBAC, transaction/audit fail-closed behavior, static
  SQL checks, verifier guardrails, and read model behavior.
- `GET /admin/api/internal-notes` read API is implemented and deployed.
- Production `internal_notes` schema verification passed: table exists,
  pre-create `internal_notes` count was 0, expected indexes exist, and
  expected CHECK constraints exist.
- Authenticated production `GET /admin/api/internal-notes` read smoke passed:
  HTTP 200, `schemaReady=true`, `notes=[]`, pagination present, and no raw DB
  error indicators. The smoke used an existing customer `sender_id` from
  `profiles` without printing it.
- Authenticated production `POST /admin/api/internal-notes` note-create smoke
  passed: HTTP 201, safe response shape, note id present, `body_length`
  present, no note body returned, no raw customer/order/message data, no raw DB
  error, and no target id/token/DB URL printed. It created exactly 1 production
  smoke note.
- Authenticated production post-create `GET /admin/api/internal-notes` read
  smoke passed: HTTP 200, `schemaReady=true`, `notes.length=1`, pagination
  present, safe note fields only, no raw customer/order/message data, no DB
  error, and no target id/token/DB URL printed.
- Production `internal_notes` count is now 1.
- The smoke note still exists and was not hidden/deleted.
- No production environment change was made.
- Production DB writes in this baseline were limited to the additive
  `internal_notes` schema apply, one production smoke note, and the expected
  audit success rows from the approved internal-notes smokes.
- No deploy, schema apply, or production `/data` touch occurred during the
  POST/GET smoke session.
- Production `/data` was not touched.
- Previous verified Railway deployment:
  `06f98cbf-c6f8-4eae-b6e1-f63367b2d2e9 SUCCESS` at commit
  `834c157 Add internal notes read API`
- Previous verified Railway deployment:
  `c220b138-ff42-4630-a0db-4404e4b39370 SUCCESS` at commit
  `1a8f8d7 Add internal notes read model`
- Previous verified Railway deployment:
  `39f5f647-9815-4b70-8891-9a612b8b8444 SUCCESS` at commit
  `d138144 Add internal notes SQL proposal checks`
- Previous verified Railway deployment:
  `c2f57a04-9040-4dc4-8d1e-bdc0cb066429 SUCCESS` at commit
  `5989b2e Complete Phase 3.5 identity audit design`
- Earlier verified Railway deployment:
  `0d92944b-4aa7-4a84-bdfe-836d01ac2e93 SUCCESS` at commit
  `2841e69 Update handoff docs after login rate limit deploy`
- Latest verified code deployment:
  `9f10f24 Add internal notes create API`
- Latest verified code Railway deployment:
  `71daeacd-015f-4f03-b5fc-b21e72bac1b0 SUCCESS` at commit
  `9f10f24 Add internal notes create API`
- Previous verified code deployment:
  `834c157 Add internal notes read API`
- Previous verified code Railway deployment:
  `06f98cbf-c6f8-4eae-b6e1-f63367b2d2e9 SUCCESS` at commit
  `834c157 Add internal notes read API`
- Previous verified code deployment:
  `1a8f8d7 Add internal notes read model`
- Previous verified code Railway deployment:
  `c220b138-ff42-4630-a0db-4404e4b39370 SUCCESS` at commit
  `1a8f8d7 Add internal notes read model`
- Previous verified code deployment:
  `d138144 Add internal notes SQL proposal checks`
- Previous verified code Railway deployment:
  `39f5f647-9815-4b70-8891-9a612b8b8444 SUCCESS` at commit
  `d138144 Add internal notes SQL proposal checks`
- Previous verified code deployment:
  `31bcf1f Add admin login rate limit`
- Previous verified code Railway deployment:
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
  `5989b2e Complete Phase 3.5 identity audit design`,
  `d138144 Add internal notes SQL proposal checks`,
  `1a8f8d7 Add internal notes read model`,
  `834c157 Add internal notes read API`,
  `d6e8cb9 Add internal notes production rollout runbook`,
  `9f10f24 Add internal notes create API`
- Phase 4 internal notes current status:
  design doc exists in `docs/phase-4-internal-notes-design.md`;
  SQL proposal exists in `db/internal-notes-proposal.sql`;
  safe SQL verifier exists via `npm run verify:internal-notes-sql`;
  live local PostgreSQL SQL verification passed in an isolated schema using
  `CHATBOT_TEST_DATABASE_URL`;
  create service exists local-only in `core/admin/internal-notes.js`;
  read/list model exists local-only in `core/admin/internal-notes.js`;
  `GET /admin/api/internal-notes` read API is implemented and deployed;
  `POST /admin/api/internal-notes` create API is implemented and deployed;
  production `internal_notes` schema is applied and verified;
  authenticated production POST note-create smoke passed and created exactly 1
  production smoke note;
  authenticated production post-create GET read smoke passed with
  `schemaReady=true`, `notes.length=1`, pagination present, and
  `auditDelta=+1 success`;
  production `internal_notes` count is now 1;
  latest known `admin_audit_log` is 55, outcomes `denied=19`, `success=36`,
  `error=0`;
  tests cover validation, RBAC, transaction/audit fail-closed behavior, static
  SQL checks, verifier guardrails, and read model behavior in
  `tests/admin-internal-notes.test.js`; there is no UI form/list yet; UI/list
  and form integration remains future work. The smoke note still exists and was
  not hidden/deleted.
- Latest known backup: `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply`
- Latest known backup archive:
  `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply\postgres-base64jsonl.tar.gz`
- Latest known backup SHA256:
  `59CF7048631D86E8F5E5E0CFA5777A0224B41FEB8F09BC79B344F218789E0384`
- Previous backup counts: profiles 1, conversations 4, messages 53, orders 6,
  order_items 7, events 249, processed_mids 94, admin_users 0,
  admin_roles 4, admin_user_roles 0, admin_audit_log 38
- Latest count-only internal_notes/audit check after POST + post-create GET
  smokes:
  internal_notes 1; admin_audit_log 55, outcomes denied 19, success 36,
  error 0.

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

Current internal-notes status:

- Design doc exists: `docs/phase-4-internal-notes-design.md`.
- SQL proposal exists: `db/internal-notes-proposal.sql`.
- Safe SQL verifier exists via `npm run verify:internal-notes-sql`.
- Local create service exists: `core/admin/internal-notes.js`.
- Local read/list model exists: `core/admin/internal-notes.js`.
- `GET /admin/api/internal-notes` read API is implemented and deployed.
- `POST /admin/api/internal-notes` create API is implemented and deployed.
- Production `internal_notes` schema is applied and verified.
- Authenticated production read API smoke passed with HTTP 200,
  `schemaReady=true`, `notes=[]`, pagination present, and
  `auditDelta=+1 success`.
- Authenticated production POST note-create smoke passed with HTTP 201 and a
  safe response shape. It created exactly 1 production smoke note.
- Authenticated production post-create GET read smoke passed with HTTP 200,
  `schemaReady=true`, `notes.length=1`, pagination present, safe note fields
  only, no raw customer/order/message data, and no DB error.
- Production `internal_notes` count is now 1.
- Latest known audit count after GET smoke: `admin_audit_log=55`, outcomes
  `success=36`, `denied=19`, `error=0`.
- The smoke note still exists and was not hidden/deleted.
- No env change, deploy, schema apply, or production `/data` touch occurred
  during the POST/GET smoke session.
- Tests exist for validation, RBAC, transaction/audit fail-closed behavior,
  static SQL checks, verifier guardrails, and read model behavior.
- Live local PostgreSQL SQL verification passed using the existing verifier:
  local Docker container `chatbot-fanpage-internal-notes-pg`, bound to
  `127.0.0.1:55432 -> 5432`; `CHATBOT_TEST_DATABASE_URL` was set only inside
  the verifier PowerShell process; `DATABASE_URL` was removed from that
  process; the proposal was applied twice inside an isolated schema; table,
  columns, indexes, and CHECK constraints were verified; the isolated schema
  was dropped; 0 `internal_notes_verify_%` schemas remained.
- No UI form/list exists.
- Phase 4 v1 backend/API is complete.
- UI/list/form integration remains future work.

Candidate first write actions:

- Add internal note.
- Mark order as handled.
- Trigger one safe staff notification retry.
- Update limited shop setting in staging first.

Recommended next task:

- Plan and implement UI/list/form integration only after separate approval.
- Any further deploy or production smoke still needs separate approval.
  Authenticated read smoke writes audit rows, and create-note smoke writes
  business data.
- Keep using explicit non-production variables such as
  `CHATBOT_TEST_DATABASE_URL` or `CHATBOT_STAGING_DATABASE_URL` for verification;
  do not use `DATABASE_URL` for schema verification.

Rules:

- Every write action needs a UI confirmation.
- Every write action needs an audit record.
- Every write action needs tests.
- Every write action needs a rollback plan.
- Production write approval must be action-specific.
- Do not re-apply or mutate the production `internal_notes` schema without a
  fresh backup and separate approval.
- Do not run authenticated production admin smoke without approval because it
  writes audit rows.
- Do not run authenticated `/admin/api/internal-notes` smoke without approval
  because it writes audit rows.
- Do not create a production internal note without explicit approval because it
  writes business data.
- Do not hide/delete the production smoke note without explicit approval.

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
session. Phase 4 internal notes now has a design doc, SQL proposal, local
create service, local read/list model, deployed GET+POST API, safe SQL
verifier, focused tests, and a passing live local PostgreSQL SQL verification
against an isolated schema. Production `internal_notes` schema is applied and
verified; production POST note-create smoke passed and created exactly 1 smoke
note; post-create GET read smoke passed with `schemaReady=true`,
`notes.length=1`, pagination present, and `auditDelta=+1 success`. Latest known
counts are `internal_notes=1` and `admin_audit_log=55` with `success=36`,
`denied=19`, `error=0`. The smoke note still exists and was not hidden/deleted.
There is still no UI form/list; UI/list/form integration remains future work.
