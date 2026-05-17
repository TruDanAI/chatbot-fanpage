# Staging Canary

Use this skill to test risky runtime behavior on staging before production.

Staging URL:

```text
https://chatbot-fanpage-staging-staging.up.railway.app
```

## Boundary

- Deploy staging only.
- Do not touch production deploy, production env, production DB, production `/data`, or production authenticated smoke.
- Keep Meta App staging and production distinct. Confirm the webhook/subscription, page, and credentials belong to the staging app/page before interpreting results.
- Do not copy staging flags or credentials into production.

## Runbook

1. Confirm the task is staging-only and list the risky behavior being canaried.
2. Deploy to the staging Railway service only, if deployment is needed and approved by the user.
3. Check public `GET /healthz` on staging.
4. Check public `GET /admin/login` on staging.
5. Exercise the smallest staging path needed for the behavior.
6. Aggregate logs by safe counters and markers. Do not paste raw logs.
7. Confirm production was not touched.

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
- Public `/healthz` result.
- Public `/admin/login` result.
- Relevant flag states, without values for secrets.
- Aggregate marker counts.
- Clear statement that production deploy/env/DB/`/data` were not touched.
