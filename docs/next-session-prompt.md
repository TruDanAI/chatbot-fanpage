# Next Session Prompt

Paste this full prompt into the next Codex session before continuing work.

```text
Tiếp tục repo chatbot-fanpage.

Repo path:
c:\Users\Pc\Desktop\New folder\chatbot-fanpage

Timezone người dùng: Asia/Bangkok
Branch chính: main

Mục tiêu sản phẩm:
- Biến chatbot Messenger hiện tại thành một hệ thống admin/SaaS nội bộ ổn định.
- Ưu tiên an toàn dữ liệu production hơn tốc độ làm tính năng.
- Admin dashboard hiện có internal-notes UI/list/form trên user detail, nhưng
  chưa có edit/delete/hide/order-notes UI. Phase 4 internal notes v1
  backend/API/UI đã complete: design/SQL proposal/safe
  verifier/live local PostgreSQL verification/create service/read-list model,
  GET+POST API/tests, production schema đã apply, production POST note-create
  smoke đã pass, post-create GET read smoke đã pass, và User Detail UI smoke
  đã pass.
- Multi-shop MVP trên branch feature/multi-shop-dashboard đã pass staging:
  MULTI_SHOP_DB_CONFIG_ENABLED=true, multi-shop schema applied, admin audit
  schema applied, adult-shop seeded, runtime DB config/admin shops read-only/
  product CRUD smoke passed, audit delta +5, original 13 products unchanged,
  smoke product archived. Latest multi-shop fix commit:
  e98ad73 Fail product writes on aborted transactions. Production chưa đụng.
- Multi-shop runtime safety foundation mới nhất: runtime admission guard dùng
  `RUNTIME_ALLOWED_SHOP_IDS` / `RUNTIME_ALLOWED_PAGE_IDS`; unknown page vẫn
  fail-closed khi allowlist active; runtime logs dùng `page_ref=p:<hash>` thay
  raw `page_id`.
- Per-page credential resolution phase 1 đã hoàn tất local-only:
  `shop_page_credentials` additive SQL proposal, credential service mã hóa/giải
  mã bằng `CREDENTIAL_MASTER_KEY`, DB-backed runtime chọn đúng page token,
  missing credential fail-closed, legacy file-backed runtime vẫn dùng
  `FB_PAGE_TOKEN`; latest local verification `npm test` = 479 passed, 0 failed.
  Không deploy, không đổi production env, không ghi production DB, không đụng
  production /data.

Quy tắc an toàn bắt buộc:
- Ưu tiên an toàn dữ liệu tuyệt đối.
- Không mất dữ liệu production.
- Không deploy nếu tôi chưa xác nhận riêng trong phiên này.
- Không push nếu tôi chưa xác nhận riêng trong phiên này.
- Không đổi production env nếu tôi chưa xác nhận riêng.
- Không ghi production PostgreSQL nếu chưa có backup mới và xác nhận riêng.
- Không dùng DATABASE_URL để verify schema/test SQL vì biến này có thể là
  production. Verification script phải từ chối DATABASE_URL và chỉ nhận biến
  non-production explicit như CHATBOT_TEST_DATABASE_URL hoặc
  CHATBOT_STAGING_DATABASE_URL.
- Không xóa/sửa/truncate/drop/reset production DB.
- Không switch production về file storage.
- Không đụng production /data trừ khi chỉ đọc để kiểm tra.
- Không chạy authenticated admin smoke nếu chưa xác nhận riêng vì sẽ ghi audit
  rows production.
- Không tạo production internal note nếu chưa xác nhận rõ vì đó là business
  data write.
- Không in dữ liệu khách, token, DATABASE_URL, Facebook token, Google service account, Telegram token ra chat.
- Không in raw customer rows/messages/orders ra chat. Nếu cần verify thì dùng counts, status code, title, masked snippets.
- Nếu tính năng mới cần env setup, phải thêm key tương ứng vào .env.example với comment rõ local/production, optional/bắt buộc, và rủi ro nếu bật.
- Migration production phải additive/idempotent, có backup mới, có verify count-only, và có xác nhận riêng.

Production:
- Railway project: graceful-harmony
- Railway production service: chatbot-fanpage
- Railway production Postgres service: Postgres-TQuc
- Public domain đã dùng smoke test:
  https://chatbot-fanpage-production.up.railway.app
- Storage production đang dùng PostgreSQL.
- Các biến production đã biết từ phiên trước, phải kiểm tra lại chứ không được giả định:
  - STORAGE_ADAPTER=postgres
  - DATABASE_URL=${{Postgres-TQuc.DATABASE_URL}}
  - ALLOW_PRODUCTION_DB_WRITES=true
  - ADMIN_AUDIT_LOG_ENABLED=true
  - ADMIN_EXPORT_TOKEN rotated ngày 2026-05-11, set=true, không in value
  - SESSION_SECRET set=true theo metadata safe check ngày 2026-05-11, không in value
  - ADMIN_PUBLIC_BASE_URL set=true theo metadata safe check ngày 2026-05-11, không in value
  - ADMIN_SESSION_COOKIE_NAME set=true theo metadata safe check ngày 2026-05-11, không in value
  - TENANT_ID=default
  - PAGE_ID=1026325343908119

Trạng thái production mới nhất đã biết:
- Latest verified Railway deployment:
  a4155bae-5a11-476c-8cf0-f77931565b2c SUCCESS ở commit fae7c7f
  Fix user detail internal notes UI contract
- Latest pushed/code commit:
  fae7c7f Fix user detail internal notes UI contract
- Latest git state:
  Must be re-checked at the start of the next session with `git status` and
  `git rev-list --left-right --count origin/main...HEAD`. Do not assume the
  previous clean state still holds after handoff/docs/runtime safety updates.
- Latest production internal_notes schema apply:
  db/internal-notes-proposal.sql đã apply thành công vào production
  PostgreSQL sau backup mới.
- Backup dùng trước schema apply/read smoke:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply
- Backup archive:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply\postgres-base64jsonl.tar.gz
- Backup SHA256:
  59CF7048631D86E8F5E5E0CFA5777A0224B41FEB8F09BC79B344F218789E0384
- Production internal_notes schema verification:
  internal_notes table exists; pre-create internal_notes count = 0; expected
  indexes exist; expected CHECK constraints exist.
- Authenticated production schema-era read API smoke đã pass:
  GET /admin/api/internal-notes chỉ đọc, dùng existing customer sender_id từ
  profiles nhưng không in raw value; HTTP 200; schemaReady=true; notes=[];
  pagination present; không có raw DB error indicators.
- Audit delta during internal-notes read smoke:
  admin_audit_log before total 52, denied 19, success 33; after total 53,
  denied 19, success 34; auditDelta=+1 success.
- internal_notes before read smoke: 0.
- internal_notes after read smoke: 0.
- Production POST /admin/api/internal-notes note-create smoke đã pass sau
  deploy `9f10f24`; tạo đúng 1 production smoke note. Response HTTP 201, note
  id present, body_length present, note body không returned, không raw
  customer/order/message data, không raw DB error, không in target_id/token/DB
  URL.
- internal_notes after POST smoke: 1.
- admin_audit_log after POST smoke: total 54, success 35, denied 19, error 0.
- Production GET /admin/api/internal-notes read smoke sau create đã pass:
  HTTP 200, schemaReady=true, notes.length=1, pagination present, safe note
  fields only, không raw customer/order/message data, không DB error, không in
  target_id/token/DB URL.
- internal_notes after GET smoke: 1.
- admin_audit_log after GET smoke: total 55, success 36, denied 19, error 0.
- Smoke note vẫn tồn tại và chưa bị hidden/deleted.
- Authenticated production User Detail internal notes UI smoke đã pass sau
  deploy `fae7c7f`: opened exactly one authenticated user detail page; HTTP
  200; smoke note visible; form visibility matched current Bearer/admin role;
  internal_notes count 1 -> 1; admin_audit_log 61 -> 62; audit delta +1
  success, +0 denied, +0 error; no POST calls; no note create/hide/delete; no
  env change; no deploy during smoke; no production /data touch. Caveat:
  literal Vietnamese heading check had a PowerShell encoding issue, but
  deployed source contains `Ghi Chú Nội Bộ` and the live GET showed the note
  body/form from that section.
- Không đổi production env.
- Không deploy trong lúc POST/GET smoke.
- Không apply schema trong lúc POST/GET smoke.
- Không đụng production /data.
- Latest local test coverage baseline:
  `npm test` passed with 479 passed, 0 failed after per-page credential phase 1.
  Tests cover internal-notes validation/RBAC/transaction/audit fail-closed
  behavior, SQL verifier guardrails, read model behavior, webhook log
  redaction, multi-shop runtime admission, page credential encryption/decryption,
  DB-backed credential token selection, missing credential fail-closed behavior,
  legacy `FB_PAGE_TOKEN` fallback, and no raw token/page_id logging.
- Latest Phase 4 internal notes live local SQL verification:
  npm run verify:internal-notes-sql passed using local Docker Postgres
  container chatbot-fanpage-internal-notes-pg, bound to
  127.0.0.1:55432 -> 5432.
  CHATBOT_TEST_DATABASE_URL was set only inside the verifier PowerShell
  process, and DATABASE_URL was removed from that process.
  The verifier created an isolated schema, applied
  db/internal-notes-proposal.sql twice, verified table, columns, indexes, and
  CHECK constraints, dropped the isolated schema, and left 0 remaining
  internal_notes_verify_% schemas.
- GET /admin/api/internal-notes read API đã implement/deploy và authenticated
  production read smoke đã pass sau production schema apply và sau note-create
  smoke.
- POST /admin/api/internal-notes create API đã implement/deploy và
  authenticated production note-create smoke đã pass.
- Read API production hiện trả schemaReady=true với notes.length=1 cho smoke
  note target.
- Production schema apply đã hoàn tất cho internal_notes.
- Production DB writes đã biết cho Phase 4 internal notes: additive schema
  apply; +1 audit success row từ schema-era read smoke; +1 production smoke
  note từ POST smoke; +1 audit success row từ POST smoke; +1 audit success row
  từ post-create GET smoke; +1 audit success row từ User Detail UI smoke.
- Không production env change.
- Không deploy trong lúc POST/GET smoke.
- Không apply schema trong lúc POST/GET smoke.
- Không production /data touch.
- Previous verified Railway deployment:
  06f98cbf-c6f8-4eae-b6e1-f63367b2d2e9 SUCCESS ở commit 834c157
  Add internal notes read API
- Previous verified Railway deployment:
  c220b138-ff42-4630-a0db-4404e4b39370 SUCCESS ở commit 1a8f8d7
  Add internal notes read model
- Previous verified Railway deployment:
  39f5f647-9815-4b70-8891-9a612b8b8444 SUCCESS ở commit d138144
  Add internal notes SQL proposal checks
- Previous verified Railway deployment:
  c2f57a04-9040-4dc4-8d1e-bdc0cb066429 SUCCESS ở commit 5989b2e
  Complete Phase 3.5 identity audit design
- Earlier verified Railway deployment:
  0d92944b-4aa7-4a84-bdfe-836d01ac2e93 SUCCESS ở commit 2841e69
  Update handoff docs after login rate limit deploy
- Previous verified code/docs deployment:
  5989b2e Complete Phase 3.5 identity audit design
- Latest verified docs deployment:
  d6e8cb9 Add internal notes production rollout runbook
- Latest verified code/docs deployment:
  9f10f24 Add internal notes create API
- Latest verified code/docs Railway deployment:
  71daeacd-015f-4f03-b5fc-b21e72bac1b0 SUCCESS ở commit 9f10f24
- Latest verified docs Railway deployment:
  48b0f11b-f577-4853-90c6-4e04ceac7d82 SUCCESS ở commit d6e8cb9
- Latest verified code deployment:
  9f10f24 Add internal notes create API
- Latest verified code Railway deployment:
  71daeacd-015f-4f03-b5fc-b21e72bac1b0 SUCCESS ở commit 9f10f24
- Previous verified code deployment:
  834c157 Add internal notes read API
- Previous verified code Railway deployment:
  06f98cbf-c6f8-4eae-b6e1-f63367b2d2e9 SUCCESS ở commit 834c157
- Previous verified code deployment:
  1a8f8d7 Add internal notes read model
- Previous verified code Railway deployment:
  c220b138-ff42-4630-a0db-4404e4b39370 SUCCESS ở commit 1a8f8d7
- Previous verified code deployment:
  d138144 Add internal notes SQL proposal checks
- Previous verified code Railway deployment:
  39f5f647-9815-4b70-8891-9a612b8b8444 SUCCESS ở commit d138144
- Previous verified code deployment:
  31bcf1f Add admin login rate limit
- Previous verified code Railway deployment:
  ca5e0770-34bd-40e7-a7a5-61998c06768e SUCCESS ở commit 31bcf1f
- Previous verified code deployment:
  5e2748b Add admin read pagination
- Previous verified code Railway deployment:
  84899ffb-858a-4cec-85fc-bf7d73083359 SUCCESS ở commit 5e2748b
- Previous verified code deployment:
  0c30a9a Extract admin dashboard repository
- Previous verified code Railway deployment:
  85084c38-40a2-44ef-acc1-882035dc89cb SUCCESS ở commit 0c30a9a
- Previous verified Railway deployment:
  f8faaaf0-69c2-4988-abc5-cfd13b72bd48 SUCCESS ở commit 3c45166
  Update handoff docs after token rotation
- Latest verified Railway deployment after ADMIN_EXPORT_TOKEN rotation:
  255aacfd-1f58-4697-ba1f-378a65ec1f7a SUCCESS ở commit 0ac16bf
- Previous Railway deployment after first token rotation attempt:
  48dc3133-5c60-4574-aa86-9431c8fab73e SUCCESS ở commit 0ac16bf.
  Lưu ý: lần set đầu bằng PowerShell stdin bị BOM trong token, phát hiện trước khi smoke authenticated thành công, sau đó rotate lại bằng ASCII stdin.
- Previous Railway deployment:
  bc732be5-b422-4669-9e5d-d97406f4a693 SUCCESS ở commit 8cccc0c Update handoff docs after ops insights deploy
- Previous code deployment:
  affaf4b Add admin ops insights API
- Previous session/login code deployment:
  8baa178 Add admin session login flow
- Latest verified docs handoff commit before repository deploy:
  8cccc0c Update handoff docs after ops insights deploy
- Previous route handler code deployment:
  fd5a9a0 Extract admin route handlers
- Previous docs-only deployed commit:
  70ac695 Update handoff docs after route handler deploy
- Previous admin refactor code commit:
  20676a3 Refactor admin dashboard modules
- Previous Railway code deployment:
  d30fb579-77df-4dda-97ee-4ae291262856 SUCCESS ở commit 8baa178
- Previous Railway deployment after enabling audit env:
  2ebbb94b-4f77-489b-a309-db3b0ed04784 SUCCESS ở commit 6d21707
- Previous code Railway deployment:
  69552f93-f4ee-4ef6-b382-7e7891e409df SUCCESS
- Previous docs-only Railway deployment:
  5e84718a-8ea4-4ad0-8767-20052dd38cd3 SUCCESS
- Previous route handler Railway deployment:
  6e26df2d-2cff-4634-b4b2-6fb5ffaf523c SUCCESS
- Previous admin refactor Railway deployment:
  81404dae-05e9-4aa6-94f1-1ef5c7538b7e SUCCESS
- /healthz gần nhất:
  ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
- Previous admin smoke bằng Bearer header trước repository deploy:
  /admin/dashboard: 200, title=Admin Dashboard
  /admin/audit: 200, title=Admin Audit Log, schema_message=false
- Post-repository deploy smoke không ghi DB:
  /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
  GET /admin/login 200, title=Admin Login, has_form=true
- /admin/login gần nhất sau login rate limit deploy:
  200 Admin Login HTML, has_form=true.
- Latest approved browser cookie smoke sau token rotation:
  /admin/dashboard bằng Bearer: 200, title=Admin Dashboard
  /admin/audit bằng Bearer: 200, title=Admin Audit Log, schema_message=false
  POST /admin/login bằng token mới: 303 -> /admin/dashboard, cookie HttpOnly=true, Secure=true, SameSite=Lax=true
  /admin/dashboard bằng cookie: 200, title=Admin Dashboard
  /admin/audit bằng cookie: 200, title=Admin Audit Log, schema_message=false
- Audit production đã bật. Count-only sau smoke/token rotation:
  before admin_audit_log=34, outcomes denied=8, success=26.
- Audit production count-only sau pagination authenticated smoke:
  after admin_audit_log=38, outcomes denied=8, success=30, auditDelta=4.
- Audit production count-only sau approved login rate-limit smoke:
  after admin_audit_log=52, outcomes denied=19, success=33, error=0,
  auditDelta=14 từ backup trước smoke.
- Audit production count-only sau approved internal-notes read API smoke:
  after admin_audit_log=53, outcomes denied=19, success=34,
  auditDelta=+1 success.

Git state mới nhất đã biết:
- Latest code/docs commit đã push/deploy:
  d6e8cb9 Add internal notes production rollout runbook
- Previous code/docs commit đã push/deploy:
  834c157 Add internal notes read API
- Previous code/docs commit đã push/deploy:
  1a8f8d7 Add internal notes read model
- Earlier code/docs commit đã push/deploy:
  d138144 Add internal notes SQL proposal checks
- Previous code/docs commit đã push/deploy:
  5989b2e Complete Phase 3.5 identity audit design
- Latest docs commit đã push/deploy:
  2841e69 Update handoff docs after login rate limit deploy
- Latest code commit đã push/deploy:
  31bcf1f Add admin login rate limit
- Previous code commit đã push/deploy:
  5e2748b Add admin read pagination
- Previous code commit đã push/deploy:
  0c30a9a Extract admin dashboard repository
- Latest docs commit đã push/deploy:
  3c45166 Update handoff docs after token rotation
- Latest docs commit đã push/deploy sau repository deploy:
  0ac16bf Update handoff docs after repository deploy
- Latest docs commit đã push/deploy trước repository slice:
  8cccc0c Update handoff docs after ops insights deploy
- Previous code commit đã push/deploy:
  affaf4b Add admin ops insights API
- Previous session/login code commit đã push/deploy:
  8baa178 Add admin session login flow
- Previous docs commit đã push/deploy:
  c333388 Update handoff docs after audit rollout
- Latest docs commit đã push/deploy trước phiên audit:
  6d21707 Update handoff docs after legacy handler deploy
- Code refactor commit đã push/deploy:
  da48d2a Extract admin legacy handlers
- Previous route handler commit đã push/deploy:
  fd5a9a0 Extract admin route handlers
- Previous docs-only handoff commit đã push/deploy:
  70ac695 Update handoff docs after route handler deploy
- Trước docs-only handoff update cuối phiên:
  worktree clean, origin/main...HEAD = 0 0.
- Latest commits:
  d6e8cb9 Add internal notes production rollout runbook
  834c157 Add internal notes read API
  1a8f8d7 Add internal notes read model
  d138144 Add internal notes SQL proposal checks
  5989b2e Complete Phase 3.5 identity audit design

Backup production mới nhất đã biết:
- Latest backup:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply
- Latest backup archive:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply\postgres-base64jsonl.tar.gz
- Latest backup SHA256:
  59CF7048631D86E8F5E5E0CFA5777A0224B41FEB8F09BC79B344F218789E0384
- Latest post-apply internal_notes verification:
  internal_notes table exists; count = 0; expected indexes exist; expected
  CHECK constraints exist.
- Previous backup:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-180314-postgres-login-rate-smoke
  SHA256 06828A6B579FA434DD48C7153668E4CB5F3FA7326139095E4097D0BFEAB8DA85
  Counts:
  profiles 1, conversations 4, messages 53, orders 6, order_items 7, events 249, processed_mids 94,
  admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 38
- Previous backup:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-171508-postgres-pagination-smoke
  SHA256 F0A371964CBBA397DA6F382DE1CA77B2CE5484153F2EE9818C826AE8D80BC720
  Counts profiles 1, conversations 4, messages 53, orders 6, order_items 7, events 249, processed_mids 94,
  admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 34
- Path:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-152322-postgres
- SHA256:
  7AE33DB76481BE7A8FB33A0A1B7FDD4630DEEF8E1C6EEE0E072998680B087F6E
- Counts:
  profiles 1, conversations 4, messages 53, orders 6, order_items 7, events 249, processed_mids 94,
  admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 24
- Backup PostgreSQL JSONL này tạo ngoài repo bằng read-only SELECT trước khi smoke login/cookie và rotate ADMIN_EXPORT_TOKEN ngày 2026-05-11.
- Previous backup dùng cho production audit schema apply:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-101331
  SHA256 CEC1076AE2CC131DB136FE81A9EBBE31D9D46D535CEF9779FB59E0F7A2CBF54D
  Counts profiles 1, conversations 4, messages 37, orders 6, order_items 7, events 223, processed_mids 85
- Nếu chuẩn bị production DB write mới trong phiên sau, tạo backup PostgreSQL production mới ngoài repo, read-only SELECT, verify SHA256/counts.

Đã làm vừa qua:
1. Baseline đầu phiên:
   - git clean.
   - origin/main...HEAD = 0 0.
   - Latest production deployment lúc đó là eb864ef9... ở commit b90c5de.
   - /healthz production ok=true, storage.adapter=postgres, storage.ready=true.
   - npm test: 268 passed.
   - npm audit --omit=dev: 0 vulnerabilities.
2. Refactor admin dashboard an toàn:
   - Tách PostgreSQL dashboard/audit reader ra:
     core/admin/reader.js
   - Tách audit writer ra:
     core/admin/audit.js
   - Tách server-rendered admin HTML/views ra:
     core/admin/views.js
   - Giữ route wiring và export tương thích cũ trong:
     core/admin-routes.js
   - Không đổi schema.
   - Không đổi env.
   - Không thêm production write workflow.
   - Không bật ADMIN_AUDIT_LOG_ENABLED.
3. Verify trước deploy refactor:
   - node --check pass cho core/admin-routes.js, core/admin/reader.js, core/admin/audit.js, core/admin/views.js.
   - npm test: 268 passed.
   - npm audit --omit=dev: 0 vulnerabilities.
   - git diff --check pass.
4. Push/deploy refactor sau khi có xác nhận riêng:
   - Commit:
     20676a3 Refactor admin dashboard modules
   - Pushed origin/main.
   - Railway deployment:
     81404dae-05e9-4aa6-94f1-1ef5c7538b7e SUCCESS
   - Smoke:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true
     /admin/dashboard 200
     /admin/audit 200, schema message vẫn hiện như kỳ vọng
5. Cập nhật docs handoff/roadmap:
   - docs/next-session-prompt.md
   - docs/saas-roadmap.md
   - Commit:
     5851368 Update handoff docs after admin refactor deploy
   - Pushed origin/main.
   - Railway auto-deploy docs-only:
     7d0d93fb-4537-4849-a765-0f0c9c37a1fb SUCCESS
   - Smoke lại:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true
     /admin/dashboard 200
     /admin/audit 200, schema_message=true
6. Phiên code-only route handler, đã push/deploy sau xác nhận:
   - Re-check production deployment:
     7d0d93fb-4537-4849-a765-0f0c9c37a1fb SUCCESS ở commit 5851368.
   - /healthz production:
     ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
   - Local git sau fetch:
     worktree bắt đầu sạch, origin/main...HEAD = 0 1, local HEAD 5ec0902.
   - Tách route auth/audit request handling ra:
     core/admin/route-auth.js
   - Tách dashboard/user detail/audit page handlers ra:
     core/admin/read-routes.js
   - core/admin-routes.js giờ giữ route wiring, legacy export/state handlers, và dùng createAdminRouteAuthorizer()/createAdminReadHandlers().
   - Export tương thích cũ vẫn giữ qua core/admin-routes.js.
   - Thêm tests cho parseAdminRoles và IP allowlist denied audit.
   - Không đổi schema.
   - Không đổi env.
   - Không thêm production write workflow.
   - Không bật ADMIN_AUDIT_LOG_ENABLED.
   - node --check pass cho core/admin-routes.js, core/admin/route-auth.js, core/admin/read-routes.js, tests/admin-routes.test.js.
   - npm test: 270 passed.
   - npm audit --omit=dev: 0 vulnerabilities.
   - git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     fd5a9a0 Extract admin route handlers
   - Pushed origin/main.
   - Railway deployment:
     6e26df2d-2cff-4634-b4b2-6fb5ffaf523c SUCCESS
   - Smoke:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
     /admin/dashboard 200, title=Admin Dashboard
     /admin/audit 200, title=Admin Audit Log, schema_message=true
7. Phiên code-only legacy handlers, đã push/deploy sau xác nhận:
   - Local git đầu slice:
     worktree clean, origin/main...HEAD = 0 0, HEAD 70ac695.
   - Tách legacy export/state handlers ra:
     core/admin/legacy-routes.js
   - core/admin-routes.js giờ chủ yếu giữ dependency setup và route wiring.
   - Thêm tests cho:
     legacy export 404 audit khi file chưa có
     legacy state support read audit success
   - Không đổi schema.
   - Không đổi env.
   - Không thêm production write workflow.
   - Không bật ADMIN_AUDIT_LOG_ENABLED.
   - node --check pass cho core/admin-routes.js, core/admin/legacy-routes.js, tests/admin-routes.test.js.
   - npm test: 272 passed.
   - npm audit --omit=dev: 0 vulnerabilities.
   - git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     da48d2a Extract admin legacy handlers
   - Pushed origin/main.
   - Railway deployment:
     69552f93-f4ee-4ef6-b382-7e7891e409df SUCCESS
   - Smoke:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
     /admin/dashboard 200, title=Admin Dashboard
     /admin/audit 200, title=Admin Audit Log, schema_message=true
8. Phiên production audit rollout, đã làm sau xác nhận riêng:
   - Preflight:
     worktree clean, origin/main...HEAD = 0 0.
     Latest production deployment trước env change:
       3f0bff5b-fe89-4c5b-a611-59e709a03835 SUCCESS ở commit 6d21707.
     /healthz production:
       ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     npm test: 272 passed.
     npm audit --omit=dev: 0 vulnerabilities.
   - Tạo backup PostgreSQL production mới ngoài repo bằng read-only SELECT:
     Path: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-101331
     SHA256: CEC1076AE2CC131DB136FE81A9EBBE31D9D46D535CEF9779FB59E0F7A2CBF54D
     Counts: profiles 1, conversations 4, messages 37, orders 6, order_items 7, events 223, processed_mids 85
   - Review SQL:
     db/admin-auth-rbac-audit-proposal.sql additive/idempotent.
     Có CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING.
     Không thấy DROP/TRUNCATE/DELETE/destructive ALTER.
   - Staging apply chưa làm được vì CHATBOT_STAGING_DATABASE_URL tồn tại nhưng không phải URL hợp lệ.
   - Sau xác nhận riêng, apply schema audit production:
     admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 0.
   - Smoke sau schema:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
     /admin/dashboard 200, title=Admin Dashboard
     /admin/audit 200, title=Admin Audit Log, schema_message=false
   - Sau xác nhận riêng tiếp theo, bật production env:
     ADMIN_AUDIT_LOG_ENABLED=true
   - Railway deployment do env change:
     2ebbb94b-4f77-489b-a309-db3b0ed04784 SUCCESS ở commit 6d21707.
   - Smoke sau bật audit:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
     /admin/dashboard 200, title=Admin Dashboard
     /admin/audit 200, title=Admin Audit Log, schema_message=false
   - Verify audit count-only sau smoke:
     admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 2, outcomes success=2.
   - Không push code trong phiên audit rollout.
   - Không ghi production /data.
9. Phiên Phase 3 admin login/session, đã push/deploy code sau xác nhận:
   - Thêm browser login flow:
     GET /admin/login
     POST /admin/login
     POST /admin/logout
   - Thêm signed stateless admin session cookie:
     core/admin/session.js
   - Cookie dùng HttpOnly, SameSite=Lax, Secure khi production hoặc ADMIN_PUBLIC_BASE_URL là https.
   - Session token được rotate khi login.
   - Dashboard/user detail/audit read routes nhận session cookie hoặc Authorization Bearer.
   - Legacy export/state routes vẫn giữ compatibility x-admin-token/Authorization Bearer qua static admin token, không chuyển sang browser session.
   - Giữ Authorization: Bearer cho automation.
   - Login success/failure ghi audit, không ghi raw token.
   - Thêm express.urlencoded để nhận form login.
   - Thêm env docs trong .env.example:
     SESSION_SECRET
     ADMIN_PUBLIC_BASE_URL
     ADMIN_SESSION_COOKIE_NAME
   - Nếu SESSION_SECRET chưa set hoặc ngắn hơn 32 ký tự, /admin/login trả 503; Bearer token vẫn hoạt động.
   - Tests mới cho:
     login set HttpOnly/Secure/SameSite cookie
     login sai token không set cookie và audit denied
     dashboard nhận session cookie nhưng vẫn không nhận query token
     logout clear cookie
   - Verify local:
     node --check pass cho core/admin-routes.js, core/admin/route-auth.js, core/admin/session.js, core/admin/views.js, tests/admin-routes.test.js
     npm test: 276 passed
     npm audit --omit=dev: 0 vulnerabilities
     git diff --check pass, chỉ có cảnh báo line ending CRLF/LF
   - Commit:
     8baa178 Add admin session login flow
   - Pushed origin/main.
   - Railway deployment:
     d30fb579-77df-4dda-97ee-4ae291262856 SUCCESS ở commit 8baa178.
   - Smoke sau deploy:
     /healthz ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
     /admin/dashboard 200, title=Admin Dashboard bằng Bearer header
     /admin/audit 200, title=Admin Audit Log bằng Bearer header
     /admin/login 503 Admin Login HTML vì SESSION_SECRET production chưa set
   - Tại thời điểm Phase 3 code deploy, chưa set SESSION_SECRET/ADMIN_PUBLIC_BASE_URL/ADMIN_SESSION_COOKIE_NAME production.
   - Không ghi production DB trong Phase 3 code-only.
   - Không ghi production /data.
10. Phiên code-only admin privacy headers + read-only API/ops insights foundation, đã push/deploy sau xác nhận:
   - Preflight local/production:
     worktree ban đầu clean, origin/main...HEAD = 0 0.
     Latest production deployment:
       f55f2c43-fb2b-4bb0-9a3a-3f62def7ad21 SUCCESS ở commit 46ca2d3.
     /healthz production:
       ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     Production env metadata safe check:
       STORAGE_ADAPTER=postgres, ALLOW_PRODUCTION_DB_WRITES=true, ADMIN_AUDIT_LOG_ENABLED=true,
       SESSION_SECRET_set=true, ADMIN_PUBLIC_BASE_URL_set=true, ADMIN_SESSION_COOKIE_NAME_set=true,
       TENANT_ID=default, PAGE_ID=1026325343908119.
   - Không chạy Bearer/cookie admin smoke vì ADMIN_AUDIT_LOG_ENABLED=true sẽ ghi audit rows production và cần xác nhận riêng.
   - GET /admin/login không token, không DB write:
     200, title=Admin Login, has_form=true.
   - Count-only production bằng psql không chạy được vì local thiếu psql.
   - Count-only production bằng Node/pg qua railway run không kết nối được từ local do DATABASE_URL resolve host nội bộ Railway (ENOTFOUND).
     Không in DATABASE_URL, không in secrets.
   - Thêm admin no-store/security headers middleware cho /admin:
     Cache-Control no-store, Pragma no-cache, Expires 0, X-Content-Type-Options nosniff, Referrer-Policy no-referrer.
   - Thêm read-only admin JSON API foundation phục vụ Phase 6 frontend sau này:
     GET /admin/api/dashboard
     GET /admin/api/dashboard/users/:senderId
     GET /admin/api/audit
   - API dùng cùng auth/RBAC/session/Bearer authorizer với HTML read routes.
   - API vẫn không nhận query token hoặc x-admin-token cho dashboard read routes.
   - API trả presenter JSON đã mask phone/address/snippets và không trả audit metadata raw.
   - Thêm ops insights read-only cho dashboard HTML và API:
     rolling 24h metrics, ready orders, active handoffs, events 24h,
     last user message/event timestamps, order status breakdown,
     top products 30d, needs-attention orders/handoffs.
   - Ops insights chỉ dùng SELECT qua read-only SQL guard.
   - Dashboard HTML có thêm Ops Snapshot, Needs Attention, Top Products, Order Status.
   - Thêm file:
     core/admin/api-presenter.js
   - Không đổi schema.
   - Không thêm env.
   - Không thêm production write workflow.
   - Document ADMIN_SESSION_TTL_MS trong .env.example.
   - Tests mới cho admin no-store middleware, admin API masking/auth/audit access,
     và operational insights SELECT read-only.
   - Verify local:
     node --check pass cho core/admin/api-presenter.js, core/admin/read-routes.js, core/admin/reader.js, core/admin/views.js, core/admin-routes.js, tests/admin-routes.test.js.
     npm test: 282 passed.
     npm audit --omit=dev: 0 vulnerabilities.
     git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     affaf4b Add admin ops insights API
   - Pushed origin/main sau xác nhận push/deploy.
   - Railway deployment:
     416e4908-9c70-41f3-8988-b9fafb1f03ba SUCCESS ở commit affaf4b.
   - Smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, title=Admin Login, has_form=true.
   - Không smoke /admin/dashboard, /admin/api/dashboard, /admin/audit bằng Bearer/cookie vì sẽ ghi audit rows production và cần xác nhận riêng cho DB write audit smoke.
   - Không đổi production env.
   - Không ghi production DB.
   - Không ghi production /data.
11. Phiên code-only dashboard repository split, đã push/deploy sau xác nhận:
   - Baseline đầu phiên:
     worktree clean, origin/main...HEAD = 0 0.
     Latest production deployment:
       bc732be5-b422-4669-9e5d-d97406f4a693 SUCCESS ở commit 8cccc0c.
     /healthz production:
       ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login không token:
       200, title=Admin Login, has_form=true.
     Production env metadata safe check:
       STORAGE_ADAPTER=postgres, ALLOW_PRODUCTION_DB_WRITES=true, ADMIN_AUDIT_LOG_ENABLED=true,
       SESSION_SECRET_set=true, ADMIN_PUBLIC_BASE_URL_set=true, ADMIN_SESSION_COOKIE_NAME_set=true,
       TENANT_ID=default, PAGE_ID=1026325343908119.
   - Tách dashboard SQL/query composition ra:
     core/admin/dashboard-repository.js
   - core/admin/reader.js giờ giữ filter normalization, limit config, PostgreSQL connection lifecycle, và read-only SQL guard.
   - Thêm test trực tiếp cho repository audit query parameterized/read-only.
   - Không đổi schema.
   - Không đổi env.
   - Không thêm production write workflow.
   - Verify local:
     node --check pass cho core/admin/dashboard-repository.js, core/admin/reader.js, tests/admin-routes.test.js.
     npm test: 283 passed.
     npm audit --omit=dev: 0 vulnerabilities.
     git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     0c30a9a Extract admin dashboard repository
   - Pushed origin/main sau xác nhận push/deploy.
   - Railway deployment:
     85084c38-40a2-44ef-acc1-882035dc89cb SUCCESS ở commit 0c30a9a.
   - Smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, title=Admin Login, has_form=true.
   - Không smoke /admin/dashboard, /admin/api/dashboard, /admin/audit bằng Bearer/cookie vì sẽ ghi audit rows production và cần xác nhận riêng cho DB write audit smoke.
   - Không đổi production env.
   - Không ghi production DB.
   - Không ghi production /data.
12. Phiên production browser-cookie smoke + ADMIN_EXPORT_TOKEN rotation, đã làm sau xác nhận riêng:
   - Preflight:
     worktree clean, origin/main...HEAD = 0 0.
     Latest production deployment trước smoke/rotation:
       258877be-b636-49ca-8578-e807cb4df02d SUCCESS ở commit 0ac16bf.
     /healthz production:
       ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login không token:
       200, title=Admin Login, has_form=true.
   - Tạo backup PostgreSQL production mới ngoài repo bằng read-only SELECT:
     Path: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-152322-postgres
     Archive: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-152322-postgres\postgres-jsonl.tar.gz
     SHA256: 7AE33DB76481BE7A8FB33A0A1B7FDD4630DEEF8E1C6EEE0E072998680B087F6E
     Counts: profiles 1, conversations 4, messages 53, orders 6, order_items 7, events 249,
       processed_mids 94, admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 24.
   - Approved browser-cookie smoke trước token rotation:
     admin_audit_log before=24, outcomes denied=8, success=16.
     /admin/dashboard bằng Bearer: 200, title=Admin Dashboard.
     /admin/audit bằng Bearer: 200, title=Admin Audit Log, schema_message=false.
     POST /admin/login: 303 -> /admin/dashboard, cookie HttpOnly=true, Secure=true, SameSite=Lax=true.
     /admin/dashboard bằng cookie: 200, title=Admin Dashboard.
     /admin/audit bằng cookie: 200, title=Admin Audit Log, schema_message=false.
     admin_audit_log after=29, outcomes denied=8, success=21, auditDelta=5.
   - Rotate ADMIN_EXPORT_TOKEN production env sau xác nhận:
     Không in token cũ hoặc token mới.
     Lần set đầu qua PowerShell stdin tạo token có BOM, phát hiện bằng post-rotation smoke trước khi authenticated smoke thành công.
     Rotate lại ngay bằng ASCII stdin qua temp file ngoài repo, temp file đã xóa.
   - Railway deployment sau rotation cuối:
     255aacfd-1f58-4697-ba1f-378a65ec1f7a SUCCESS ở commit 0ac16bf.
     Previous failed-format env deployment:
       48dc3133-5c60-4574-aa86-9431c8fab73e SUCCESS ở commit 0ac16bf, token đã được thay thế bởi rotation ASCII sau đó.
   - Production env metadata safe check sau rotation:
     STORAGE_ADAPTER=postgres, ALLOW_PRODUCTION_DB_WRITES=true, ADMIN_AUDIT_LOG_ENABLED=true,
     ADMIN_EXPORT_TOKEN_set=true, SESSION_SECRET_set=true, ADMIN_PUBLIC_BASE_URL_set=true,
     ADMIN_SESSION_COOKIE_NAME_set=true, TENANT_ID=default, PAGE_ID=1026325343908119.
   - Post-rotation smoke bằng token mới:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, title=Admin Login.
     admin_audit_log before=29, outcomes denied=8, success=21.
     /admin/dashboard bằng Bearer: 200, title=Admin Dashboard.
     /admin/audit bằng Bearer: 200, title=Admin Audit Log, schema_message=false.
     POST /admin/login: 303 -> /admin/dashboard, cookie HttpOnly=true, Secure=true, SameSite=Lax=true.
     /admin/dashboard bằng cookie: 200, title=Admin Dashboard.
     /admin/audit bằng cookie: 200, title=Admin Audit Log, schema_message=false.
     admin_audit_log after=34, outcomes denied=8, success=26, auditDelta=5.
   - Có ghi production DB: chỉ audit rows do admin smoke, tổng +10 success rows trong phiên smoke/rotation.
   - Có đổi production env: ADMIN_EXPORT_TOKEN đã rotate, token value không in ra chat/log.
   - Không ghi production /data.
13. Phiên read-only pagination, đã push/deploy/smoke sau xác nhận riêng:
   - Baseline trước push/deploy:
     worktree có 7 file modified liên quan pagination/docs/tests.
     origin/main...HEAD = 0 0.
     Latest local HEAD: 3c45166 Update handoff docs after token rotation.
     Latest production Railway deployment:
       f8faaaf0-69c2-4988-abc5-cfd13b72bd48 SUCCESS ở commit 3c45166.
     /healthz production:
       ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
   - Thêm bounded pagination cho dashboard overview tables:
     orders, conversations, recent events.
   - Dashboard dùng page params độc lập:
     `ordersPage`, `conversationsPage`, `eventsPage`.
   - Thêm bounded `page`/`limit` pagination cho `/admin/audit`.
   - Repository thêm filtered count-only SELECT và `LIMIT/OFFSET` parameterized.
   - HTML admin render Previous/Next và Page input cho dashboard/audit.
   - JSON API trả thêm `pagination` metadata cho `/admin/api/dashboard` và `/admin/api/audit`.
   - Không đổi schema.
   - Không đổi env.
   - Không thêm production write workflow.
   - Verify local trước push:
     node --check pass cho core/admin/dashboard-repository.js, core/admin/reader.js,
     core/admin/views.js, core/admin/api-presenter.js, tests/admin-routes.test.js.
     npm test: 283 passed.
     npm audit --omit=dev: 0 vulnerabilities.
     git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     5e2748b Add admin read pagination
   - Pushed origin/main sau xác nhận push/deploy.
   - Railway deployment:
     84899ffb-858a-4cec-85fc-bf7d73083359 SUCCESS ở commit 5e2748b.
   - Safe smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, title=Admin Login, has_form=true.
   - Tạo backup PostgreSQL production mới ngoài repo bằng read-only SELECT trước authenticated smoke:
     Path: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-171508-postgres-pagination-smoke
     Archive: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-171508-postgres-pagination-smoke\postgres-jsonl.tar.gz
     SHA256: F0A371964CBBA397DA6F382DE1CA77B2CE5484153F2EE9818C826AE8D80BC720
     Counts: profiles 1, conversations 4, messages 53, orders 6, order_items 7, events 249,
       processed_mids 94, admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 34.
   - Authenticated pagination smoke sau backup:
     before admin_audit_log=34, outcomes denied=8, success=26.
     /admin/dashboard?limit=2&ordersPage=1&conversationsPage=1&eventsPage=1 bằng Bearer:
       200, title=Admin Dashboard, has_pagination=true.
     /admin/api/dashboard?limit=2&ordersPage=2&conversationsPage=1&eventsPage=1 bằng Bearer:
       orders pagination page=2, limit=2, hasPrevious=true, hasNext=true.
     /admin/audit?limit=5&page=1 bằng Bearer:
       200, title=Admin Audit Log, has_pagination=true, schema_message=false.
     /admin/api/audit?limit=5&page=1 bằng Bearer:
       schemaReady=true, page=1, limit=5, hasNext=true.
     after admin_audit_log=38, outcomes denied=8, success=30, auditDelta=4.
   - Có ghi production DB: chỉ audit rows do admin smoke, tổng +4 success rows.
   - Không ghi production /data.
14. Phiên Phase 3.5 login rate limit, đã push/deploy sau xác nhận:
   - Baseline trước code push:
     worktree có 5 file modified liên quan login rate limit/env docs/tests.
     origin/main...HEAD = 0 0.
     Latest production Railway deployment:
       460ece03-c9ba-4a6e-9ac0-21e74b924285 SUCCESS ở commit 1c35127.
     /healthz production:
       ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login không token:
       200, title=Admin Login, has_form=true.
     Production env metadata safe check:
       STORAGE_ADAPTER=postgres, ALLOW_PRODUCTION_DB_WRITES=true, ADMIN_AUDIT_LOG_ENABLED=true,
       ADMIN_EXPORT_TOKEN_set=true, SESSION_SECRET_set=true, ADMIN_PUBLIC_BASE_URL_set=true,
       ADMIN_SESSION_COOKIE_NAME_set=true, TENANT_ID=default, PAGE_ID=1026325343908119.
   - Thêm in-memory fixed-window rate limit riêng cho POST /admin/login theo IP.
   - Mặc định mới:
     ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS=300000
     ADMIN_LOGIN_RATE_LIMIT_MAX=10
   - Khi bị chặn: trả 429, set Retry-After, render lại Admin Login HTML,
     không set cookie, ghi audit denied reason=login_rate_limited nếu audit logger bật.
   - Successful login reset bucket cho IP đó.
   - Thêm env docs trong .env.example.
   - Không đổi schema.
   - Không đổi production env.
   - Không thêm production write workflow.
   - Verify local trước push:
     node --check pass cho core/admin/session.js, core/admin-routes.js, index.js, tests/admin-routes.test.js.
     npm test: 285 passed.
     npm audit --omit=dev: 0 vulnerabilities.
     git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     31bcf1f Add admin login rate limit
   - Pushed origin/main sau xác nhận push/deploy.
   - Railway deployment:
     ca5e0770-34bd-40e7-a7a5-61998c06768e SUCCESS ở commit 31bcf1f.
   - Safe smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, title=Admin Login, has_form=true.
   - Không tạo backup mới vì không ghi production DB.
   - Không ghi production DB.
   - Không ghi production /data.
15. Phiên approved production login rate-limit smoke + audit stability:
   - Latest verified Railway deployment trước smoke:
     0d92944b-4aa7-4a84-bdfe-836d01ac2e93 SUCCESS ở commit 2841e69
     Update handoff docs after login rate limit deploy.
   - /healthz production:
     200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
   - GET /admin/login không token:
     200, title=Admin Login, has_form=true.
   - Tạo backup PostgreSQL production mới ngoài repo bằng read-only SELECT trước authenticated/rate-limit smoke:
     Path: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-180314-postgres-login-rate-smoke
     Archive: C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-180314-postgres-login-rate-smoke\postgres-jsonl.tar.gz
     SHA256: 06828A6B579FA434DD48C7153668E4CB5F3FA7326139095E4097D0BFEAB8DA85
     Counts: profiles 1, conversations 4, messages 53, orders 6, order_items 7, events 249,
       processed_mids 94, admin_users 0, admin_roles 4, admin_user_roles 0, admin_audit_log 38.
   - Smoke rate-limit/login sau backup:
     before admin_audit_log=38, outcomes denied=8, success=30.
     Invalid POST /admin/login attempts trả 401 khi còn trong limit, không set cookie.
     Khi vượt limit: 429, Retry-After set, Admin Login HTML, không set cookie, audit denied reason=login_rate_limited.
     Bearer automation và browser/session path vẫn pass trong smoke.
     after admin_audit_log=52, outcomes denied=19, success=33, error=0, auditDelta=14.
     Delta đúng kỳ vọng: +11 denied từ invalid/rate-limited login và +3 success từ authenticated checks.
   - Có ghi production DB: chỉ audit rows do admin smoke, tổng +14 rows.
   - Không đổi production env.
   - Không ghi production /data.
16. Phiên Phase 3.5 identity/audit design, đã push/deploy sau xác nhận:
   - Thêm docs/admin-identity-provisioning.md:
     PostgreSQL-backed admin_users/admin_user_roles design, provisioning sequence,
     rollback stance, và quy tắc chưa tạo production user vội.
   - Định nghĩa actor/audit semantics:
     Bearer automation là non-human actor `automation:admin_export_token` khi được cấu hình rõ;
     browser session hiện vẫn là bridge từ `ADMIN_PRINCIPAL_ID`, target sau này là `admin_users.id`.
   - core/admin-auth.js enrich audit metadata bằng safe `auth_method` cho audit entry mới.
   - Cập nhật DESIGN.md, docs/admin-auth-rbac-audit-runbook.md, docs/saas-roadmap.md,
     docs/next-session-prompt.md.
   - Không thêm business write workflow.
   - Không tạo production admin user.
   - Verify local trước push:
     node --check core/admin-auth.js pass.
     npm test: 285 passed.
     npm audit --omit=dev: 0 vulnerabilities.
     git diff --check pass, chỉ có cảnh báo line ending CRLF/LF.
   - Commit:
     5989b2e Complete Phase 3.5 identity audit design.
   - Pushed origin/main sau xác nhận push/deploy.
   - Railway deployment:
     c2f57a04-9040-4dc4-8d1e-bdc0cb066429 SUCCESS ở commit 5989b2e.
   - Safe smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, title=Admin Login, has_form=true.
   - Không đổi production env.
   - Không ghi production DB.
   - Không ghi production /data.
17. Phiên Phase 4 internal notes local service/test, đã push/deploy sau xác nhận:
   - Thêm design doc:
     docs/phase-4-internal-notes-design.md
   - Thêm SQL proposal additive/idempotent:
     db/internal-notes-proposal.sql
   - Thêm local PostgreSQL internal note service:
     core/admin/internal-notes.js
   - Thêm permission `admin.internal_note.write` cho maintainer/owner.
   - Thêm tests cho:
     validation, RBAC, transaction, audit fail-closed behavior, safe audit
     metadata, unresolved actor handling, và static SQL proposal checks.
   - Không thêm POST route.
   - Không thêm UI form.
   - Không apply production internal_notes schema.
   - Không chạy authenticated production note-create smoke.
   - Không đổi production env.
   - Không intentional production DB write.
   - Không ghi production /data.
   - Verify local:
     npm test: 301 passed, 0 failed.
     npm audit --omit=dev: 0 vulnerabilities.
   - Commit:
     d138144 Add internal notes SQL proposal checks.
   - Pushed origin/main sau xác nhận push/deploy.
   - Railway deployment:
     39f5f647-9815-4b70-8891-9a612b8b8444 SUCCESS ở commit d138144.
   - Safe public smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, Admin Login form present.
18. Phiên Phase 4 internal_notes live local PostgreSQL SQL verification:
   - Docker Desktop running; local container used:
     chatbot-fanpage-internal-notes-pg.
   - Container bound only to local host:
     127.0.0.1:55432 -> 5432.
   - Used a clearly local test database.
   - CHATBOT_TEST_DATABASE_URL was set only inside the verifier PowerShell
     process.
   - DATABASE_URL was removed from that verifier process.
   - npm run verify:internal-notes-sql passed.
   - Verification details:
     isolated schema created: yes;
     SQL proposal applied twice: yes;
     table verified: yes;
     columns verified: yes;
     indexes verified: yes;
     constraints verified: yes;
     isolated schema dropped: yes.
   - Extra local check:
     0 remaining internal_notes_verify_% schemas.
   - npm test: 308 passed, 0 failed.
   - npm audit --omit=dev: 0 vulnerabilities.
   - Git clean, origin/main...HEAD = 0 0.
   - No push, deploy, env change, production DB write, production data touch, or
     authenticated production smoke occurred during verification.
19. Phiên Phase 4 internal notes read/list model, đã push/deploy sau xác nhận:
   - Baseline latest commit:
     1a8f8d7 Add internal notes read model.
   - Railway deployment:
     c220b138-ff42-4630-a0db-4404e4b39370 SUCCESS ở commit 1a8f8d7.
   - Safe public smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, Admin Login form present.
   - Phase 4 internal notes status:
     design doc exists; SQL proposal exists; safe SQL verifier exists; live
     local PostgreSQL verification passed; create service exists local-only;
     read/list model exists local-only.
   - Tests cover validation, RBAC, transaction/audit fail-closed behavior,
     static SQL checks, verifier guardrails, and read model behavior.
   - Không thêm POST route.
   - Không thêm UI form/list.
   - Không apply production internal_notes schema.
   - Không chạy authenticated production note-create smoke.
   - Không đổi production env.
   - Không intentional production DB write.
   - Không ghi production /data.
   - Git clean, origin/main...HEAD = 0 0.
20. Phiên Phase 4 internal notes read API, đã push/deploy sau xác nhận:
   - Baseline latest commit:
     834c157 Add internal notes read API.
   - Railway deployment:
     06f98cbf-c6f8-4eae-b6e1-f63367b2d2e9 SUCCESS ở commit 834c157.
   - Safe public smoke sau deploy không ghi DB:
     /healthz 200, ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false.
     GET /admin/login 200, Admin Login form present.
   - GET /admin/api/internal-notes read API đã implement và deploy.
   - Read API handles missing production schema gracefully:
     schemaReady=false, notes=[].
   - Phase 4 internal notes status:
     design doc exists; SQL proposal exists; safe SQL verifier exists; live
     local PostgreSQL verification passed; create service exists local-only;
     read/list model exists local-only; GET /admin/api/internal-notes read API
     is implemented and deployed.
   - Không thêm POST route.
   - Không thêm UI form/list.
   - Không apply production internal_notes schema.
   - Không chạy authenticated production internal-notes smoke/call.
   - Không chạy authenticated production note-create smoke.
   - Không đổi production env.
   - Không intentional production DB write.
   - Không ghi production /data.
   - Git clean, origin/main...HEAD = 0 0.
21. Phiên Phase 4 internal_notes production schema apply + read smoke, đã làm
    sau backup và xác nhận riêng:
   - Latest code/docs commit trước production schema work:
     d6e8cb9 Add internal notes production rollout runbook.
   - Railway deployment giữ nguyên:
     48b0f11b-f577-4853-90c6-4e04ceac7d82 SUCCESS ở commit d6e8cb9.
   - Backup dùng trước schema apply/read smoke:
     C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply
   - Backup archive:
     C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260512-110333-postgres-internal-notes-preapply\postgres-base64jsonl.tar.gz
   - Backup SHA256:
     59CF7048631D86E8F5E5E0CFA5777A0224B41FEB8F09BC79B344F218789E0384
   - Production schema apply completed for:
     db/internal-notes-proposal.sql.
   - Production internal_notes schema verification:
     internal_notes table exists; internal_notes count = 0; expected indexes
     exist; expected CHECK constraints exist.
   - Authenticated production read API smoke completed:
     GET /admin/api/internal-notes only; used existing customer sender_id from
     profiles without printing it; HTTP 200; schemaReady=true; notes=[];
     pagination present; no raw DB error indicators.
   - admin_audit_log before: total 52, denied 19, success 33.
   - admin_audit_log after: total 53, denied 19, success 34.
   - auditDelta: +1 success.
   - internal_notes before: 0.
   - internal_notes after: 0.
   - No production internal note created.
   - No POST/create-note workflow run.
   - No env change.
   - No deploy during schema apply/read smoke.
   - No production /data touch.
   - Git remained clean, origin/main...HEAD = 0 0.
22. Phiên Phase 4 internal notes create API production smoke + read smoke, đã
    làm sau xác nhận riêng:
   - Latest commit:
     9f10f24 Add internal notes create API.
   - Railway deployment:
     71daeacd-015f-4f03-b5fc-b21e72bac1b0 SUCCESS ở commit 9f10f24.
   - Production POST /admin/api/internal-notes smoke passed.
   - POST created exactly 1 production smoke note.
   - internal_notes count after POST smoke: 1.
   - admin_audit_log after POST smoke: total 54, success 35, denied 19,
     error 0.
   - Production GET /admin/api/internal-notes read smoke passed.
   - GET returned HTTP 200, schemaReady=true, notes.length=1, pagination
     present, safe note fields only, no raw customer/order/message data, and
     no DB error.
   - admin_audit_log after GET smoke: total 55, success 36, denied 19,
     error 0.
   - Smoke note still exists and was not hidden/deleted.
   - No env change.
   - No deploy during smoke.
   - No schema apply during smoke.
   - No production /data touch.
   - Git remained clean, origin/main...HEAD = 0 0.
23. Phiên Phase 4 User Detail internal notes UI contract fix + production UI
    smoke, đã làm sau xác nhận riêng:
   - Latest code commit:
     fae7c7f Fix user detail internal notes UI contract.
   - Railway deployment:
     a4155bae-5a11-476c-8cf0-f77931565b2c SUCCESS ở commit fae7c7f.
   - User Detail internal notes UI smoke opened exactly one authenticated user
     detail page.
   - HTTP 200.
   - Smoke note visible: pass.
   - Form visibility: pass for current Bearer/admin role.
   - internal_notes count: 1 -> 1.
   - admin_audit_log: 61 -> 62.
   - audit delta: +1 success, +0 denied, +0 error.
   - No POST calls.
   - No note create/hide/delete.
   - No env change.
   - No deploy during smoke.
   - No production /data touch.
   - Caveat: literal Vietnamese heading check had a PowerShell encoding issue,
     but deployed source contains `Ghi Chú Nội Bộ` and live GET showed note
     body/form from the section.

Tính năng admin hiện có:
- Dashboard read-only với filters.
- Dashboard overview tables có bounded read-only pagination đã deploy:
  orders, conversations, recent events dùng page params độc lập.
- Bounded user detail view.
- Mask phone/address/snippets trong admin UI.
- Read-only SQL guard cho dashboard reader.
- Dashboard SQL/query composition đã tách vào core/admin/dashboard-repository.js.
- Admin auth hardening:
  - Dashboard read routes nhận Authorization: Bearer <ADMIN_EXPORT_TOKEN> hoặc admin session cookie sau login.
  - Không nhận token qua query param.
  - Legacy export/debug route còn x-admin-token compatibility.
- Admin browser login/session code-only:
  - /admin/login và /admin/logout đã deploy trong code production
  - POST /admin/login có in-memory rate limit theo IP, mặc định 10 lần / 5 phút
  - production session env hiện đã set theo metadata safe check
  - POST login/cookie dashboard/audit smoke production đã pass sau xác nhận ngày 2026-05-11
  - ADMIN_EXPORT_TOKEN đã rotate production sau smoke, token value không in ra chat/log
  - Bearer token vẫn hoạt động cho automation
- Route authorization/audit request handling đã tách vào core/admin/route-auth.js.
- Dashboard/user detail/audit page handlers đã tách vào core/admin/read-routes.js.
- Legacy export/state handlers đã tách vào core/admin/legacy-routes.js.
- RBAC:
  - viewer: dashboard + user detail read
  - support: viewer + legacy state read
  - maintainer: support + export + audit read
  - owner: full admin gates hiện tại
- /admin/audit read-only.
- /admin/audit xử lý thiếu schema gracefully, không 500.
- /admin/audit có bounded read-only pagination đã deploy.
- Read-only JSON API foundation đã deploy:
  - /admin/api/dashboard
  - /admin/api/dashboard/users/:senderId
  - /admin/api/audit
  - dùng presenter mask phone/address/snippets trước khi trả JSON
- Ops insights đã deploy:
  - rolling 24h metrics
  - needs-attention orders/handoffs
  - order status breakdown
  - top products 30d
  - render trong dashboard HTML và trả qua /admin/api/dashboard
- Audit writer PostgreSQL opt-in:
  - mặc định tắt nếu ADMIN_AUDIT_LOG_ENABLED không phải true
  - không tạo DB connection khi disabled
  - production hiện đã bật ADMIN_AUDIT_LOG_ENABLED=true
- Audit metadata redaction:
  - token, DB URL, phone, address, email, service account-like fields
- Audit actor/auth semantics:
  - audit entry mới có safe metadata.auth_method khi principal đã auth
  - static_bearer = Bearer automation
  - admin_session = browser session cookie
  - static_admin_token = legacy export/state compatibility
- Audit schema proposal additive/idempotent:
  db/admin-auth-rbac-audit-proposal.sql
- Production audit schema đã apply.
- Admin read routes production đang ghi audit log.
- Phase 3.5 identity provisioning design:
  docs/admin-identity-provisioning.md
- Phase 4 internal notes v1 backend/API/UI đã complete:
  - design doc: docs/phase-4-internal-notes-design.md
  - SQL proposal: db/internal-notes-proposal.sql
  - safe SQL verifier: npm run verify:internal-notes-sql
  - local create service: core/admin/internal-notes.js
  - local read/list model: core/admin/internal-notes.js
  - GET /admin/api/internal-notes read API đã implement/deploy
  - POST /admin/api/internal-notes create API đã implement/deploy
  - production internal_notes schema đã apply
  - authenticated production POST note-create smoke đã pass và tạo đúng 1
    production smoke note
  - authenticated production GET read smoke sau create đã pass với
    schemaReady=true, notes.length=1, pagination present, và auditDelta=+1
    success
  - User Detail UI/list/form đã implement/deploy; authenticated production UI
    smoke đã pass với HTTP 200, smoke note visible, form visibility đúng theo
    Bearer/admin role, internal_notes count 1 -> 1, admin_audit_log 61 -> 62,
    auditDelta=+1 success
  - internal_notes production count hiện = 1
  - admin_audit_log latest known total = 62, success 40, denied 22, error 0
  - smoke note vẫn tồn tại và chưa bị hidden/deleted
  - tests: tests/admin-internal-notes.test.js cover validation, RBAC,
    transaction/audit fail-closed behavior, static SQL checks, verifier
    guardrails, and read model behavior
  - static SQL proposal checks tồn tại
  - live local PostgreSQL SQL verification đã pass bằng
    npm run verify:internal-notes-sql với CHATBOT_TEST_DATABASE_URL trong
    isolated schema; proposal apply 2 lần, table/columns/indexes/constraints
    verified, schema dropped, 0 internal_notes_verify_% schemas còn lại
  - chưa có edit/delete/hide/order-notes UI
- Multi-shop MVP staging status:
  - branch feature/multi-shop-dashboard
  - latest commit e98ad73 Fail product writes on aborted transactions
  - MULTI_SHOP_DB_CONFIG_ENABLED=true trên staging
  - db/multi-shop-proposal.sql applied staging
  - db/admin-auth-rbac-audit-proposal.sql applied staging
  - adult-shop seeded staging
  - runtime DB config, admin shops read-only, product CRUD passed staging
  - product CRUD smoke: create ZB-SMOKE-001, visible, update, disable, enable,
    archive
  - audit rows working; audit delta +5
  - original 13 non-smoke products unchanged
  - no duplicate active smoke code
  - staging initially lacked admin_audit_log, causing audit insert failure,
    aborted transaction, COMMIT reporting ROLLBACK, and fake 201; fixed by
    applying audit schema and guarding COMMIT command with product_commit_failed
  - production not deployed, env not changed, DB not written, smoke not run
- Multi-shop runtime safety foundation after staging MVP:
  - `RUNTIME_ALLOWED_SHOP_IDS` and `RUNTIME_ALLOWED_PAGE_IDS` exist as runtime
    admission controls for DB-backed rollout
  - `RUNTIME_ALLOWED_PAGE_IDS` is post-resolution only; it does not make unknown
    pages fallback to file config
  - fail-closed/fallback webhook logs use `page_ref=p:<hash>`, not raw
    `page_id`
  - startup validation warns if allowed shop IDs are absent/inactive in DB but
    does not crash production startup
  - per-page credential resolution phase 1 local-only:
    - additive/idempotent `shop_page_credentials` proposal in
      `db/multi-shop-proposal.sql`
    - `core/credentials/page-credentials.js` encrypts/decrypts with
      `CREDENTIAL_MASTER_KEY`
    - DB-backed runtime resolves `fb_page_token` for the resolved shop/page and
      uses that token for Messenger sends
    - missing/decrypt-failed credential fail-closed and does not fallback to
      `FB_PAGE_TOKEN`
    - file-backed legacy runtime still uses `FB_PAGE_TOKEN`
  - latest local verification for this safety foundation: `npm test` 476
    passed, 0 failed; `git diff --check` passed
  - production deploy/env/DB/data remain untouched unless a future session gets
    separate approval

File quan trọng:
- core/admin-auth.js
- core/admin-routes.js
- core/admin/audit.js
- core/admin/dashboard-repository.js
- core/admin/legacy-routes.js
- core/admin/reader.js
- core/admin/read-routes.js
- core/admin/route-auth.js
- core/admin/session.js
- core/admin/internal-notes.js
- core/admin/views.js
- core/credentials/page-credentials.js
- core/utils/log-refs.js
- core/webhook.js
- core/messenger-client.js
- core/shops/db-shop-config.js
- index.js
- db/admin-auth-rbac-audit-proposal.sql
- db/internal-notes-proposal.sql
- db/multi-shop-proposal.sql
- docs/admin-auth-rbac-audit-runbook.md
- docs/admin-identity-provisioning.md
- docs/multi-shop-dashboard-design.md
- docs/multi-shop-rollout.md
- docs/phase-4-internal-notes-design.md
- docs/saas-roadmap.md
- docs/next-session-prompt.md
- DESIGN.md
- .env.example
- tests/admin-auth.test.js
- tests/admin-internal-notes.test.js
- tests/admin-routes.test.js
- tests/index.js

Việc bắt buộc làm đầu phiên mới:
1. Chạy trạng thái local/remote:
   - git status --short --untracked-files=all
   - git rev-list --left-right --count origin/main...HEAD
   - git log --oneline -5
2. Kiểm tra production deployment:
   - railway deployment list --environment production --service chatbot-fanpage --limit 1 --json
3. GET production /healthz:
   - Không cần token.
   - Chỉ báo metadata an toàn: ok, storage.adapter, storage.ready, messenger.dryRun.
4. Đọc lại:
   - docs/next-session-prompt.md
   - docs/saas-roadmap.md
   - docs/phase-4-internal-notes-design.md
   - docs/admin-auth-rbac-audit-runbook.md
   - docs/admin-identity-provisioning.md
   - docs/multi-shop-dashboard-design.md
   - docs/multi-shop-rollout.md
   - db/multi-shop-proposal.sql
   - db/internal-notes-proposal.sql
   - core/webhook.js
   - index.js
   - core/admin/internal-notes.js
   - tests/admin-internal-notes.test.js
   - DESIGN.md
5. Chạy local:
   - npm test
   - npm audit --omit=dev

Hướng tốt nhất cho phiên tới:
Phase 2 production audit rollout đã hoàn tất. Phase 3 admin login/session
production smoke đã pass và ADMIN_EXPORT_TOKEN đã rotate. Phase 4 internal
notes v1 backend/API/UI đã complete và production-smoked theo các giới hạn an
toàn ở trên. Multi-shop staging MVP đã pass, và runtime admission guard đã được
thêm để giảm blast radius. Per-page credential resolution phase 1 đã hoàn tất
local-only. Trọng tâm tiếp theo là atomic message idempotency trước khi rollout
production rộng hơn.

Next recommended task:
- Làm atomic message idempotency:
  - thay `seenMid()` + async `markMid()` bằng `tryMarkMid()`
  - PostgreSQL dùng `INSERT ... ON CONFLICT DO NOTHING RETURNING`
  - file adapter giữ behavior hiện tại sau cùng interface
- Sau đó làm feature flag facade:
  - tạo `getFeatureFlag(shopConfig/shopId, key)`
  - runtime đọc facade, không đọc trực tiếp `settings_json.ruleToggles.X` rải rác
  - chưa migrate schema nếu chưa cần
- Chỉ làm durable webhook queue sau credential isolation và idempotency:
  - states: queued, processing, done, failed
  - retry bounded
  - PostgreSQL `FOR UPDATE SKIP LOCKED`; Redis chưa cần cho mục tiêu 5-20 shop
- Sau queue mới làm per-shop health/credential status:
  - last webhook, last successful send, send error rate, active handoffs,
    credential status
  - không expose raw token, raw page_id, customer rows, messages, orders
- Production multi-shop rollout vẫn phải theo docs/multi-shop-rollout.md và cần
  approval riêng cho từng gate: backup, schema apply, credential seed,
  `CREDENTIAL_MASTER_KEY` env, deploy, env enable, authenticated smoke, product
  CRUD smoke.
- Any further production internal-notes smoke or write still needs separate
  approval because GET writes audit rows and POST writes business data.
- Tiếp tục chỉ dùng explicit non-production URL như CHATBOT_TEST_DATABASE_URL
  hoặc CHATBOT_STAGING_DATABASE_URL cho schema verification; không dùng
  DATABASE_URL vì có thể là production.

Việc nên làm đầu phiên tới:
1. Re-check git/deployment/healthz.
2. Verify production env metadata an toàn:
   - STORAGE_ADAPTER=postgres
   - ALLOW_PRODUCTION_DB_WRITES=true
   - ADMIN_AUDIT_LOG_ENABLED=true
   - SESSION_SECRET_set=true
   - ADMIN_PUBLIC_BASE_URL_set=true
   - ADMIN_SESSION_COOKIE_NAME_set=true
3. GET /admin/login không token:
   - phải trả 200 Admin Login HTML
4. Chỉ smoke thêm bằng Bearer/cookie sau xác nhận riêng vì sẽ ghi audit production:
   - /admin/dashboard
   - /admin/audit
   - /admin/api/internal-notes
5. Chỉ smoke note-create production sau xác nhận riêng rõ ràng vì sẽ ghi business data.
6. Verify count-only nếu có đường kết nối không in secrets:
   - admin_users
   - admin_roles
   - admin_user_roles
   - admin_audit_log
7. Chạy npm test và npm audit --omit=dev nếu có code/script thay đổi. Baseline
   coverage mới nhất đã biết: `npm test` 479 passed, 0 failed sau per-page
   credential phase 1; tests cover validation, RBAC, transaction/audit
   fail-closed behavior, static SQL checks, verifier guardrails, read model
   behavior, webhook log redaction, multi-shop admission, credential
   encryption/decryption, DB-backed credential token selection, missing
   credential fail-closed, legacy `FB_PAGE_TOKEN`, and no raw token/page_id
   logging.

Phase 3 browser cookie smoke:
- Đã hoàn tất ngày 2026-05-11 sau backup và xác nhận riêng.
- Không cần lặp lại ngay trừ khi có code/env/deploy thay đổi liên quan auth/session.
- Nếu lặp lại, nhớ tạo backup PostgreSQL mới trước vì smoke sẽ ghi audit production.

Code-only hướng khác:
- Tiếp tục hardening read-only:
  - pagination read-only cho user detail timelines nếu fixed limits bắt đầu thiếu
  - tách HTML view helpers nhỏ hơn nếu cần test sâu hơn
- Multi-shop safety foundation:
  - per-page credential resolution phase 1 đã hoàn tất local-only
  - atomic `tryMarkMid()` là bước tiếp theo
  - feature flag facade đứng sau idempotency
  - durable queue đứng sau token isolation và idempotency, không làm trước
  - per-shop health/credential status đứng sau queue/credential validation
- Phase 4 internal notes:
  - v1 backend/API/UI đã complete
  - internal notes design/create service/read-list model/test baseline đã có
  - live local SQL verification bằng non-production PostgreSQL isolated schema
    đã pass, gồm idempotency/constraints/index checks và cleanup schema
  - production schema đã apply
  - production POST note-create smoke đã pass và tạo đúng 1 smoke note
  - production GET read smoke sau create đã pass với notes.length=1
  - User Detail UI smoke đã pass; UI/list/form đã tồn tại trên user detail
  - chưa có edit/delete/hide/order-notes UI
  - chưa thêm production admin user nếu chưa có implementation path và xác nhận DB write riêng

Không làm vội:
- Không thêm edit/delete/hide/order-notes UI cho internal notes trước khi có plan/test/approval rõ.
- Không re-apply hoặc mutate internal_notes schema production nếu chưa có fresh backup và xác nhận riêng.
- Không dùng DATABASE_URL cho verification vì có thể là production.
- Không chạy authenticated admin smoke nếu chưa xác nhận riêng vì sẽ ghi audit rows.
- Không tạo production internal note nếu chưa xác nhận rõ vì sẽ ghi business data.
- Không coi browser session hiện tại là per-human identity; nó vẫn là static-token bridge cho tới khi admin_users login thật được implement.
- Không thêm admin user production nếu chưa review identity provisioning và rollback.
- Không làm durable webhook queue trước per-page credentials và atomic idempotency.
- Không apply/seed `shop_page_credentials` production hoặc set
  `CREDENTIAL_MASTER_KEY` production nếu chưa có backup/approval riêng.
- Không coi `RUNTIME_ALLOWED_PAGE_IDS` là whitelist cho page chưa có DB mapping; nó chỉ là post-resolution override.
- Không deploy/push/đổi env/ghi production DB nếu chưa có xác nhận riêng trong phiên mới.

Cuối mỗi lượt phải báo rõ:
- Có backup mới không, nằm ở đâu, SHA256/counts.
- Có push không.
- Có deploy không.
- Có đổi env production không.
- Có ghi production DB không.
- Có ghi production /data không.
- Đã thay đổi gì.
- Tests/audit kết quả.
- Production healthz.
- Admin smoke nếu có deploy.
- Git state.
- Rủi ro còn lại.
- Bước tiếp theo cần tôi xác nhận gì.
```
