# When Reset + Antigravity Manager: runbook

This is the canonical path for exposing the five primary Antigravity accounts to
When Reset. Do not return to screenshot/OCR collection or use an exported token
file as the live source.

## Data path

1. Antigravity Manager refreshes Google quota and stores it in
   `~/.antigravity-agent/cloud_accounts.db`.
2. `scripts/read-antigravity-manager-usage.mjs` reads only `email`, identity
   metadata, activity state, `last_used`, and encrypted `quota_json`. Its SQL
   never selects `token_json`.
3. The reader obtains the Manager safe-storage password from the local macOS
   Keychain, unwraps `~/Library/Application Support/Antigravity Manager/.mk`, and
   decrypts only the quota envelope in memory.
4. The generated `antigravity_usage.json` contains email, plan, percentages, and
   reset timestamps. It contains no Google access, refresh, or ID token.
5. `scripts/run-usage-data-update.mjs antigravity` commits that sanitized snapshot
   to `usage-data`. Vercel reads it and serves an authenticated Compatible API.
6. When Reset sends only the bridge bearer key to the exact HTTPS endpoint. The
   bridge key is not a Google credential.

The static `~/Downloads/cloud-accounts-export-2026-08-17.json` was used once to
match identities. It is not read for live quota after this setup.

## Selected accounts

The local allowlist is `~/.antigravity-agent/when-reset-accounts.json`. It is not
committed and currently selects, in this order:

1. `leosaquetto0@gmail.com` (`leosaquetto0`)
2. `leosaquetto1@gmail.com` (`leosaquetto1`)
3. `laraujo@outlook.com` (`laraujo-outlook`)
4. `leosaquetto.jobs@gmail.com` (`leosaquetto-jobs`)
5. `leosaquetto@gmail.com` (`leosaquetto-main`)

Every account publishes four independent windows when the Manager provides them:

- Gemini Models — 5-hour limit
- Gemini Models — weekly limit
- Claude and GPT models — 5-hour limit
- Claude and GPT models — weekly limit

The Manager-provided `subscription_tier` becomes the When Reset plan.

## Add the five accounts in When Reset

Choose **Add account → Compatible API** five times. Use the email as **Provider
name**, the same private bearer key for all five, and these endpoints:

| Provider name | Endpoint |
| --- | --- |
| `leosaquetto0@gmail.com` | `https://codex-usage-nine.vercel.app/api/antigravity-compatible/leosaquetto0` |
| `leosaquetto1@gmail.com` | `https://codex-usage-nine.vercel.app/api/antigravity-compatible/leosaquetto1` |
| `laraujo@outlook.com` | `https://codex-usage-nine.vercel.app/api/antigravity-compatible/laraujo-outlook` |
| `leosaquetto.jobs@gmail.com` | `https://codex-usage-nine.vercel.app/api/antigravity-compatible/leosaquetto-jobs` |
| `leosaquetto@gmail.com` | `https://codex-usage-nine.vercel.app/api/antigravity-compatible/leosaquetto-main` |

When Reset derives the displayed account name from the manually entered Provider
name. Its Compatible API parser does not map server-returned identity into the
Account tab, so `Name` and `Email` may still say `Not provided`; the account header
will nevertheless be the entered email. This is an upstream app limitation, not
a missing field in this bridge.

The old `/account-1` form remains accepted for compatibility, but stable slugs
above should be used because they do not change when account order changes.

## Refresh and health checks

The LaunchAgent
`com.leosaquetto.codexusage.antigravity.autoupdate` runs every 900 seconds. It is
safe for Antigravity Manager to remain in the background; screen recording and
UI focus are not used.

```bash
node scripts/read-antigravity-manager-usage.mjs
npm run test:antigravity-manager-reader
npm run test:antigravity-usage-parser
npm run update:antigravity-usage:auto
npm run audit:automation
```

Check the installed schedule:

```bash
launchctl print gui/$(id -u)/com.leosaquetto.codexusage.antigravity.autoupdate
```

If the app says the credential was rejected, verify the Vercel
`WHEN_RESET_ANTIGRAVITY_KEY` and the iPhone entry are byte-for-byte identical,
without spaces or line breaks. Never put that value in Git, documentation, logs,
or chat.

## Security boundary

- Never query, print, copy, commit, upload, or log `token_json`.
- Never publish `.mk`, Keychain output, account exports, ORPC packet logs, or raw
  Manager database rows.
- Fail the update if a configured account, quota, or reset window is missing;
  do not silently fall back to an old export.
- The public snapshot may contain the selected email identities and quota values,
  but no provider credential.
- The optional When Reset self-hosted Worker is not part of this path. Upstream
  intentionally keeps Antigravity OAuth and Compatible API origins on-device;
  enabling the Worker would not improve this bridge and must not receive Google
  tokens.

## Changing the account list

Edit only `~/.antigravity-agent/when-reset-accounts.json`. Each entry needs a
unique lowercase email, stable URL slug, and label. Run the reader test and one
manual update afterward. Existing When Reset accounts continue to work as long
as their slug remains unchanged.
