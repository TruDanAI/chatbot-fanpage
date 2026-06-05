# Product/Menu Polish Checkpoint (P1.2e)

This checkpoint records the completed Product/Menu management UX polish for the
admin shop detail flow. It covers layout, drawer editing, catalog image/status
visuals, product lifecycle row actions, product code history safety, CSV import
preview, and CSV import result summaries.

This document is a docs-only checkpoint. It is not approval to deploy, change
environment variables, write any database, touch `/data`, touch production,
call Meta Graph API, run token health checks, or send Messenger messages.

## Scope Summary

| Slice | Commit | Staging deployment | Result |
| --- | --- | --- | --- |
| P1.2e1 Products & Menu layout polish | `97e8f90` | `9727ec8b-0e2f-49c4-b2ed-adbb1a967742` | Completed |
| P1.2e2 Product drawer editing UI | `65d5b5e` | `9e739790-4ac0-4dac-95cf-123bfdbb21f5` | Completed |
| P1.2e3a Product image/status visual polish | `2dbd193` | `72d569f2-19d7-4592-a662-176924952831` | Completed |
| P1.2e3b1 Product lifecycle row actions | `94b0915` | `aaa77674-c28f-4a23-a7f3-786b61e0b37b` | Completed |
| P1.2e3b2 Product code history safety | `d545b4a` | `3a1b47c3-20df-4521-98c3-7f976c74abfb` | Completed |
| P1.2e3c1 CSV import preview | `758a5dc` | `36729b08-83de-4265-a323-c4a8f6ee673f` | Completed |
| P1.2e3c2 CSV import result summary | `3d668a3` | `0ca452ab-227c-407d-81ed-951fa6c22a02` | Completed |

## P1.2e1 Products & Menu Layout Polish

- Commit: `97e8f90`
- Staging deployment: `9727ec8b-0e2f-49c4-b2ed-adbb1a967742`
- Separated bot script settings from the product catalog so operators can scan
  and edit menu/product data without mixing it with bot copy controls.
- Added a catalog health summary to surface operational catalog readiness at
  the top of the Products & Menu area.
- Added Add Product and CSV anchors so operators can jump directly to the
  manual add flow or bulk import flow.

## P1.2e2 Product Drawer Editing UI

- Commit: `65d5b5e`
- Staging deployment: `9e739790-4ac0-4dac-95cf-123bfdbb21f5`
- Added drawer-based add/edit UX for products.
- Kept the implementation as progressive enhancement so the baseline server
  forms still work when JavaScript is unavailable or fails.
- Preserved existing forms and submit behavior.
- Fixed the `activeDrawerForm` collision so add/edit drawer state does not
  leak across forms.

## P1.2e3a Product Image/Status Visual Polish

- Commit: `2dbd193`
- Staging deployment: `72d569f2-19d7-4592-a662-176924952831`
- Added an image column to the product table.
- Added a missing image warning for products that need operator attention.
- Localized status labels for active, hidden, and archived products.
- Added a mobile fallback layout so the image/status information remains
  usable on narrow screens.

## P1.2e3b1 Product Lifecycle Row Actions

- Commit: `94b0915`
- Staging deployment: `aaa77674-c28f-4a23-a7f3-786b61e0b37b`
- Added row actions for `Tạm ẩn`, `Hiện lại`, and `Lưu trữ`.
- Added the archive modal for deliberate archive confirmation.
- Added archived row placeholders so retired products have clear, low-risk UI
  affordances instead of editable active-row controls.

## P1.2e3b2 Product Code History Safety

- Commit: `d545b4a`
- Staging deployment: `3a1b47c3-20df-4521-98c3-7f976c74abfb`
- Archived product codes remain reserved within the shop.
- Restoring an archived product returns it to `hidden`, not directly to
  `active`.
- Creating a new product with a code already held by an archived product is
  blocked.
- Product codes are treated as historical identifiers rather than reusable
  display labels.

## P1.2e3c1 CSV Import Preview

- Commit: `758a5dc`
- Staging deployment: `36729b08-83de-4265-a323-c4a8f6ee673f`
- Added CSV preview classifications:
  `create`, `update`, `archived_conflict`, `duplicate_in_csv`, and `error`.
- The preview path is read-only. Previewing a CSV does not create, update,
  restore, archive, or otherwise mutate products.
- A blocker CSV hides the final import action so operators cannot continue into
  a known unsafe import.

## P1.2e3c2 CSV Import Result Summary

- Commit: `3d668a3`
- Staging deployment: `0ca452ab-227c-407d-81ed-951fa6c22a02`
- Added clear success summary labels for created, updated, image, skipped, and
  error outcomes.
- Failed imports no longer claim partial success.
- Staging smoke verified the result summary with a disposable product imported
  through CSV and then archived after the smoke.

## Final Product/Menu Policy

- `active`: the product is published and visible to customer-facing chatbot
  product-code matching.
- `hidden`: the product is retained and editable, but temporarily unavailable
  to the customer-facing chatbot.
- `archived`: the product is retired for historical/reference safety and kept
  out of normal catalog operation.
- Product code is a historical identifier.
- Archived product codes cannot be reused in the same shop.
- CSV import is preview-first and all-or-nothing.
- CSV import never auto-restores archived products.
- Archived-code conflicts in CSV require explicit operator lifecycle handling
  outside the CSV import path.

## Safety Boundary

- Docs only.
- No deploy.
- No environment changes.
- No database writes.
- No `/data` access or writes.
- No production access or changes.
- No Meta Graph API calls.
- No token health checks.
- No Messenger messages.
