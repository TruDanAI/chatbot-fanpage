# Admin Identity Provisioning Design

This is the Phase 3.5 design for moving admin identity from one static
operations token toward real PostgreSQL-backed admin users. It is not approval
to create a production admin user or to change production auth behavior.

## Current bridge

Production already has the additive admin tables:

- `admin_users`: 0 rows.
- `admin_roles`: 4 seeded rows.
- `admin_user_roles`: 0 rows.
- `admin_audit_log`: active and writing admin read/login events.

The current runtime still uses `ADMIN_EXPORT_TOKEN` as the bootstrap secret:

- `Authorization: Bearer <ADMIN_EXPORT_TOKEN>` is kept for automation and smoke
  scripts.
- `/admin/login` validates the submitted token and issues a signed browser
  session cookie.
- Browser sessions inherit the same configured principal id and roles as the
  static token until real user auth is implemented.
- Legacy export/state routes still accept the compatibility admin token path
  through `x-admin-token` or Bearer.

Because of that bridge, a browser session is not yet proof of a per-human admin
identity. Audit readers must treat the actor id as a safe operational principal
unless it comes from a future `admin_users.id` lookup.

## Actor semantics

New audit entries should be interpreted with both `actor_id` and
`metadata.auth_method`:

| Auth path | Target actor id | Auth method | Meaning |
| --- | --- | --- | --- |
| Bearer automation | `automation:admin_export_token` once explicitly configured; currently the configured `ADMIN_PRINCIPAL_ID` or `legacy-admin` fallback | `static_bearer` | Non-human automation or smoke access using `ADMIN_EXPORT_TOKEN`. |
| Browser session, current bridge | configured `ADMIN_PRINCIPAL_ID` or `legacy-admin` fallback | `admin_session` | Human-operated browser access, but still bootstrapped from the static token. |
| Browser session, target state | stable `admin_users.id` such as `admin:owner-primary` | `admin_session` | Real per-admin identity loaded from PostgreSQL. |
| Legacy export/state token | configured `ADMIN_PRINCIPAL_ID` or `legacy-admin` fallback | `static_admin_token` | Compatibility access for legacy export/debug endpoints. |
| Missing/invalid/rate-limited auth | `anonymous` | absent or request-specific metadata | Denied before an authenticated principal exists. |

Recommended production naming once env and auth changes are separately
approved:

- Bearer automation actor: `automation:admin_export_token`.
- Human admin actors: stable `admin:<slug>` ids stored in `admin_users.id`.
- Avoid using raw email addresses as `actor_id`; keep email in
  `admin_users.email` only.

## Provisioning model

The existing schema is sufficient for the first real admin identities:

- `admin_users.id`: stable, non-secret, non-email actor id.
- `admin_users.display_name`: safe display name for operators.
- `admin_users.email`: optional; unique case-insensitively when non-empty.
- `admin_users.status`: `active` or `disabled`.
- `admin_user_roles`: role grants by user id.

Role meaning stays unchanged:

- `viewer`: dashboard and bounded user detail read.
- `support`: viewer plus legacy state read.
- `maintainer`: support plus export and audit read.
- `owner`: full admin access, including future write/admin management gates.

No production admin user should be inserted until the app has a reviewed path
that actually authenticates a browser admin as that `admin_users.id`.

## Provisioning sequence

1. Keep the current static-token bridge while Phase 3.5 completes.
2. Add and test a repository/service that can load an active admin user and
   roles from PostgreSQL without changing production behavior.
3. Add a reviewed login identity mechanism such as magic link, passkey, or a
   separately approved temporary bootstrap flow.
4. Test user creation and login against non-production first.
5. Before any production user insert, create a fresh PostgreSQL backup outside
   the repo and verify counts/SHA256.
6. Insert the first production admin user only after explicit production DB
   write approval in the same session.
7. Verify with count-only checks: `admin_users`, `admin_user_roles`, and audit
   outcome counts. Do not print raw user rows.

Example insert shape for a reviewed script, not a command to run now:

```sql
BEGIN;

INSERT INTO admin_users (id, display_name, email, status)
VALUES ($1, $2, lower($3), 'active')
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    status = EXCLUDED.status,
    updated_at = now();

INSERT INTO admin_user_roles (user_id, role_name, granted_by)
VALUES ($1, $4, $5)
ON CONFLICT (user_id, role_name) DO NOTHING;

COMMIT;
```

## Rollback stance

- Prefer disabling an admin user with `status='disabled'` over deleting it.
- Rotate `SESSION_SECRET` only after separate production env approval if all
  active browser sessions must be invalidated.
- Keep `ADMIN_EXPORT_TOKEN` as a separate automation path until browser
  identity is proven in production.
- Do not remove audit rows. If an audit write path causes trouble, disable the
  writer with `ADMIN_AUDIT_LOG_ENABLED=false` after separate env approval.

## Phase 3.5 exit state

Phase 3.5 is complete when:

- Login rate limiting is deployed and production-smoked.
- This identity provisioning design is in docs.
- Audit actor semantics are documented and new audit entries include a safe
  auth method.
- Production audit stability is observed with count-only checks and no
  unexpected `error` outcomes.
- No production admin user or business write workflow has been created.
