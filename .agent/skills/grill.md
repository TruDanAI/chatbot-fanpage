# Grill

Use this skill to stress-test unclear plans before implementation. Use it before architecture, production rollout, multi-shop, credential, webhook queue, admin onboarding, and business/pricing decisions. Do not use it for tiny docs, copy, or test-only tasks.

## Operating Rules

- Ask one question at a time.
- For each question, provide:
  - `Question`
  - `Why it matters`
  - `Recommended answer`
- **Before asking the user**: check whether the answer is discoverable by reading repo files, docs, or existing skill files. If it is, state what you found and move to the next question without waiting.
- Keep questions focused on decisions that change implementation, safety, cost, rollout, or customer impact.
- Stop only when every remaining uncertainty would produce the same implementation. If in doubt, ask one more.

## Terms To Challenge

When a plan uses these words, force a concrete definition before implementation:

- `shop`: clarify whether it means `shops.id`, slug, business account, Facebook Page owner, or tenant.
- `page`: clarify whether it means Facebook Page, `shop_pages` mapping row, `page_ref`, or raw `page_id`.
- `credential`: clarify type, scope, owner, rotation state, and whether it is active or archived.
- `customer`: clarify whether it means Messenger sender, buyer profile, order contact, or admin-facing customer record.
- `handoff`: clarify whether bot should stop replying, send a handoff message, notify staff, or only mark state.
- `active`: clarify whether active means enabled in DB, selected by runtime, visible in admin, or allowed for production traffic.
- `ready`: clarify the exact readiness checklist, required data, and allowed missing sections.
- `asset`: clarify whether it means `menu_image`, `product_image`, a CDN URL, a DB row, or an uploaded file object.
- `status`: clarify which status field on which table, and whether it is the source of truth or a derived view.
- `mapping`: clarify whether it means `shop_pages` row, `page_ref` lookup, a runtime config entry, or a webhook subscription binding.
- `rotate`: clarify whether it means archive-then-insert, update-in-place, or dual-active period.
- `enabled`: clarify whether enabled means a DB flag, an env var, a feature flag, or all three in agreement.

## Hidden Risks To Surface

Ask or inspect for:

- Production traffic impact (reads vs writes, affected shops, live sends).
- Token or secret leakage in logs, audit metadata, tests, or API responses.
- Raw `page_id` mapping mismatch between DB and Meta.
- Wrong Meta App callback URL or webhook subscription scope.
- DB write scope, transaction boundary, backup existence, and rollback path.
- Deploy or service restart impact on in-flight webhook processing.
- Queue and idempotency behavior under retry or duplicate delivery.
- Dry-run versus real Messenger send behavior (check `MESSENGER_DRY_RUN`).
- Authenticated smoke versus public read-only checks — confirm which is safe.
- Audit metadata and API response redaction (token, `encrypted_value`, `page_id`).
- Whether the change is reversible by feature flag without a code deploy.

## Question Format

```text
Question: ...
Why it matters: ...
Recommended answer: ...
```

Ask only that question. If the answer is locally discoverable, state it and continue. Do not batch questions.

## When To Stop

Stop grilling when:

1. All ambiguous terms in the plan have a concrete definition.
2. All hidden risks above are either confirmed absent or have a documented mitigation.
3. The remaining unknowns would not change which slice to implement first or how to safely implement it.

If you reach a point where no safe implementation slice exists, say so explicitly and name the missing decision or approval before stopping.

## Output Before Implementation

End the grill with:

```text
Clarified decision: the exact decision to implement or defer.
Rejected options: alternatives considered and why they are not the current path.
Smallest safe next slice: the minimum useful change that respects safety boundaries.
Required tests: focused tests or checks needed for the slice.
Rollback plan: required when production, env, DB, webhook, queue, credential, or pricing changes are in scope.
```
