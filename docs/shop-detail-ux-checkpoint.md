# Shop Detail UX and Safe Delete Draft Checkpoint (P1.2d)

This checkpoint document records the successful implementation, testing, staging deployment, and E2E verification of the P1.2d update suite. This suite encompasses major admin dashboard enhancements, including clean tabbed visual grouping, active onboarding helper guidance, danger-confirmation UI modals, and a transactional Delete Draft Shop safety service.

---

## 🚀 P1.2d Suite Milestones

### 1. P1.2d1: Shop Detail Layout Grouping
- **Commit**: `bbdb7f5`
- **Objective**: Reorganize the complex, flat multi-shop admin panel interface into a highly polished, tabular layout for intuitive, focused navigation.
- **Tab Structure**:
  1. **Tổng quan (Overview)**: Summary metrics, general information, and status check.
  2. **Sản phẩm & Menu (Catalog)**: Integrated product management, code uniqueness, pricing, and bulk CSV catalog imports.
  3. **Hình ảnh (Assets)**: Management panel for shop images, product images, and menu intros.
  4. **Kết nối Fanpage (Integrations)**: Facebook page mapping management.
  5. **Vận hành an toàn (Safety UX)**: Advanced emergency brakes (Pause/Resume), per-shop dry-run simulation toggles, and draft shop deletion.

### 2. P1.2d2: Active Status Guidance and Safe Empty States
- **Summary Cards**: Introduced state summaries indicating whether the shop is fully operational, paused, or dry-running.
- **Action Cards**: Active helper cards pointing the user to the next logical step (e.g., adding first product, configuring mapping, or executing a dry-run test).
- **Empty States**: Replaced raw tabular lists with visually Harmonious empty states containing illustrations and action buttons to guide onboarding users.
- **Safety Sections**: Consolidated destructive actions securely into one tab, preventing administrative confusion.

### 3. P1.2d3: Danger Confirmation Modals
- **Commit**: `a284a35`
- **Staging Deployment**: `b17c4d4f-51cc-439a-b38f-5599ad605ae6`
- **UX Protections**:
  - **Intercept Dialog**: Intercepts high-risk operations (Pause, Resume, Dry-Run change, Archive, and Delete).
  - **Typo Protection**: Requires typing the exact shop slug case-insensitively.
  - **Checkbox Confirmation**: Checked-to-unlock checkbox.
  - **Countdown Timer**: 3-second disabled state on confirmation buttons to prevent double-clicking or muscle-memory bypass.
- **Server Guardrails**: All actions require the `confirmation_text` parameter backend verification, ensuring API calls bypass is blocked.

### 4. P1.2d4: Transactional Safe Delete Draft Shop Service
- **Commit**: `2d4615f`
- **Staging Deployment**: `d735284e-eadb-4667-b3ba-63807c1e1580`
- **Objective**: Allow complete database removal **only** for draft/configuring shops created by mistake, while blocking deletion on live or historically active shops.
- **Cascading transactional order**:
  1. `shop_page_credentials`
  2. `shop_pages`
  3. `shop_assets`
  4. `shop_products`
  5. `shop_settings`
  6. `shops`
- **Audit Logging**: Inserts an audit log (`admin.shop.delete`) into the database on successful deletion.

---

## 🛡️ Delete Draft Shop Policy

To enforce absolute database integrity, the service blocks deletion unless all of the following rules are met:

### 1. Lifecycle Constraint
- The shop must have `lifecycle = 'draft'` or `lifecycle = 'configuring'`.
- Deletion is strictly blocked if the shop is in `live`, `ready`, `paused`, or `archived` states.

### 2. Protected Slug List
- System protected shops are hard-blocked:
  - `adult-shop`
  - `demo-shop`
  - `nem-bui-xa`
- Any shop containing `"prod"` or `"production"` in its slug or database ID is blocked.

### 3. Customer and Business Data Boundaries
Deletion is immediately aborted if the shop has *any* associated customer or runtime records:
- **Connected Channels**: Exists any active/archived rows in `shop_pages` (mappings) or `shop_page_credentials` (Page tokens).
- **Business Data**: Exists any rows in `orders`, `shop_products`, or `shop_assets` that don't belong exclusively to a draft config.
- **Customer Interactions**: Exists any rows in `messages`, `conversations`, `events`, `profiles`, or `processed_mids`.
- **Active Threads**: Exists active handoffs or queued webhook jobs in `webhook_queue`.

*Note: For shops that do not qualify for draft deletion, users are instructed to use the **Lưu trữ (Archive)** emergency action to disconnect safely.*

---

## 🧪 E2E Verification Results on Staging

A rigorous staging verification script was executed against the live Railway staging URL (`https://chatbot-fanpage-staging-staging.up.railway.app`):

1. **Staging Health**: `/healthz` successfully returned `HTTP 200 OK` (database ready and dry-run active).
2. **Blocked Path Validation**: Attempting to delete `adult-shop` returned **`HTTP 409 Conflict`** and rendered the details page displaying five active safety blocker reasons.
3. **Success Path Validation**:
   - Created disposable draft shop with slug `delete-draft-smoke-1780022921`.
   - Executed deletion POST request with strict confirmation `"DELETE DRAFT"` and slug match.
   - Deletion returned **`HTTP 200 OK`** and rendered the success banner.
   - Detail page GET queries on `delete-draft-smoke-1780022921` returned **`HTTP 404 Not Found`** (fully deleted).
4. **System Isolation**: All other shops (including `adult-shop`, `demo-shop`, `nem-bui-xa`, and `wizard-smoke-shop`) remained untouched and active.
5. **Negative Input Path**: Triggering deletion with incorrect slug validation on disposable `delete-draft-smoke-neg-1780022921` returned **`HTTP 400 Bad Request`** and successfully blocked DB writes.

---

## 🔒 Guardrail Compliance Report
- **Production database or environment touched**: **NO**
- **Production deployment triggered**: **NO**
- **Meta Graph API called**: **NO**
- **Token health checks run**: **NO**
- **Messenger messages sent**: **NO**
- **Authorization headers or database secrets exposed**: **NO** (Securely verified in memory using `railway run`)
- **Safe to deploy to Staging**: **YES** (100% verified and active)
