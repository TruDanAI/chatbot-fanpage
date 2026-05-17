# Credential Safety

Use this skill for page token, app secret, `CREDENTIAL_MASTER_KEY`, encryption, credential rotation, credential audit, and credential response work.

## Hard Rules

- A token is received once and never echoed.
- Never print, log, return, snapshot, or test against a real token.
- Never print `encrypted_value`.
- Never print app secret values.
- `CREDENTIAL_MASTER_KEY` is required for page credential encryption/decryption.
- Rotate mode is required when an active credential already exists.
- Audit metadata must not contain token, `encrypted_value`, app secret, raw `page_id`, customer data, or message bodies.
- API and HTML responses must not contain token, `encrypted_value`, app secret, raw `page_id`, customer data, or message bodies.
- Use `page_ref`, credential type, status, counts, and rotation summaries instead.

## Implementation Pattern

- Normalize credential input and trim token only inside the write path.
- Validate token presence and length without including the token in error messages.
- Encrypt immediately with `CREDENTIAL_MASTER_KEY`.
- Lock active credentials for the page mapping before deciding whether rotate is required.
- If active credentials exist and rotate mode is false, return a safe conflict.
- On rotate, archive prior active credentials and insert one new active credential.
- Write sanitized audit metadata with `page_ref`, `credential_type`, `rotated`, `previous_active_count`, `archived_count`, and `active_count`.
- Return only safe summaries: credential id/type/status, `page_ref`, active count, archived count, and rotated boolean.

## Safe Debugging

- Prefer placeholder fixture names that cannot be mistaken for real credentials; never use real credentials in tests.
- When diagnosing failures, report error codes and counts.
- If decryption fails, report credential error count/status. Do not expose encrypted payloads or key material.
- If `CREDENTIAL_MASTER_KEY` is missing, report configuration missing. Do not ask the user to paste it into chat.

## Redaction Review

Before finalizing credential work, search changed files and outputs for:

- `token`
- `encrypted_value`
- `page_id`
- `CREDENTIAL_MASTER_KEY`
- `DATABASE_URL`

Confirm any matches are field names, fake fixtures, or sanitized code paths rather than secret values.
