# Messenger Outside-24h Review

Last updated: 2026-06-03, Asia/Bangkok.

Purpose: document the current Messenger policy posture for automated sends so
Basic shops keep product-code handoff and staff takeover as the primary sales
flow.

## Sources Checked

- Meta Messenger Platform policy overview:
  `https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/`
- Meta Messenger Send API docs:
  `https://developers.facebook.com/docs/messenger-platform/send-messages/`
- Meta Messenger message tags docs:
  `https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags/`

Summary from the current Meta policy pages:

- Standard Messaging allows a business to respond within 24 hours after a user
  message.
- Message Tags are for important, personally relevant 1:1 updates outside the
  standard 24-hour window, not promotional sales nudges.
- The Human Agent tag is for manual agent replies within the extended period,
  not automated sales follow-up.

## Current Repo Behavior

- Customer-triggered webhook sends are standard Messenger Send API `RESPONSE`
  payloads. The code does not use `MESSAGE_TAG`, Human Agent, One-Time
  Notification, recurring notification, marketing-message tokens, or sponsored
  messages.
- `core/webhook.js` skips stale webhook events older than 23 hours before
  sending automated replies. Queued jobs also use the original entry time for
  the stale check.
- `core/messenger-send-errors.js` classifies outside-window Meta send errors as
  non-retryable and records the safe `outside_allowed_window` reason without
  raw Page IDs, sender IDs, or message bodies.
- Basic/minimal sales shops (`menu_code_handoff` and `basic_sales_v2`) do not
  start abandoned-cart or engaged follow-up workers. Product-code detail, image,
  handoff copy, and staff takeover remain the sales path.
- If reminder workers are enabled later for a non-Basic mode, the reminder
  service caps automated reminder candidates at 23 hours unless a future,
  explicitly reviewed outside-window mechanism is implemented.

## Blocked Outside-window Automation

Do not add any automated Messenger sales send outside the standard window unless
all gates are met:

1. Re-check current Meta policy and approved use cases from official docs.
2. Decide the exact allowed mechanism: appropriate message tag, One-Time
   Notification, recurring notification, marketing opt-in token, or sponsored
   message.
3. Prove the content is non-promotional when using message tags.
4. Add explicit Send API payload fields for that mechanism; do not reuse the
   standard `RESPONSE` sender.
5. Add tests for payload shape, age/window gating, and non-retryable failures.
6. Add an operator-facing runbook and rollback path.
7. Get explicit approval before enabling it for production.

Until those gates exist, outside-24h automated sales reminders remain blocked.
