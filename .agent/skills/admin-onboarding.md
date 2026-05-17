# Admin Onboarding

Use this skill for admin shop onboarding, shop setup, page mapping, page credentials, products/assets, readiness, and per-shop health.

## Current Flow

### 1. Create a shop shell
- Create only the `shops` row, default `shop_settings`, and `admin_audit_log` row.
- Default shell values: `status=active`, `bot_mode=menu_code_handoff`, `locale=vi-VN`, `timezone=Asia/Ho_Chi_Minh`.
- Do not proceed to page mapping until the shell `COMMIT` is verified.

### 2. Add a page mapping
- Create an active `shop_pages` mapping for the shop.
- Use `page_ref` in responses and audit when raw `page_id` is not required.
- One shop may have multiple page mappings. Confirm the intended page before writing.

### 3. Add or rotate the page credential
- Treat credentials as a **separate phase** from page mapping. Do not combine them in one request unless the code explicitly supports that transaction.
- If an active credential already exists, rotate mode is required. A new insert without rotate will conflict.
- Follow `credential-safety.md` for the full write pattern.

### 4. Add products and assets
- Add **active products first**, then add assets (`menu_image`, then `product_image`).
- Order matters: the readiness check requires at least one active product before asset presence is meaningful. Adding assets to a shop with no products passes partial readiness but will fail the product check.
- Validate asset URLs for accessibility and reject private/local hosts (`localhost`, `127.0.0.1`, internal ranges).

### 5. Check onboarding readiness
Run `GET /admin/api/shops/:shopId` and verify each item on the readiness checklist:

| Check | Required |
|-------|---------|
| Page mapping (active) | Yes |
| Credential (active) | Yes |
| Product (at least one active) | Yes |
| Menu asset | Yes |
| Product asset | Yes |
| Health | Pass |

If any check fails, do not mark the shop as ready for production traffic. See **Readiness Failure Escalation** below.

### 6. Check shop health
- Use `GET /admin/api/shops/:shopId/health` for safe per-shop status summaries.
- Health checks credential decryptability, page mapping activity, and product/asset presence without exposing raw values.

## Readiness Failure Escalation

If a readiness check fails after completing the flow:

| Failing check | Likely cause | Action |
|--------------|-------------|--------|
| Page mapping | `shop_pages` row missing or inactive | Re-run step 2; verify `COMMIT` |
| Credential | No active credential or decryption failure | Re-run step 3 with rotate mode; check `CREDENTIAL_MASTER_KEY` |
| Product | No active product rows | Re-run step 4; check `status=active` on insert |
| Menu asset | Asset row missing or URL invalid | Re-add asset; validate URL is publicly reachable |
| Product asset | Asset row missing or URL invalid | Re-add asset; validate URL is publicly reachable |
| Health | Credential decrypt error or mapping conflict | Use `messenger-webhook-debugging.md` for runtime diagnosis |

If credential decrypt errors appear in health, do not expose key material. Report count only and follow `credential-safety.md`.

## Safety Rules

- Credentials are a separate phase. Do not combine page mapping and credential writes unless the code explicitly supports that transaction.
- Do not include tokens in responses, audit metadata, logs, tests, or final answers.
- Do not include `encrypted_value` in responses, audit metadata, logs, tests, or final answers.
- Do not include raw `page_id` when `page_ref` is enough.
- Use transactions for all writes and verify `COMMIT` succeeded before the next step.
- Audit every admin write with metadata that is useful but sanitized.
- Keep write endpoints permission-gated through existing admin authorization.
- On schema-missing errors, fail safely with a sanitized error shape.

## Route Surface

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/shops/new` | Shop shell form |
| `POST` | `/admin/api/shops` | Create shop shell |
| `POST` | `/admin/api/shops/:shopId/pages` | Add page mapping |
| `POST` | `/admin/api/shops/:shopId/pages/:pageMappingId/credentials` | Add or rotate page credential |
| `POST` | `/admin/api/shops/:shopId/products` | Add product |
| `POST` | `/admin/api/shops/:shopId/assets` | Add asset |
| `GET` | `/admin/api/shops/:shopId` | Shop detail and readiness |
| `GET` | `/admin/api/shops/:shopId/health` | Per-shop health summary |

## Review Checklist

- Does every write happen in one transaction with rollback on failure?
- Is `COMMIT` verified before the next dependent write?
- Does audit metadata omit token, `encrypted_value`, raw `page_id`, customer data, and message bodies?
- Does the response use `page_ref` and count/status summaries?
- Do tests cover: unauthorized, missing permission, validation failure, duplicate conflict, success, and secret-redaction cases?
- Are asset URLs validated against a blocklist of private/local hosts?
