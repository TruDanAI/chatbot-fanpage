# Setup Wizard MVP Checkpoint - 2026-05-28

This document records the completed P1.1 Admin Setup Wizard MVP end-to-end staging verification under safe dry-run mode.

## Checkpoint Status
* **Status**: Completed and Verified on Staging
* **Date**: 2026-05-28
* **Commit**: `0614e171d7e43e6ae1036920d4d65eaabfa9c189`
* **Message**: `Add setup wizard dry-run simulation step`
* **Source Branch**: `feature/multi-shop-dashboard`

---

## Setup Wizard Step-by-Step Status

### 🛡️ Step 0: Pre-flight Check (Kiểm tra môi trường)
* **Status**: Completed and Verified
* **Verification**: Checks for staging safety, global dry-run configuration (`MESSENGER_DRY_RUN=true`), database routing enabling (`MULTI_SHOP_DB_CONFIG_ENABLED=true`), database connectivity via SELECT-only query, and blocklist safety (ensuring `adult-shop` is protected).

### 🛒 Step 1: Create Shop Shell (Tạo Shell Cửa Hàng)
* **Status**: Completed and Verified
* **Verification**: Form collects slug, display name, default locale, timezone, and messages. Enforces safety defaults: `dry_run=true`, `live_enabled=false`, `status=active`, `lifecycle=draft`.

### 📦 Step 2: Products & Menu Configuration (Cấu hình Sản phẩm & Menu)
* **Status**: Completed and Verified
* **Verification**: Allows adding products and updating settings. Advances only when >= 1 active product exists and menu greeting is configured.

### 🗺️ Step 3: Page Mapping (Liên kết Trang Facebook)
* **Status**: Completed and Verified
* **Verification**: Dedicated `/step/3` routes mapping a target Facebook Page to the shop in `draft` mode. Blocks duplicates and restricts slug mutations.

### 🔑 Step 4: Page Credentials (Xác thực Fanpage)
* **Status**: Completed and Verified
* **Verification**: Stores encrypted Facebook Page tokens utilizing the current runtime environment’s own `CREDENTIAL_MASTER_KEY`. Sanitizes inputs and guarantees no tokens or secrets are leaked in hidden fields or HTML outputs.

### 🚦 Step 5: Readiness Gate (Kiểm tra điều kiện sẵn sàng)
* **Status**: Completed and Verified
* **Verification**: Displays comprehensive checklists, distinguishing between blocking hard blockers (e.g. products, settings, mappings, credentials) and non-blocking warnings.

### 🔄 Step 6: Dry-Run Smoke Test & Completion (Chạy thử giả lập & Hoàn tất)
* **Status**: Completed and Verified
* **Verification**: Runs safe, offline, deterministic simulation of customer messages (menu, product code lookup) without calling Meta APIs or sending real Messenger messages. Updates `last_manual_test_status = 'passed'` upon success, allowing final wizard completion in dry-run mode.

---

## wizard-smoke-shop Final Staging State
* **Shop Slug**: `wizard-smoke-shop`
* **Status**: `active`
* **Lifecycle**: `draft`
* **Dry-Run Mode**: `dry_run = true` (enforces safe sandbox dry-run isolation)
* **Live Status**: `live_enabled = false`
* **Manual Test Status**: `last_manual_test_status = 'passed'`
* **Manual Test Timestamp**: Fresh timestamp set under `last_manual_test_at`
* **Data State**: Configurations (products, settings, assets, page mappings, credentials) remain entirely unchanged.

---

## Staging DB Credential Rotation & Security Incident Handling
Before the final E2E functional verification, a staging Postgres public connection string leak was addressed:
1. **Sanitization**: All local temporary scratch scripts containing the leaked connection string were **completely deleted**. No hardcoded credentials remain in the codebase.
2. **Rotation**: The database password for the `postgres` user was updated directly in the Postgres database engine via an `ALTER USER` query.
3. **Synchronization**: Fresh credentials were set in the `PGPASSWORD` and `POSTGRES_PASSWORD` environment variables on the `Postgres` service.
4. **Auto-managed Propagation**: Railway successfully regenerated and updated `DATABASE_URL` and `DATABASE_PUBLIC_URL` on the application service `chatbot-fanpage-staging`, which completed a clean restart and successfully connected to the database with the new secure credentials.

---

## Public Staging Health Verification
Post-rotation E2E verification confirmed that the staging environment is fully healthy:
* **`GET /healthz`**: Status `200 OK`
  * `ok = true`
  * `storage.ready = true`
  * `messenger.dryRun = true`
* **`GET /admin/login`**: Status `200 OK`
  * Form structure and security checks pass correctly.

---

## Safety & Compliance Confirmation
* **Staging-Only**: Verified. Absolutely no production deployments, database writes, or environment variables were changed.
* **No External API Interaction**: Confirmed that zero Meta Graph API calls were made, zero Messenger messages were sent, and zero token health checks were executed.
* **Adult-Shop Context**: Production adult-shop and other reserved configurations remained completely untouched. The operational lesson that credentials must always be encrypted utilizing the runtime context's unique `CREDENTIAL_MASTER_KEY` was observed.
