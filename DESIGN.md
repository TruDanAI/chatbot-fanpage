# Chatbot Fanpage Admin Design

## Product Shape

This product is an internal operations dashboard for a Messenger sales bot.
The dashboard is for staff and maintainers, not customers. It should feel
quiet, dense, reliable, and built for repeated daily use.

Primary jobs:

- Check production storage health and row counts.
- Review recent orders, conversations, and events.
- Open a limited customer detail view.
- Diagnose bot behavior without exposing raw customer data.
- Keep every dashboard screen read-only until write workflows are explicitly
  designed and approved.

Non-goals:

- No marketing layout.
- No hero section.
- No decorative illustration.
- No broad customer CRM features until access control, audit logging, and data
  handling rules are upgraded.

## Principles

- Safety first: never render secrets, tokens, database URLs, raw addresses, or
  full phone numbers.
- Read-only by default: dashboards may query data, but controls must not imply
  editing, deletion, retrying, or state changes.
- Dense but calm: prefer tables, compact metrics, and clear status labels.
- Fast scanning: align timestamps, status, product code, sender, and counts in
  predictable columns.
- Narrow detail: customer detail screens should show only recent, bounded data.
- Operational language: use direct labels such as Orders, Conversations,
  Recent Events, Sender, Status, Product, Updated.

## Visual Tokens

Use these values for admin screens unless a future design system replaces them.

Colors:

- Page background: `#f7f8fb`
- Surface: `#ffffff`
- Surface muted: `#f1f5f9`
- Border: `#d8e0ea`
- Text: `#17202a`
- Muted text: `#64748b`
- Primary: `#0f766e`
- Primary dark: `#115e59`
- Link: `#2563eb`
- Warning: `#b45309`
- Success: `#15803d`
- Danger: `#b91c1c`
- Neutral badge: `#475569`

Typography:

- Font stack: Arial, sans-serif.
- Page title: 24px, 700 weight.
- Section title: 18px, 700 weight.
- Body/table text: 14px.
- Metadata text: 13px.
- Column headings: 12px, uppercase, letter spacing 0.

Spacing:

- Page max width: 1180px.
- Page padding: 16px to 24px.
- Section gap: 24px.
- Table cell padding: 9px 10px.
- Metric padding: 12px.
- Radius: 8px or less.

## Components

Header:

- Full-width primary band.
- Contains a short screen title and optional metadata.
- Do not place the main experience in a card.

Metric strip:

- Compact grid of count tiles.
- Tile label is small muted text.
- Tile number is 22px, bold.
- Use only for aggregate counts, not actions.

Tables:

- Use tables for orders, conversations, events, messages, and items.
- Header row uses muted surface background.
- Rows should not shift size on hover.
- Links should use the Link token and remain text-only.

Filters:

- Use compact form controls above the metric strip.
- Allow only low-risk operational filters: sender id, order status, product
  code, event type, and row limit.
- Do not provide phone or address filters because those values would be easy to
  place into URLs, logs, screenshots, or browser history.
- Filters must remain read-only and parameterized at the database layer.

Status badge:

- Compact inline label with 999px radius.
- `confirmed` and ready states use Success.
- `cancelled`, failed, or error states use Danger.
- `abandoned` uses Warning.
- Draft/unknown states use Neutral.

Empty state:

- Plain bordered surface with concise text.
- No illustration.

## Data Privacy Rules

List views:

- Mask phone numbers. Show only the last two digits.
- Replace non-empty addresses with `[masked-address]`.
- Truncate free text to short snippets.
- Remove phone/address patterns from event and message snippets.

Detail views:

- Keep the same phone/address masking.
- Show only bounded recent orders, messages, and events.
- Do not render raw JSON columns by default.
- Do not render Facebook page tokens, app secrets, database URLs, Google service
  account values, Telegram tokens, or customer export files inline.

Auth:

- Dashboard routes must only accept `Authorization: Bearer <token>`.
- Do not accept dashboard tokens through query params.
- Existing export/debug routes may keep their current compatibility until they
  are redesigned separately.

## Screens

Admin Dashboard:

- Route: `/admin/dashboard` and `/admin/db`.
- Top metadata: tenant, page, list limit, active filter count.
- Filters: sender id, order status, product code, event type, row limit.
- Metric strip: profiles, conversations, messages, orders, order_items, events,
  processed_mids.
- Tables: Orders, Conversations, Recent Events.
- Sender links open the detail screen.

User Detail:

- Route: `/admin/dashboard/users/:senderId`.
- Back link to dashboard.
- Profile/conversation summary.
- Recent orders with masked customer fields.
- Recent messages and events with masked snippets.

Admin Audit Log:

- Route: `/admin/audit`.
- Requires the audit read permission.
- Shows time, actor, roles, action, resource, outcome, request id, and user
  agent only.
- Does not render raw audit metadata by default.

## Future Direction

Before adding write workflows, add:

- Per-user admin authentication.
- Role-based permissions.
- Audit log for every admin action.
- Explicit confirmation flows.
- Production backup and rollback checklist for each write feature.

## Admin Auth/RBAC/Audit Proposal

This phase wires local RBAC/audit helpers into admin routes, but production
deployment and production schema apply remain separate approvals. Do not apply
the schema proposal to production until there is a fresh PostgreSQL backup,
non-production apply proof, passing tests, and explicit owner approval for
production writes.

Auth model:

- Dashboard/admin routes should use `Authorization: Bearer <token>` only.
- Tokens must never be accepted through query parameters.
- Runtime principals should contain only safe metadata: admin id, display name,
  roles, permissions, tenant id, page id, and auth method.
- Static bearer auth can bridge the current single-token setup, but the next
  production design should move to per-user identities and token/session
  rotation.
- The current compatibility principal is configured by `ADMIN_PRINCIPAL_ID`,
  `ADMIN_PRINCIPAL_DISPLAY_NAME`, and comma-separated `ADMIN_ROLES`. If
  `ADMIN_ROLES` is unset, it defaults to `owner` to preserve existing access.

RBAC model:

- `viewer`: read dashboard and bounded user detail.
- `support`: viewer plus legacy user state read.
- `maintainer`: support plus export and audit read.
- `owner`: full admin access, including future write/admin management gates.
- Future write permissions must stay disconnected from production routes until
  their own workflow, tests, confirmation UI, backup plan, and owner approval
  are complete.

Audit model:

- Every admin action should produce an audit event before a response is sent.
- Audit events record actor, roles, action, resource, outcome, tenant/page,
  request id, hashed IP, user agent, and redacted metadata.
- Audit metadata must redact tokens, database URLs, service account values,
  phone numbers, addresses, and raw customer export rows.
- Audit write failures should fail closed for future write actions. For
  read-only dashboard views, the rollout decision can be fail-open with an
  application error counter, but that must be explicit before production use.
- PostgreSQL audit writes are disabled unless `ADMIN_AUDIT_LOG_ENABLED=true`.
  This prevents accidental writes before the audit schema is applied.

Schema proposal:

- See `db/admin-auth-rbac-audit-proposal.sql`.
- It is additive and idempotent: admin users, roles, user-role grants, and
  audit log tables plus indexes.
- It is not part of the runtime schema bootstrap and must not be run against
  production without the migration runbook.

Frontend/runtime location:

- Admin frontend is server-rendered HTML/CSS in `core/admin/views.js`.
- Admin read page handlers live in `core/admin/read-routes.js`.
- Legacy export/state handlers live in `core/admin/legacy-routes.js`.
- Route wiring stays in `core/admin-routes.js`.
- There is no separate React/Vite frontend app for these screens.

Production runbook:

- See `docs/admin-auth-rbac-audit-runbook.md`.
- The runbook requires backup first, dev/staging apply, read-only verification,
  passing local tests/audit, and separate production write approval.
