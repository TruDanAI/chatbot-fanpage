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

Last verified baseline from May 10, 2026:

- Production Railway project: `graceful-harmony`
- Production service: `chatbot-fanpage`
- Production Postgres service: `Postgres-TQuc`
- Production storage: PostgreSQL
- Production runtime health: `ok=true`, `storage.adapter=postgres`,
  `storage.ready=true`, `messenger.dryRun=false`
- Latest deployed commit at that time:
  `5851368 Update handoff docs after admin refactor deploy`
- Latest Railway production deployment at that time:
  `7d0d93fb-4537-4849-a765-0f0c9c37a1fb SUCCESS`
- Phase commits already pushed:
  `e14692c Add admin RBAC audit scaffolding`,
  `a28c0e5 Add SaaS roadmap and handoff prompt`,
  `c9ff1df Handle missing audit schema gracefully`,
  `b90c5de Update handoff docs after production deploy`,
  `20676a3 Refactor admin dashboard modules`,
  `5851368 Update handoff docs after admin refactor deploy`
- Latest known backup: `C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260510-154120`
- Latest known backup SHA256:
  `0F8772912394868B41BC246B196F6C2183D1CC361302293703A2C3A0C7E497C4`
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

Status: mostly done.

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
- Production smoke checks for `/admin/dashboard` and `/admin/audit` passed
  after the refactor deploy.

Remaining:

- Apply audit schema after fresh backup and approval.
- Enable `ADMIN_AUDIT_LOG_ENABLED=true` after schema verification.
- Keep smoke checks for `/admin/dashboard` and `/admin/audit` after each
  future deploy.

### Phase 2: production audit rollout

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

### Phase 3: admin login/session

Goal: replace manual Bearer-header usage for the dashboard with a usable browser
login flow.

Recommended approach:

- Add secure cookie sessions.
- Keep `Authorization: Bearer` support for automation.
- Store admin users and roles in PostgreSQL.
- Add passwordless magic link or passkey later; avoid rolling custom password
  auth too early unless there is a clear operational need.

Required env keys to add when implemented:

```env
# SESSION_SECRET=change_me_to_64_plus_random_chars
# ADMIN_PUBLIC_BASE_URL=https://your-admin-domain.example
# ADMIN_SESSION_COOKIE_NAME=chatbot_admin_session
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
2. Add API endpoints with tests.
3. Build frontend pages against those APIs.
4. Switch links gradually.
5. Remove old server-rendered views only after parity.

### Phase 7: performance and maintainability

Priority improvements:

- Add pagination instead of only fixed limits.
- Add targeted indexes for slow dashboard queries.
- Avoid loading full histories into memory for large tenants.
- Cache product config and static shop config.
- Move reminder and outbox workers into separate worker process if traffic grows.
- Add structured logging without secrets.
- Add request IDs to admin and webhook flows.

Refactor targets:

- Continue shrinking `core/admin-routes.js` by extracting route auth/wiring
  helpers when the next admin slice needs it.
- Extract dashboard SQL into a repository module.
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
session. Update that prompt if production state changes before the next phase.
