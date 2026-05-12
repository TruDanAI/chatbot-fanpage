# Phase 4 Internal Notes Production Schema Rollout

This is a production rollout plan for applying
`db/internal-notes-proposal.sql`. It is not approval to apply the schema, run
authenticated production smoke, deploy code, change environment variables,
write production business data, create production admin users, or touch
production `/data`.

## Scope

The only schema change in scope for a future approved rollout is:

- apply `db/internal-notes-proposal.sql` to production PostgreSQL.

The current deployed code already handles missing production `internal_notes`
schema safely for `GET /admin/api/internal-notes` by returning
`schemaReady=false` and `notes=[]`. The authenticated route must still not be
smoked without approval because admin read routes write audit rows.

## Preconditions

Before requesting any production backup or schema apply approval, re-check and
record:

- `git status --short --untracked-files=all` shows a clean worktree.
- `git rev-list --left-right --count origin/main...HEAD` is `0 0`.
- Latest Railway production deployment for service `chatbot-fanpage` is
  verified as `SUCCESS`.
- Public `GET /healthz` returns HTTP 200 with safe metadata:
  `ok=true`, `storage.adapter=postgres`, `storage.ready=true`, and
  `messenger.dryRun=false`.
- Public `GET /admin/login` returns HTTP 200 and the Admin Login form is
  present.
- `npm test` passes locally.
- `npm audit --omit=dev` passes locally.
- The local live SQL verifier has already passed against an explicit
  non-production PostgreSQL URL:
  `npm run verify:internal-notes-sql`.
- No authenticated production smoke has been run without approval.

Known baseline at the time this runbook was written:

- Latest commit: `6bba618 Update handoff after internal notes read API deploy`
- Latest verified Railway deployment:
  `aa566ba9-b01b-4eec-8d64-862195e55266 SUCCESS`
- Public `/healthz`: HTTP 200, `ok=true`, `storage.adapter=postgres`,
  `storage.ready=true`, `messenger.dryRun=false`
- Public `GET /admin/login`: HTTP 200, Admin Login form present
- Git clean, `origin/main...HEAD = 0 0`
- No authenticated production smoke, production `/admin/api/internal-notes`
  call, production schema apply, production env change, production DB write, or
  production `/data` touch after that deployment

Treat this baseline as a snapshot only. Re-check it in the rollout session.

## Approval Gates

Use separate owner approvals for each production-impacting step:

1. Production PostgreSQL backup approval.
2. Production `internal_notes` schema apply approval.
3. Authenticated `GET /admin/api/internal-notes` smoke approval because it
   writes `admin_audit_log` rows.
4. Future `POST` note-create smoke approval because it writes business data to
   `internal_notes`.

Approval for one gate does not imply approval for any later gate.

## Backup Requirement

Before any production schema apply, create a fresh production PostgreSQL backup
outside this repository.

Requirements:

- Store the backup outside the repo, for example under
  `C:\Users\Pc\Desktop\chatbot-fanpage-backups\...`.
- Use the production PostgreSQL connection safely without printing
  `DATABASE_URL` or any secret.
- Verify and record a SHA256 hash for the backup artifact.
- Verify count-only summaries for production tables.
- Include count-only coverage for existing core tables and admin tables, and
  include `internal_notes` only if it already exists.
- Do not print raw customer, order, message, or note rows.
- Do not print phone numbers, addresses, note bodies, tokens, cookies,
  service-account values, `DATABASE_URL`, or any other secret.

The backup step is read-only. If backup creation requires any write,
destructive operation, env change, deploy, or production `/data` access, stop
and request a new explicit approval.

## Schema Safety Review

Before applying the schema, re-open and review
`db/internal-notes-proposal.sql`.

Confirm:

- The SQL is additive and idempotent.
- It contains only:
  - `CREATE TABLE IF NOT EXISTS internal_notes`
  - `CREATE INDEX IF NOT EXISTS internal_notes_target_time_idx`
  - `CREATE INDEX IF NOT EXISTS internal_notes_status_time_idx`
- It contains no `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`, or
  destructive `ALTER`.
- It does not modify any existing table.
- The table includes the expected CHECK constraints:
  non-empty `tenant_id`, non-empty `page_id`, target type limited to
  `order`, `conversation`, or `customer`, non-empty `target_id`, non-empty
  `body`, body length at most 2000 characters, and status limited to
  `visible` or `hidden`.
- The proposal was verified locally with an isolated schema using
  `CHATBOT_TEST_DATABASE_URL` or `CHATBOT_STAGING_DATABASE_URL`; do not use
  `DATABASE_URL` for local/staging verification.

## Apply Steps

Only after the backup and schema apply approvals are both explicit:

1. Re-confirm the backup path, SHA256, and count-only summaries.
2. Re-confirm the exact SQL file path: `db/internal-notes-proposal.sql`.
3. Connect to production PostgreSQL without printing the connection URL.
4. Apply only `db/internal-notes-proposal.sql`.
5. Do not modify any other schema.
6. Do not change production environment variables.
7. Do not deploy during schema apply unless deployment has separate approval.
8. Do not run authenticated admin routes as part of schema apply.

If any command would echo the database URL, raw rows, secrets, or customer data,
stop and replace it with a non-printing or count-only path.

## Verification After Apply

Run count-only and metadata-only checks first. Do not print raw rows.

Verify:

- `internal_notes` table exists.
- `SELECT count(*) FROM internal_notes` returns `0` initially.
- Expected indexes exist:
  `internal_notes_target_time_idx` and
  `internal_notes_status_time_idx`.
- Expected CHECK constraints exist.
- No other schema changes were made intentionally.

After separate approval, run a safe authenticated read API smoke:

```text
GET /admin/api/internal-notes?target_type=customer&target_id=<safe masked or synthetic target>
```

Expected response shape:

- HTTP 200
- `schemaReady=true`
- `notes=[]`
- `pagination` is present and bounded

This read smoke writes an `admin_audit_log` row. Verify only count/outcome
delta for `admin_audit_log`; do not print raw audit rows or metadata rows.

Do not run future `POST` note-create smoke without separate explicit approval,
because it writes business data to `internal_notes`.

## Rollback Stance

The default rollback stance is non-destructive:

- The additive `internal_notes` schema can stay if the feature remains disabled
  or unused.
- Do not drop `internal_notes` unless there is a separate destructive rollback
  plan, a fresh backup, and explicit approval.
- If an app issue appears, redeploy the previous known-good commit; the schema
  can remain unused.
- If the read API issue appears, avoid authenticated route smoke and patch code
  separately.
- Do not delete internal notes or audit rows as a rollback shortcut.

## What Not To Do

Do not do any of the following during this rollout unless a later approved plan
explicitly changes scope:

- Do not add a `POST` route.
- Do not add a UI form.
- Do not create production internal notes.
- Do not create production admin users.
- Do not change production environment variables.
- Do not deploy.
- Do not push.
- Do not touch production `/data`.
- Do not run authenticated production smoke without approval.
- Do not print raw customer, order, message, note, or audit rows.
- Do not print `DATABASE_URL`, tokens, cookies, service-account values, or
  other secrets.

## Completion Report Template

At the end of a future approved rollout session, report:

- Backup path, SHA256, and count-only summaries.
- Whether production schema was applied.
- Exact SQL file applied.
- Count-only verification results for `internal_notes`.
- Whether authenticated read API smoke was approved and run.
- `admin_audit_log` count/outcome delta only.
- Whether any deploy, env change, production DB write, production `/data`
  touch, or production business-data write occurred.
- Git state.
- Remaining risks and next approval needed.
