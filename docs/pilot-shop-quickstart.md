# Pilot Shop Quickstart

Purpose: fastest safe path for one higher-quality ZenBot v2 pilot shop.

This runbook is not approval to deploy, change env, write DB, touch `/data`,
call Meta Graph API, run token health checks, or send Messenger messages. Use
it only when an approved operator window exists.

## Who Qualifies

A pilot shop qualifies when all are true:

- It is not `adult-shop` and does not reuse a protected slug.
- It can run the Basic `menu_code_handoff` flow.
- It has one intended Facebook Page for the pilot.
- It can provide product/menu copy before setup starts.
- It accepts dry-run first, then a controlled go-live gate.
- It has a human operator ready for handoff and rollback.
- It has no requirement for AI shopping advice, automated order capture, or
  multi-Page routing in week 1.

No-go:

- Production Page must go live immediately.
- Raw tokens or customer data must be shared in chat/docs.
- The shop needs custom runtime code this week.
- The Page is already actively mapped to another shop.

## Required Info

Collect before setup:

- Shop display name and stable lowercase slug.
- Owner/operator contact and escalation path.
- Locale, timezone, and handoff hours.
- Bot mode: `menu_code_handoff`.
- Handoff text and staff instructions.
- Public Page name and exact intended Page.
- Credential owner who can enter the Page token through approved admin flow.
- Product list: code, name, price, description, active status.
- Primary smoke product code.
- Menu image URL/file and product image URLs/files.
- Fallback message when a product code is unclear.
- Compliance notes and forbidden wording.

Never record raw Page token, raw Page ID, customer identifiers, or message
bodies in commits, docs, tickets, or chat.

## Dry-Run Setup

Target setup state:

- Unique shop slug, not `adult-shop`, `admin`, `api`, `webhook`, `system`,
  `test`, `root`, `default`, `public`, or `static`.
- Shop status active only for the approved staging window.
- `package=basic`.
- `lifecycle=draft` or `configuring` until go-live approval.
- `live_enabled=false` until go-live approval.
- Shop `dry_run=true`.
- DB-backed runtime enabled in the target staging environment.
- One active Page mapping for the pilot Page.
- One active encrypted `fb_page_token` credential for that mapping.
- Bot mode `menu_code_handoff`.
- At least one active product, one active menu image, and product image for
  the primary smoke code.

Setup rules:

- Use admin/wizard or approved admin APIs only.
- Do not insert credentials directly into DB.
- Do not call Meta Graph API.
- Do not run token health checks.
- Do not start runtime just to inspect state; `node index.js` calls
  `checkPageToken()` on startup.
- Do not change `adult-shop` config, products, assets, mapping, credential,
  dry-run, live gate, or lifecycle.

## Smoke Checklist

Run in staging dry-run before any live send:

- Full local test suite passes on the target branch.
- Multi-shop isolation test passes.
- Wizard/admin route tests pass if wizard was changed.
- Shop detail renders without raw token/Page ID exposure.
- Readiness reports:
  - intended shop id,
  - bot mode `menu_code_handoff`,
  - one active mapping,
  - one active credential,
  - active products present,
  - menu image present,
  - manual test status acceptable for current phase.
- Dry-run simulation resolves the pilot Page to the pilot shop.
- Menu trigger returns the expected menu response.
- Primary product code resolves to the intended product and image.
- Handoff marker/text appears at the expected point.
- Logs use safe refs, not raw Page IDs or tokens.
- No `page_not_found`, credential, storage-context, or wrong-shop routing
  errors appear.
- No Messenger send is made during dry-run.

Stop if any item fails. Fix configuration before repeating the smoke.

## Go-Live Gate

Go live only after explicit approval with a dated time window.

Required gate:

- Staging dry-run smoke passed on the same code version intended for deploy.
- The target Page, shop slug, and operator are reconfirmed.
- `adult-shop` remains unchanged and stable.
- Runtime code diff is reviewed if any code changed since smoke.
- Production deploy approval is explicit.
- Production DB/write approval is explicit if any production setup is needed.
- Exactly one active mapping and one active credential exist for the pilot.
- Shop remains `dry_run=true` until the final approved live-send switch.
- `live_enabled=true` and `dry_run=false` are changed only for the pilot shop,
  only in the approved window.
- A rollback/pause operator is present.

Production note: `MESSENGER_DRY_RUN=true` is refused by current production
startup guard, so do not rely on it as a production kill switch. Use per-shop
`dry_run`, pause, lifecycle/live gate, and Page mapping controls.

## Rollback/Pause

Fast pause order:

1. Re-enable shop `dry_run=true` for the pilot shop.
2. Pause the shop or set `live_enabled=false` if live gate is enabled.
3. Confirm the shop no longer sends real Messenger messages.
4. Keep the active mapping and credential intact unless the Page is wrong.
5. If the Page is wrong, use approved page archive/cutover runbook; do not
   improvise a direct DB edit.
6. Record safe refs, timestamps, symptom, operator, and final state.

Rollback must not touch `adult-shop`, env, `/data`, raw tokens, or production
DB outside the approved rollback action.
