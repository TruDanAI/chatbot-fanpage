# Grill

Use this skill to stress-test product ideas, architecture choices, rollout plans, and production-impacting decisions before planning, coding, deployment, migration, webhook changes, credential changes, or customer-facing behavior changes.

Grill has two modes:

- **Discovery Grill**: deep early-stage exploration to build shared understanding before planning or implementation.
- **Implementation Gate**: final decision gate before coding, deploying, changing data, changing webhooks, changing credentials, or touching production behavior.

Do not use Grill for tiny docs, copy-only changes, formatting, test-only changes, already-root-caused bug fixes, or commit/review/deploy smoke tasks unless there is a real decision to make.

## Hard Boundaries

- Do not deploy.
- Do not change env.
- Do not touch `/data`.
- Do not modify production data.
- Do not run token health checks.
- Do not modify adult-shop config, data, or assets.
- Do not print tokens, raw page IDs, raw sender IDs, customer data, or message bodies.

## Mode Selection

First identify which mode to use.

Use **Discovery Grill** when the user says `discovery`, `explore`, `ask me deeply`, `50 questions`, `understand the idea`, `grill the whole plan`, or when the idea is broad, early, vague, strategic, product-facing, business-facing, or architecture-facing.

Use **Implementation Gate** when the user says `implement`, `deploy`, `change DB`, `change webhook`, `production`, `commit`, `safe slice`, or when the plan is close to coding, migration, credential change, webhook change, rollout, or production behavior.

If both modes could apply, start with Discovery Grill unless the user is clearly asking for immediate implementation safety.

## Shared Operating Rules

- Before asking the user, check whether the answer is clearly available from current repo, docs, or context.
- Inspect only files directly related to the current decision.
- Do not perform a broad repo audit unless explicitly asked.
- If the answer is discoverable, state `Found from source/context: ...`, then continue to the next unresolved decision.
- If the answer depends on product intent, customer impact, cost, risk tolerance, UX preference, or rollout preference, ask the user.
- Treat `Recommended answer` as the safest technical default if there is no stronger product preference.
- Do not ask questions that would not change understanding, tradeoffs, implementation, safety, rollout, cost, or customer impact.

## Discovery Grill

Use Discovery Grill for early-stage product, architecture, business, or workflow exploration. The goal is shared understanding, not immediate implementation.

Behavior:

- Interview deeply; ask up to 50-100 questions if useful.
- Ask in structured rounds grouped by decision area.
- Prefer 5-10 questions per round unless the user explicitly asks one-by-one.
- After each round, summarize what is confirmed, assumed, undecided, and blocked.
- Continue until a product/design brief can be written with clear tradeoffs.
- Do not stop early just because a small implementation slice exists.
- Ask hidden risks as product, operational, and risk-tolerance questions.

Cover these discovery areas when relevant:

1. Product goal.
2. Target customer.
3. Current pain.
4. User journey.
5. Main workflows.
6. Admin workflow.
7. Customer-facing behavior.
8. Automation boundaries.
9. Human handoff.
10. Multi-shop model.
11. Data model concepts.
12. Assets, images, and media.
13. Pricing and packages.
14. Onboarding and setup.
15. Support and operations.
16. Reliability and fallback.
17. Hosting and deployment.
18. Security and secrets.
19. Metrics and success criteria.
20. Roadmap and prioritization.

Discovery question format:

```text
Round: <round name>
Goal of this round: <what this round clarifies>
Questions:
1. ...
2. ...
3. ...
Recommended defaults:
- ...
```

After each Discovery round, summarize:

```text
Confirmed:
Assumptions:
Still needs decision:
Blocked:
```

Stop output for Discovery Grill:

```text
Shared understanding:
Confirmed decisions:
Assumptions:
Open questions:
Rejected options:
Recommended direction:
Roadmap:
Smallest next discovery task:
Smallest next implementation task:
```

If a field does not apply, write `None`.

## Implementation Gate

Use Implementation Gate for plans that are close to implementation, deployment, migration, credential changes, webhook changes, DB writes, or production behavior.

Behavior:

- Ask one blocking question at a time.
- Only ask questions that change implementation, safety, rollout, cost, or customer impact.
- Treat hidden risks as blocking safety checks.
- Stop when the smallest safe implementation slice is clear.

Implementation Gate priority:

1. Data loss, secret leakage, or irreversible writes.
2. Production traffic impact, including live customer messages.
3. Database write scope, transaction boundary, backup, and rollback.
4. External side effects, including Messenger sends, Meta subscriptions, and webhook callbacks.
5. Runtime reliability, queue retry, idempotency, duplicate delivery, and deploy/restart behavior.
6. Admin workflow, onboarding clarity, feature flags, and rollout polish.

Skip lower-priority questions once they no longer affect the smallest safe implementation slice.

Implementation question format:

```text
Question: ...
Why it matters: ...
Recommended answer: ...
```

Stop output for Implementation Gate:

```text
No blocking question.
Smallest safe slice:
Found from source/context:
Assumptions:
Residual risk:
Next implementation step:
Required tests:
Rollback plan:
```

If a field does not apply, write `None`.

## Terms To Challenge

Force a concrete definition only when the term affects the current mode or task:

- `shop`: shops.id, slug, tenant, business owner, or Facebook Page owner?
- `page`: Facebook Page, shop_pages row, page_ref, or raw page_id?
- `credential`: type, scope, owner, active/archived, rotation model?
- `customer`: Messenger sender, buyer profile, order contact, or admin-facing customer record?
- `handoff`: stop bot, send handoff message, notify staff, or only mark state?
- `active`: enabled in DB, visible in admin, selected by runtime, or allowed for production traffic?
- `ready`: exact readiness checklist and allowed missing sections?
- `asset`: menu_image, product_image, CDN URL, DB row, uploaded file, or runtime media file?
- `status`: source-of-truth field or derived view?
- `mapping`: shop_pages row, page_ref lookup, runtime config entry, or Meta webhook subscription?
- `rotate`: archive-then-insert, update-in-place, or dual-active period?
- `enabled`: DB flag, env var, feature flag, or all three?

## Hidden Risks To Surface

In Discovery Grill, ask these as product, operational, and risk-tolerance questions. In Implementation Gate, treat them as blocking safety checks:

- Production traffic impact: reads vs writes, affected shops, live sends.
- Secret/token leakage in logs, audit metadata, tests, API responses.
- Raw page_id/page_ref mapping mismatch.
- Meta webhook callback URL and subscription scope.
- DB write scope, transaction boundary, backup, rollback.
- Deploy/restart impact on in-flight webhook processing.
- Queue/idempotency behavior under retry or duplicate delivery.
- Dry-run vs real Messenger send behavior.
- Public smoke vs authenticated smoke.
- Audit/API redaction.
- Whether the change can be disabled without another code deploy.

## Examples

Discovery examples:

- `/grill-me discovery: design ZenBot SaaS for 20-100 shops`
- `/grill-me discovery: design image upload optimizer`
- `/grill-me discovery: design inbox-lite conversation status`
- `/grill-me discovery: design pricing packages`

Implementation Gate examples:

- `/grill-me implementation: implement image upload optimizer phase 1`
- `/grill-me implementation: deploy webhook queue worker`
- `/grill-me implementation: change page credential rotation`
- `/grill-me implementation: modify handoff policy`
