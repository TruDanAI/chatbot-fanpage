# Messenger Webhook Debugging

Use this skill to debug webhook delivery, Meta app subscription, page mapping, DB-backed runtime resolution, credential lookup, Messenger sends, dry-run behavior, and no-reply reports.

## Safe Debug Flow

Work from delivery to send:

1. Count webhook POSTs.
2. Count signature errors.
3. Count DB config fail-closed events.
4. Count `page_not_found` events.
5. Count credential errors.
6. Count Messenger send errors.
7. Count reply, image, and handoff markers.

Use aggregate counts and safe `page_ref` values only. Do not paste raw logs in final answers.

## Interpretation

- No POST means a Meta webhook/subscription issue, wrong app/page, wrong callback URL, or delivery blocked before the app.
- POST plus signature errors means the request reached the app but did not validate against the configured app secret.
- POST plus DB config fail-closed means runtime resolution intentionally stopped before fallback.
- POST plus `page_not_found` means the incoming page does not match an active `shop_pages` mapping.
- POST plus credential errors means runtime resolved the page/shop but could not obtain a usable page credential.
- POST plus Messenger send errors means the app tried to send and Messenger rejected or failed the request.
- POST plus no reply can be expected for handoff, dry-run, no-text payloads, duplicate MID suppression, validation skips, or logic paths that only send images.
- `MESSENGER_DRY_RUN=true` means logic may run without a real Messenger send.

## Staging Versus Production

- Confirm whether the event belongs to the staging Meta App/page or production Meta App/page before drawing conclusions.
- Use staging first for risky runtime changes.
- Do not change production webhook subscription, env, credentials, or DB mappings without approval.

## What To Report

Report:

- Time window.
- Environment.
- Webhook POST count.
- Signature error count.
- DB config fail-closed count.
- `page_not_found` count.
- Credential error count.
- Messenger send error count.
- Reply/image/handoff marker counts.
- Relevant flag state, especially `MESSENGER_DRY_RUN`.

Do not report raw customer IDs, message bodies, raw page IDs, tokens, DB URLs, or raw log lines.
