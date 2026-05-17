# Messenger Webhook Debugging

Use this skill to debug webhook delivery, Meta app subscription, page mapping, DB-backed runtime resolution, credential lookup, Messenger sends, dry-run behavior, and no-reply reports.

## Safe Debug Flow

Work from delivery to send. Collect aggregate counts before drawing conclusions.

| Step | What to count | Interpretation if nonzero |
|------|--------------|--------------------------|
| 1 | Webhook POSTs received | Delivery is reaching the app |
| 2 | Signature errors | Request reached app but failed app-secret validation |
| 3 | DB config fail-closed events | Runtime intentionally stopped; no fallback attempted |
| 4 | `page_not_found` events | Incoming page has no active `shop_pages` mapping |
| 5 | Credential errors | Page/shop resolved but no usable credential obtained |
| 6 | Messenger send errors | App attempted send; Messenger rejected or failed it |
| 7 | Meta 429 / rate-limit errors | Messenger API is throttling sends for this page token |
| 8 | Reply, image, and handoff markers | Expected output paths — absent markers are the primary no-reply signal |

Use aggregate counts and safe `page_ref` values only. Do not paste raw logs in final answers.

## Interpretation

**Delivery problems (before the app):**
- Zero POSTs → Meta webhook subscription issue, wrong app or page, wrong callback URL, or delivery blocked upstream. Verify Meta App dashboard.

**Validation problems (app receives but rejects):**
- POST + signature errors → request reached the app but did not validate against the configured app secret. Check `APP_SECRET` env value matches the Meta App.

**Runtime resolution problems:**
- POST + DB config fail-closed → runtime resolution intentionally stopped. Check `MULTI_SHOP_DB_CONFIG_ENABLED` and DB config rows.
- POST + `page_not_found` → incoming page has no active `shop_pages` mapping for the app/environment.

**Credential problems:**
- POST + credential errors → runtime resolved page/shop but could not obtain a usable credential. Check credential status, rotation state, and `CREDENTIAL_MASTER_KEY`.

**Send problems:**
- POST + Messenger send errors → app attempted send; Messenger rejected it. Check token validity, page permissions, and whether the user has messaged first (24-hour window).
- POST + Meta 429 errors → Messenger API is rate-limiting this page token. Check send volume and back off. Do not retry immediately.

**Latency / duplicate problems:**
- POST + duplicate MID suppression counts elevated → Meta is retrying because the app took too long to respond (>5 s acknowledgment). Check response time and whether the handler is blocking on slow DB or Messenger calls.
- POST count significantly higher than message count → likely retry storm from slow acknowledgment. Prioritize acknowledgment speed before processing.

**Expected no-reply (not a bug):**
- Handoff path active → bot intentionally suppresses reply.
- `MESSENGER_DRY_RUN=true` → logic runs but no real send occurs.
- No-text payload (postback, read receipt, delivery) → handler may skip reply by design.
- 24-hour messaging window closed → Messenger rejects the send; surfaces as send error, not app bug.
- Image-only path → only image markers appear, no text reply marker.

## Transient vs Persistent Errors

Before recommending a fix, classify the error:

| Type | Signal | Action |
|------|--------|--------|
| Transient | Error count is isolated to a short window, then stops | Verify the window, confirm recovery, monitor |
| Persistent | Error count continues or recurs on new events | Investigate root cause before any production change |
| Correlated | Error appeared after a deploy, env change, or credential rotation | Compare timestamps; rollback or rotate may be warranted |

Never recommend a production env or credential change for a transient error without confirming it recurred.

## Staging Versus Production

- Confirm whether the event belongs to the staging Meta App/page or production Meta App/page before drawing conclusions. They must not share pages, subscriptions, or credentials.
- Use staging first for any risky runtime change.
- Do not change production webhook subscription, env, credentials, or DB mappings without approval.

## What To Report

Report:

- Time window investigated.
- Environment (staging vs production).
- Webhook POST count.
- Signature error count.
- DB config fail-closed count.
- `page_not_found` count.
- Credential error count.
- Messenger send error count.
- Meta 429 / rate-limit count.
- Duplicate MID suppression count (if elevated).
- Reply / image / handoff marker counts.
- Relevant flag state (`MESSENGER_DRY_RUN`, `MULTI_SHOP_DB_CONFIG_ENABLED`, `WEBHOOK_QUEUE_ENABLED`).
- Error classification: transient, persistent, or correlated.

Do not report raw customer IDs, message bodies, raw page IDs, tokens, DB URLs, or raw log lines.
