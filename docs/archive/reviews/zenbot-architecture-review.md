# ZenBot Full Architecture, Operations & Admin UX Review

> **Reviewer**: Senior Software Architect / Product Engineer / UI-UX Reviewer
> **Date**: 2026-05-25
> **Codebase snapshot**: chatbot-fanpage v1.1.0 — staging post-E2E, pre-production pilot

---

## 1. Executive Verdict

**ZenBot is in a surprisingly mature state for a pre-pilot system.** The multi-shop isolation, encrypted credentials, DB-backed config resolution, fail-closed safety, dry-run cascade (global → per-shop), audit log foundation, and Cloudinary image upload are all well-engineered. The codebase shows disciplined defensive coding — every resolver returns `failClosed` on error, every env has safe defaults, every log is redacted.

**However, the project has an operator UX debt that will block scaling past 2 shops.** The current admin is a collection of API endpoints behind server-rendered views, with no coherent dashboard, no setup wizard, and no visual readiness checklist. A non-technical operator cannot onboard a shop without reading docs, running scripts, and manually coordinating Railway env vars.

**Verdict: Proceed to real Page dry-run pilot now, but gate shop #3 onboarding behind an admin UX sprint.**

> [!IMPORTANT]
> The system is architecturally sound for 2–5 shops. The risk is not code — it's human-error during operator onboarding. Fix that before scaling.

---

## 2. Top 10 Risks

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | **Operator pastes Page token into wrong shop** | 🔴 Critical | High | Setup Wizard with preview + confirmation step |
| 2 | **`index.js` god-file** (1063 lines, wires everything) | 🟡 Medium | Certain | Refactor to `server.js` + `runtime-factory.js` |
| 3 | **`admin-routes.js` mega-file** (2411 lines) | 🟡 Medium | Certain | Split by domain: shops, products, assets, credentials |
| 4 | **No admin undo/rollback** for page mapping or credential writes | 🔴 Critical | Medium | Add archive-with-restore + audit trail |
| 5 | **`ONBOARDING_DEMO_PAGE_ID/TOKEN`** legacy env confusion | 🟡 Medium | High | Remove — use DB page mapping only |
| 6 | **No health-check per shop** — only global `/healthz` | 🟡 Medium | Medium | Add `/healthz?shop=X` with per-shop readiness |
| 7 | **Cloudinary credentials shared across all shops** | 🟡 Medium | Low | Accept for MVP, plan per-shop subfolder isolation |
| 8 | **No `processed_mids` TTL/cleanup** — table grows unbounded | 🟡 Medium | Certain | Add daily cleanup cron or TTL partition |
| 9 | **`webhook_queue` no dead-letter queue** — failed jobs stay as `failed` | 🟡 Medium | Low | Add DLQ or alert on failed count > threshold |
| 10 | **No Messenger send quota awareness** — no rate-limit per page | 🟡 Medium | Low | Add per-page send rate tracking |

---

## 3. Architecture Review (Section A)

### A1. Is modular monolith still the right architecture?

**Yes, absolutely.** At 1-5 shops and a single Railway service, a modular monolith is the correct choice. Microservices would add deployment complexity, service mesh overhead, and distributed transaction pain with zero benefit at this scale.

**The monolith is already well-modularized:**
- [webhook.js](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/core/webhook.js) — pure webhook handler, no DB knowledge
- [admin-routes.js](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/core/admin-routes.js) — admin API layer
- [core/shops/](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/core/shops) — DB shop config resolution
- [core/credentials/](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/core/credentials) — encrypted credential store
- [core/admin/](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/core/admin) — admin write services split by domain

**Concern**: [index.js](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/index.js) at 1063 lines is doing too much — it's simultaneously the server bootstrap, runtime factory, dry-run resolver, allowlist evaluator, and live-gate checker. This should be split:
- `server.js` — Express bootstrap + routes
- `runtime-factory.js` — `buildDbShopRuntime`, `resolveDbShopRuntimeForPage`, allowlist/live-gate logic
- `config.js` — env parsing and validation

### A2. Is the current multi-shop model sound?

**Yes, the model is sound.** The design is correct:

```
shops (1) → shop_pages (N) → shop_page_credentials (1 per mapping)
shops (1) → shop_products (N) → shop_assets (N per product)
shops (1) → shop_settings (1)
```

**Key strengths:**
- `shop_pages_active_page_id_uidx` ensures one Page maps to exactly one active shop — this is the critical isolation constraint
- Credential cascade: global env `FB_PAGE_TOKEN` → DB-resolved per-page encrypted token
- `resolveShopConfigForPage()` is the single entry point for runtime shop resolution
- Fail-closed on every error path (page not found, shop not active, credential missing, bot mode unsupported)

**Key gap:** No `shop_id` column on the runtime tables (`conversations`, `messages`, `orders`, `events`, `processed_mids`). They use `tenant_id + page_id` as the isolation key. This means:
- If a Page is reassigned to a different shop, historical data cannot be cleanly separated
- Analytics queries require joining through `shop_pages` to group by shop

> [!WARNING]
> Consider adding `shop_id` to `conversations` and `events` tables for analytics and future Page reassignment scenarios. This is P2, not blocking.

### A3. What is risky about the current DB schema/runtime routing?

1. **`processed_mids` has no TTL** — this table will grow linearly with traffic. At 100 messages/day/shop × 5 shops × 365 days = 182,500 rows/year. Not critical but should have a 7-day cleanup.

2. **`webhook_queue` has no dead-letter queue** — failed jobs (status = 'failed') accumulate. Need either:
   - A separate `webhook_queue_dlq` table, or
   - An alert when `failed` count exceeds threshold

3. **Runtime routing hot path does 3 queries** per webhook event when `MULTI_SHOP_DB_CONFIG_ENABLED=true`:
   - `resolveShopConfigForPage` (shop + settings + products + assets)
   - `resolvePageCredential` (credential decrypt)
   - `resolveStorageForDbRuntime` (storage context)

   This is fine at low volume but should be cached (in-process LRU, 30s TTL) before 10+ shops.

### A4. What should remain in Railway env vs move to DB/admin?

| Keep in Railway env | Move to DB/admin |
|---|---|
| `DATABASE_URL` | Shop-specific Page tokens ✅ (already moved) |
| `FB_APP_SECRET` | Shop-specific dry_run ✅ (already moved) |
| `FB_VERIFY_TOKEN` | Shop-specific bot_mode ✅ (already moved) |
| `CREDENTIAL_MASTER_KEY` | Product data ✅ (already moved) |
| `ADMIN_EXPORT_TOKEN` | Asset/image URLs ✅ (already moved) |
| `SESSION_SECRET` | `ONBOARDING_DEMO_PAGE_ID` ❌ (remove) |
| `NODE_ENV` | `ONBOARDING_DEMO_TOKEN` ❌ (remove) |
| `MESSENGER_DRY_RUN` (global kill switch) | `FB_PAGE_TOKEN` (default/fallback) → eventually remove |
| `MULTI_SHOP_DB_CONFIG_ENABLED` | Per-shop handoff/session settings (P2) |
| `RUNTIME_ALLOWED_SHOP_IDS` | — |
| `GEMINI_*` (shared AI config) | — |
| `GOOGLE_CLOUD_*` | — |

### A5. What should be removed, renamed, or deprecated?

| Variable | Action | Reason |
|---|---|---|
| `ONBOARDING_DEMO_PAGE_ID` | **Remove** | Replaced by DB `shop_pages` |
| `ONBOARDING_DEMO_TOKEN` | **Remove** | Replaced by `shop_page_credentials` |
| `ACTIVE_SHOP` | **Deprecate** | Alias of `SHOP_ID`, confusing |
| `FB_PAGE_TOKEN` | **Rename** → `DEFAULT_FB_PAGE_TOKEN` | Make clear it's fallback, not primary |
| `FB_PAGE_ID` / `PAGE_ID` | **Deprecate** | File-config era; replaced by DB shop_pages |
| `GOOGLE_PROJECT_ID` | **Remove** | Alias of `GOOGLE_CLOUD_PROJECT` |
| `ALLOW_PRODUCTION_DB_WRITES` | **Keep but review** | Safety gate for storage adapter |

### A6. What are the top cross-shop leakage risks?

1. **In-memory state leakage**: `storage` module is shared across shops when `forContext()` returns the same backing store. If `forContext` returns the same `Map` instance, handoff state from Shop A could leak to Shop B via `senderId` collision (unlikely but possible with test accounts).

2. **`recentMessageTextKeys` and `recentMenuSendKeys`** in [webhook.js](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/core/webhook.js#L81-L82) are global in-memory Maps. They do include `pageId` in the key, so cross-shop collision requires same `pageId` + `senderId` + `text` — effectively impossible in practice. **Low risk.**

3. **Gemini API key is shared** across all shops. If one shop's conversation leaks into another's system prompt, there could be cross-contamination. The `buildDbShopRuntime` correctly creates a separate `AiClient` per resolution, so this is safe.

4. **Cloudinary upload uses shared credentials** — images from Shop A and Shop B go to the same Cloudinary account. Acceptable for MVP; add shop-specific subfolders later.

**Assessment: Cross-shop leakage risk is LOW.** The key isolation points (page_id unique index, per-resolution runtime, fail-closed) are sound.

### A7. Is the dry-run/live model correct?

**Yes, the cascade model is excellent:**

```
MESSENGER_DRY_RUN (global kill switch)
    └── shops.dry_run (per-shop override)
        └── Effective dry-run decision
```

The `resolveEffectiveMessengerDryRun()` function in [index.js](file:///c:/Users/Pc/Desktop/New%20folder/chatbot-fanpage/index.js#L379-L411) correctly implements:
- Global `true` → always dry-run (regardless of shop)
- Global `false` + shop `true` → dry-run for that shop
- Global `false` + shop `false` → live sends allowed
- Global `false` + shop `null` (missing column) → `source: 'legacy_missing_shop_dry_run'` → live (safe default depends on deployment)

**One concern**: When `shopDryRunColumnAvailable` is `false` (schema not yet applied), the effective behavior is `dryRun: false` with `source: 'legacy_missing_shop_dry_run'`. This means a shop without the dry_run column will default to **live**. Consider making the default `true` when the column is missing — safer for new deployments.

### A8. Is the Page mapping/credential model correct?

**Yes, very well designed:**

- `shop_pages` maps Facebook Page → shop with active/paused/archived status
- `shop_pages_active_page_id_uidx` prevents duplicate active mappings
- `shop_page_credentials` stores AES-encrypted Page tokens with `encryption_key_id` + `key_version` for rotation
- Credential resolution is fail-closed: missing key → no send
- Archive with credential cascade is implemented

**Recommendation**: Add a `last_verified_at` timestamp to `shop_page_credentials` for token health tracking.

### A9. Is Cloudinary image upload the right MVP choice?

**Yes.** Cloudinary is:
- Free tier sufficient for MVP (25K transforms/month)
- HTTPS URLs work directly in Messenger (no proxy needed)
- CDN-backed for global delivery
- Upload-and-forget model fits the admin flow

**Alternative** (for future): If cost becomes an issue at 20+ shops, consider:
- R2 (Cloudflare) — cheaper storage, free egress
- S3 + CloudFront — more control

For now, Cloudinary is the right call.

### A10. Audit, readiness, archive, fail-closed behavior

**Audit**: The `createPostgresAuditLogger` exists but `ADMIN_AUDIT_LOG_ENABLED` is off by default. The audit log correctly avoids raw Page IDs, tokens, message bodies per the redaction policy.

**Readiness**: The `shops` table has `last_readiness_status`, `last_readiness_checked_at`, `last_manual_test_status`, `last_manual_test_at`, `last_ready_by` columns. This is good schema — but there's no automated readiness checker that populates these. The readiness check is currently manual/doc-based.

**Archive**: Page mapping archive works correctly. Shop-level archive/pause is partially implemented in `shop-control-writes.js` but the admin UI doesn't expose it fully.

**Fail-closed**: This is the strongest safety feature. Every `resolveEventRuntime` path returns `{ failClosed: true, reason: '...' }` on failure. This is excellent.

---

## 4. Operations Review (Section B)

### B1. How should a new shop be onboarded from zero?

**Current state**: Requires reading [basic-shop-onboarding-checklist.md](../../runbooks/basic-shop-onboarding-checklist.md) (19KB!) and manually executing ~25 steps across admin API, Railway env, Facebook Developer Console, and Cloudinary dashboard.

**Target state** (recommended operator workflow):

```
Step 1: Admin Dashboard → "Create New Shop" button
Step 2: Enter shop name, slug, locale → Shop created in draft state
Step 3: Upload product CSV → Products imported, validation errors shown inline
Step 4: Upload menu images + product images → Cloudinary upload, URLs stored
Step 5: Paste Facebook Page ID → Preview shows Page name, existing mapping check
Step 6: Paste Page Access Token → Token encrypted and stored, health check runs
Step 7: Readiness checklist auto-evaluates → Shows pass/fail per item
Step 8: Click "Enable Dry-Run Test" → shop.dry_run = true, lifecycle = ready
Step 9: Send test message on Messenger → Verify bot responds correctly
Step 10: Click "Go Live" → shop.dry_run = false, lifecycle = live, live_enabled = true
```

### B2. Top human-error risks

| # | Error | Impact | Mitigation |
|---|---|---|---|
| 1 | Paste Page token for Shop A into Shop B | **Cross-shop message sends** | Preview + confirm step showing Page name |
| 2 | Forget to set `dry_run = true` before testing | Live messages to real customers | Default `dry_run = true` on shop create |
| 3 | Archive wrong Page mapping | Shop stops responding | Confirmation dialog + recent archive list with restore |
| 4 | Import product CSV with wrong column names | Empty product list | Validate-only mode with preview |
| 5 | Set `MESSENGER_DRY_RUN=false` globally while testing | All shops go live simultaneously | Admin UI warning banner when global dry-run is off |
| 6 | Deploy to production with staging env vars | Production uses staging Page tokens | Railway env separation (already done) |

### B3. What rollback controls are missing?

- **Shop pause/resume**: Schema exists (`status: paused`) but no admin button
- **Page mapping restore**: Archive works but no "undo archive" in UI
- **Credential rollback**: Rotate replaces, but no "revert to previous token"
- **Product import rollback**: No "revert to previous product list"
- **Global emergency stop**: `MESSENGER_DRY_RUN=true` works but requires Railway access

**Recommendation**: Add a big red "Emergency Pause" button per shop in admin that sets `status=paused` + `dry_run=true` atomically.

### B4. Monitoring for first 1h/24h/48h of a shop

| Window | What to monitor | How |
|---|---|---|
| **First 1h** | Webhook delivery (Meta → app), dry-run log output, fail-closed events | Tail Railway logs; alert on `fail-closed` or `messenger-send blocked` |
| **First 24h** | Message volume, handoff rate, fallback rate, Messenger send errors | Telegram operational alerts (already configured) |
| **First 48h** | Abandoned cart reminders firing correctly, no cross-shop leakage, processed_mids growth | Admin dashboard events view + DB query |

**Missing**: No shop-level metrics dashboard. The `/healthz` endpoint is global only. Add:
- `/admin/api/shops/:shopId/stats` — last 24h message count, handoff count, error count
- Telegram daily digest per shop

### B5. Staging vs production management

**Current state**: Railway staging and production are separate services with separate env vars. This is correct.

**Recommendation**:
- Production should have `MESSENGER_DRY_RUN=true` as default until explicitly removed per-shop
- Staging should always have `MESSENGER_DRY_RUN=true` (already the case)
- Never share `DATABASE_URL` between staging and production (already separate)
- Deploy to staging first, run E2E, then deploy to production

### B6. Real Page pilot safety

Follow this sequence:
1. Ensure `MESSENGER_DRY_RUN=false` globally on staging
2. Set `shops.dry_run = true` for the pilot shop
3. Map real Page ID and store encrypted token
4. Run dry-run test — verify logs show correct shop resolution
5. Set `shops.dry_run = false` for the pilot shop
6. Send a test message from a team member's personal Facebook account
7. Verify response arrives correctly
8. Monitor for 1h
9. If OK, announce pilot live to shop operator

---

## 5. Admin UI/UX Review (Section C)

### C1. Dashboard Information Architecture

```
┌─────────────────────────────────────────────────────┐
│  ZenBot Admin                              [Logout] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ Global Status Bar ────────────────────────────┐ │
│  │ 🟢 System OK  │ Dry-Run: OFF │ 3 shops active  │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Shop Cards ───────────────────────────────────┐ │
│  │                                                 │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │ │
│  │  │ Shop A   │  │ Shop B   │  │ + New    │     │ │
│  │  │ 🟢 Live  │  │ 🟡 Draft │  │  Shop    │     │ │
│  │  │ 12 prods │  │ 0 prods  │  │          │     │ │
│  │  │ 3 msgs/h │  │ dry-run  │  │          │     │ │
│  │  └──────────┘  └──────────┘  └──────────┘     │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Recent Activity ──────────────────────────────┐ │
│  │ • Shop "nem-bui-xa" → page mapped 2h ago       │ │
│  │ • Shop "demo-shop" → 5 test messages today     │ │
│  │ • System → 0 webhook errors in 24h             │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### C2. New Shop Setup Wizard

A 5-step progressive wizard:

**Step 1: Identity**
- Shop ID (auto-generated from name, editable)
- Display Name
- Locale (dropdown: vi-VN, en-US)
- Timezone (dropdown: Asia/Bangkok, etc.)
- → Creates shop in `draft` state with `dry_run = true`

**Step 2: Products**
- Upload CSV or enter manually
- Preview table with validation
- "Validate Only" button before commit
- Show: ✅ 12 products valid, ⚠️ 1 duplicate code skipped

**Step 3: Images**
- Upload menu images (drag-and-drop)
- Upload product images (matched to product codes)
- Preview thumbnails with Cloudinary URLs
- Bulk upload zone for ZIP in future (P2)

**Step 4: Facebook Page**
- Paste Page ID → preview shows existing mappings
- Paste Page Access Token → health check runs
- Show: ✅ Token valid, Page name: "Nệm Bui Xa Official"
- ⚠️ Warning if Page ID already mapped to another shop

**Step 5: Review & Activate**
- Readiness checklist (auto-evaluated)
- "Start Dry-Run Test" button
- "I've tested, Go Live" button (requires confirmation)

### C3. Shop Detail Page Layout

```
┌─────────────────────────────────────────────────────┐
│  ← Back to Dashboard         Shop: Nem Bui Xa      │
├──────────────┬──────────────────────────────────────┤
│  Navigation  │  Content Area                        │
│              │                                      │
│  Overview    │  ┌─ Status Card ──────────────────┐  │
│  Products    │  │ Status: 🟢 Active               │  │
│  Images      │  │ Lifecycle: Live                  │  │
│  Page Setup  │  │ Dry-Run: OFF                     │  │
│  Settings    │  │ Bot Mode: menu_code_handoff      │  │
│  Readiness   │  │ Products: 12 │ Images: 24        │  │
│  Activity    │  │ Messages today: 47               │  │
│  Controls    │  └────────────────────────────────┘  │
│              │                                      │
│              │  ┌─ Readiness Checklist ───────────┐  │
│              │  │ ✅ Products uploaded              │  │
│              │  │ ✅ Menu images set                │  │
│              │  │ ✅ Page mapped                    │  │
│              │  │ ✅ Token valid                    │  │
│              │  │ ⚠️  Manual test: not done         │  │
│              │  └────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────┘
```

### C4. Readiness Checklist UI

The checklist should auto-evaluate from DB state:

| Check | Source | Auto? |
|---|---|---|
| ✅ Shop created | `shops` row exists | Yes |
| ✅ Products uploaded | `shop_products` count > 0 | Yes |
| ✅ Menu images set | `shop_assets` where `asset_type = 'menu_image'` count > 0 | Yes |
| ✅ Page mapped | `shop_pages` active mapping exists | Yes |
| ✅ Token stored | `shop_page_credentials` active credential exists | Yes |
| ✅ Token valid | Token health check passed < 24h ago | Semi-auto |
| ✅ Bot mode set | `shop_settings.bot_mode != 'disabled'` | Yes |
| ⚠️ Manual test done | `shops.last_manual_test_status = 'passed'` | Manual |
| ⚠️ Dry-run tested | At least 1 dry-run event logged | Semi-auto |

Display as a vertical checklist with green/yellow/red icons. Block "Go Live" button if any ❌ items.

### C5. Page Mapping and Credential Setup UX

**Current pain**: Operator must know Page ID (a numeric string), obtain a Page Access Token from Facebook Developer Console, and paste both into separate API calls.

**Improved UX**:

1. **Page ID Input**: Single text field. On blur, system checks:
   - Is this Page ID already mapped? → Show warning with shop name
   - Is this a valid format? → Show validation

2. **Token Input**: Password-masked text field with "Verify Token" button.
   - On verify: calls Facebook Graph API `/me?access_token=...`
   - Shows: Page name, Page ID match confirmation
   - ⚠️ If token's Page ID doesn't match entered Page ID → block

3. **Preview Panel**: Before save, show:
   ```
   You are about to:
   • Map Page "Nệm Bùi Xa Official" (ID: 1234...7890) to shop "nem-bui-xa"
   • Store encrypted Page Access Token
   • This will allow the bot to respond to messages on this Page

   [Confirm & Save]  [Cancel]
   ```

### C6. Product Import UX

**Current**: POST to `/admin/api/shops/:shopId/products/import` with CSV body.

**Improved UX**:
1. Drag-and-drop CSV upload zone
2. "Validate Only" step — shows table preview with:
   - Green rows: valid
   - Yellow rows: warnings (e.g., missing description)
   - Red rows: errors (e.g., duplicate code, missing name)
3. Column mapping preview: "We found columns: code, name, price, description"
4. "Import" button — shows result summary
5. "Download current products as CSV" for backup before re-import

### C7. Image Upload UX

**Current**: Single image upload per request to `/admin/api/shops/:shopId/assets/upload`.

**Improved UX**:
1. **Menu Images tab**: Drag-and-drop zone, reorder with drag handles, delete with ❌
2. **Product Images tab**: Grid of products, each with image upload slot
   - Match by product code
   - Show current image + "Replace" button
3. **Bulk Upload** (P2): ZIP file containing `PRODUCT_CODE.jpg` filenames auto-matched

### C8. Dry-Run / Live Test Controls

**Dashboard banner** when dry-run is active:
```
🟡 DRY-RUN MODE — Messages will be logged but NOT sent to Messenger
   [Switch to Live]  (requires readiness checklist pass)
```

**Per-shop controls**:
- Toggle switch: "Dry Run" ON/OFF
- Warning on switch to Live: "This will send real messages to real customers. Are you sure?"
- Confirmation requires typing shop name to prevent accidental toggle

### C9. Archive / Pause / Reset Controls

**Shop Controls panel** (in Shop Detail → Controls tab):

```
┌─ Shop Lifecycle Controls ─────────────────────────┐
│                                                     │
│  Current Status: 🟢 Active / Live                   │
│                                                     │
│  [Pause Shop]     — Stop bot from responding,       │
│                     keep all data. Reversible.       │
│                                                     │
│  [Archive Shop]   — Mark shop as archived.           │
│                     Requires confirmation.           │
│                     Data preserved but bot stops.    │
│                                                     │
│  [Reset Dry-Run]  — Switch back to dry-run mode.    │
│                     Bot logs but doesn't send.       │
│                                                     │
│  ⚠️ Danger Zone ──────────────────────────────────  │
│  [Remove Page Mapping] — Disconnects Page from shop │
│                          Requires typing Page ID    │
└─────────────────────────────────────────────────────┘
```

### C10. Warnings, Blockers, and Safe Next Actions

**Design principle**: Every admin page should show exactly what the operator should do next.

**Warning levels**:
- 🔴 **Blocker**: Cannot proceed. E.g., "No products uploaded — upload products to continue"
- 🟡 **Warning**: Can proceed but risky. E.g., "Manual test not done — recommended before going live"
- 🟢 **Ready**: All checks pass. E.g., "Shop is ready to go live"
- ℹ️ **Info**: Contextual help. E.g., "Dry-run mode means messages are logged but not sent"

**Safe Next Action** — always show a prominent CTA:
- Draft shop with no products → "Upload Products"
- Products uploaded, no images → "Upload Images"
- Images done, no Page → "Connect Facebook Page"
- Page connected, not tested → "Start Dry-Run Test"
- Tested, ready → "Go Live"

---

## 6. Product Scope Review (Section D)

### D1. Basic Package — what to include

| Feature | Status | Include? |
|---|---|---|
| Menu text/image send on greeting | ✅ Done | Yes |
| Product code lookup + image send | ✅ Done | Yes |
| Post-product handoff to human | ✅ Done | Yes |
| Multi-shop isolation | ✅ Done | Yes |
| Per-shop dry-run | ✅ Done | Yes |
| Admin: shop create | ✅ Done | Yes |
| Admin: product import CSV | ✅ Done | Yes |
| Admin: Cloudinary image upload | ✅ Done | Yes |
| Admin: Page mapping + credential | ✅ Done | Yes |
| Admin: readiness checklist (auto) | 🔶 Schema exists | Yes (build UI) |
| Admin: shop pause/resume | 🔶 Schema exists | Yes (build UI) |
| Telegram operational alerts | ✅ Done | Yes |

### D2. Sales Flow Package — what to include later

| Feature | Status | Include? |
|---|---|---|
| AI fallback (Gemini) | ✅ Built, disabled for basic | Yes |
| Lead capture (phone/name/address) | ✅ Built | Yes |
| Order flow (draft → confirmed) | ✅ Built | Yes |
| Quick replies | ✅ Built | Yes |
| Abandoned cart reminders | ✅ Built | Yes |
| Google Sheets lead push | ✅ Built | Yes |
| Hot product carousel | ✅ Built | Yes |

### D3. What should definitely NOT be built yet

- ❌ Telegram bot channel (parallel to Messenger)
- ❌ Payment/checkout integration
- ❌ Self-serve SaaS signup
- ❌ Billing/subscription management
- ❌ Multi-tenant identity/RBAC (beyond current single-admin)
- ❌ Customer-facing order tracking
- ❌ Analytics dashboard with charts
- ❌ WhatsApp/Instagram DM channel
- ❌ AI free-form selling mode

### D4. Should quick buttons wait?

**Yes.** Quick buttons (quick_replies) are already built in the Sales Flow mode but should not be enabled for Basic package shops. They add UX complexity and require per-shop configuration of button labels. Enable after the first 2-3 shops are stable on Basic.

### D5. What must be done before onboarding 2-5 more shops?

1. **P0**: Setup Wizard in admin (even a simple multi-step form)
2. **P0**: Auto-readiness checklist in admin
3. **P0**: Shop pause/resume button
4. **P1**: Remove `ONBOARDING_DEMO_*` env vars
5. **P1**: Per-shop health endpoint
6. **P1**: Bulk image upload (at least multi-file, not ZIP)
7. **P1**: Token health check button in admin

---

## 7. P0/P1/P2 Roadmap (Section E)

### P0: Must fix before real Page pilot

| # | Item | Why | Risk Reduced | Complexity | Owner | Changes |
|---|---|---|---|---|---|---|
| P0.1 | **Auto-readiness checklist API** | Operator needs to know if shop is ready without reading docs | Human error | Medium | Codex | Code + DB |
| P0.2 | **Shop pause button** (status → paused) | Emergency stop without Railway access | Operational | Low | Codex | Code + UI |
| P0.3 | **Default `dry_run = true` on new shop** | Prevent accidental live sends | Cross-shop sends | Low | Codex | Code |
| P0.4 | **Token health check in admin** | Verify token works before going live | Silent failure | Low | Codex | Code + UI |
| P0.5 | **Confirmation dialog for Go Live** | Prevent accidental live toggle | Accidental sends | Low | Codex | UI |

### P1: Must fix before 2-5 shops

| # | Item | Why | Risk Reduced | Complexity | Owner | Changes |
|---|---|---|---|---|---|---|
| P1.1 | **Setup Wizard (5-step)** | Non-technical operator can't onboard | Onboarding blocked | High | Codex | Code + UI |
| P1.2 | **Remove `ONBOARDING_DEMO_*` env vars** | Confusion, unused | Env confusion | Low | Codex | Code + Env |
| P1.3 | **Split `index.js`** into server + runtime-factory + config | Maintainability | Tech debt | Medium | Codex | Code |
| P1.4 | **Split `admin-routes.js`** by domain | Maintainability | Tech debt | Medium | Codex | Code |
| P1.5 | **Multi-image upload** (not ZIP, just multi-file) | Operator uploads 20+ images per shop | UX friction | Medium | Codex | Code + UI |
| P1.6 | **`processed_mids` cleanup cron** | Table growth | DB growth | Low | Codex | Code + DB |
| P1.7 | **Per-shop `/healthz` endpoint** | Monitor individual shop health | Monitoring gap | Low | Codex | Code |
| P1.8 | **Deprecate `FB_PAGE_TOKEN` in favor of DB** | Env simplification | Env confusion | Low | Manual | Docs + Env |

### P2: Nice after stable pilot

| # | Item | Why | Risk Reduced | Complexity | Owner | Changes |
|---|---|---|---|---|---|---|
| P2.1 | **Admin dashboard with shop cards** | Visual overview | UX | High | Codex | UI |
| P2.2 | **Shop-level analytics** (message count, handoff rate) | Operator visibility | Monitoring | Medium | Codex | Code + UI |
| P2.3 | **Bulk image upload (ZIP)** | Operator efficiency | UX friction | Medium | Codex | Code + UI |
| P2.4 | **Credential rotation UI** | Token refresh without downtime | Security | Medium | Codex | UI |
| P2.5 | **Add `shop_id` to runtime tables** | Analytics, Page reassignment | Data isolation | Medium | Codex | DB + Code |
| P2.6 | **Runtime config caching (LRU, 30s TTL)** | Performance at 10+ shops | Latency | Medium | Codex | Code |
| P2.7 | **Webhook DLQ and alerting** | Failed job visibility | Silent failures | Low | Codex | Code + DB |
| P2.8 | **Admin audit log UI** | Audit trail visibility | Compliance | Medium | Codex | UI |

### Defer: Do not build yet

| Item | Reason |
|---|---|
| Telegram bot channel | No demand, adds complexity |
| Payment/checkout | Way beyond Basic scope |
| Self-serve SaaS | Premature — need 10+ shops first |
| Multi-admin RBAC | Single operator sufficient for now |
| Quick buttons for Basic | Confusing, wait for Sales Flow |
| WhatsApp/Instagram | Different API, different problem |
| AI selling mode | Dangerous without guardrails |

---

## 8. Specific Codex Prompts (Section G — Next Codex Tasks)

### Codex Prompt 1: Auto-Readiness Checklist API (P0.1)

```
Create a readiness checklist API endpoint at
POST /admin/api/shops/:shopId/readiness-check

The endpoint should:
1. Query shop_products count for the shop
2. Query shop_assets count where asset_type = 'menu_image'
3. Query shop_pages for active mapping
4. Query shop_page_credentials for active credential
5. Query shop_settings for bot_mode != 'disabled'
6. Return JSON with each check as { name, status: 'pass'|'fail'|'warning', detail }
7. Update shops.last_readiness_status and shops.last_readiness_checked_at
8. Block "Go Live" if any hard check fails

Add tests in tests/shop-readiness.test.js.
Use the existing admin auth middleware.
Follow the same error presentation pattern as other admin write services.
```

### Codex Prompt 2: Shop Pause/Resume Button (P0.2)

```
Add shop pause and resume functionality:

1. In core/admin/shop-control-writes.js, add:
   - pauseShop(shopId) — sets status='paused', dry_run=true atomically
   - resumeShop(shopId) — sets status='active', dry_run stays true (require explicit live enable)

2. Add API endpoints:
   - POST /admin/api/shops/:shopId/pause
   - POST /admin/api/shops/:shopId/resume

3. In the webhook runtime resolver, ensure shops with status='paused' fail-closed

4. Add tests in tests/shop-control-writes.test.js

Follow existing patterns in presentShopControlWriteApi and presentShopControlWriteError.
```

### Codex Prompt 3: Remove Legacy Env Vars (P1.2)

```
Remove all references to ONBOARDING_DEMO_PAGE_ID and ONBOARDING_DEMO_TOKEN:

1. Search entire codebase for these variable names
2. Remove from .env.example
3. Remove from index.js env loading
4. Remove from any scripts/
5. Remove from any docs/ references
6. Add deprecation note in DESIGN.md

Also deprecate ACTIVE_SHOP (keep SHOP_ID only):
1. Remove ACTIVE_SHOP from .env.example
2. Keep fallback in normalizeShopId for backwards compatibility
3. Add console.warn if ACTIVE_SHOP is set: "ACTIVE_SHOP is deprecated, use SHOP_ID"
```

---

## 9. What NOT to Build

> [!CAUTION]
> Do not build any of these in the next 30 days:

1. **Self-serve signup/billing** — You need 10+ manually onboarded shops before building this. Building it now will waste 2-4 weeks and delay the pilot.

2. **Multi-admin RBAC** — Single operator with `ADMIN_EXPORT_TOKEN` is sufficient for 1-5 shops. The schema is proposed but don't implement until you have 2+ operators.

3. **AI free-form selling** — This is the #1 way to destroy customer trust. The Basic handoff flow is safe and predictable. Do not introduce AI-generated responses to customers until you have extensive testing and guardrails.

4. **Real-time analytics dashboard** — Telegram alerts + admin events view is sufficient. Charts and graphs can wait until post-pilot.

5. **Telegram/WhatsApp channel** — Each new channel doubles the testing surface. Master Messenger first.

---

## 10. Final Recommendation

### Continue pilot → YES, but with conditions

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ✅ PROCEED to real Page dry-run pilot NOW           │
│                                                     │
│  With these conditions:                             │
│                                                     │
│  1. Build P0.1-P0.5 first (2-3 days of Codex work) │
│  2. Run real Page pilot in dry-run for 24h          │
│  3. Switch to live sends after dry-run passes       │
│  4. Monitor first 48h via Telegram alerts           │
│  5. Gate shop #3 onboarding behind P1.1 (wizard)    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Recommended 7-day plan

| Day | Activity |
|---|---|
| **Day 1** | Codex: P0.1 (readiness API) + P0.3 (default dry_run) |
| **Day 2** | Codex: P0.2 (pause button) + P0.4 (token health check) + P0.5 (confirmation dialog) |
| **Day 3** | Manual: Real Page dry-run pilot for nem-bui-xa |
| **Day 4** | Monitor dry-run logs, fix any issues |
| **Day 5** | Switch nem-bui-xa to live, monitor 24h |
| **Day 6** | Codex: Start P1.1 (Setup Wizard - step 1-3) |
| **Day 7** | Codex: P1.1 (Setup Wizard - step 4-5) + P1.2 (remove legacy env) |

### What Codex should do NEXT (immediate)

**Start with P0.1**: Build the auto-readiness checklist API. This is the highest-leverage item — it converts the 19KB onboarding doc into a single API call that tells the operator exactly what's missing.

---

## Appendix: Specific Answers to Section F Questions

### F1. Continue to real Page dry-run now, or improve admin UX first?

**Continue to dry-run now.** The admin UX is not blocking a dry-run test — it's blocking onboarding shop #3+. Do both in parallel: P0 items (2 days) → dry-run pilot (day 3) → P1 items (days 6-7+).

### F2. Should `ONBOARDING_DEMO_PAGE_ID/TOKEN` be removed?

**Remove.** They're replaced by DB `shop_pages` + `shop_page_credentials`. Keeping them adds confusion.

### F3. Clean target model for Page ID/token setup?

**Target**: All Page IDs and tokens live in DB (`shop_pages` + `shop_page_credentials`). Railway env has only `CREDENTIAL_MASTER_KEY` (for encryption) and `FB_VERIFY_TOKEN` (for webhook verification — shared across all Pages on the same app). `FB_PAGE_TOKEN` becomes `DEFAULT_FB_PAGE_TOKEN` as a fallback for file-config shops only, and is deprecated.

### F4. Should we build shop archive/pause next?

**Pause: YES (P0.2).** Archive: P2. Pause is the emergency brake operators need. Archive is for cleanup later.

### F5. Should we build Setup Wizard next?

**After P0 items, yes (P1.1).** The wizard is the highest-impact item for scaling to 2-5 shops. But it's not blocking the current pilot.

### F6. Should we add upload-many-images or ZIP import now?

**Multi-file upload: P1.5.** ZIP import: P2.3. Multi-file upload is a UX improvement that saves operator time. ZIP is nice-to-have.

### F7. What is the safest next 7-day plan?

See the 7-day plan in Section 10 above.

### F8. What should Codex do next?

**P0.1: Auto-readiness checklist API.** See Codex Prompt 1 in Section 8.
