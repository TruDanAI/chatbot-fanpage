# Basic Sales V2 Staging Smoke Runbook

Last updated: 2026-06-02, Asia/Bangkok.

This runbook prepares the Basic Sales v2 staging smoke. It does not grant
approval to run the smoke. The smoke mutates staging
`shop_settings.settings_json` and must only run after explicit staging DB write
approval in the same session.

## Scope

Target:

- Environment: staging only.
- Target shop: `wizard-smoke-shop`, as defined in
  `scripts/basic-sales-v2-staging-smoke.js`.
- Protected comparison shop: `adult-shop`.
- Smoke product code: `SMOKE-1`.
- Durable script: `scripts/basic-sales-v2-staging-smoke.js`.

The smoke validates Basic Sales v2 behavior without sending real Messenger
messages. It uses an in-memory webhook harness and requires dry-run staging
settings.

Out of scope:

- production DB writes;
- production env changes;
- production deploys;
- Meta Graph API token health checks;
- real Messenger sends;
- admin authenticated smoke, because it writes audit rows.

## Required Approval

Before P1.2, get explicit approval that names all of these:

- approval to run the Basic Sales v2 staging smoke;
- approval that the run may write and restore staging
  `wizard-smoke-shop.shop_settings.settings_json`;
- confirmation that production DB, production env, and production Messenger
  sends are not approved;
- operator who will review the final summary.

Do not infer this approval from a general request to prepare or review the
runbook.

## Preconditions

Confirm these before running the script:

- `RAILWAY_ENVIRONMENT_NAME` or `RAILWAY_ENVIRONMENT` contains `staging`.
- `MESSENGER_DRY_RUN=true`.
- `MULTI_SHOP_DB_CONFIG_ENABLED=true`.
- `CHATBOT_STAGING_DATABASE_URL` is set to the staging PostgreSQL URL.
- `DATABASE_URL` is not used for this smoke. The script intentionally refuses
  `DATABASE_URL` fallback.
- `wizard-smoke-shop` has `dry_run=true`.
- `wizard-smoke-shop` has exactly one active Page mapping expected for the
  smoke.
- `wizard-smoke-shop` has active product `SMOKE-1`.
- Product `SMOKE-1` has at least one active product image asset.
- `adult-shop` exists and should remain unchanged.
- Staff do not need to be online because this is simulated and dry-run only.

If there is any uncertainty that `CHATBOT_STAGING_DATABASE_URL` points to
staging, stop. Do not print or paste the URL into chat or logs.

## Secret Handling

Do not print or paste:

- raw Page IDs;
- sender IDs;
- Page tokens or encrypted credential values;
- DB URLs;
- service account JSON;
- raw customer message bodies;
- cookies or admin session values.

The script summary is designed to print safe hashes and booleans, not raw
identifiers. If a failure output includes a sensitive value, stop and redact it
before sharing.

## Pre-Run Local Checks

These checks are safe and do not hit staging DB:

```powershell
node --check scripts/basic-sales-v2-staging-smoke.js
npm test
npm audit --omit=dev
```

Recommended focused local v2 check:

```powershell
node -e "require('./tests/webhook.test.js'); require('./tests/harness').run().then(code => process.exit(code))"
```

Expected current local baseline:

- focused webhook suite: 93 passed, 0 failed;
- full suite: 950 passed, 0 failed;
- audit: 0 vulnerabilities.

## Approved Smoke Command

Run this only after explicit staging DB write approval:

```powershell
node scripts/basic-sales-v2-staging-smoke.js
```

Preferred execution location is a staging-scoped shell where staging env vars
are already scoped to the staging service. Do not copy production DB credentials
into any staging variable or local shell.

The script will fail closed unless:

- environment name contains `staging`;
- `MESSENGER_DRY_RUN=true`;
- `MULTI_SHOP_DB_CONFIG_ENABLED=true`;
- `CHATBOT_STAGING_DATABASE_URL` is present.

## What The Script Mutates

The script only writes staging `shop_settings.settings_json` for
`wizard-smoke-shop`. It applies temporary settings for these phases:

- classic v2 disabled with Hot Products disabled;
- classic v2 disabled with Hot Products enabled;
- v2 enabled with Hot Products enabled;
- v2 disabled again to confirm classic fallback.

The script restores the original `settings_json` in a `finally` block and then
asserts that the final hash matches the original hash.

The script also hashes `adult-shop` settings before and after the smoke and
asserts that the hash is unchanged.

## Expected Pass Criteria

The smoke passes only if all of these are true:

- classic menu remains classic when v2 is disabled;
- classic product code sends detail, image, and handoff;
- classic Hot Products emits a list only when enabled;
- v2 menu sends the v2 text fallback;
- v2 menu sends no menu images;
- v2 Hot Products sends the configured list and images;
- v2 Hot Products does not enter handoff;
- v2 product code sends image, detail, and handoff;
- disabling v2 returns to classic behavior;
- `wizard-smoke-shop` `settings_json` is restored;
- `adult-shop` settings hash is unchanged.

## Failure Handling

If the script exits non-zero:

1. Do not rerun immediately.
2. Inspect whether the cleanup summary says `restored=true`.
3. If restore status is unknown or false, stop and ask for staging DB recovery
   approval before making any manual write.
4. Do not run any production command.
5. Do not print raw identifiers or DB values while reporting the failure.

If a Messenger send, Meta Graph call, production DB write, or production env
change is observed, stop the rollout and treat it as a safety incident.

## Post-Run Checks

After an approved successful smoke:

- Confirm the summary reports `cleanup.restored=true`.
- Confirm the summary reports `adultShop.untouched=true`.
- Re-run local focused tests if code changed.
- Re-run `npm audit --omit=dev` if dependencies changed.
- Update `docs/active/active-delivery-plan.md` P1.2 with the date, result, and any
  follow-up.

Do not use a successful staging smoke as production approval. Production Page
cutover and production DB writes remain separately blocked.
