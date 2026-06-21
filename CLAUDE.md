# Codex Usage Repository Guide

## Product

This repository contains:

- a compact PWA dashboard in `webapp/`;
- local data collectors in `scripts/`;
- public JSON snapshots in the `usage-data` branch;
- Scriptable widgets in `scriptable/`.

The main Codex collector is the Switcher flow. Playwright/CDP and Chrome/AppleScript remain fallback collectors.

## Branch and deploy rules

- Code and webapp changes belong on `main`.
- Automatic JSON snapshots belong on `usage-data`.
- Never publish automatic data commits from `main`.
- `webapp/vercel.json` must keep Git deployments disabled for `usage-data`.
- Widgets and the production API must continue reading `usage-data`.
- Treat `usage-data` as the only live source for `codex_usage.json`, `codex_usage_history.json` and `usage_summary.json`. Repo-root JSONs on `main` are stale-capable local snapshots and are only valid when explicitly testing with `CODEX_USAGE_USE_LOCAL_FILES=1`.

## Main commands

```bash
npm run dev
npm run validate
npm run audit:automation
npm run update:codex-usage:switcher:auto
npm run update:antigravity-usage:auto
```

`npm run validate` must remain side-effect free. `node scripts/build-usage-summary.mjs --verify-only` must validate without writing.

## Dashboard behavior

- `activeAccountId` and `lastUsedAt` must survive collector, API, cache and view-model normalization.
- The active-account strip precedes the account overview.
- Paid-only aggregates exclude FREE/GO; those accounts remain visible and filterable.
- Data older than one hour is stale and must be visibly identified.
- Notifications use Web Push when permission and a subscription are available, with local browser notifications only as fallback while the app is active.
- Web Push subscriptions and dedupe state live in private Vercel Blob objects; never commit VAPID keys, Blob tokens or the dispatch secret.
- The UI must remain dense, readable and verified at `390x844`.
- **Quota Formatting**: Model quota percentage displays must be truncated to exactly two decimal places using floor division (e.g. `99.99%`) to avoid premature rounding.
- **Quota Consolidation**: Standard accounts render a single consolidated "Gemini" indicator row.
- **PRO Accounts (e.g. `leosaquetto@gmail.com`)**: Must be badged as `PRO` and render separated "Weekly Limit" (88%) and "Five Hour Limit" (82%) indicators along with a descriptive "Model Quota" header.
- **Desktop Sidebar Layout**: Wider viewports (>= 1024px) utilize a left fixed/sticky sidebar for navigation, placing the welcome header and metrics overview cards on top. The columns grid features `grid-template-columns: 1fr 1fr` containing only the Gemini Model Progress list and Codex Accounts list, with status widgets and other panels placed full-width above or below to avoid overlaps.

## Automation behavior

- Switcher updates run through `scripts/run-usage-data-update.mjs switcher`.
- The Switcher wrapper dispatches background Push only after the `usage-data` update has completed.
- Antigravity only captures while the app is open and requires macOS Accessibility and Screen Recording permissions.
- **Quota Overrides**: `scripts/update-antigravity-usage-auto.mjs` intercepts the CLI collector output for `leosaquetto@gmail.com` to map the `gemini-3.1-pro-high` (Weekly) and `gemini-3.1-pro-low` (5-Hour) models with their overridden mock percentages (88% and 82%), mapping the model IDs correctly to prevent overrides from being wiped.
- Do not print or commit access tokens, refresh tokens, cookies or local account-store contents.
- Use `npm run audit:automation` before diagnosing old snapshots.

## Troubleshooting & Setup Tips

- **Antigravity LaunchAgent**: If `npm run audit:automation` shows `com.leosaquetto.codexusage.antigravity.autoupdate` is loaded: `false` or state: `not-loaded`, copy the plist file to `~/Library/LaunchAgents/` and bootstrap it:
  ```bash
  cp launchagents/com.leosaquetto.codexusage.antigravity.autoupdate.plist ~/Library/LaunchAgents/
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.leosaquetto.codexusage.antigravity.autoupdate.plist
  ```
  To force run the agent manually:
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.leosaquetto.codexusage.antigravity.autoupdate
  ```
- **Playwright Chromium**: If Playwright scripts fail due to a missing browser executable, run:
  ```bash
  npx playwright install chromium
  ```
- **Web Push Dispatch 403 Forbidden**: If push dispatch logs show `BlobError: Vercel Blob: Failed to fetch blob: 403 Forbidden`, verify that `BLOB_READ_WRITE_TOKEN` environment variable on Vercel matches active store credentials and is synchronized.

## Validation before completion

1. Run `npm run validate`.
2. Smoke-test `/api/usage`.
3. Verify the Browser in-app on desktop and `390x844`.
4. Check account focus, filters, sort, notification views/toggles and permission scenarios.
5. Check browser console and PWA assets.
6. Do not commit, push, open a PR or deploy without an explicit request.


