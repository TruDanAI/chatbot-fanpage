# Production Page Cutover Runbook (P1.2g)

This runbook is documentation and design only. Writing or reading it is not
approval to deploy, change environment variables, write any database, touch
`/data`, touch production, call the Meta Graph API, run a token health check,
send a Messenger message, or enable any production cutover UI or route.

It describes the intended, future, production-safe procedure for replacing the
Facebook Page that a single shop is connected to ("Page cutover"), and the
operator approval gate that must pass before that procedure is ever run.

## 1. What this procedure is for

A "Page cutover" replaces the one active Fanpage mapping and its one active
encrypted page credential for a single shop with a new Page mapping and a new
encrypted credential, in one atomic transaction. The old mapping and old
credential are archived, not deleted.

Use it when a shop must move from one Facebook Page to a different Facebook
Page, for example:

- The shop created or migrated to a new Facebook Page.
- The Page token must be reissued against a different Page.
- A wrong Page was mapped during onboarding and must be corrected.

A cutover is **not** a credential rotation. Rotating the token for the *same*
Page is a separate operation (`core/credentials/page-credentials.js` rotate
mode). A cutover always changes the `page_id` and always replaces the
credential at the same time.

## 2. What this procedure is NOT allowed to do yet

This is the current, enforced reality of the codebase. Do not work around it.

- **No production cutover is possible today.** The cutover service
  (`core/admin/page-cutover-writes.js`) calls `assertPageCutoverRuntime()` and
  throws `page_cutover_not_allowed_in_production` (HTTP 403) whenever the
  runtime is production. Production runtime is any process where `NODE_ENV`,
  `RAILWAY_ENVIRONMENT`, or `RAILWAY_ENVIRONMENT_NAME` equals `production`
  (see `core/storage-config.js`). The Railway production service matches this.
- **There is no production cutover button.** The cutover is API-only
  (`POST /admin/api/shops/:shopId/pages/cutover`, Bearer-only). No HTML UI
  triggers it, and none may be enabled as part of this phase.
- **The only production shop is doubly protected.** `adult-shop` is in the
  protected-shop set, and any slug containing `prod`/`production` is also
  blocked (`protected_shop_cutover_blocked`, HTTP 403). The service also
  refuses any shop that is live or archived (`shop_not_staging_test_safe`,
  HTTP 409): it only runs for non-live staging test shops.
- This runbook does **not** authorize removing or weakening any of the guards
  above. Enabling a production cutover path is a future implementation slice
  that needs its own design, review, tests, and a separate approval.
- This phase performs no deploy, no env change, no DB write, no `/data` touch,
  no Meta Graph API call, no token health check, and no Messenger send.

## 3. Pre-cutover checks (must all pass before any production cutover)

These are the gates that a future production cutover must satisfy. Until a
production cutover path is implemented and separately approved, treat any
unmet item as a hard stop.

- [ ] The operator approval gate in `docs/operator-approval-gate-plan.md` has
      passed, including the exact approval wording (see section 8).
- [ ] A fresh production PostgreSQL backup exists outside this repo, with a
      confirmed timestamp and verified SHA256 (same standard as
      `.agent/skills/railway-production-safety.md` and
      `docs/production-data-backup-runbook.md`). Record it in
      `.agent/project-state.md`.
- [ ] The exact target shop is confirmed by `shop_ref` and slug, not by memory.
- [ ] The target shop currently has **exactly one** active page mapping and
      **exactly one** active `fb_page_token` credential. Zero or more than one
      is a hard stop (`active_page_mapping_required` /
      `active_page_mapping_ambiguous` / `active_page_credential_*`).
- [ ] The new `page_id` is confirmed correct, is different from the current
      active `page_id` (`same_page_id` otherwise), and is not already mapped
      active anywhere (`duplicate_active_page_id` otherwise).
- [ ] The new Page token was generated in, and belongs to, the **production**
      Meta app context for the new Page. It is not a staging token.
- [ ] `CREDENTIAL_MASTER_KEY` is present in the production runtime and is the
      production key (never a staging key). See section 6.
- [ ] The expected current state is pinned: capture the current active
      `page_mapping_id` and current `page_ref` and pass them as
      `expected_current_page_mapping_id` / `expected_current_page_ref` so the
      service fails closed if state drifted (`stale_page_mapping` /
      `stale_page_ref`).
- [ ] A rollback decision-maker is available for the duration of the change.
- [ ] You can read public `/healthz` and aggregate Railway logs without
      printing secrets.

## 4. How to verify the correct shop and target Fanpage

Verify identity twice, using safe references only. Never print raw tokens, raw
`page_id`, `encrypted_value`, `DATABASE_URL`, or customer/message data.

1. Resolve the shop by slug and confirm its `shop_ref`. The service resolves by
   `id` or `slug` and locks the row `FOR UPDATE`.
2. Confirm the current active mapping: exactly one row in `shop_pages` with
   `status='active'`. Record its `page_ref` (`p:<hash>`), never the raw
   `page_id`.
3. Confirm the current active credential: exactly one row in
   `shop_page_credentials` with `status='active'` and
   `credential_type='fb_page_token'` for that mapping. Record only its
   `credential_ref` (`c:<hash>`), status, and counts.
4. Confirm the new target Page by computing its `page_ref` from the new
   `page_id` and matching it against the value the owner approved in writing.
   The staging smoke shop's current active ref is `p:94bf9048cd`; a production
   target must be a different, owner-confirmed production ref.
5. The shop slug confirmation field must match the resolved slug exactly, or
   the service throws `shop_slug_confirmation_mismatch`.

If any reference does not match what was approved, stop. Do not "fix it in
flight."

## 5. How to avoid mixing staging and production credentials

This is the highest-risk failure mode. Treat staging and production as fully
separate trust domains.

- Generate the new Page token only against the **production** Meta app and the
  **production** Page. Never reuse a token that was issued for staging.
- Encrypt production tokens only with the **production** `CREDENTIAL_MASTER_KEY`
  inside the production runtime. A value encrypted under the staging key cannot
  be decrypted in production and will fail closed at runtime.
- Never copy `shop_page_credentials` rows, `encrypted_value` blobs, or
  `CREDENTIAL_MASTER_KEY` between environments.
- Never paste a token into chat, logs, a commit, or this runbook. The token is
  received once inside the write path, trimmed, encrypted immediately, and
  never echoed (see `.agent/skills/credential-safety.md`).
- Confirm the runtime is production by checking the deployment metadata before
  the change, but the operator must still treat the token's origin as the
  source of truth — environment detection alone does not prove a token is a
  production token.
- If there is any doubt about whether a token or key is from staging, stop and
  reissue a fresh production token.

## 6. How production credential encryption must happen safely

- Encryption uses `encryptCredential(token, masterKey)` from
  `core/credentials/page-credentials.js` (AES-GCM envelope). The cutover writes
  `credential_type='fb_page_token'`, `encryption_key_id='default'`,
  `key_version=1`, `status='active'`, and safe `metadata_json`
  (`source='admin_page_cutover'`, `health_check=false`, `messenger_send=false`).
- `CREDENTIAL_MASTER_KEY` must already be set in the production runtime context
  before the change. If it is missing, the service returns
  `credential_master_key_missing` (surfaced as `credential_write_unavailable`,
  HTTP 503). Do not paste the key anywhere; report only "configuration missing."
- Do **not** rotate `CREDENTIAL_MASTER_KEY` as part of a cutover. Key rotation
  is a separate, higher-stakes operation that requires re-encrypting all
  existing credentials and its own backup and approval
  (`.agent/skills/credential-safety.md`).
- The plaintext token exists only transiently in process during the write path
  and is never persisted or logged. Only `encrypted_value` is stored, and it is
  never printed.

## 7. Who is allowed to approve the operation

- **Owner approval is mandatory.** Only the product owner (the person who
  authorizes production DB writes elsewhere in this project) may approve a
  production Page cutover. This matches the existing `duoc ghi DB production`
  approval pattern used for production database writes.
- **Two-person rule.** A separate operator (not the approver) executes the
  change. The approver and the executor should not be the same person.
- **Permission.** The executor's principal must hold `PRODUCT_WRITE`
  (the service throws `permission_denied`, HTTP 403, otherwise) and must use
  Bearer authentication on the API-only route.
- Approval is **per cutover**, in the current session. Approval of one cutover
  never implies approval of another, and never implies approval to enable a
  production cutover UI or to weaken any guard.

## 8. Exact approval wording required

Two distinct confirmations are required.

1. **Owner approval phrase (human gate).** Before anything runs, the owner must
   state, in writing, for this specific cutover:

   ```
   duoc cutover page production shop=<slug> new_page_ref=<p:hash>
   ```

   The slug and `new_page_ref` must match the verified target exactly. A
   generic "go ahead" is not sufficient.

2. **In-request confirmation (service gate).** The cutover request body must
   include:

   - `confirmation_text`: exactly `CUTOVER PAGE`
     (`PAGE_CUTOVER_CONFIRMATION`); any other value throws
     `page_cutover_confirmation_required`.
   - `shop_slug_confirmation`: the exact resolved shop slug.
   - `expected_current_page_mapping_id` and/or `expected_current_page_ref`:
     pinned to the verified current state.

Both gates must be satisfied. Missing the owner phrase is a hard stop even if
the service confirmation is well-formed.

## 9. What should be logged or audited

- The service writes one `admin_audit_log` entry with action
  `admin.shop_page.cutover` and resource type `shop_page_cutover`. Its metadata
  contains only safe values: `shop_ref`, `old_page_ref`, `new_page_ref`,
  `old_credential_ref`, `new_credential_ref`, `active_mapping_count`,
  `active_credential_count`, `readiness_stale=true`, `health_check=false`,
  `messenger_send=false`, `source='admin_api'`.
- Operators should additionally record, outside this repo, in the change log:
  the owner approval phrase, the approver and executor identities, the backup
  timestamp/SHA256, the `shop_ref`, `old_page_ref`, `new_page_ref`, and the
  post-cutover counts.
- Never log or record raw tokens, raw `page_id`, `encrypted_value`,
  `CREDENTIAL_MASTER_KEY`, `DATABASE_URL`, customer rows, or message bodies.
  Use `page_ref`/`credential_ref`/`shop_ref` and counts only.

## 10. Required smoke test after cutover

A cutover marks readiness stale on purpose (`last_readiness_status='unknown'`).
The shop is not considered ready until these pass, in order:

1. Confirm the safe API response: exactly `active_mapping_count=1`,
   `active_credential_count=1`, old mapping/credential `archived`, new
   mapping/credential `active`, `readiness_stale=true`. (The service enforces
   this post-condition and throws `page_cutover_postcondition_failed` if it is
   not met, so a success response already implies it.)
2. Public `GET /healthz` returns HTTP 200, `ok=true`, expected `shop`,
   `storage.ready=true`, and the expected `messenger.dryRun` value. Report
   these fields only.
3. Re-run the shop readiness checklist and confirm it returns to `passed`.
4. Only after readiness passes, run a controlled live verification on the new
   Page following the existing real-Page pilot discipline
   (`docs/real-page-pilot-checklist.md`): keep the global kill switch and
   per-shop dry-run posture deliberate, verify the inbound `page_ref` matches
   the new mapping, and confirm there is no wrong-shop routing.
5. Confirm aggregate Railway logs show no `page_not_found`, credential error,
   or Messenger send error for the new `page_ref`. Report counts only.

A controlled live send is a separate, customer-visible action and needs its own
go-ahead; it is out of scope for the cutover write itself.

## 11. What to do if something fails

The cutover is a single atomic transaction, which makes failure handling
simpler.

- **Failure during the transaction.** Any thrown error rolls back the whole
  transaction (`ROLLBACK`). No partial state is persisted: the old mapping and
  old credential remain active and the new ones are not created. Read the safe
  error code, fix the precondition, and only retry after re-verifying state.
  Common safe stops: `stale_page_mapping`, `stale_page_ref`,
  `duplicate_active_page_id`, `same_page_id`, `active_page_*_ambiguous`,
  `shop_slug_confirmation_mismatch`, `page_cutover_commit_failed`.
- **Encryption/key failure.** `credential_master_key_missing` or
  `page_cutover_encryption_failed` means the credential was not written and the
  transaction rolled back. Resolve key configuration (without printing it)
  before retrying.
- **Post-condition failure.** `page_cutover_postcondition_failed` rolls back;
  re-verify counts before any retry.
- **Runtime/Messenger trouble after a successful cutover.** Do not delete rows.
  Use the project's reversible controls first: if real sends must stop, enable
  `MESSENGER_DRY_RUN=true` (production env change, separate approval); if the
  DB-backed runtime itself is implicated, disabling
  `MULTI_SHOP_DB_CONFIG_ENABLED` is the documented runtime rollback
  (`.agent/skills/railway-production-safety.md`). Either change needs
  production env approval and a `/healthz` re-check afterward.

Never print secrets while diagnosing. Report error codes, counts, and statuses
only.

## 12. How rollback should work

Because the old mapping and old credential are archived (not deleted), the
shop's previous Page connection is recoverable.

- **Preferred rollback: reverse-cutover.** Run another cutover that targets the
  original `page_id` again, supplying the original production Page token so it
  is freshly encrypted. This restores exactly-one-active mapping/credential and
  marks readiness stale again. This is the clean, forward-only path once a
  production cutover path exists.
- **Do not** manually flip archived rows back to `active` by hand-editing the
  database; that risks creating two active mappings or two active credentials
  and breaking the exactly-one invariant.
- **Immediate safety, independent of the mapping:** if customers are at risk,
  halt real sends first with `MESSENGER_DRY_RUN=true` (production env approval),
  then perform the reverse-cutover.
- After any rollback, re-run the section 10 smoke test and confirm readiness
  returns to `passed`.
- Always keep the verified pre-cutover backup until the new Page is confirmed
  healthy in production.

## 13. Future implementation steps (after this documentation phase)

These are design notes for later slices. None of them are approved by this
document; each needs its own review, tests, and approval.

1. **Production-eligibility design.** Decide how (and whether) a production
   cutover is ever allowed to run, given that the only production shop is
   currently in the protected set. Any change to `assertPageCutoverRuntime`,
   the protected-shop set, or the non-live gate must be deliberate, narrowly
   scoped, and reversible.
2. **Approval-gate enforcement in code.** Encode the owner approval phrase and
   two-person rule as an explicit gate (for example, a required confirmation
   token plus an audit of approver and executor), so the human gate is not
   purely procedural.
3. **Operator UI (last, not first).** Only after the service path is proven in
   production should a guarded UI be considered, with the same danger-modal
   discipline already used for credential replacement and delete-draft
   (checkbox, exact slug typing, countdown, environment/encryption warnings).
4. **Token health and live verification tooling.** A separate, opt-in,
   explicitly approved capability to verify a new Page token and run a
   controlled live check, kept out of the cutover write path itself.
5. **Reverse-cutover convenience.** A documented, possibly assisted, path for
   the reverse-cutover described in section 12.

## 14. Safety boundary for this documentation checkpoint

- No deployment was performed.
- No environment variable was changed.
- No database or `/data` write was performed.
- No production system was touched.
- No Meta Graph API call, token health check, or Messenger send was performed.
- No production cutover UI or route was enabled.
- No raw token, raw `page_id`, `encrypted_value`, `CREDENTIAL_MASTER_KEY`,
  `DATABASE_URL`, customer data, or message body was printed.
