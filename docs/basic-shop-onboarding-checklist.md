# Basic shop onboarding checklist

This runbook turns the successful staging `demo-shop` Basic E2E pass into a
repeatable checklist for onboarding a new Basic Handoff Bot shop.

It is not approval to deploy, change Railway environment variables, write
production data, touch `/data`, run token health checks, send Messenger
messages, or modify `adult-shop` config/data/assets.

Reference milestone from staging:

- `demo-shop` readiness passed.
- Active page mapping count was exactly `1`.
- Active page credential count was exactly `1`.
- Products, menu assets, and settings were configured.
- Dry-run webhook simulation passed.
- Real Messenger test on a test Page passed for the menu flow and product code
  `11`.
- No Messenger send errors were observed.
- Staging was restored to `MESSENGER_DRY_RUN=true`.
- Production and `adult-shop` were untouched.

## 1. Purpose

Use this checklist to onboard a Basic Handoff Bot shop with the smallest
practical blast radius:

- create a shop shell;
- configure its Basic menu/product experience;
- attach exactly one intended Page mapping;
- attach exactly one intended Page credential through the approved credential
  path;
- prove routing first in dry-run mode;
- run one controlled real Messenger test on a test Page;
- only then decide whether the shop is ready for a live Page.

The checklist is written for staging-first onboarding. A production go-live
needs separate approval and should not be inferred from a staging pass.

## 2. Preconditions

- The operator has explicit approval for the target environment and test
  window.
- The first end-to-end test uses a staging test Page, not the production Page.
- The expected Railway service and environment are selected before any runtime
  check or admin action.
- The deployed staging source branch is the intended branch for the onboarding
  UI/runtime behavior.
- Staging normally starts and ends with `MESSENGER_DRY_RUN=true`.
- `WEBHOOK_QUEUE_ENABLED=false` unless a separate queue rollout has been
  approved.
- DB-backed multi-shop runtime config is enabled for the environment being
  tested.
- The credential master key is already configured and stable for encrypted page
  credentials. Do not print or rotate it as part of shop onboarding.
- The Page to be mapped is not currently active for another shop.
- The new shop has a unique `shop_id` slug and is not `adult-shop`.
- No production smoke, production Page mapping, production credential, or
  production send happens until staging readiness and manual test pass.

## 3. Required inputs from shop

Collect these inputs before opening the onboarding session:

- Shop display name.
- Stable shop slug, for example `demo-shop` or another lowercase
  environment-safe id.
- Plan/tier: `Basic`.
- Bot mode: `menu_code_handoff`.
- Locale and timezone.
- Handoff destination and instructions for staff.
- Public Page name and the exact Page intended for staging test or live use.
- Page admin/operator who can provide the Page credential through the approved
  credential flow.
- Product/menu copy for the Basic flow.
- Product codes, including the primary test code. The staging milestone used
  code `11`.
- Product names, prices, descriptions, and active/inactive state.
- Menu image and product image assets.
- Any compliance notes, restricted content rules, or words that must not appear
  in customer-facing messages.

Do not paste raw Page tokens, raw Page IDs, customer identifiers, or message
bodies into chat, tickets, commit messages, or runbooks.

## 4. Railway/staging safety checks

Before any onboarding action:

- Confirm the Railway project, service, and environment are the intended
  staging targets.
- Confirm the staging deployment source branch is the expected branch.
- Confirm the session is not pointed at production.
- Confirm there is no open task to modify `adult-shop`.
- Confirm `MESSENGER_DRY_RUN=true` before dry-run testing.
- Confirm the operator has a plan to restore `MESSENGER_DRY_RUN=true`
  immediately after the controlled real Messenger test.
- Confirm logs and admin views used during the session do not expose raw tokens,
  raw Page IDs, customer rows, or message bodies.

Stop if the Railway source branch is wrong, the selected environment is
production, or the Page belongs to another active shop.

## 5. Shop creation steps

1. Create the shop shell through the admin onboarding UI/API.
2. Use a unique `shop_id`; do not reuse `adult-shop`, a production customer
   slug, or a previously failed test slug without checking for stale mappings.
3. Set the shop status to active only for the intended staging test window.
4. Set bot mode to `menu_code_handoff`.
5. Set locale and timezone from the shop inputs.
6. Confirm the shop detail page renders after creation.
7. Confirm creation did not implicitly create page mappings, page credentials,
   products, assets, or copied `adult-shop` data.

Expected result: one shop shell exists with default settings, and no customer
traffic can route to it until mapping and credentials are configured.

## 6. Product/menu asset setup steps

1. Create or import the Basic product list for this shop only.
2. Keep product codes short, exact, and unique within the shop. The staging E2E
   proof used code `11`.
3. Mark only intended products active.
4. Add the menu asset used by the menu reply.
5. Add product image assets and connect each active product to its intended
   image.
6. Verify the image shown for code `11` or the shop's chosen test code is the
   expected image.
7. Verify product copy is not copied from `adult-shop` unless it is generic
   fixture text intentionally approved for the new shop.
8. Keep fallback text suitable for handoff if a product cannot be resolved.

Expected result: the Basic menu can show the intended menu image, and the
selected product code resolves to the intended active product and image.

## 7. Page mapping setup steps

1. Use a staging test Page first.
2. Add one active mapping from the test Page to the new shop.
3. Verify the Page is not actively mapped to any other shop.
4. Verify the new shop does not have multiple active Page mappings unless a
   separate multi-Page rollout is explicitly approved.
5. Record only safe identifiers in notes, such as a redacted Page reference or
   hashed `page_ref`.
6. Do not map a production Page before staging readiness and manual test pass.

Expected result: readiness reports exactly one active page mapping for the new
shop.

## 8. Credential setup steps

1. Add the Page credential through the approved admin or credential-seed path.
2. Do not insert credentials directly into the database.
3. Do not reuse the `adult-shop` Page token.
4. Do not paste token values into chat, shell history, logs, docs, or commits.
5. Keep exactly one active `fb_page_token` credential for the intended active
   page mapping.
6. Do not run token health checks as part of Basic shop onboarding.
7. If credential setup fails, stop before dry-run or Messenger testing.

Expected result: readiness reports exactly one active credential for the mapped
test Page.

## 9. Readiness checklist

Readiness must pass before webhook simulation or real Messenger testing:

- Shop exists and is the intended `shop_id`.
- Shop status is active for the test window.
- Bot mode is `menu_code_handoff`.
- Settings row exists and matches locale/timezone expectations.
- Active page mapping count is exactly `1`.
- Active page credential count is exactly `1`.
- Product list contains the intended active test code.
- Product code `11`, or the chosen test code, resolves to one active product.
- Menu asset exists and is connected to the menu response.
- Product image asset exists and matches the product under test.
- No active Page mapping conflict exists.
- `MESSENGER_DRY_RUN=true` before the dry-run test starts.
- `adult-shop` config/data/assets were not modified.

No-go if any readiness item fails.

## 10. Dry-run webhook test

Run the webhook simulation with `MESSENGER_DRY_RUN=true`.

Expected observations:

- The simulated Page resolves to the new shop.
- The menu trigger produces the Basic menu response.
- The selected product code, such as `11`, resolves to the intended product.
- Image markers match the configured menu/product assets.
- Handoff marker appears when the flow reaches handoff.
- No `page_not_found` event appears.
- No DB config fail-closed event appears.
- No credential error appears.
- No Messenger send error appears.
- No real Messenger message is sent.

Stop and fix configuration before continuing if dry-run routing, product
resolution, or asset selection is wrong.

## 11. Real Messenger test on test Page

Run this only after readiness and dry-run webhook simulation pass.

1. Confirm the Page is a staging test Page.
2. Confirm the test account is allowed to message the test Page.
3. Temporarily enable real Messenger sends for staging only after explicit
   approval for that test window.
4. Send the menu trigger from the test account.
5. Confirm the menu response and menu image are correct.
6. Send product code `11`, or the shop's chosen primary test code.
7. Confirm the product response, product image, and handoff behavior are
   correct.
8. Check for Messenger send errors, credential errors, `page_not_found`, and
   wrong-shop routing.
9. Restore staging to `MESSENGER_DRY_RUN=true` immediately after the test.
10. Record only safe counts and outcomes.

Expected result: menu and product-code flows pass on the test Page with no
Messenger send errors.

## 12. Go/no-go before live

Go-live is blocked unless all of these are true:

- Staging readiness passed.
- Dry-run webhook simulation passed.
- Real Messenger test passed on a test Page.
- Staging was restored to `MESSENGER_DRY_RUN=true`.
- No Messenger send errors were observed.
- No wrong-shop routing was observed.
- Active mapping and active credential counts were exactly `1` for the tested
  shop.
- Product and image assets matched the shop inputs.
- The production Page, credential, and go-live window are explicitly approved.
- A rollback owner and rollback steps are named before the live switch.

No-go if any of these are true:

- The Railway source branch is wrong.
- Readiness is failing.
- The Page is mapped to another shop.
- The credential is missing, ambiguous, reused, or unapproved.
- Product code resolution fails.
- Images are missing or mismatched.
- Messenger returns `551` or `#10` errors during the test.
- `MESSENGER_DRY_RUN` was not restored after staging real-send testing.
- Any `adult-shop` config/data/assets were touched.

## 13. Rollback plan

For staging:

- Restore `MESSENGER_DRY_RUN=true`.
- Disable or archive the new shop's test Page mapping through the approved
  admin path.
- Disable or archive the new shop's Page credential through the approved
  credential path.
- Set the shop inactive if traffic should not route to it.
- Keep products/assets in place for diagnosis unless there is explicit approval
  to remove them.
- Record safe counts and error codes only.

For live rollout:

- Stop new live testing immediately.
- Re-enable dry-run or otherwise disable sends using the approved environment
  rollback procedure.
- Disable the live Page mapping for the new shop.
- Disable the live Page credential for the new shop.
- Return traffic to the previous known-good routing state.
- Preserve logs and audit rows for review without printing tokens, Page IDs,
  customer data, or message bodies.

Do not delete production data or manually edit database rows as an emergency
shortcut unless a separate production data-write approval explicitly names that
operation.

## 14. Common failure cases

### Missing demo/shop config

Symptoms:

- Readiness cannot find the shop.
- Settings are missing.
- The menu flow has no configured copy or assets.

Action:

- Stop testing.
- Create or repair the shop shell and settings through the approved admin path.
- Re-run readiness before dry-run simulation.

### Wrong Railway source branch

Symptoms:

- Expected onboarding UI/API is missing.
- Runtime behavior differs from the staging E2E milestone.
- Readiness fields or admin pages do not match the runbook.

Action:

- Stop before writes or Messenger testing.
- Confirm the selected Railway service/environment.
- Get explicit approval before any deploy or source-branch correction.

### dryRun mismatch

Symptoms:

- Dry-run simulation tries to send real Messenger messages.
- Real Messenger test produces no actual send because dry-run is still enabled.
- Staging is left with real sends enabled after the test.

Action:

- Stop the test.
- Restore the expected staging dry-run state.
- Re-confirm the test phase before retrying.
- Treat any unexpected real send as an incident to review.

### Page mapping conflict

Symptoms:

- Readiness shows zero or multiple active mappings.
- The Page routes to the wrong shop.
- Logs show a different shop for the same Page reference.

Action:

- Stop testing.
- Disable the unintended mapping through the approved admin path.
- Keep exactly one active mapping for the intended test Page and shop.
- Re-run readiness and dry-run simulation.

### Credential missing

Symptoms:

- Readiness shows zero active credentials.
- Runtime logs show credential resolution failure.
- Real Messenger sends cannot proceed.

Action:

- Stop before Messenger testing.
- Add one active credential through the approved credential path.
- Do not insert directly into the database.
- Do not run token health checks.
- Re-run readiness.

### Product code not resolving

Symptoms:

- Code `11`, or the chosen test code, returns fallback behavior.
- The product is not shown, or handoff happens without product context.

Action:

- Confirm the product code is exact and active.
- Confirm the product belongs to the new shop.
- Confirm there is no duplicate active code within the shop.
- Re-run dry-run simulation before any real Messenger test.

### Image asset mismatch

Symptoms:

- Menu image is missing or belongs to another shop.
- Product code resolves but shows the wrong image.
- Image marker points to an unexpected asset.

Action:

- Confirm menu and product asset records are attached to the new shop.
- Replace the asset association through the approved admin path.
- Do not reuse `adult-shop` assets unless explicitly approved as shared
  generic assets.
- Re-run dry-run simulation and then the test Page flow.

### Messenger 551/#10 errors

Symptoms:

- Messenger send fails with `551`.
- Messenger send fails with `#10`.
- Menu or product reply does not reach the tester.

Action:

- Stop real-send testing.
- Restore staging to `MESSENGER_DRY_RUN=true`.
- For `551`, confirm the tester/Page can legally receive the message and that
  the conversation state is eligible.
- For `#10`, confirm Page permissions and app/Page access with the Page owner.
- Do not reuse another shop's token to bypass the error.
- Retry only after readiness is still passing and the Page owner confirms the
  permission issue is resolved.

## 15. What not to do

- Do not test production first.
- Do not reuse an `adult-shop` Page mapping or Page token.
- Do not copy `adult-shop` config/data/assets into a new shop without explicit
  approval.
- Do not insert credentials directly into the database.
- Do not enable `live_enabled=true` until readiness and manual test pass.
- Do not run token health checks during Basic onboarding.
- Do not leave staging in real-send mode after the test.
- Do not touch `/data`.
- Do not deploy as part of this checklist unless a separate deployment approval
  explicitly says to deploy.
- Do not print raw Page IDs, tokens, customer identifiers, message bodies, or
  database URLs.
