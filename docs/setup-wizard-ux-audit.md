# UX Audit & Localization Reference: Setup Wizard & Shop Control Panel (P1.2a)

This document provides a detailed UX audit, a comprehensive Vietnamese localization glossary, structural layout proposals, and safe operation workflows for the Admin Setup Wizard and Shop Detail views. It serves as the canonical UX blueprint for the P1.2 rollout.

---

## 1. UX Diagnosis & Jargon Refinement

Our audit of the completed P1.1 Wizard MVP identified several high-friction areas where non-technical operators could feel overwhelmed by developer terms or commit configuration mistakes.

### 📋 Full Screen-by-Screen Diagnosis

#### Step 0: Pre-flight Check (Kiểm tra môi trường)
* **Diagnosis**: The page highlights server status, system environment keys (`MESSENGER_DRY_RUN`, `MULTI_SHOP_DB_CONFIG_ENABLED`), and informational states (Cloudinary status, decrypt master keys).
* **Friction Points**: Terms like "Pre-flight", "Hard Checks", "Cloudinary", and "Master Key" make the interface feel like a debugging console.
* **Simplification Plan**: Translate headers to friendly Vietnamese terminology. Present flags as simple status badges (e.g. `ĐẠT` or `CẢNH BÁO`) with plain explanations.

#### Step 1: Shop Shell (Tạo Khung Cửa Hàng)
* **Diagnosis**: The operator is asked to input a "Shop Slug" with a strict regex warning `^[a-z0-9]+(?:-[a-z0-9]+)*$` and a block on the reserved slug `adult-shop`.
* **Friction Points**: "Slug" is a web development term. Standard regex validation messages can be confusing.
* **Simplification Plan**: Rename the label to **Đường dẫn rút gọn (Shop Slug)**. Explain that this represents the name in the web address (e.g., `nem-bui-xa`). Provide real-time lowercase validation hints.

#### Step 2: Products & Menu (Cấu hình Sản phẩm & Menu)
* **Diagnosis**: Standard tables displaying code, name, and status. It requires entering a product code with a strict alphanumeric pattern.
* **Friction Points**: Adding products individually is slow. Standard warning boxes look intimidating.
* **Simplification Plan**: Transition to a modular visual card grid for products. Provide a prominent **Import CSV** tab with instructions. Show a clear thumbnail preview area for images.

#### Step 3: FB Page Mapping (Kết nối Trang Facebook)
* **Diagnosis**: Requires inputting a numerical "Page ID". Asks the user to manually type the exact string `CREATE PAGE MAPPING` in uppercase to submit the link.
* **Friction Points**: Operators are prone to copying full Page URLs instead of the numerical ID. Typing uppercase phrases is tedious and error-prone.
* **Simplification Plan**: Clarify that Page ID is a long numerical string found under Page Info. Replace manual typing with a simple, friendly confirmation checkbox.

#### Step 4: Page Credentials (Xác thực Fanpage)
* **Diagnosis**: Collects Page Access Tokens. Demands typing `CREATE PAGE CREDENTIAL` to confirm.
* **Friction Points**: Token fields are long, intimidating, and lack context. Operators fear security leaks.
* **Simplification Plan**: Emphasize that tokens are encrypted in the database using high-security military-grade standards (AES-256-GCM). Replace the uppercase verification typing field with a simple modal checkmark confirmation.

#### Step 5: Readiness Gate (Kiểm tra sẵn sàng)
* **Diagnosis**: Evaluates a checklist of statuses (`bot_mode_ready`, `product_ready`, `multiple_menu_images`).
* **Friction Points**: Displaying check keys like `bot_mode_ready` feels technical.
* **Simplification Plan**: Translate checking keys to plain Vietnamese (e.g., "Tin nhắn giới thiệu", "Danh sách sản phẩm"). Provide direct navigation links labeled "Đi đến sửa mục này →" instead of "Đi đến Bước liên quan".

#### Step 6: Chạy thử giả lập (Dry-Run Smoke Test)
* **Diagnosis**: Asks operators to trigger simulations of customer messages. Mentions "Messenger Dry-Run (Global)" and "Local dry_run".
* **Friction Points**: Non-technical operators do not know what "dry-run" means.
* **Simplification Plan**: Clarify that **"Chạy thử nghiệm (Dry-Run)"** is a safe sandbox where the bot replies offline and **never** sends real messages to customers. Provide a simulated chat box to preview bot replies.

---

## 2. Vietnamese Translation Glossary

We establish a canonical glossary of terms to ensure language consistency across all administrative modules.

### Terminology Glossary

| English Technical Term | Simplified Vietnamese Translation | Context & Explanation |
| :--- | :--- | :--- |
| **Pre-flight Check** | Kiểm tra điều kiện hệ thống | Verifies server readiness. |
| **Hard Checks** | Yêu cầu bắt buộc | Conditions blocking wizard progress. |
| **Informational Checks** | Thông tin bổ sung | Informative environment statistics. |
| **Shop Shell** | Khâu khởi tạo cửa hàng | The blank record before setup. |
| **Slug (Shop Slug)** | Đường dẫn rút gọn (Shop Slug) | URL handle (e.g. `cua-hang-nem`). |
| **Locale / Timezone** | Ngôn ngữ mặc định / Múi giờ | Base regional formats. |
| **bot_mode** | Chế độ phản hồi của Bot | Configures bot interactive behavior. |
| **menu_intro_text** | Lời chào mừng kèm thực đơn (Menu) | Welcome message triggered by customers. |
| **handoff_message** | Tin nhắn bàn giao nhân viên | Text sent before routing to staff. |
| **fallback_text** | Tin nhắn mặc định khi bot chưa hiểu | Bot reply when rules fail to trigger. |
| **Page Mapping** | Liên kết trang Facebook | Mapping a Page ID to a shop. |
| **Page ID** | Mã số định danh Trang (Page ID) | Numerical Page ID from FB. |
| **Page Credential** | Mã bảo mật Fanpage (AccessToken) | Access token for webhook sending. |
| **AES-256-GCM Encryption**| Mã hóa an toàn cấp độ cao | Informs operators about token safety. |
| **Readiness Gate** | Kiểm tra sẵn sàng vận hành | Auto-check before test flight. |
| **Hard Blocker** | Lỗi bắt buộc phải khắc phục | Mandatory issues that must be fixed. |
| **Warning** | Lưu ý bổ sung (Không chặn) | Optional improvements. |
| **Dry-Run Smoke Test** | Chạy thử nghiệm giả lập an toàn | Offline sandbox message check. |
| **Simulation Dashboard** | Bảng điều khiển giả lập | Page where operators run offline tests. |
| **Go-Live / Live** | Chạy thật / Kích hoạt hoạt động | Connects the bot to active customers. |

---

## 3. UI Structure & Responsive Layout Proposal

To elevate the UI to a premium level, the interface should adopt modern design principles using existing HSL tokens.

### A. Setup Wizard Layout (Two-Column Pattern)
On screen widths of `768px` and above, the wizard transforms into a beautiful split-screen panel:
1. **Left Panel (30% width)**:
   * Displays the current staging mode status in a stylized blue pill.
   * Renders a friendly list of completed steps with green icons.
   * Explains SSL & AES-256 data protection standard.
2. **Right Panel (70% width)**:
   * Renders the active step card with clean card shadows and white backgrounds.
   * Bottom navigation buttons (`Quay lại` / `Tiếp tục`) are styled as dense pills with micro-animations on hover.

### B. Shop Detail Layout
Reworked into a comprehensive **Master-Detail Sidebar Grid**:
1. **Sticky Left Sidebar**:
   * Displays Shop branding, Status badge (`Hoạt động` / `Tạm dừng`), and operational package (`Basic`).
   * Quick health overview metric tiles.
   * **Safety Action Area**: Contains the instant **Pause Bot** toggle switch.
2. **Main Right Workspace**:
   * Divided into styled navigation tabs (Overview, Pages, Settings, Products, Images).
   * Forms use consistent layouts, displaying quick-help tooltips for every field.

---

## 4. Safe Operation Workflows & Soft-Delete Policy

### Rationale: Safety Gates and Blocking Hard-Deletions
To prevent catastrophic accidental loss of store history, orders, conversation logs, and credentials, **hard deletion of database records is completely blocked**.
* **Soft-Archive**: Operators can safely move shops to an `archived` lifecycle state. This disables all background processes, halts webhook processing, and rotates page mappings to inactive, while preserving all configurations in the database for potential recovery.
* **Emergency Pause**: Provides a prominent toggle button to instantly change the status to `paused` and force `dry_run = true`, creating a safe sandbox cutoff.

---

## 5. P1.2 Implementation Roadmap

The UI/UX upgrades will be rolled out in five manageable, staging-verified slices:

1. **P1.2a: UX Audit & Terms Glossary (Current Checkpoint)**: Complete terms localization mapping, CSS structure specs, and plan approval.
2. **P1.2b: Stepper & Wizard Visual Polish**: Revamp `wizard-ui.js` and `wizard-routes.js` styles, fonts, alerts, and Vietnamese localization titles.
3. **P1.2c: Shop Detail & Sidebar Layout**: Split `views.js` detail layout into Left Sidebar + Right Tab panels. Modernize Health Metrics.
4. **P1.2d: Soft Archive & Safety Toggles UI**: Redesign Pause/Resume/Archive forms to use checkboxes and click-toggles instead of strict typing fields.
5. **P1.2e: Product Grid & Media Upload Polish**: Replace product tables with a beautiful grid of visual cards. Polish image library dropzones.
