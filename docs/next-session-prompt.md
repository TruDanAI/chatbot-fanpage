# Next Session Prompt

Paste this prompt into the next Codex session before continuing work.

```text
Tiếp tục repo chatbot-fanpage.

Ngữ cảnh máy:
- Repo path: c:\Users\Pc\Desktop\New folder\chatbot-fanpage
- Branch: main
- Timezone người dùng: Asia/Bangkok
- Production Railway project: graceful-harmony
- Production service: chatbot-fanpage
- Production Postgres service: Postgres-TQuc

Quy tắc an toàn bắt buộc:
- Ưu tiên an toàn dữ liệu tuyệt đối.
- Không mất dữ liệu production.
- Không deploy nếu tôi chưa xác nhận riêng trong phiên này.
- Không push nếu tôi chưa xác nhận riêng trong phiên này.
- Không đổi production env nếu tôi chưa xác nhận riêng.
- Không xóa/sửa/truncate production DB.
- Không ghi production PostgreSQL nếu chưa có backup mới và xác nhận riêng.
- Không switch production về file storage.
- Không đụng production /data trừ khi chỉ đọc để kiểm tra.
- Không in dữ liệu khách, token, DATABASE_URL, Facebook token, Google service account, Telegram token ra chat.
- Nếu tính năng mới cần env setup, phải thêm key tương ứng vào .env.example với comment rõ local/production, optional/bắt buộc, và rủi ro nếu bật.

Trạng thái đã biết từ phiên trước, cần kiểm tra lại chứ không được giả định:
- Production đang dùng PostgreSQL:
  - STORAGE_ADAPTER=postgres
  - DATABASE_URL=${{Postgres-TQuc.DATABASE_URL}}
  - ALLOW_PRODUCTION_DB_WRITES=true
  - TENANT_ID=default
  - PAGE_ID=1026325343908119
- Latest deployed commit khi đó:
  - c9ff1df Handle missing audit schema gracefully
- Latest Railway production deployment khi đó:
  - fa6d0939-4fb4-437c-b159-7b21fa323712 SUCCESS
- Commits đã push sau dashboard filters:
  - e14692c Add admin RBAC audit scaffolding
  - a28c0e5 Add SaaS roadmap and handoff prompt
  - c9ff1df Handle missing audit schema gracefully
- Git sau push khi đó:
  - clean
  - origin/main...HEAD = 0 0
- Backup PostgreSQL production mới nhất đã biết:
  - C:\Users\Pc\Desktop\chatbot-fanpage-backups\20260510-154120
  - SHA256: 0F8772912394868B41BC246B196F6C2183D1CC361302293703A2C3A0C7E497C4
  - counts: profiles 1, conversations 4, messages 37, orders 6, order_items 7, events 223, processed_mids 85
- Tests gần nhất:
  - npm test: 268 passed
  - npm audit --omit=dev: 0 vulnerabilities
- Production smoke gần nhất:
  - /healthz: ok=true, storage.adapter=postgres, storage.ready=true, messenger.dryRun=false
  - /admin/dashboard with Bearer header: 200
  - /admin/audit with Bearer header: 200, shows schema-not-ready message until audit schema is applied

Các file quan trọng đã thêm/cập nhật:
- core/admin-auth.js
- core/admin-routes.js
- db/admin-auth-rbac-audit-proposal.sql
- docs/admin-auth-rbac-audit-runbook.md
- docs/saas-roadmap.md
- docs/next-session-prompt.md
- DESIGN.md
- .env.example
- tests/admin-auth.test.js
- tests/admin-routes.test.js
- tests/index.js

Tính năng đã làm ở phase trước:
- RBAC cho admin routes:
  - viewer: dashboard + user detail read
  - support: viewer + legacy state read
  - maintainer: support + export + audit read
  - owner: full admin gates hiện tại
- Route /admin/audit read-only.
- /admin/audit now handles missing audit schema gracefully instead of returning 500.
- Audit writer PostgreSQL opt-in, mặc định tắt nếu ADMIN_AUDIT_LOG_ENABLED không phải true.
- Audit metadata redaction cho token, DB URL, phone, address, email, service account-like fields.
- Dashboard vẫn yêu cầu Authorization: Bearer <ADMIN_EXPORT_TOKEN>.
- Legacy export/debug vẫn giữ x-admin-token compatibility.
- Schema proposal additive/idempotent, chưa được apply production.

Việc cần làm đầu phiên:
1. Kiểm tra trạng thái:
   - git status --short --untracked-files=all
   - git rev-list --left-right --count origin/main...HEAD
   - git log --oneline -5
   - railway deployment list --environment production --service chatbot-fanpage --limit 1 --json
   - GET production /healthz
2. Không tạo backup mới trừ khi chuẩn bị production DB/env/deploy work. Nếu có production write/env/deploy phase, phải tạo backup PostgreSQL mới trước.
3. Đọc:
   - docs/saas-roadmap.md
   - docs/admin-auth-rbac-audit-runbook.md
   - DESIGN.md
4. Chạy local:
   - npm test
   - npm audit --omit=dev

Hướng phát triển đề xuất tiếp theo:
- Nếu muốn bật audit production thật:
  1. Tạo backup PostgreSQL production mới ngoài repo bằng SELECT/read-only.
  2. Verify SHA256/counts.
  3. Apply db/admin-auth-rbac-audit-proposal.sql vào non-production trước nếu có môi trường.
  4. Code đã deploy ở commit c9ff1df, nhưng vẫn verify deployment trước khi làm tiếp.
  5. Sau xác nhận riêng, apply schema production.
  6. Verify count-only admin tables.
  7. Sau xác nhận riêng, set ADMIN_AUDIT_LOG_ENABLED=true.
  8. Test /admin/dashboard và /admin/audit bằng Bearer header.
- Nếu muốn phát triển SaaS:
  - Bắt đầu bằng tách core/admin-routes.js thành các module nhỏ: admin reader, audit logger, views, route auth.
  - Không thêm write workflow cho đến khi audit production ổn định.

Cuối lượt luôn báo:
- Có backup mới không, nằm ở đâu, SHA256/counts.
- Có deploy không.
- Có push không.
- Có đổi env production không.
- Có ghi production DB không.
- Có ghi production /data không.
- Đã thay đổi gì.
- Tests/audit kết quả.
- Production healthz.
- Git state.
- Rủi ro còn lại.
- Bước tiếp theo cần tôi xác nhận gì.
```
