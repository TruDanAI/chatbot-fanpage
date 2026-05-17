# Credential Safety

Use this skill for page token, app secret, `CREDENTIAL_MASTER_KEY`, encryption, credential rotation, credential audit, and credential response work.

## Hard Rules

- A token is received once and never echoed back.
- Never print, log, return, snapshot, or test against a real token.
- Never print `encrypted_value`.
- Never print app secret values.
- `CREDENTIAL_MASTER_KEY` is required for page credential encryption/decryption.
- Rotate mode is required when an active credential already exists.
- Audit metadata must not contain token, `encrypted_value`, app secret, raw `page_id`, customer data, or message bodies.
- API and HTML responses must not contain token, `encrypted_value`, app secret, raw `page_id`, customer data, or message bodies.
- Use `page_ref`, credential type, status, counts, and rotation summaries instead.

## Implementation Pattern

1. Normalize credential input; trim token only inside the write path.
2. Validate token presence and length without including the token in error messages.
3. Encrypt immediately with `CREDENTIAL_MASTER_KEY`.
4. Lock active credentials for the page mapping before deciding whether rotate is required.
5. If active credentials exist and rotate mode is false, return a safe conflict (HTTP 409). Do not overwrite silently.
6. On rotate: archive prior active credentials, insert one new active credential, write in a single transaction.
7. Write sanitized audit metadata: `page_ref`, `credential_type`, `rotated`, `previous_active_count`, `archived_count`, `active_count`.
8. Return only safe summaries: credential id/type/status, `page_ref`, active count, archived count, rotated boolean.

## CREDENTIAL_MASTER_KEY Rotation

`CREDENTIAL_MASTER_KEY` rotation is a separate, higher-stakes operation from page credential rotation.

- Do not attempt key rotation without an explicit plan, a production backup, and user approval.
- Key rotation requires re-encrypting all existing `encrypted_value` rows under the new key before the old key is removed.
- If the old and new key coexist during rotation, the decryption path must try both and commit to the new key on success.
- After re-encryption, verify all active credentials decrypt cleanly before removing the old key from env.
- A failed key rotation can silently break all credential lookups for all shops. Treat it as a production DB write requiring the full backup requirement from `railway-production-safety.md`.

If asked to rotate `CREDENTIAL_MASTER_KEY` without a plan covering the above, stop and request the plan first.

## Safe Debugging

- Prefer placeholder fixture names that cannot be mistaken for real credentials in tests (e.g., `FAKE_TOKEN_FOR_TEST`).
- Never use real tokens or key values in tests, fixtures, or examples.
- When diagnosing failures, report error codes and counts only.
- If decryption fails, report credential error count/status. Do not expose encrypted payloads or key material.
- If `CREDENTIAL_MASTER_KEY` is missing, report "configuration missing." Do not ask the user to paste it into chat.

## Redaction Review

Before finalizing any credential work, search changed files and outputs for:

- `token`
- `encrypted_value`
- `page_id`
- `CREDENTIAL_MASTER_KEY`
- `DATABASE_URL`
- `APP_SECRET`

Confirm every match is a field name, fake fixture, or sanitized code path — not a real secret value.
