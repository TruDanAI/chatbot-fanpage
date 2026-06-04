# Admin Image Upload Staging Smoke Runbook

Last updated: 2026-06-04, Asia/Bangkok.

This runbook prepares the local-file admin image upload staging smoke. It does
not grant approval to enable the feature or run the smoke. The smoke changes
staging environment variables, uploads files to Cloudinary, and writes staging
database rows, so it must only run after explicit approval in the same session.

## Scope

Target:

- Environment: staging only.
- Feature flag: `ADMIN_IMAGE_UPLOAD_ENABLED=true`.
- Storage provider: Cloudinary through `CLOUDINARY_URL` and
  `CLOUDINARY_FOLDER`.
- Admin surface: shop detail image/assets UI.
- Uploads: one menu image and one product image from local disk.

The smoke validates that operators can use a no-URL workflow for menu and
product images while the runtime still receives public HTTPS image URLs.

Out of scope:

- production env changes;
- production deploys;
- production database writes;
- production Page cutover;
- queue rollout or `WEBHOOK_QUEUE_ENABLED`;
- Meta Graph API token health checks;
- real Messenger sends;
- credential rotation.

## Required Approval

Before running the smoke, get explicit approval that names all of these:

- approval to stage-enable local-file admin image upload;
- staging target shop ID or slug;
- staging product that will receive the product image;
- approval to set or update staging `ADMIN_IMAGE_UPLOAD_ENABLED`;
- approval to set or update staging `CLOUDINARY_URL`;
- approval to set or update staging `CLOUDINARY_FOLDER`;
- approval for any optional staging upload limits:
  `IMAGE_UPLOAD_MAX_BYTES`, `IMAGE_UPLOAD_ALLOWED_MIME`, and
  `IMAGE_UPLOAD_ALLOWED_EXT`;
- approval for the staging service restart or redeploy caused by env changes,
  if the hosting platform requires it;
- approval that the smoke may create staging `shop_assets` rows, write staging
  admin audit metadata, and store files in Cloudinary;
- whether post-smoke cleanup/archive of the test assets is approved;
- confirmation that production env, production DB, queue enablement, Meta API
  calls, and Messenger sends are not approved;
- operator who will review the final summary.

Do not infer this approval from a general request to prepare, inspect, or
review the upload feature.

Suggested approval wording:

```text
Approve P5 staging image-upload smoke for staging only.
Target shop: <shop-id-or-slug>.
Target product: <product-id-or-code>.
Approved staging env changes: ADMIN_IMAGE_UPLOAD_ENABLED=true,
CLOUDINARY_URL, CLOUDINARY_FOLDER, and <optional upload limits or "no optional limits">.
Approved staging writes: upload one menu image and one product image, create
staging shop_assets rows, write staging admin audit metadata, and store files
in Cloudinary. <Cleanup/archive approved or not approved>.
Production env, production DB, WEBHOOK_QUEUE_ENABLED, Meta API calls, and
Messenger sends are not approved.
```

## Preconditions

Confirm these before any env change or upload:

- Target runtime is staging, not production.
- `MESSENGER_DRY_RUN=true` for staging.
- `MULTI_SHOP_DB_CONFIG_ENABLED=true` for staging.
- Target shop is not `adult-shop` unless the owner explicitly approves that
  staging-only target.
- Target shop is active and dry-run.
- Target product is active and belongs to the target shop.
- Current URL-only asset management still works.
- Admin user has product write permission.
- Local verification has passed.
- Cloudinary folder is staging-specific, for example
  `zenbot-staging/admin_uploads`, not a production folder.

If there is any uncertainty that a credential, DB URL, or admin session targets
staging, stop. Do not print or paste secrets while resolving it.

## Secret Handling

Do not print or paste:

- raw Page IDs;
- sender IDs;
- Page tokens or encrypted credential values;
- DB URLs;
- Cloudinary secret values;
- service account JSON;
- raw customer message bodies;
- cookies or admin session values.

When reporting results, use safe shop slugs, product codes, counts, booleans,
and public HTTPS image hostnames only. Do not include full Cloudinary storage
keys unless the operator explicitly needs them for cleanup and the value has no
secret material.

## Pre-Run Local Checks

These checks are safe and do not hit staging:

```powershell
node --check core/admin/asset-uploads.js
node --check core/admin-routes.js
npm test
npm audit --omit=dev
```

Optional focused local upload service check:

```powershell
node -e "require('./tests/asset-uploads.test.js'); require('./tests/harness').run().then(code => process.exit(code))"
```

Expected current local baseline:

- full suite: 960 passed, 0 failed;
- audit: 0 vulnerabilities.

## Staging Env Enablement

Run only after explicit staging env approval.

Set these on the staging service only:

- `ADMIN_IMAGE_UPLOAD_ENABLED=true`;
- `CLOUDINARY_URL=<staging Cloudinary URL>`;
- `CLOUDINARY_FOLDER=<staging-specific folder>`.

Optional limits, if approved:

- `IMAGE_UPLOAD_MAX_BYTES`;
- `IMAGE_UPLOAD_ALLOWED_MIME`;
- `IMAGE_UPLOAD_ALLOWED_EXT`.

Do not set these variables on production. Do not change
`WEBHOOK_QUEUE_ENABLED`.

After env changes, restart or redeploy staging only if required and approved.
Then confirm the staging admin process shows upload forms on the target shop
assets section. If the UI still reports disabled or not configured, stop and
review staging env only.

## Approved Smoke Steps

Run only after explicit staging DB/write and Cloudinary approval.

1. Open the staging admin shop detail page for the approved target shop.
2. Go to the assets/image section.
3. Upload one local menu image through the menu image upload form.
4. Verify the response redirects back to the shop detail page and shows the
   upload success banner.
5. Verify the new menu image appears as an active asset with an HTTPS public
   URL and renders as a thumbnail/image in the admin UI.
6. Upload one local product image through the product image upload form for the
   approved active product.
7. Verify the response redirects back to the shop detail page and shows the
   upload success banner.
8. Verify the new product image appears as an active asset with an HTTPS public
   URL and renders as a thumbnail/image in the admin UI.
9. Verify runtime image resolution uses the uploaded HTTPS URL. Prefer a
   staging dry-run simulation path that is already approved for staging writes;
   do not use a live Messenger send.
10. Review visible UI/log output and confirm no Cloudinary secret, raw Page ID,
    customer data, DB URL, token, or message body is exposed.

## What The Smoke Mutates

Successful uploads create staging `shop_assets` rows with:

- `storage_provider='object_storage'`;
- Cloudinary storage key;
- public HTTPS URL;
- image content type and size;
- `asset_type='menu_image'` or `asset_type='product_image'`;
- optional product linkage for product images;
- status and sort order from the form.

The upload service also writes staging admin audit metadata for
`admin.shop_asset.upload`. It does not intentionally write production data and
does not call Meta Graph API or Messenger.

If DB/audit persistence fails after the Cloudinary upload, the service attempts
best-effort Cloudinary cleanup and logs only safe references.

## Expected Pass Criteria

The smoke passes only if all of these are true:

- staging upload forms are hidden before enablement and visible only after
  approved staging enablement;
- menu image upload succeeds;
- product image upload succeeds for the approved active product;
- uploaded URLs are HTTPS Cloudinary URLs;
- admin thumbnails/rendering work for both uploaded images;
- runtime image resolution uses the uploaded HTTPS URLs in dry-run;
- staging audit metadata is written without exposing secrets;
- no production env, production DB, queue, Meta API, or Messenger send action
  occurs.

## Failure Handling

If any step fails:

1. Do not continue to the next upload.
2. Do not retry repeatedly against Cloudinary.
3. Record the safe error code and affected approved shop/product only.
4. If a partial Cloudinary upload may have happened without a DB row, stop and
   ask whether cleanup is approved.
5. If cleanup/archive was not included in the original approval, do not archive
   assets or delete Cloudinary files.
6. Do not run any production command.

If a production write, Meta API call, Messenger send, or queue enablement is
observed, stop the rollout and treat it as a safety incident.

## Rollback

Feature rollback:

- set staging `ADMIN_IMAGE_UPLOAD_ENABLED=false` or remove it;
- restart/redeploy staging only if required and approved;
- leave `CLOUDINARY_URL` and `CLOUDINARY_FOLDER` unchanged unless env cleanup is
  explicitly approved.

Data cleanup:

- only archive or hide smoke-created `shop_assets` rows if cleanup was
  approved;
- only delete Cloudinary objects if cleanup was approved and the exact objects
  are known;
- do not hard-delete production or staging DB rows as part of this smoke.

Production enablement remains separate and must not be combined with real Page
live tests, queue rollout, credential rotation, or production DB changes.

## Post-Run Checks

After an approved successful smoke:

- confirm the uploaded menu image and product image both render in staging;
- confirm dry-run runtime behavior uses the uploaded HTTPS URLs;
- confirm no sensitive values appeared in UI/log output;
- re-run local tests if code changed;
- re-run `npm audit --omit=dev` if dependencies changed;
- update `docs/active-delivery-plan.md` with the date, target shop, safe result
  summary, cleanup decision, and next production approval gate.

Do not use a successful staging smoke as production approval.
