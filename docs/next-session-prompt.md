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
- Admin dashboard hiện vẫn read-only. Không thêm write workflow cho tới khi audit production ổn định.

Quy tắc an toàn bắt buộc:
- Ưu tiên an toàn dữ liệu tuyệt đối.
- Không mất dữ liệu production.
- Không deploy nếu tôi chưa xác nhận riêng trong phiên này.
- Không push nếu tôi chưa xác nhận riêng trong phiên này.
- Không đổi production env nếu tôi chưa xác nhận riêng.
- Không ghi production PostgreSQL nếu chưa có backup mới và xác nhận riêng.
- Không xóa/sửa/truncate/drop/reset production DB.
- Không switch production về file storage.
- Không đụng production /data trừ khi chỉ đọc để kiểm tra.
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
  - SESSION_SECRET set=true theo metadata safe check ngày 2026-05-11, không in value
  - ADMIN_PUBLIC_BASE_URL set=true theo metadata safe check ngày 2026-05-11, không in value
  - ADMIN_SESSION_COOKIE_NAME set=true theo metadata safe check ngày 2026-05-11, không in value
  - TENANT_ID=default
  - PAGE_ID=1026325343908119

Trạng thái production mới nhất đã biết:
- Latest verified code deployment:
  affaf4b Add admin ops insights API
- Latest verified code Railway deployment:
  416e4908-9c70-41f3-8988-b9fafb1f03ba SUCCESS ở commit affaf4b
- Previous Railway deployment:
  f55f2c43-fb2b-4bb0-9a3a-3f62def7ad21 SUCCESS ở commit 46ca2d3 Update handoff docs after session deploy
- Previous code deployment:
  8baa178 Add admin session login flow
- Latest verified docs/audit handoff commit:
  c333388 Update handoff docs after audit rollout
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
- Admin smoke gần nhất bằng Bearer header:
  /admin/dashboard: 200, title=Admin Dashboard
  /admin/audit: 200, title=Admin Audit Log, schema_message=false
- /admin/login gần nhất:
  200 Admin Login HTML, has_form=true bằng unauthenticated GET sau khi session env đã set.
  Chưa smoke POST login/cookie dashboard vì các route đó sẽ ghi audit vào production DB và cần xác nhận riêng.
- Audit production đã bật và smoke gần nhất ghi 2 audit rows thành công:
  admin_audit_log=2, outcomes success=2.

Git state mới nhất đã biết:
- Latest code commit đã push/deploy:
  affaf4b Add admin ops insights API
- Latest docs commit đã push/deploy:
  46ca2d3 Update handoff docs after session deploy
- Previous code commit đã push/deploy:
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
  affaf4b Add admin ops insights API
  46ca2d3 Update handoff docs after session deploy
  8baa178 Add admin session login flow
  c333388 Update handoff docs after audit rollout
  6d21707 Update handoff docs after legacy handler deploy

Backup production mới nhất đã biết:
- Path:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260511-101331
- SHA256:
  CEC1076AE2CC131DB136FE81A9EBBE31D9D46D535CEF9779FB59E0F7A2CBF54D
- Counts:
  profiles 1, conversations 4, messages 37, orders 6, order_items 7, events 223, processed_mids 85
- Backup này đã dùng cho production audit schema apply ngày 2026-05-11. Nếu chuẩn bị production DB write mới trong phiên sau, tạo backup PostgreSQL production mới ngoài repo, read-only SELECT, verify SHA256/counts.

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

Tính năng admin hiện có:
- Dashboard read-only với filters.
- Bounded user detail view.
- Mask phone/address/snippets trong admin UI.
- Read-only SQL guard cho dashboard reader.
- Admin auth hardening:
  - Dashboard read routes nhận Authorization: Bearer <ADMIN_EXPORT_TOKEN> hoặc admin session cookie sau login.
  - Không nhận token qua query param.
  - Legacy export/debug route còn x-admin-token compatibility.
- Admin browser login/session code-only:
  - /admin/login và /admin/logout đã deploy trong code production
  - production session env hiện đã set theo metadata safe check, nhưng chưa smoke POST login/cookie dashboard
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
- Read-only JSON API foundation local chưa deploy:
  - /admin/api/dashboard
  - /admin/api/dashboard/users/:senderId
  - /admin/api/audit
  - dùng presenter mask phone/address/snippets trước khi trả JSON
- Ops insights local chưa deploy:
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
- Audit schema proposal additive/idempotent:
  db/admin-auth-rbac-audit-proposal.sql
- Production audit schema đã apply.
- Admin read routes production đang ghi audit log.

File quan trọng:
- core/admin-auth.js
- core/admin-routes.js
- core/admin/audit.js
- core/admin/legacy-routes.js
- core/admin/reader.js
- core/admin/read-routes.js
- core/admin/route-auth.js
- core/admin/session.js
- core/admin/views.js
- db/admin-auth-rbac-audit-proposal.sql
- docs/admin-auth-rbac-audit-runbook.md
- docs/saas-roadmap.md
- docs/next-session-prompt.md
- DESIGN.md
- .env.example
- tests/admin-auth.test.js
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
   - docs/saas-roadmap.md
   - docs/admin-auth-rbac-audit-runbook.md
   - DESIGN.md
5. Chạy local:
   - npm test
   - npm audit --omit=dev

Hướng tốt nhất cho phiên tới:
Phase 2 production audit rollout đã hoàn tất. Phase 3 admin login/session code đã deploy và production session env hiện đã set theo metadata safe check. Ưu tiên tiếp theo là smoke login bằng browser cookie sau xác nhận riêng vì POST login/dashboard/audit sẽ ghi audit rows production, rồi rotate ADMIN_EXPORT_TOKEN.

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
4. Chỉ smoke bằng Bearer/cookie sau xác nhận riêng vì sẽ ghi audit production:
   - /admin/dashboard
   - /admin/audit
5. Verify count-only nếu có đường kết nối không in secrets:
   - admin_users
   - admin_roles
   - admin_user_roles
   - admin_audit_log
6. Chạy npm test và npm audit --omit=dev.

Phase 3 browser cookie smoke nếu được xác nhận:
1. Re-check git/deployment/healthz.
2. GET /admin/login không token.
3. Smoke Bearer:
   - /admin/dashboard
   - /admin/audit
4. Nếu session env metadata bất ngờ thiếu thì dừng và xin xác nhận env riêng trước khi set lại:
   - SESSION_SECRET random 64+ chars
   - ADMIN_PUBLIC_BASE_URL=https://chatbot-fanpage-production.up.railway.app
   - ADMIN_SESSION_COOKIE_NAME=chatbot_admin_session nếu muốn rõ ràng
5. Smoke có ghi audit sau xác nhận:
   - login bằng ADMIN_EXPORT_TOKEN set cookie
   - /admin/dashboard mở được bằng cookie
   - /admin/audit mở được bằng cookie
   - verify admin_audit_log count-only tăng với login/dashboard/audit
6. Sau khi browser login ổn, rotate ADMIN_EXPORT_TOKEN vì token cũ đã từng bị lộ trong chat.

Code-only hướng khác nếu chưa deploy:
- Tiếp tục hardening read-only:
  - dashboard repository/service split có test
  - pagination read-only cho dashboard/audit

Không làm vội:
- Không thêm business write workflow cho tới khi audit production được quan sát ổn định.
- Không thêm admin user production nếu chưa review identity/session/token rotation.
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
