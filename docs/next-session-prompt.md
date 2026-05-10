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
  - TENANT_ID=default
  - PAGE_ID=1026325343908119

Trạng thái production mới nhất đã biết:
- Latest verified code deployment:
  da48d2a Extract admin legacy handlers
- Previous route handler code deployment:
  fd5a9a0 Extract admin route handlers
- Previous docs-only deployed commit:
  70ac695 Update handoff docs after route handler deploy
- Previous admin refactor code commit:
  20676a3 Refactor admin dashboard modules
- Latest code Railway deployment:
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
  /admin/audit: 200, title=Admin Audit Log, schema_message=true
- schema_message=true là kỳ vọng hiện tại vì audit schema production chưa apply.

Git state mới nhất đã biết:
- Code refactor commit đã push/deploy:
  da48d2a Extract admin legacy handlers
- Previous route handler commit đã push/deploy:
  fd5a9a0 Extract admin route handlers
- Previous docs-only handoff commit đã push/deploy:
  70ac695 Update handoff docs after route handler deploy
- Trước docs-only handoff update cuối phiên:
  worktree clean, origin/main...HEAD = 0 0.
- Latest commits:
  da48d2a Extract admin legacy handlers
  70ac695 Update handoff docs after route handler deploy
  fd5a9a0 Extract admin route handlers
  5ec0902 Expand next session handoff prompt
  5851368 Update handoff docs after admin refactor deploy

Backup production mới nhất đã biết:
- Path:
  C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260510-154120
- SHA256:
  0F8772912394868B41BC246B196F6C2183D1CC361302293703A2C3A0C7E497C4
- Counts:
  profiles 1, conversations 4, messages 37, orders 6, order_items 7, events 223, processed_mids 85
- Backup này không được coi là đủ nếu chuẩn bị ghi production DB/env trong phiên mới. Trước mọi production DB write/env rollout phải tạo backup PostgreSQL production mới ngoài repo, read-only SELECT, verify SHA256/counts.

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

Tính năng admin hiện có:
- Dashboard read-only với filters.
- Bounded user detail view.
- Mask phone/address/snippets trong admin UI.
- Read-only SQL guard cho dashboard reader.
- Admin auth hardening:
  - Dashboard chỉ nhận Authorization: Bearer <ADMIN_EXPORT_TOKEN>.
  - Không nhận token qua query param.
  - Legacy export/debug route còn x-admin-token compatibility.
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
- Audit writer PostgreSQL opt-in:
  - mặc định tắt nếu ADMIN_AUDIT_LOG_ENABLED không phải true
  - không tạo DB connection khi disabled
- Audit metadata redaction:
  - token, DB URL, phone, address, email, service account-like fields
- Audit schema proposal additive/idempotent:
  db/admin-auth-rbac-audit-proposal.sql
- Production audit schema chưa apply.
- ADMIN_AUDIT_LOG_ENABLED chưa bật.

File quan trọng:
- core/admin-auth.js
- core/admin-routes.js
- core/admin/audit.js
- core/admin/legacy-routes.js
- core/admin/reader.js
- core/admin/read-routes.js
- core/admin/route-auth.js
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
Ưu tiên Phase 2: production audit rollout, nhưng chỉ khi tôi xác nhận muốn làm production DB/env work.

Nếu muốn bật audit production thật:
1. Re-check git/deployment/healthz.
2. Tạo backup PostgreSQL production mới ngoài repo bằng read-only SELECT.
3. Verify backup:
   - folder path
   - SHA256
   - count-only: profiles, conversations, messages, orders, order_items, events, processed_mids
   - Không in raw customer data.
4. Review SQL:
   - db/admin-auth-rbac-audit-proposal.sql
   - Xác nhận additive/idempotent:
     CREATE TABLE IF NOT EXISTS
     CREATE INDEX IF NOT EXISTS
     INSERT ... ON CONFLICT DO NOTHING
     Không DROP/TRUNCATE/DELETE/destructive ALTER.
5. Apply SQL vào non-production/staging trước nếu môi trường dùng được.
6. Chạy npm test và npm audit --omit=dev.
7. Chỉ sau xác nhận riêng:
   - apply schema production.
8. Verify production bằng count-only:
   - admin_users
   - admin_roles
   - admin_user_roles
   - admin_audit_log
9. Chỉ sau xác nhận riêng tiếp theo:
   - set ADMIN_AUDIT_LOG_ENABLED=true
10. Smoke:
   - /healthz
   - /admin/dashboard bằng Bearer header
   - /admin/audit bằng Bearer header
11. Không thêm admin user production cho tới khi identity provisioning/session/token rotation được review riêng.

Nếu chưa muốn ghi production DB:
- Tiếp tục nhánh code-only an toàn:
  - Tạo admin dashboard repository/API read-only có test.
  - Hoặc thêm pagination read-only cho dashboard.
- Không thêm write workflow cho tới khi audit production ổn định.
- Không deploy/push nếu chưa có xác nhận riêng.

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
