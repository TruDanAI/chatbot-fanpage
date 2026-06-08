# Chatbot Fanpage

AI-assisted Messenger sales chatbot backend for small-shop fanpage workflows.

This repository is a portfolio-ready Node.js/Express backend that handles
Messenger webhooks, rule-based sales conversations, product catalog lookup,
human handoff, admin operations, and multi-shop runtime hardening. The project
is intentionally backend-focused: the value is in webhook safety, state
management, deterministic sales rules, admin controls, and test coverage.

## Highlights

- Facebook Messenger webhook with signature validation support.
- Rule engine for greetings, product lookup, pricing, order intent, handoff,
  fallback replies, and Vietnamese text normalization.
- Shop-specific configuration through `shops/<SHOP_ID>/config.js` and
  `products.csv`.
- Optional Gemini fallback through Vertex AI or API key mode.
- Admin routes with bearer/header token authentication, RBAC-oriented helpers,
  audit metadata redaction, rate limits, and optional IP allowlist.
- File-backed storage for local/demo mode and PostgreSQL-backed rollout paths
  for multi-shop runtime configuration.
- Production-oriented guardrails such as fail-closed page resolution, webhook
  dry-run mode, credential encryption hooks, and token redaction tests.
- Test suite covering NLP, rules, webhooks, admin flows, storage adapters,
  multi-shop behavior, credential safety, and UI rendering.

Current validation snapshot:

```bash
npm test
# 945 passed, 0 failed
```

## Tech Stack

- Node.js 20+
- Express
- PostgreSQL (`pg`) for production rollout paths
- Gemini / Vertex AI via `@google/genai`
- Facebook Messenger Platform
- CSV catalog ingestion
- Custom lightweight test runner

## Repository Layout

```text
core/                 Application services, rule engine, admin routes, storage
db/                   PostgreSQL schemas and rollout SQL
docs/                 Architecture notes, rollout runbooks, audit plans
scripts/              Verification and migration helpers
shops/demo-shop/      Safe public demo shop fixture
tests/                Regression and security-hygiene tests
index.js              Express app and webhook runtime wiring
```

## Quick Start

```bash
npm install
cp .env.example .env
npm test
npm run dev
```

The public sample defaults to `SHOP_ID=demo-shop`. Use real page tokens,
service account credentials, and production URLs only through environment
variables. Never commit `.env`, customer exports, chat state, page tokens, app
secrets, service account JSON, or database URLs.

## Required Environment

Minimum local/demo variables:

```text
NODE_ENV=development
SHOP_ID=demo-shop
FB_VERIFY_TOKEN=replace_with_random_string
FB_PAGE_TOKEN=replace_with_page_token
USE_GEMINI=false
ADMIN_EXPORT_TOKEN=replace_with_64_char_random_token
```

Production should additionally set:

```text
FB_APP_SECRET=replace_with_meta_app_secret
SESSION_SECRET=replace_with_64_plus_random_chars
PUBLIC_BASE_URL=https://your-public-app.example
```

When using Gemini:

```text
GEMINI_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=your-google-cloud-project
GOOGLE_CLOUD_LOCATION=global
```

or API-key mode for development:

```text
GEMINI_PROVIDER=api_key
GEMINI_API_KEY=replace_with_api_key
```

## Security Notes

- Production requires `FB_APP_SECRET` so Messenger webhook requests can be
  verified with `X-Hub-Signature-256`.
- Admin export/state endpoints should use `Authorization: Bearer <token>` or
  `x-admin-token: <token>`. Do not send admin tokens in query strings.
- `.env`, `data/`, logs, and local state are ignored by git.
- Demo fixtures must not contain real page IDs, customer data, page tokens, app
  secrets, database URLs, or service account credentials.
- Run `npm audit --omit=dev` before publishing or deploying.

## Portfolio Positioning

This project is best described as:

> Messenger sales chatbot backend with rule-based automation, Gemini fallback,
> admin controls, multi-shop rollout planning, and extensive regression tests.

Recommended CV bullet:

> Built a Messenger sales chatbot backend with Express, deterministic sales
> rules, Gemini fallback, human handoff, admin controls, and 900+ regression
> tests covering webhook, storage, credential-safety, and multi-shop flows.

## Limitations

- This is not a managed SaaS product yet.
- Real production rollout still requires fresh secret provisioning, live
  Messenger review, database migration approval, backups, and monitoring.
- The public `demo-shop` fixture is intentionally fake and does not collect
  real customer data.
