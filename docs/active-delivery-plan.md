# Active Delivery Plan

Last updated: 2026-06-03, Asia/Bangkok.

This is the first file to read at the start of a new Codex session. It is the
working plan for moving ZenBot from a production pilot into a stable internal
SaaS-style Messenger shop operations system.

Use this file as the active checklist. Treat the longer docs as detailed
evidence and runbooks:

- `docs/source-map-current.md` for current code map.
- `docs/production-rollout-checkpoint.md` for the latest verified production
  state.
- `docs/multi-shop-rollout.md` for rollout history and gates.
- `docs/basic-sales-v2-behavior-contract.md` for Basic Sales v2 runtime
  behavior, disabled features, and staging smoke procedure.
- `docs/basic-sales-v2-staging-smoke-runbook.md` for the Basic Sales v2
  staging smoke approval gate, preconditions, command, and failure handling.
- `docs/processed-mids-retention-plan.md` for count-only `processed_mids`
  visibility, retention policy, and cleanup approval gates.
- `docs/messenger-outside-24h-review.md` for Messenger standard-window policy,
  automated-send boundaries, and outside-window approval gates.
- `docs/real-page-pilot-checklist.md` for real Page pilot steps.
- `docs/production-page-cutover-runbook.md` for future production Page cutover.
- `docs/saas-roadmap.md` for the long-range architecture direction.

## How To Use This File

At the start of a session, the user can say:

```text
Doc docs/active-delivery-plan.md roi lam muc NEXT tiep theo. Khong deploy,
khong push, khong doi env, khong ghi production DB neu toi chua xac nhan.
```

Session procedure:

1. Re-check local state:

   ```powershell
   git status --short --untracked-files=all
   git rev-list --left-right --count origin/main...HEAD
   git log --oneline -5
   ```

2. Re-check public production health only, no token:

   ```powershell
   try {
     (Invoke-WebRequest -UseBasicParsing https://chatbot-fanpage-production.up.railway.app/healthz -TimeoutSec 20).Content
   } catch {
     $_.Exception.Message
   }
   ```

3. Run local verification before code changes or after dependency changes:

   ```powershell
   npm test
   npm audit --omit=dev
   ```

4. Pick the highest-priority unchecked item in this file.
5. Update this file when a phase is completed, blocked, or reprioritized.
6. End every session by reporting: tests, audit, git state, production health
   if checked, whether any deploy/env/DB/data/push happened, and next approval
   needed.

Status markers:

- `[x]` done and verified.
- `[>]` in progress.
- `[ ]` next work.
- `[!]` blocked or requires explicit approval.
- `[?]` needs re-check because local/remote state may have changed.

## Current Project Stage

ZenBot is in production pilot / operational MVP stage.

What is production-ready today:

- `adult-shop` is live on Messenger.
- Public health is green: `ok=true`, `shop=adult-shop`, `products=13`,
  `storage.adapter=postgres`, `storage.ready=true`,
  `messenger.dryRun=false` as checked on 2026-06-02.
- Production storage is PostgreSQL.
- Current live customer-facing mode is classic `menu_code_handoff`.
- Gemini remains off for production Basic mode per the production checkpoint.
- Admin dashboard, shop list/detail, setup wizard, product/menu UX, readiness,
  shop pause/resume, dry-run controls, fanpage connection UI, and staging-only
  Page cutover are implemented or staged according to rollout docs.

What is not yet production-ready:

- `basic_sales_v2` is code/test present but still a staging pilot path.
- `WEBHOOK_QUEUE_ENABLED` must remain false/unset until a separate queue
  rollout approval.
- Production Page cutover remains blocked by design.
- Multi-admin real identity is future work; current admin auth is still a
  static-token/session bridge.
- Production multi-shop expansion beyond `adult-shop` still needs explicit
  backup, env, credential, DB, smoke, and live-window approvals.

Latest local observation from 2026-06-02:

- Branch: `sprint/zenbot-quality-v2`.
- Local branch was `0 3` against `origin/main...HEAD`, meaning local HEAD was
  three commits ahead of `origin/main` at that moment.
- P0.1 dependency audit fix was applied locally with `npm audit fix`; only
  `package-lock.json` changed.
- Updated locked dependency versions include `axios 1.16.1`,
  `express 4.22.2`, `qs 6.15.2`, `protobufjs 7.6.2`, and `ws 8.21.0`, plus
  transitive changes.
- `npm test`: `950 passed, 0 failed`.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.
- P0.3 focused local Basic Sales v2 check passed with 93 tests:
  `node -e "require('./tests/webhook.test.js'); require('./tests/harness').run().then(code => process.exit(code))"`.
- P0.4 Basic Sales v2 behavior contract was documented in
  `docs/basic-sales-v2-behavior-contract.md`.
- P1.1 Basic Sales v2 staging smoke runbook was prepared in
  `docs/basic-sales-v2-staging-smoke-runbook.md`.
- P1.2 Basic Sales v2 staging smoke passed on 2026-06-02 after explicit
  staging DB write approval from Trung. The smoke mutated and restored staging
  `wizard-smoke-shop.shop_settings.settings_json`; `cleanup.restored=true` and
  `adultShop.untouched=true`.
- P1.3 activation decision: during pilot, Basic Sales v2 is a controlled
  feature overlay using `settings_json.basicSalesV2.enabled=true` on a shop
  whose canonical `bot_mode` remains `menu_code_handoff`. Do not expose
  `botMode.name='basic_sales_v2'` as the operator-facing activation path yet.
- Durable Basic Sales v2 staging smoke script now lives at
  `scripts/basic-sales-v2-staging-smoke.js`.
- Generated smoke/UI artifacts, including Playwright screenshots, are kept
  under ignored `output/`.

Re-check all of the above before relying on it.

## Non-Negotiable Safety Rules

- Do not deploy without explicit approval in the same session.
- Do not push without explicit approval in the same session.
- Do not change production environment variables without separate explicit
  approval.
- Do not write production PostgreSQL without a fresh verified backup and
  separate explicit production DB write approval.
- Do not use `DATABASE_URL` for schema verification scripts. Use explicit
  non-production variables such as `CHATBOT_TEST_DATABASE_URL` or
  `CHATBOT_STAGING_DATABASE_URL`.
- Do not print customer data, raw Page IDs, sender IDs, tokens, cookies,
  `DATABASE_URL`, service account JSON, Telegram tokens, or raw message bodies.
- Do not run authenticated production admin smoke without approval because it
  writes audit rows.
- Do not call Meta Graph API, run token health checks, or send Messenger
  messages unless that is the explicit task and the target environment is clear.
- Keep production `WEBHOOK_QUEUE_ENABLED=false` until there is a queue rollout
  runbook, backup, verification plan, rollback plan, and approval.
- Keep file-backed `adult-shop` fallback intact until DB-backed runtime has
  been proven safe in production.

## Operating Strategy

The product should grow in this order:

1. Stabilize the current production pilot.
2. Finish and smoke Basic Sales v2 in staging.
3. Improve observability and operator health views.
4. Expand real Page pilot for the next shop using dry-run-first workflow.
5. Roll out multi-shop production gates one by one.
6. Refactor large files only after behavior is covered and stable.
7. Add advanced sales features only after Basic mode is reliable.

Do not rebuild the chatbot around a new framework. The current modular monolith
is the right shape for the near term. The highest leverage is safer operations,
clearer admin UX, better smoke automation, and smaller code modules.

## P0: Immediate Stabilization

Goal: make the current branch safe to keep developing and safe to stage-smoke.

- [x] P0.1 Fix dependency audit.
  - Run `npm audit fix`.
  - Review `package-lock.json` and any `package.json` changes.
  - Re-run `npm test`.
  - Re-run `npm audit --omit=dev`.
  - Exit criteria: tests pass and audit reports 0 vulnerabilities, or any
    remaining advisory is documented with reason and mitigation.
  - Completed 2026-06-02: `package-lock.json` updated only; `package.json`
    unchanged; `npm test` passed with 950 tests and `npm audit --omit=dev`
    reported 0 vulnerabilities.

- [x] P0.2 Decide whether `output/basic-sales-v2-staging-smoke.js` should be
  committed.
  - It is useful as a staging smoke script.
  - It currently lives under `output/`, which also contains screenshots and
    generated artifacts.
  - Preferred action: move the durable smoke script to `scripts/` or
    `tests/smoke/` in a separate commit, and keep generated screenshots
    untracked.
  - Exit criteria: durable script location is intentional, and generated output
    policy is clear.
  - Completed 2026-06-02: moved the durable script to
    `scripts/basic-sales-v2-staging-smoke.js`; added an `output/` ignore rule
    for generated screenshots and captures; hardened the script to require
    `CHATBOT_STAGING_DATABASE_URL` instead of falling back to `DATABASE_URL`.

- [x] P0.3 Run local Basic Sales v2 focused checks.
  - Use existing tests first; do not hit staging DB by default.
  - Suggested focused local run:

    ```powershell
    node -e "require('./tests/webhook.test.js'); require('./tests/harness').run().then(code => process.exit(code))"
    ```

  - Exit criteria: v2 tests still prove adult-shop classic boundary, v2 menu,
    v2 product-code image/detail/handoff, v2 hot products, and disabled-v2
    fallback.
  - Completed 2026-06-02: focused local webhook suite passed with 93 tests and
    no staging smoke/DB script was run.

- [x] P0.4 Document Basic Sales v2 behavior contract.
  - Add or update a small doc for v2 once behavior is stable.
  - Must include enabled flag, supported bot mode, menu behavior, hot products,
    product-code handoff, disabled features, and staging smoke procedure.
  - Exit criteria: future sessions do not need to infer v2 behavior from code.
  - Completed 2026-06-02: added
    `docs/basic-sales-v2-behavior-contract.md` covering activation, supported
    runtime, menu behavior, Hot Products, product-code handoff, disabled
    features, staging smoke procedure, and local verification.

## P1: Basic Sales V2 Staging Pilot

Goal: prove `basic_sales_v2` safely on staging without touching production.

- [x] P1.1 Prepare staging smoke runbook.
  - Identify staging target shop: likely `wizard-smoke-shop` unless changed.
  - Confirm `MESSENGER_DRY_RUN=true` when using simulated smoke.
  - Confirm `MULTI_SHOP_DB_CONFIG_ENABLED=true`.
  - Confirm no production DB URL is used.
  - Confirm script restores `settings_json` after mutation.
  - Do not print raw tokens, Page IDs, sender IDs, or DB URLs.
  - Completed 2026-06-02: added
    `docs/basic-sales-v2-staging-smoke-runbook.md` covering target
    `wizard-smoke-shop`, required dry-run and DB-config flags, explicit
    `CHATBOT_STAGING_DATABASE_URL` usage, no `DATABASE_URL` fallback,
    restoration checks, secret-handling rules, expected pass criteria, and
    failure handling. The staging smoke itself was run later under P1.2.

- [x] P1.2 Run staging smoke only after explicit approval.
  - The smoke mutates staging `shop_settings.settings_json` and restores it.
  - It should validate:
    - classic menu remains classic when v2 disabled;
    - classic product code sends detail, image, and handoff;
    - classic hot products works only when enabled;
    - v2 menu sends the v2 fallback text and no menu image unless specified;
    - v2 hot products sends configured list and images without handoff;
    - v2 product code sends image, detail, and handoff;
    - v2 disabled returns to classic behavior;
    - `adult-shop` settings hash stays unchanged.
  - Completed 2026-06-02 after explicit approval from Trung. Safe pre-run
    checks passed: script syntax check, focused webhook suite `93 passed,
    0 failed`, full `npm test` `950 passed, 0 failed`, and
    `npm audit --omit=dev` reported `0 vulnerabilities`.
  - The successful run used Railway staging Postgres service env with
    `DATABASE_PUBLIC_URL` mapped into process-local
    `CHATBOT_STAGING_DATABASE_URL`, `DATABASE_URL` removed from the process,
    and staging guards set to `RAILWAY_ENVIRONMENT_NAME=staging`,
    `RAILWAY_ENVIRONMENT=staging`, `MESSENGER_DRY_RUN=true`, and
    `MULTI_SHOP_DB_CONFIG_ENABLED=true`.
  - Smoke result: classic menu/product/hot-products checks passed; v2
    menu fallback, hot-products, product-code handoff, and disable fallback
    checks passed; `cleanup.restored=true`; `adultShop.untouched=true`;
    `wizard-smoke-shop` settings hash
    `27128c4d3af222381ca8c5ac83047c5b6b36e23bd57aff8872181b1cbff3a340`
    was restored; `adult-shop` settings hash
    `acc476c1e06a88a1626b4ba193feb8fb6ebec613348d7f69a3414cc6877e9dd2`
    was unchanged.

- [x] P1.3 Decide whether v2 is a new mode or feature flag overlay.
  - Current code supports `botMode.name='basic_sales_v2'` or
    `basicSalesV2.enabled=true`.
  - Decision needed: for operator UX, prefer one canonical activation path.
  - Completed 2026-06-03: choose
    `settings_json.basicSalesV2.enabled=true` as the canonical activation path
    for staging pilots. Keep `bot_mode='menu_code_handoff'` so operators still
    see the shop as a Basic shop with a controlled v2 overlay, not a separate
    product mode.
  - Treat `botMode.name='basic_sales_v2'` as compatibility/internal runtime
    support only. Do not add it to the admin bot mode dropdown or use it for
    production rollout until v2 has a separate operator UX, rollback copy, and
    production approval path.
  - Rollback rule for pilots: set `settings_json.basicSalesV2.enabled=false`
    or remove the overlay key; the shop returns to classic
    `menu_code_handoff` behavior without changing its canonical bot mode.

- [x] P1.4 Add admin UI copy for v2 after staging pass.
  - Do not expose a casual "enable v2" toggle until rollback behavior is clear.
  - If exposed, require confirmation and show that AI/order/lead capture remain
    disabled.
  - Completed 2026-06-03: added read-only Basic Sales v2 pilot copy to the
    shop detail chat behavior form. The copy shows whether the approved v2
    overlay is active, states that canonical `bot_mode` remains
    `menu_code_handoff`, names the rollback path, and explicitly notes that AI
    fallback, order flow, lead capture, follow-up jobs, Telegram alerts, and
    Sheets writes remain disabled. No casual enable-v2 toggle or
    `basic_sales_v2` bot mode option was exposed.

## P2: Production Pilot Hardening

Goal: make the current live `adult-shop` safer and easier to monitor.

- [x] P2.1 Add or improve per-shop health UI.
  - Existing API: `GET /admin/api/shops/:shopId/health`.
  - Add a compact section in shop detail or dashboard.
  - Show safe metrics only:
    - last webhook timestamp;
    - last successful send timestamp;
    - 1h send error rate;
    - active handoff count;
    - queue counts if schema exists;
    - credential status counts if schema exists.
  - Do not show raw Page IDs, tokens, customer rows, message bodies, or raw
    orders.
  - Completed 2026-06-03: improved the shop detail Overview health card to
    show last webhook, last successful send, 1h send error rate with counts,
    active handoffs, page mapping status counts, queue status counts, and
    credential status counts using the existing read-only health API
    presentation. Added focused HTML coverage to verify the compact health
    metrics render without raw Page IDs, secrets, message bodies, or queue
    payloads.

- [x] P2.2 Add alert thresholds.
  - Trigger operational alert when send error rate rises, queue failed count is
    non-zero, credential status is stale, or no successful send follows recent
    webhooks.
  - Start with read-only dashboard warnings before adding external alerts.
  - Completed 2026-06-03: added read-only operational alert banners to the
    shop detail Health card. The first thresholds warn on any 1h send errors
    and escalate above 10%, failed queue jobs, unavailable/stale credential
    status based on active credential count/schema availability, and a latest
    webhook timestamp that has no later successful bot send. No external alert,
    Meta call, Messenger send, queue action, audit write, env change, or DB
    write is triggered by viewing the dashboard.

- [x] P2.3 Add `processed_mids` cleanup plan.
  - Do not implement destructive cleanup without runbook.
  - First add count-only visibility and retention policy.
  - Candidate policy: keep recent MIDs for 7-30 days depending on Meta retry
    behavior and traffic.
  - Completed 2026-06-03: added count-only per-shop health visibility for
    `processed_mids` retention posture: total rows, rows older than 7 days,
    rows older than 30 days, cleanup candidate count, and oldest/newest
    timestamps. Documented the initial 30-day retention policy and future
    cleanup gates in `docs/processed-mids-retention-plan.md`. No cron, worker,
    delete SQL, production DB write, env change, deploy, push, Meta call, or
    Messenger send was added.

- [x] P2.4 Review outside-24h Messenger behavior.
  - Keep product-code handoff and staff takeover as the primary sales flow.
  - Avoid automated sales messages outside allowed policy windows.
  - Ensure reminder/follow-up workers are disabled or strictly policy-safe for
    Basic shops.
  - Completed 2026-06-03: reviewed Meta Messenger policy/Send API docs and
    documented the repo posture in `docs/messenger-outside-24h-review.md`.
    Standard automated Messenger sends now declare `messaging_type='RESPONSE'`
    and do not use message tags. Basic/minimal sales shops
    (`menu_code_handoff` and `basic_sales_v2`) do not start abandoned-cart or
    engaged follow-up workers; the reminder service also caps automated
    reminder candidates at 23 hours unless a future, explicitly reviewed
    outside-window mechanism is added. Existing stale webhook and
    outside-window send-error handling remain in place. No Meta call,
    Messenger send, deploy, push, env change, or production DB write happened.

## P3: Next Shop Real Page Pilot

Goal: onboard one more shop safely without increasing blast radius.

- [!] P3.1 Preconditions before real Page work.
  - Owner approval for the specific Page.
  - Product/menu content approved by shop owner.
  - Staff are online for the test window.
  - Rollback owner, pilot operator, and monitoring owner named.
  - Exactly one active Page mapping and one active credential expected.
  - All other shops remain dry-run unless intentionally live.

- [ ] P3.2 Dry-run-only setup.
  - Keep global `MESSENGER_DRY_RUN=true` if doing simulation.
  - Keep target shop `dry_run=true`.
  - Map Page and credential only through approved admin flow.
  - Run readiness check and dry-run simulation.
  - Confirm no wrong-shop routing and no Messenger send.

- [!] P3.3 Controlled live window.
  - Requires explicit approval.
  - Set global/per-shop dry-run according to runbook.
  - Test only `menu` and one product code.
  - Confirm image, product info, handoff, and staff takeover.
  - Monitor for 1h, then review at 24h.
  - Roll back immediately on send error, wrong product/image, wrong-shop
    routing, or staff unavailability.

## P4: Queue Rollout Planning

Goal: prepare durable webhook queue without enabling it prematurely.

- [ ] P4.1 Write queue rollout runbook.
  - Preconditions: schema exists, backup, `WEBHOOK_QUEUE_ENABLED=false`,
    worker settings known, rollback plan.
  - Rollout: staging first, production later with approval.
  - Rollback: set `WEBHOOK_QUEUE_ENABLED=false`, leave additive rows in place.

- [ ] P4.2 Add queue observability.
  - Counts by status.
  - Oldest queued job age.
  - Failed count and last safe error code.
  - No raw payload or customer body in UI.

- [!] P4.3 Production enable is blocked.
  - Do not enable `WEBHOOK_QUEUE_ENABLED` in production until runbook and
    approval exist.

## P5: Admin UX And Operator Productivity

Goal: reduce operator mistakes and make onboarding repeatable.

- [x] Setup Wizard MVP exists and was staging verified.
- [x] Product/menu polish exists and was staging verified.
- [x] Fanpage connection UI and credential replacement UX exist in staging.
- [ ] Add shop-card dashboard status.
- [ ] Add clear "safe next action" for every shop state.
- [ ] Add multi-image upload polish if operators are uploading many product
  images.
- [ ] Add better search/filter/pagination for product/admin pages as data
  grows.
- [ ] Keep all write actions confirmed, audited, and reversible where possible.

## P6: Maintainability Refactor

Goal: reduce file size and cognitive load without changing behavior.

Current large files:

- `index.js`: about 1127 lines at last check.
- `core/admin-routes.js`: about 3005 lines at last check.
- `core/admin/views.js`: about 4044 lines at last check.
- `core/webhook.js`: about 1125 lines at last check.

Refactor order:

1. Extract runtime env/config parsing from `index.js`.
2. Extract DB runtime factory and admission/live-gate helpers from `index.js`.
3. Split admin route registration by domain.
4. Split view helpers by screen or component cluster.
5. Keep each slice covered by existing tests before the next slice.

Do not refactor during active production rollout unless the refactor is needed
for a specific safety issue.

## P7: Advanced Sales Features

Goal: expand product capability only after Basic mode is stable.

- [ ] Enable richer lead/order capture only for a controlled package.
- [ ] Keep AI fallback off for Basic shops by default.
- [ ] If AI fallback is enabled later, keep a strict system prompt, bounded
  context, policy-safe fallback, and human handoff on uncertainty.
- [ ] Google Sheets/Telegram integration can stay operator-only; do not make
  them customer-facing channels.
- [ ] Do not build payment, billing, self-serve SaaS signup, WhatsApp,
  Instagram DM, or real-time analytics until there are stable pilot shops and
  clear demand.

## Tool And Skill Strategy

Current recommendation: use repo docs as the primary coordination layer. A
custom Codex skill can help later, but this file is safer because it travels
with the project.

Useful existing skills/tools:

- `playwright`: use for admin UI smoke screenshots and visual regression when
  changing dashboard/wizard/shop detail UI.
- `codex-security`: use for a repository-wide or diff security scan before a
  larger production rollout.
- `github` plugin skills: use when publishing branches, opening PRs, or fixing
  GitHub Actions.
- `openai-docs`: use only when building with OpenAI APIs or ChatGPT Apps.
- `skill-creator`: use if we decide to create a project-specific Codex skill.

Recommended future custom skill:

- Name: `zenbot-operator`.
- Purpose: automatically read `docs/active-delivery-plan.md`,
  `docs/source-map-current.md`, and relevant runbooks; enforce no production
  deploy/env/DB/smoke without explicit approval; report session closeout in the
  standard format.
- Do not create this skill until the user explicitly asks, because skills live
  in the local Codex home, not necessarily inside this repo.

Git/source download policy:

- Do not clone random chatbot frameworks into this repo. The architecture is
  already fit for the current scale.
- Prefer official docs and small reference notes under `docs/research/` when
  researching Meta Messenger, Vertex/Gemini, Cloudinary, Railway, or security.
- If a third-party repo is useful, clone it outside the repo or into a clearly
  ignored scratch area, summarize findings, and do not vendor code unless there
  is a license review and explicit approval.
- Prefer proven libraries only for hard domains we should not hand-roll:
  browser automation, security scanning, PDF/document rendering, or future
  queue/worker primitives if the current implementation stops being enough.

## Source Watchlist

Re-check these sources when changing related behavior:

- Meta Messenger Platform docs for webhooks, Send API, Page tokens,
  `pages_messaging`, message tags, and the 24-hour messaging window.
- Meta policy pages before adding reminders, follow-ups, or AI-generated sales
  replies.
- Google Vertex AI / Gemini docs before changing model names, regions, auth, or
  generation settings.
- Cloudinary docs before changing upload, transformation, folder, or URL
  behavior.
- Railway docs before changing deploy, volume, service, or Postgres operations.
- npm advisories before production deploys or dependency changes.

## Standard Closeout Template

End each session with:

```text
Done:
- ...

Verified:
- npm test: ...
- npm audit --omit=dev: ...
- production /healthz: ...

Not touched:
- deploy: no/yes
- push: no/yes
- production env: no/yes
- production DB: no/yes
- production /data: no/yes
- Meta Graph/Messenger send: no/yes

Git state:
- branch: ...
- status: ...
- ahead/behind: ...

Next:
- ...
```
