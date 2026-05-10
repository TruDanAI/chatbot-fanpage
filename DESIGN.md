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

## Future Direction

Before adding write workflows, add:

- Per-user admin authentication.
- Role-based permissions.
- Audit log for every admin action.
- Explicit confirmation flows.
- Production backup and rollback checklist for each write feature.
