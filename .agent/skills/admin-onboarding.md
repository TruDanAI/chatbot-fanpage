# Admin Onboarding

Use this skill for admin shop onboarding, shop setup, page mapping, page credentials, products/assets, readiness, and per-shop health.

## Current Flow

1. Create a shop shell.
   - Create only the `shops` row, default `shop_settings`, and `admin_audit_log` row.
   - Default shell values are `status=active`, `bot_mode=menu_code_handoff`, `locale=vi-VN`, and `timezone=Asia/Ho_Chi_Minh`.
2. Add a page mapping.
   - Create an active `shop_pages` mapping for the shop.
   - Use `page_ref` in responses/audit when raw `page_id` is not required.
3. Add or rotate the page credential.
   - Treat credentials as a separate phase from page mapping.
   - Require rotate mode when an active credential already exists.
4. Add products and assets.
   - Add active products first, then `menu_image` and `product_image` assets.
   - Validate asset URLs and avoid private/local hosts.
5. Check onboarding readiness.
   - Use the shop detail readiness checklist: page mapping, credential, product, menu asset, product asset, and health.
6. Check shop health.
   - Use `/admin/api/shops/:shopId/health` for safe per-shop status summaries.

## Safety Rules

- Credentials are a separate phase. Do not combine page mapping and credential writes unless the code explicitly supports that transaction.
- Do not include tokens in responses, audit metadata, logs, tests, or final answers.
- Do not include `encrypted_value` in responses, audit metadata, logs, tests, or final answers.
- Do not include raw `page_id` when `page_ref` is enough.
- Use transactions for writes and verify `COMMIT` succeeded.
- Audit every admin write with metadata that is useful but sanitized.
- Keep write endpoints permission-gated through existing admin authorization.
- On schema-missing errors, fail safely with a sanitized error shape.

## Useful Route Surface

- `GET /admin/shops/new`: shop shell form.
- `POST /admin/api/shops`: create shop shell.
- `POST /admin/api/shops/:shopId/pages`: add page mapping.
- `POST /admin/api/shops/:shopId/pages/:pageMappingId/credentials`: add or rotate page credential.
- `POST /admin/api/shops/:shopId/products`: add product.
- `POST /admin/api/shops/:shopId/assets`: add asset.
- `GET /admin/api/shops/:shopId`: shop detail and readiness.
- `GET /admin/api/shops/:shopId/health`: per-shop health summary.

## Review Checklist

- Does the write happen in one transaction with rollback on failure?
- Does audit metadata omit token, `encrypted_value`, raw `page_id`, customer data, and message bodies?
- Does the response use `page_ref` and count/status summaries?
- Do tests cover unauthorized, missing permission, validation, duplicate, success, and secret-redaction cases?
