# Security Policy

## Supported Scope

This repository is a portfolio and small-shop automation backend. Public demo
fixtures must stay fake. Production credentials and customer data must live only
in deployment environment variables or private databases/storage.

## Secret Handling

Do not commit:

- `.env`
- Facebook page tokens
- Facebook app secrets
- Gemini or Google service account credentials
- `CREDENTIAL_MASTER_KEY`
- `DATABASE_URL`
- Telegram bot tokens
- customer exports, chat state, message history, or local `data/`

If a secret is ever committed, rotate it at the provider first. Removing the
file from the latest commit is not enough because Git history remains public.

## Admin Access

Use one of these forms for admin requests:

```bash
curl -H "Authorization: Bearer $ADMIN_EXPORT_TOKEN" https://your-app.example/admin/customers.csv
curl -H "x-admin-token: $ADMIN_EXPORT_TOKEN" https://your-app.example/admin/customers.csv
```

Do not send admin tokens in query strings because URLs can appear in browser
history, reverse-proxy logs, analytics, screenshots, and support tickets.

## Pre-Publish Checklist

```bash
npm test
npm audit --omit=dev
git grep -n -E "AIza|EAAB|sk-proj|ghp_|github_pat_|PRIVATE KEY|DATABASE_URL=.*://|ADMIN_PASSWORD="
```

The grep command is a local smoke check only. It does not replace GitHub Secret
Scanning or provider-side key rotation.
