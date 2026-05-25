# Real Page Pilot Checklist

This checklist covers moving `nem-bui-xa` from successful staging test Page
validation to a real Page dry-run-only setup and a controlled live test window.
It is documentation-only and is not approval to deploy, change environment
variables, write a database, touch `/data`, call Meta Graph API, run token
health checks, send Messenger messages, or modify `adult-shop` or `demo-shop`
config, data, or assets.

## Current Checkpoint

- [ ] `nem-bui-xa` real Messenger staging test passed.
- [ ] Rollback completed after the staging test.
- [ ] `nem-bui-xa` is back to `dry_run=true`.
- [ ] Global `MESSENGER_DRY_RUN=true`.
- [ ] `live_enabled=false`.
- [ ] No Messenger send errors were observed during the staging test.
- [ ] No wrong-shop routing was observed during the staging test.
- [ ] No `adult-shop` or `demo-shop` side effects were observed.

## Preconditions Before Touching The Real Page

- [ ] Shop owner has explicitly approved using the real Page.
- [ ] Shop owner has approved the product/menu content for the pilot.
- [ ] Staff are online and ready to take over conversations.
- [ ] Rollback owner is named: `TBD`.
- [ ] Pilot operator is named: `TBD`.
- [ ] Monitoring owner is named: `TBD`.
- [ ] Real Page identity is confirmed by the shop owner without printing raw
      Page IDs in chat or logs.
- [ ] Real Page has no conflicting active mapping for another shop.
- [ ] All operators understand the no-go conditions in this checklist.

Do not continue if any item above is incomplete.

## Real Page Dry-Run-Only Steps

Keep the system in dry-run-only mode while preparing the real Page. These steps
are for the approved future pilot window, not for this documentation update.

- [ ] Confirm global `MESSENGER_DRY_RUN=true`.
- [ ] Confirm `nem-bui-xa` `dry_run=true`.
- [ ] Confirm every other shop remains `dry_run=true`.
- [ ] Archive the staging/test Page mapping for `nem-bui-xa` if it would
      conflict with the real Page pilot.
- [ ] Map the approved real Page to `nem-bui-xa`.
- [ ] Add the approved real Page credential for `nem-bui-xa`.
- [ ] Confirm exactly one active Page mapping exists for `nem-bui-xa`.
- [ ] Confirm exactly one active Page credential exists for that mapping.
- [ ] Run a dry-run webhook simulation for the real Page mapping.
- [ ] Confirm the dry-run menu response resolves to `nem-bui-xa`.
- [ ] Confirm dry-run code `1` resolves to the approved product and image.
- [ ] Confirm no real Messenger sends occur during dry-run simulation.
- [ ] Confirm no `adult-shop` or `demo-shop` config, data, or asset changes
      occur.

Stop and rollback to the prior safe mapping state if dry-run routing, product,
image, credential resolution, or shop isolation is wrong.

## Controlled Live Window

Only start the live window after all dry-run-only checks pass and the
preconditions remain true.

- [ ] Set global `MESSENGER_DRY_RUN=false` for the approved live window.
- [ ] Set `nem-bui-xa` `dry_run=false`.
- [ ] Keep all other shops at `dry_run=true`.
- [ ] Keep `WEBHOOK_QUEUE_ENABLED=false` unless a separate queue rollout has
      been approved.
- [ ] Test menu only.
- [ ] Test product code `1` only.
- [ ] Confirm menu image is correct.
- [ ] Confirm product image and product info for code `1` are correct.
- [ ] Confirm handoff is active and staff can respond.
- [ ] Do not test other product codes during the initial controlled window.
- [ ] Do not enable or expand live traffic outside the approved window.

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

- [ ] Watch for Messenger send errors.
- [ ] Watch for wrong product or wrong image responses.
- [ ] Watch for Page conflict or wrong-shop routing.
- [ ] Confirm handoff starts after product code `1`.
- [ ] Confirm staff are online and can answer.
- [ ] Roll back immediately on any no-go condition.

### First 1 Hour

- [ ] Recheck send error count.
- [ ] Recheck wrong-shop routing indicators.
- [ ] Recheck customer/staff handoff behavior.
- [ ] Confirm no unexpected product codes were tested.
- [ ] Confirm no `adult-shop` or `demo-shop` side effects.

### 24 Hours

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
