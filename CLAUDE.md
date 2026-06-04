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
- Notifications are local browser/PWA notifications, configurable globally, by rule and by account.
- The UI must remain dense, readable and verified at `390x844`.

## Automation behavior

- Switcher updates run through `scripts/run-usage-data-update.mjs switcher`.
- Antigravity only captures while the app is open and requires macOS Accessibility and Screen Recording permissions.
- Do not print or commit access tokens, refresh tokens, cookies or local account-store contents.
- Use `npm run audit:automation` before diagnosing old snapshots.

## Validation before completion

1. Run `npm run validate`.
2. Smoke-test `/api/usage`.
3. Verify the Browser in-app on desktop and `390x844`.
4. Check account focus, filters, sort, notification views/toggles and permission scenarios.
5. Check browser console and PWA assets.
6. Do not commit, push, open a PR or deploy without an explicit request.
