# Basic Sales V2 Behavior Contract

Last updated: 2026-06-03, Asia/Bangkok.

Basic Sales v2 is a staging pilot path for a minimal Messenger sales flow. It is
not the current production customer-facing mode. Production `adult-shop` must
remain on classic `menu_code_handoff` unless a separate production approval is
given.

## Activation

Decision as of 2026-06-03:

- The canonical pilot activation path is a controlled feature overlay:
  keep the shop's canonical `bot_mode`/`botMode.name` as
  `menu_code_handoff`, and set
  `settings_json.basicSalesV2.enabled=true` only for the approved pilot shop.
- `botMode.name='basic_sales_v2'` remains runtime compatibility/internal
  support. Do not expose it in the admin bot mode selector or use it as the
  operator-facing activation path during the pilot.
- Pilot rollback is to set `settings_json.basicSalesV2.enabled=false` or remove
  the overlay key. This returns the shop to classic `menu_code_handoff`
  behavior without changing its canonical bot mode.

Runtime is selected as Basic Sales v2 when one of these is true:

- `botMode.name` is `basic_sales_v2`, unless `basicSalesV2.enabled` is
  explicitly `false`.
- `basicSalesV2.enabled=true` is present on the resolved shop config. DB-backed
  shops source this from `shop_settings.settings_json.basicSalesV2` or
  `settings_json.basic_sales_v2`.

Current operator rule:

- Keep existing Basic shops on `botMode.name='menu_code_handoff'`.
- For controlled staging pilots, use `settings_json.basicSalesV2.enabled=true`
  on the target staging shop only.
- Missing v2 config or `basicSalesV2.enabled=false` falls back to classic
  `menu_code_handoff` when the shop bot mode is classic.

The v2 overlay is selected before classic `menu_code_handoff`. A shop with
`botMode.name='menu_code_handoff'` and `basicSalesV2.enabled=true` will run v2.

## Supported Runtime

Basic Sales v2 is a minimal sales runtime. It shares the Basic-mode safeguards:

- quick replies are disabled;
- broad rule-engine intents such as checkout, policy Q&A, discount, tracking,
  stock, recommendation, and order-info capture are disabled by
  `applyBotModeConfig`;
- AI fallback, lead capture, order flow, and follow-up behavior are off by
  default for minimal modes;
- product-code lookup, menu sending, and post-product handoff are enabled by
  default unless their rule toggles are explicitly disabled.

When the v2 handler is selected, webhook processing stops inside the v2 path.
Unmatched messages are currently silent; they do not fall through to classic
menu behavior, full-mode deterministic replies, Gemini, lead parsing, order
capture, Telegram alerts, or Sheets writes.

## Menu Behavior

Menu-like messages include greetings and direct menu/catalog/price/list
requests. In v2 they send a text fallback only:

- `basicSalesV2.menuReply`, if configured;
- otherwise `basicSalesV2.menuFallbackReply`;
- otherwise `botMode.menuIntroText` or top-level `menuIntroText`;
- otherwise the default:

```text
Dạ shop gửi mình danh sách sản phẩm ạ.
Mình nhắn mã sản phẩm để em gửi chi tiết nhé.
```

The v2 menu fallback does not send menu images. This is an intentional staging
contract and differs from classic `menu_code_handoff`, where menu requests send
the classic price/menu reply and menu images.

If `menuSendingEnabled=false`, v2 does not send the menu fallback.

## Product-Code Behavior

Product-code lookup is the primary sales path.

When `productCodeLookupEnabled` is not disabled and the customer message
contains a known product code, v2:

- sends the product image when a matching image is available;
- sends the deterministic product detail text;
- sends the configured handoff message when `postProductHandoffEnabled` is not
  disabled;
- stores the last product code;
- enters human handoff for the configured handoff window.

While a sender is in handoff, v2 does not send automated replies. It only
refreshes the last-user timestamp.

If `postProductHandoffEnabled=false`, v2 still sends product detail behavior but
does not send the handoff message or enter handoff.

## Hot Products

Hot Products are controlled by `settings_json.hotProducts`:

- `enabled=true`;
- `trigger='keyword'`;
- `productCodes` contains active product codes;
- `maxItems` is clamped by the normal hot-products limits;
- `cooldownMs` is applied per page, sender, and shop.

Keyword examples include "hàng hot", "sản phẩm hot", "sản phẩm nổi bật", and
"gợi ý sản phẩm" after Vietnamese folding.

When enabled and matched, v2:

- sends the configured Hot Products list in configured order;
- sends at most one image per resolved product when images are available;
- does not enter handoff.

If no configured active products resolve, the safe empty Hot Products reply is
used. If Hot Products are disabled, v2 does not respond to the keyword through
the hot-products path.

Product-code lookup wins before Hot Products when the same message could match
both.

## Disabled Features

For the current v2 staging contract, these are intentionally not part of the
customer-facing behavior:

- Gemini fallback;
- checkout/order capture;
- lead parsing and customer writes;
- follow-up and reminder workers;
- Telegram alerts;
- Google Sheets export/write paths;
- quick replies;
- rich menu image sending for menu requests;
- casual admin toggle for production rollout.

Changing any of these turns v2 into a broader product change and should require
new tests and a rollout note.

## Staging Smoke Procedure

Durable smoke script:

```powershell
node scripts/basic-sales-v2-staging-smoke.js
```

Detailed runbook: `docs/basic-sales-v2-staging-smoke-runbook.md`.

Do not run this script without explicit staging DB write approval. It mutates
`wizard-smoke-shop` `shop_settings.settings_json` and restores it in `finally`.

Required runtime guards:

- `RAILWAY_ENVIRONMENT_NAME` or `RAILWAY_ENVIRONMENT` contains `staging`;
- `MESSENGER_DRY_RUN=true`;
- `MULTI_SHOP_DB_CONFIG_ENABLED=true`;
- `CHATBOT_STAGING_DATABASE_URL` is set;
- no `DATABASE_URL` fallback is accepted;
- target shop `wizard-smoke-shop` remains `dry_run=true`;
- raw tokens, Page IDs, sender IDs, DB URLs, and customer message bodies are not
  printed.

The smoke validates:

- classic menu remains classic when v2 is disabled;
- classic product code sends detail, image, and handoff;
- classic Hot Products works only when enabled;
- v2 menu sends the v2 text fallback and no menu images;
- v2 Hot Products sends configured list/images without handoff;
- v2 product code sends image, detail, and handoff;
- v2 disable returns to classic behavior;
- `adult-shop` settings hash remains unchanged.

## Local Verification

Focused local check:

```powershell
node -e "require('./tests/webhook.test.js'); require('./tests/harness').run().then(code => process.exit(code))"
```

As of 2026-06-02 this passes 93 local webhook tests, including the v2 contract
cases:

- `adult-shop` config remains classic and does not use v2;
- explicit pilot config selects v2 before classic mode;
- v2 product-code path sends image, detail, and handoff;
- v2 Hot Products sends list/images and does not hand off;
- missing or disabled v2 config stays on classic behavior.

Broader guard:

```powershell
npm test
npm audit --omit=dev
```

As of 2026-06-02, `npm test` passes 950 tests and audit reports 0
vulnerabilities.
