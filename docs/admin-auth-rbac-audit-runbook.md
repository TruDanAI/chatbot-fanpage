# Admin auth/RBAC/audit production migration runbook

This runbook is for the future production rollout of
`db/admin-auth-rbac-audit-proposal.sql`. It is not approval to run it.

Hard rules:

- Do not deploy unless the owner approves deploy in the same work session.
- Do not change production environment variables unless separately approved.
- Do not write production PostgreSQL until the owner explicitly approves the
  production migration.
- Do not touch production `/data` except read-only checks.
- Do not print tokens, `DATABASE_URL`, Facebook tokens, Google service account
  values, Telegram tokens, or raw customer data.

## Model

Roles:

- `viewer`: read dashboard and bounded user detail.
- `support`: viewer plus legacy user state read.
- `maintainer`: support plus export and audit read.
- `owner`: full admin access, including future write/admin management.

Write permissions are present only as future gates. They must not be connected
to production write routes until the write workflow has its own design,
confirmation UI, tests, and owner approval.

Audit records store actor, action, resource, outcome, tenant/page, request id,
hashed IP, user agent, and redacted JSON metadata. They must not store raw
tokens, database URLs, full phone numbers, addresses, or customer export rows.

## Runtime routes and frontend

Admin screens are server-rendered in `core/admin-routes.js`; there is no
separate frontend app.

Routes:

- `/admin/dashboard` and `/admin/db`: dashboard read.
- `/admin/dashboard/users/:senderId`: bounded user detail read.
- `/admin/audit`: audit log read.

Dashboard and audit screens require `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`.
Legacy export/debug routes keep existing header compatibility until a dedicated
login/session flow is designed.

Runtime env knobs:

- `ADMIN_ROLES`: comma-separated role list for the current static-token
  principal. Defaults to `owner` for backwards compatibility.
- `ADMIN_PRINCIPAL_ID`: safe actor id used in audit entries. Defaults to
  `legacy-admin`.
- `ADMIN_PRINCIPAL_DISPLAY_NAME`: optional safe display name.
- `ADMIN_AUDIT_LOG_ENABLED`: must be `true` before PostgreSQL audit writes are
  attempted. Leave unset/false until the audit schema exists in production.

## Preconditions

1. Git worktree is clean or all local changes are intentionally reviewed.
2. Latest production deployment and `/healthz` are healthy.
3. A fresh production PostgreSQL backup exists outside the repo.
4. The SQL proposal has been applied successfully to local/dev/staging first.
5. The app code has been tested with audit writes disabled and enabled against
   a non-production database.
6. `npm test` and `npm audit --omit=dev` pass.
7. The owner approves the exact production write window.

## Dry run review

Review the SQL locally:

```powershell
Get-Content db\admin-auth-rbac-audit-proposal.sql
```

Confirm it is additive only:

- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `INSERT ... ON CONFLICT DO NOTHING`
- no `DROP`, `TRUNCATE`, `DELETE`, destructive `ALTER`, or existing table rewrite

## Dev/staging apply

Apply only to a non-production database first. Use the environment and service
names for that non-production target.

```powershell
# Example shape only. Do not run against production here.
railway run --service Postgres-TQuc --environment staging --no-local psql -v ON_ERROR_STOP=1 -f db\admin-auth-rbac-audit-proposal.sql
```

Then verify table presence and role seed counts without printing secrets or
customer rows.

## Production apply

Production apply requires a separate explicit approval in the same session.
Before applying:

```powershell
git status --short --untracked-files=all
git rev-list --left-right --count origin/main...HEAD
railway deployment list --environment production --service chatbot-fanpage --limit 1 --json
```

Create and verify a fresh PostgreSQL backup outside the repo. Record folder,
counts, and SHA256.

Only after explicit approval, run the reviewed SQL once against production.
The command must not echo `DATABASE_URL`.

Do not set `ADMIN_AUDIT_LOG_ENABLED=true` until the production schema apply and
read-only verification have passed. Setting that variable is a production env
change and needs separate approval.

## Post-apply checks

Run read-only verification:

- `SELECT COUNT(*)` from `admin_users`, `admin_roles`,
  `admin_user_roles`, and `admin_audit_log`.
- `/healthz` still returns `ok=true`, `storage.adapter=postgres`,
  `storage.ready=true`.
- `/admin/audit` renders with a Bearer token and does not expose raw metadata.
- `npm test` and `npm audit --omit=dev` still pass locally.

No admin user should be added to production until identity provisioning and
token/session rotation are separately reviewed.

## Rollback stance

This proposal is additive, so normal rollback is to leave the empty admin
tables in place and disable any app code that references them. Dropping tables
in production is destructive and requires a separate backup, restore plan, and
explicit approval.
