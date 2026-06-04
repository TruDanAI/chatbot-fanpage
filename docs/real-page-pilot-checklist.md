# Real Page Pilot Checklist

This checklist covers moving `nem-bui-xa` from successful staging test Page
validation to a real Page dry-run-only setup and a controlled live test window.
It is documentation-only and is not approval to deploy, change environment
variables, write a database, touch `/data`, call Meta Graph API, run token
health checks, send Messenger messages, or modify `adult-shop` or `demo-shop`
config, data, or assets.

## Current Checkpoint

- [x] `nem-bui-xa` real Messenger staging test passed.
- [x] Rollback completed after the staging test.
- [x] `nem-bui-xa` is back to `dry_run=true`.
- [x] Global `MESSENGER_DRY_RUN=true`.
- [x] `live_enabled=false`.
- [x] No Messenger send errors were observed during the staging test.
- [x] No wrong-shop routing was observed during the staging test.
- [x] No `adult-shop` or `demo-shop` side effects were observed.
- [x] Shop detail Safety tab now includes a read-only Real Page Pilot Gate for
      P3 dry-run-first setup checks. It does not create mappings, save
      credentials, change dry-run, call Meta, send Messenger messages, or
      approve a live window.
- [x] The Real Page Pilot Gate includes read-only counts for other
      active/non-archived shops that are dry-run, not dry-run, or live-capable
      so operators can confirm any exception is intentionally live before the
      pilot.
- [x] The Real Page Pilot Gate keeps the P3.2 dry-run-only setup signal
      incomplete when another active/non-archived shop is not dry-run or is
      live-capable, until the exception is intentionally reviewed.
- [x] P3.2 production dry-run simulation passed for shop `1018518438021869` /
      Nem Bui Xa with exact product code `TS01`.
- [x] P3.2 simulation flags passed: `menu_pass=1`, `product_pass=1`,
      `mapping_pass=1`, `credential_pass=1`, and `handoff_pass=1`.
- [x] Production readiness is now `passed`; hard blockers are `none`.
- [x] Remaining P3.2 warning is `multiple_menu_images` with counts:
      products=3, menu images=4, product images=3, mappings=1, auth records=1.
- [x] `adult-shop` was untouched; the before/after snapshot hash matched.
- [x] Rollback reference:
      `output/p3-2-prod-dry-run-rollback-2026-06-04T11-18-06-574Z.json`.
- [x] P3.3 partial/no-traffic live enablement and rollback drill passed for
      production shop `1018518438021869` / Nem Bui Xa on 2026-06-04. Live
      enablement passed, rollback passed, `adult-shop` was untouched, and
      observed send errors were `0`. Rollback artifact:
      `output/p3-3-prod-controlled-live-rollback-2026-06-04T16-44-20-584Z.json`.
- [ ] P3.3 full live verification is not complete. A second controlled live
      window with an inbound tester is required to verify Messenger `menu`,
      product code `TS01`, handoff, and staff takeover.

## P0.2 Emergency Control Checkpoint

- [x] Commit `2ea325b Add shop pause and resume controls` was deployed to
      staging.
- [x] Staging deployment `b7818f64-6358-4057-a04f-8bdb7c58f922` finished
      `SUCCESS`.
- [x] Pause/resume was tested on `nem-bui-xa`.
- [x] Pause sets `status=paused`, `lifecycle=paused`, `dry_run=true`, and
      `live_enabled=false`.
- [x] Runtime fails closed while the shop is paused.
- [x] Resume returns `status=active`, `lifecycle=configuring`,
      `dry_run=true`, and `live_enabled=false`.
- [x] Readiness check after resume passed with a `product_assets_ready`
      warning only.
- [x] `adult-shop` and `demo-shop` config, data, and assets were unchanged.
- [x] No Messenger sends were performed.
- [x] No production action was taken.

## P0.3 Dry-Run Controls Checkpoint

- [x] Commit `980928c Add safe shop dry-run controls` was deployed to staging.
- [x] Staging deployment `74465cb2-4854-4ffb-ba9a-59f76f896994` finished `SUCCESS`.
- [x] Dry-run disable/enable was tested on `nem-bui-xa`.
- [x] Disabling dry-run set `nem-bui-xa` `dry_run=false` only.
- [x] Enabling dry-run restored `nem-bui-xa` `dry_run=true`.
- [x] `live_enabled` stayed `false` throughout the sequence.
- [x] `lifecycle` stayed `configuring` throughout the sequence.
- [x] Global `MESSENGER_DRY_RUN` stayed `true` (no actual sends).
- [x] `adult-shop` and `demo-shop` config, data, and assets were unchanged.
- [x] No Messenger sends were performed.
- [x] No production action was taken.
- [x] P0.1 (readiness check), P0.2 (emergency brake), and P0.3 (safe dry-run controls) are completely implemented and verified.

## Preconditions Before Touching The Real Page

Current status 2026-06-04: P3.1 manual approval gate is complete for P3.2
dry-run only. Page target is Nem Bui Xa. Trung approved the Page target,
approved the current menu plus exact catalog product code `TS01`, and is the
staff tester, rollback owner, pilot operator, and monitoring owner for the
current test window. P3.2 production dry-run has passed. A P3.3 no-traffic
live enablement plus rollback drill passed on 2026-06-04, but P3.3 full live
verification remains incomplete. The next P3.3 window requires an inbound
tester and must still verify `menu`, `TS01`, handoff, and staff takeover. The
`multiple_menu_images` readiness warning is accepted for dry-run only.

- [x] Shop owner has explicitly approved using the real Page.
- [x] Shop owner has approved the product/menu content for the pilot: current
      menu plus exact catalog product code `TS01`.
- [x] Staff are online and ready to take over conversations: Trung self-tests
      and monitors in the current window.
- [x] Rollback owner is named: `Trung`.
- [x] Pilot operator is named: `Trung`.
- [x] Monitoring owner is named: `Trung`.
- [x] Real Page identity is confirmed by the shop owner without printing raw
      Page IDs in chat or logs.
- [x] Real Page has no conflicting active mapping for another shop; P3.2
      `mapping_pass=1`.
- [x] All operators understand the no-go conditions in this checklist.

Do not continue to the next P3.3 live-window work until there is separate
explicit live approval for that window. Production DB writes still require a
fresh verified backup and separate explicit production DB write approval.

## Real Page Dry-Run-Only Steps

Keep the system in dry-run-only mode while preparing the real Page. P3.2 is now
complete for shop `1018518438021869` / Nem Bui Xa; these checks do not approve
P3.3 live.

- [ ] Confirm global `MESSENGER_DRY_RUN=true`.
- [x] Confirm target shop `dry_run=true`.
- [ ] Confirm every other shop remains `dry_run=true`.
- [x] Confirm the approved real Page has exactly one active mapping for the
      target shop.
- [x] Confirm exactly one active Page credential exists for that mapping.
- [x] Open the shop detail Safety tab and confirm the Real Page Pilot Gate
      shows target shop `dry_run=true`, `live_enabled=false`, exactly one
      active mapping, exactly one active credential, readiness passed, and
      manual dry-run simulation passed.
- [ ] Confirm the Real Page Pilot Gate shows either all other active shops are
      dry-run or every not-dry-run/live-capable exception is intentionally
      live for the pilot window.
- [x] Run the approved dry-run wizard simulation for the real Page mapping.
- [x] Confirm the dry-run menu check passed for the target shop.
- [x] Confirm dry-run code `TS01` resolves to the approved product and image.
- [x] Confirm no real Messenger sends occur during dry-run simulation.
- [x] Confirm no `adult-shop` config, data, or asset changes occur.
- [ ] Confirm no `demo-shop` config, data, or asset changes occur.

Stop and rollback to the prior safe mapping state if dry-run routing, product,
image, credential resolution, or shop isolation is wrong.

## Controlled Live Window

Only start the live window after all dry-run-only checks pass and the
preconditions remain true.

The 2026-06-04 no-traffic drill does not satisfy the live verification items
below. Leave the Messenger, handoff, and staff takeover checks open until a
second controlled live window has an inbound tester.

- [ ] Set global `MESSENGER_DRY_RUN=false` for the approved live window.
- [ ] Set `nem-bui-xa` `dry_run=false`.
- [ ] Keep all other shops at `dry_run=true`.
- [ ] Keep `WEBHOOK_QUEUE_ENABLED=false` unless a separate queue rollout has
      been approved.
- [ ] Test menu only.
- [ ] Test product code `TS01` only.
- [ ] Confirm menu image is correct.
- [ ] Confirm product image and product info for code `TS01` are correct.
- [ ] Confirm handoff is active and staff can respond.
- [ ] Do not test other product codes during the initial controlled window.
- [ ] Do not enable or expand live traffic outside the approved window.

### No-Traffic Controlled Live Attempt - 2026-06-04

- [x] Live enablement passed for production shop `1018518438021869` /
      Nem Bui Xa.
- [x] Rollback passed; target returned to `dry_run=true`,
      `live_enabled=false`.
- [x] Readiness/manual test remained `passed`.
- [x] `adult-shop` was untouched.
- [x] Observed send errors: `0`.
- [x] Rollback artifact:
      `output/p3-3-prod-controlled-live-rollback-2026-06-04T16-44-20-584Z.json`.
- [ ] Messenger `menu` was not run because no inbound target message appeared
      in the log window.
- [ ] Messenger `TS01` was not run.
- [ ] Handoff/staff takeover was not reached.
- [ ] Full P3.3 live verification remains open and needs a second controlled
      live window with an inbound tester.

## Rollback

Rollback is the default action for any no-go condition, uncertainty, or staff
availability issue.

- [ ] Set `nem-bui-xa` `dry_run=true`.
- [ ] Set global `MESSENGER_DRY_RUN=true`.
- [ ] Confirm no further real Messenger sends are expected.
- [ ] Leave other shops at `dry_run=true`.
- [ ] Record the rollback owner, timestamp, trigger, and observed impact.
- [ ] Do not delete product rows, audit rows, credentials, messages, or `/data`
      files as a rollback shortcut.

## Monitoring

### First 15 Minutes

- [x] 2026-06-04 no-traffic drill: rollback occurred before target traffic;
      observed send errors were `0`.
- [ ] Watch for Messenger send errors.
- [ ] Watch for wrong product or wrong image responses.
- [ ] Watch for Page conflict or wrong-shop routing.
- [ ] Confirm handoff starts after product code `TS01`.
- [ ] Confirm staff are online and can answer.
- [ ] Roll back immediately on any no-go condition.

### First 1 Hour

- [ ] 2026-06-04 no-traffic drill: 1h monitoring did not continue because the
      target was rolled back before traffic.
- [ ] Recheck send error count.
- [ ] Recheck wrong-shop routing indicators.
- [ ] Recheck customer/staff handoff behavior.
- [ ] Confirm no unexpected product codes were tested.
- [ ] Confirm no `adult-shop` or `demo-shop` side effects.

### 24 Hours

- [ ] 2026-06-04 no-traffic drill: 24h review did not continue because the
      target was rolled back before traffic.
- [ ] Review send errors and routing failures for the full period.
- [ ] Review shop owner feedback.
- [ ] Review staff feedback.
- [ ] Decide whether to keep dry-run, repeat a controlled window, or prepare a
      separate live rollout plan.

## No-Go Conditions

Do not start, or immediately roll back, if any of these occur:

- Wrong image or wrong product is shown.
- Messenger send error occurs.
- Page conflict or wrong-shop routing is suspected.
- Staff are unavailable.
- Shop owner approval is missing or withdrawn.
- Global dry-run and per-shop dry-run states do not match the intended phase.
- More than one active real Page mapping or credential is present for
  `nem-bui-xa`.
- Any `adult-shop` or `demo-shop` config, data, or asset change is required.
