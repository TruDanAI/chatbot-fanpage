# Staging Canary

Use this skill to test risky runtime behavior on staging before production.

## Staging URL

Do not hardcode the staging URL. Read it from `.agent/project-state.md`.

If not present, ask the user for the current staging Railway service URL before proceeding. Record it in `project-state.md` after confirmation.

Staging URLs follow the pattern:
```
https://<service-name>.up.railway.app
```

Confirm the URL belongs to the **staging** Railway service, not production, before running any check.

## Boundary

- Deploy staging only.
- Do not touch production deploy, production env, production DB, production `/data`, or production authenticated smoke.
- Keep Meta App staging and production distinct. Confirm the webhook subscription, page, and credentials belong to the staging app/page before interpreting results.
- Do not copy staging flags, credentials, or env values into production.

## Runbook

1. Confirm the task is staging-only and list the exact risky behavior being canaried.
2. Read staging URL from `.agent/project-state.md`.
3. Deploy to the staging Railway service only, if deployment is needed and approved by the user.
4. Check public `GET /healthz` on staging — must return HTTP 200 and `ok`.
5. Check public `GET /admin/login` on staging — must return HTTP 200.
6. Exercise the smallest staging path needed for the behavior under test.
7. Aggregate logs by safe counters and markers. Do not paste raw logs.
8. Apply pass/fail criteria (see below).
9. Confirm production was not touched.

## Pass / Fail Criteria

A canary **passes** when all of the following are true:

- `/healthz` returns HTTP 200 with `ok` and storage ready.
- No unexpected signature errors for test webhook POSTs.
- No `page_not_found` for correctly mapped staging pages.
- No credential errors for the staging credential under test.
- Reply/image/handoff markers appear as expected for the exercised path.
- No error-level log events outside the expected test scope.

A canary **fails** when any of the following occur:

- `/healthz` returns non-200 or storage not ready.
- Signature errors appear on correctly signed test POSTs.
- `page_not_found` appears for a page that should be mapped.
- Credential errors appear for a credential that was just rotated or confirmed active.
- Expected reply/image/handoff markers are absent.
- Unexpected error-level events appear.

On failure: stop, do not promote to production, report the failure using the reporting format below, and surface the failure to the user before taking further action.

## Minimum Observation Window

After exercising the staging path, wait at least **2 minutes** before declaring pass. This allows:
- Async queue processing to surface errors (if `WEBHOOK_QUEUE_ENABLED` is true on staging).
- Meta retry behavior to appear in logs.
- Any delayed credential or config resolution errors to surface.

## Safe Log Aggregation

Use counts and safe refs instead of raw logs:

- Webhook POST count.
- Signature error count.
- DB config fail-closed count.
- `page_not_found` count.
- Credential error count.
- Messenger send error count.
- Reply, image, menu image, product image, and handoff marker counts.
- `page_ref` only when page correlation is needed.

## Reporting

Report staging canary results with:

- Staging URL checked.
- Public `/healthz` result (HTTP status + body summary).
- Public `/admin/login` result (HTTP status).
- Relevant flag states — names only, not secret values.
- Aggregate marker counts.
- Pass or fail verdict with reason.
- Clear statement that production deploy/env/DB/`/data` were not touched.
