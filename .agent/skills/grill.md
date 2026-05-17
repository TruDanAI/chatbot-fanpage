# Grill

Use this skill to stress-test unclear plans before implementation. Use it before architecture, production rollout, multi-shop, credential, webhook queue, admin onboarding, and business/pricing decisions. Do not use it for tiny docs, copy, or test-only tasks.

## Operating Rules

- Ask one question at a time.
- For each question, provide:
  - `question`
  - `why it matters`
  - `recommended answer`
- If the answer can be found by reading repo files or docs, inspect the repo/docs instead of asking the user.
- Keep grilling focused on decisions that change implementation, safety, cost, rollout, or customer impact.
- Stop when the remaining uncertainty no longer changes the smallest safe next slice.

## Terms To Challenge

When a plan uses these words, force a concrete definition before implementation:

- `shop`: clarify whether it means `shops.id`, slug, business account, Facebook Page owner, or tenant.
- `page`: clarify whether it means Facebook Page, `shop_pages` mapping row, `page_ref`, or raw `page_id`.
- `credential`: clarify type, scope, owner, rotation state, and whether it is active or archived.
- `customer`: clarify whether it means Messenger sender, buyer profile, order contact, or admin-facing customer record.
- `handoff`: clarify whether bot should stop replying, send a handoff message, notify staff, or only mark state.
- `active`: clarify whether active means enabled in DB, selected by runtime, visible in admin, or allowed for production traffic.
- `ready`: clarify the exact readiness checklist, required data, and allowed missing sections.

## Hidden Risks To Surface

Ask or inspect for:

- Production traffic impact.
- Token or secret leakage.
- Raw `page_id` mapping mismatch.
- Wrong Meta App callback or webhook subscription.
- DB write scope, transaction boundary, backup, and rollback.
- Deploy or restart impact.
- Queue and idempotency behavior.
- Dry-run versus real Messenger send behavior.
- Authenticated smoke versus public read-only checks.
- Audit metadata and response redaction.

## Question Format

Use this shape:

```text
Question: ...
Why it matters: ...
Recommended answer: ...
```

Ask only that question, then wait unless the answer is discoverable locally. If it is discoverable locally, state the answer found and continue to the next material uncertainty.

## Output Before Implementation

End the grill with:

- `Clarified decision`: the exact decision to implement or defer.
- `Rejected options`: alternatives considered and why they are not the current path.
- `Smallest safe next slice`: the minimum useful change that respects safety boundaries.
- `Required tests`: focused tests or checks needed for the slice.
- `Rollback plan`: include when production, env, DB, webhook, queue, credential, or pricing changes are relevant.

If no safe implementation slice exists, say so and identify the missing decision or approval.
