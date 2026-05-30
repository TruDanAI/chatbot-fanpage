# Operator Approval Gate Plan: Production Page Cutover (P1.2g)

This plan is documentation and design only. It is not approval to deploy,
change environment variables, write any database, touch `/data`, touch
production, call the Meta Graph API, run a token health check, send a Messenger
message, or enable any production cutover UI or route.

It defines who may approve a production Page cutover, the exact wording that
counts as approval, the roles involved, and the checks that must surround the
approval. It is the human gate that sits in front of the procedure in
`docs/production-page-cutover-runbook.md`.

## 1. Why a gate is needed

A production Page cutover replaces the live Facebook Page connection and
encrypted credential for a real shop. A mistake can route a real customer to
the wrong Page, break sends, or mix a staging credential into production. The
gate exists to make the decision deliberate, attributable, and reversible.

The gate is currently a **procedural** control layered on top of the existing
**technical** controls. The technical controls already block production
cutover today (production runtime guard, protected-shop block, non-live gate,
`PRODUCT_WRITE` permission, and the in-request `CUTOVER PAGE` confirmation).
This plan does not remove or weaken any of them.

## 2. Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| Approver (Owner) | Product owner who authorizes production DB writes | Gives the written approval phrase; confirms target shop and new Page ref; owns the go/no-go decision |
| Executor (Operator) | A different person holding `PRODUCT_WRITE` | Performs the verified pre-checks and runs the cutover; does not self-approve |
| Rollback owner | Approver or a delegate available for the change window | Decides on rollback if the smoke test fails |

Two-person rule: the Approver and the Executor must not be the same person.

## 3. What must be true before approval is requested

The Executor presents, and the Approver confirms, all of the following using
safe references only (no raw tokens, no raw `page_id`, no `encrypted_value`):

- Target shop identified by slug and `shop_ref`.
- Current active mapping: exactly one, identified by `page_ref`.
- Current active credential: exactly one `fb_page_token`, identified by
  `credential_ref`.
- New target Page identified by `new_page_ref`, confirmed different from the
  current active page, and confirmed not already mapped active elsewhere.
- New Page token confirmed to originate from the **production** Meta app for
  the new Page (never a staging token).
- Production `CREDENTIAL_MASTER_KEY` confirmed present in the production
  runtime and confirmed to be the production key (never a staging key, never
  used from staging runtime).
- A fresh, verified production PostgreSQL backup exists outside the repo
  (timestamp + SHA256 recorded in `.agent/project-state.md`).
- The expected current state is pinned for the request
  (`expected_current_page_mapping_id` and/or `expected_current_page_ref`).

If any item is unconfirmed, the gate fails and no approval is requested.

## 4. Exact approval wording

Approval requires two distinct confirmations.

### 4.1 Owner approval phrase (human gate)

The Approver must state, in writing, for this specific cutover, the exact
phrase:

```
duoc cutover page production shop=<slug> new_page_ref=<p:hash>
```

- `<slug>` must equal the resolved shop slug.
- `<p:hash>` must equal the verified `new_page_ref`.
- The phrase is consistent with the project's existing
  `duoc ghi DB production` production-write approval convention.
- A generic "ok", "go ahead", or thumbs-up is **not** valid approval.
- The phrase authorizes exactly one cutover, in the current session, for the
  named shop and Page only.

### 4.2 In-request confirmation (service gate)

The cutover request body must carry:

- `confirmation_text` = `CUTOVER PAGE` (exact; `PAGE_CUTOVER_CONFIRMATION`).
- `shop_slug_confirmation` = the exact resolved shop slug.
- `expected_current_page_mapping_id` and/or `expected_current_page_ref`
  pinned to the verified current state.

Both 4.1 and 4.2 must be present. The service rejects a malformed request
(`page_cutover_confirmation_required`, `shop_slug_confirmation_mismatch`,
`stale_page_mapping`, `stale_page_ref`), but a well-formed request without the
owner phrase is still a hard stop at the human gate.

## 5. Scope and expiry of an approval

- One approval = one cutover for one named shop and one named new Page.
- Approval is valid only within the current operating session and only while
  the verified state still matches (the service fails closed on drift).
- Approval does **not** imply approval to: run another cutover, rotate
  `CREDENTIAL_MASTER_KEY`, run a live Messenger send, enable a production
  cutover UI, or relax any guard.
- If anything material changes (different shop, different Page, state drift,
  new backup needed), the gate restarts from section 3.

## 6. What gets recorded

For each approval, record outside this repo (and reflect safe summaries in
`.agent/project-state.md` as appropriate):

- The exact owner approval phrase used.
- Approver identity and Executor identity (distinct).
- `shop_ref`, `old_page_ref`, `new_page_ref`, `old_credential_ref`,
  `new_credential_ref`.
- Backup timestamp and SHA256.
- Outcome and post-cutover counts (`active_mapping_count`,
  `active_credential_count`), plus the `admin_audit_log` action
  `admin.shop_page.cutover` reference.

Never record raw tokens, raw `page_id`, `encrypted_value`,
`CREDENTIAL_MASTER_KEY`, `DATABASE_URL`, customer data, or message bodies.

## 7. Relationship to current technical guards

The gate is procedural. The following technical guards remain in force and are
**not** changed by this plan:

- Production runtime guard: `assertPageCutoverRuntime()` returns
  `page_cutover_not_allowed_in_production` (403) in production today.
- Protected-shop block: `adult-shop`, `demo-shop`, `nem-bui-xa`, and any slug
  containing `prod`/`production` are blocked (403).
- Non-live gate: only non-live, non-archived staging test shops are eligible
  (409 otherwise).
- Permission: executor must hold `PRODUCT_WRITE`; Bearer-only route (403
  otherwise).
- Exactly-one invariant: exactly one active mapping and one active credential
  before and after; atomic transaction with an enforced post-condition.

Because of these guards, a production cutover cannot actually run yet even with
a perfect approval. Making it runnable is a separate, future, approved
implementation slice (see the runbook, section 13).

## 8. Future enforcement (design notes, not approved here)

- Encode the owner approval phrase and two-person rule as a required, audited
  gate in code, so the human approval is captured in `admin_audit_log` rather
  than living only in chat or a change log.
- Add an approver/executor distinctness check.
- Consider a short-lived, single-use approval token bound to `shop_ref` +
  `new_page_ref` so the in-request confirmation cannot be replayed for a
  different target.

## 9. Safety boundary for this documentation checkpoint

- No deployment, env change, DB write, or `/data` touch was performed.
- No production system was touched.
- No Meta Graph API call, token health check, or Messenger send was performed.
- No production cutover UI or route was enabled.
- No raw secrets, tokens, `page_id`, `encrypted_value`, keys, `DATABASE_URL`,
  customer data, or message bodies were printed.
