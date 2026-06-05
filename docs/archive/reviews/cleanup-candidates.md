# Cleanup Candidates

Purpose: identify likely cleanup work without deleting anything during the
Day 1 sprint.

Boundary: docs only. No delete, deploy, env change, DB write, `/data` access,
Meta Graph API call, token health check, or Messenger send was performed.

## Delete Or Isolate Candidates

| Candidate | Confidence | Verification Needed | Why |
|---|---:|---|---|
| Untracked `output/` screenshots | High | Confirm they are not referenced by current docs/tests and are safe to archive outside repo. | Local Playwright captures are large and not part of runtime. |
| Sibling deploy mirror `chatbot-fanpage-deploy-acdc4d3-prod/` | High | Confirm it is outside the active git repo and not the deployment source. | Workspace duplicate can confuse operators. |
| Parent `production-db-backups/` | High | Confirm backup retention policy and move outside day-to-day workspace. | Backups should not sit near source editing paths. |
| Old broad review docs | Medium | Keep links needed by current runbooks, then consolidate into Day 1 docs. | `zenbot-*review*`, UX checkpoints, and roadmap docs overlap. |
| SQL proposal files after baseline migration | Medium | Confirm which patches are still required in staging/production. | Proposal files can be mistaken for approved apply scripts. |
| Token-health scripts/docs references | Medium | Keep tests, but isolate operator-facing scripts until an approved health-check policy exists. | Current sprint forbids token health checks. |
| `legacy-routes.js` exports/state endpoints | Medium | Confirm admin users no longer need CSV/JSONL/state exports. | Legacy compatibility increases surface area. |
| File-backed storage path | Low | Confirm all active shops are DB-backed and no classic production fallback remains. | Requiring file storage can create/write `data/`. |
| Legacy `FB_PAGE_TOKEN` fallback | Low | Confirm adult classic and all pilots have DB credentials first. | DB runtime should use scoped encrypted credentials. |
| Full AI/order/lead flow | Low | Confirm no shop needs non-`menu_code_handoff` modes. | Dormant for Basic flow but still tested and potentially useful. |
| Webhook queue feature | Low | Confirm queue is not part of pilot reliability plan. | Gated by flag but schema/tests are present. |
| Cloudinary upload feature | Low | Confirm admin upload will not be used in week 1. | Gated by flag and covered by tests. |

## Do Not Delete Yet

- `shops/adult-shop/**`
- `shops/demo-shop/**`
- `core/webhook.js`
- `core/modes/menu-code-handoff.js`
- `core/messenger-client.js`
- `core/storage.js` and `core/storage/**`
- `core/credentials/**`
- `core/shops/db-shop-config.js`
- `core/admin/**`
- `db/schema.sql`
- `db/production-missing-multishop-tables-patch.sql`
- `db/shop-lifecycle-readiness-patch.sql`
- `db/shop-dry-run-patch.sql`
- `tests/**`
- Current production/admin runbooks under `docs/` until replacement links are
  confirmed.

## Verification Checklist Before Any Cleanup

- Run `git status --short` and separate user changes from cleanup changes.
- Confirm cleanup path is inside the intended repo/workspace.
- Confirm the item is not referenced by `rg`.
- Confirm no current runbook links to it.
- Confirm tests do not import it.
- For docs, keep one canonical replacement link.
- For scripts, confirm no CI/package script uses it.
- For DB files, confirm production and staging migration state.
- For workspace backups or deploy mirrors, archive outside the source tree
  before deleting.
- Never delete during a production incident or pilot go-live window.

## First Safe Cleanup Task

Create an archive plan for local workspace clutter only:

- untracked `output/`;
- sibling deploy mirror;
- parent production backup folder.

Do not delete them in code review. Move only after owner confirmation and after
checking they are not the active deployment source or the only backup copy.
