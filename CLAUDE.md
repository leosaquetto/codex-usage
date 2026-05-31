# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Codex Usage Analytics** project that tracks and visualizes usage metrics for ChatGPT Codex and Antigravity AI models. It consists of:

1. **Automated data collection scripts** (Node.js) that scrape usage data from ChatGPT Codex and Antigravity desktop apps
2. **Web dashboard** (vanilla HTML/CSS/JS) that displays usage analytics with real-time calculations
3. **iOS Scriptable widgets** for displaying usage on iPhone/iPad home screen
4. **GitHub Actions workflows** for automated deployments and email triggers

The project is in **Portuguese (pt-BR)** - all UI text, comments, and documentation use Portuguese.

## Git Workflow

**IMPORTANT**: Always work on the `staging` branch for development. Only merge to `main` when ready to deploy.

- **`staging`**: Development branch - make all commits here
- **`main`**: Production branch - only receives merges from staging, triggers automatic deploys
- **`usage-data`**: Automated JSON snapshots - receives updater commits and never deploys to Vercel

### Workflow Steps

1. Make sure you're on `staging`: `git checkout staging`
2. Make your changes and commit them to `staging`
3. When ready to deploy: merge `staging` into `main` and push
4. Deploy happens manually via GitHub Actions workflow

## Architecture

### Project Structure

```
codex-usage/
├── webapp/              # Frontend (deployed to Vercel)
│   ├── index.html       # Dashboard HTML
│   ├── style.css        # Responsive CSS with dark/light mode
│   ├── app.js           # Client-side logic and calculations
│   ├── api/usage.js     # Vercel serverless function
│   ├── assets/          # Images and logos
│   └── vercel.json      # Vercel configuration
├── scripts/             # Node.js automation scripts
├── scriptable/          # iOS Scriptable widgets
│   ├── webview-hidden-auto-update-v3.js  # Manual update via Shortcuts
│   └── large-widget.js                    # Large widget for home screen
├── codex_usage.json     # Raw Codex data (root only)
├── antigravity_usage.json  # Raw Antigravity data (root only)
└── usage_summary.json   # Combined data (root only)
```

**CRITICAL**: Files are NOT duplicated. Frontend files live ONLY in `webapp/`, data files live ONLY in root.

### Data Flow

```
ChatGPT Codex Analytics Page
    ↓ (Playwright automation)
codex_usage.json (root of usage-data branch)
    ↓
usage_summary.json (combines codex + antigravity)
    ↓
webapp/api/usage.js (Vercel serverless function)
    ↓
webapp/index.html (dashboard)
```

### Key Files

- **`codex_usage.json`**: Raw Codex usage data (5-hour and weekly limits) - **root of `usage-data`**
- **`antigravity_usage.json`**: Antigravity model quotas with refresh times - **root of `usage-data`**
- **`usage_summary.json`**: Combined summary of both sources - **root of `usage-data`**
- **`webapp/`**: Static web dashboard deployed to Vercel - **all frontend files here**
  - `index.html`: Semantic HTML5 structure
  - `style.css`: Modern responsive design with CSS custom properties, dark/light mode
  - `app.js`: Vanilla JS with real-time usage calculations (no frameworks)
  - `api/usage.js`: Vercel serverless function that enriches and serves usage data
  - `assets/`: Model logos (Claude, GPT, Gemini, Codex)
- **`scripts/`**: Node.js automation scripts - **root only**
- **`scriptable/`**: iOS Scriptable widgets for home screen - **root only**
  - `webview-hidden-auto-update-v3.js`: Manual update script via Shortcuts
  - `large-widget.js`: Large widget displaying all usage metrics

### Data Collection Methods

**Codex (ChatGPT):**
- Primary: Playwright automation connecting to Chrome via CDP (Chrome DevTools Protocol)
- Scrapes `https://chatgpt.com/codex/cloud/settings/analytics`
- Requires authenticated Chrome session (no API keys stored)
- Runs via `npm run update:codex-usage:auto`
- Uses `scripts/run-usage-data-update.mjs` so automatic commits land on `usage-data`, never on `main`

**Antigravity:**
- Desktop UI automation using macOS accessibility APIs
- Screenshots the Settings > Models screen and extracts quota bars
- Only runs when Antigravity app is already open
- Runs via `npm run update:antigravity-usage:auto`

## Common Commands

### Data Collection

```bash
# Update Codex usage (automated with CDP)
npm run update:codex-usage:auto

# Update Codex usage (manual with visible browser for login)
npm run update:codex-usage:login

# Update Antigravity usage (automated, requires app open)
npm run update:antigravity-usage:auto

# Test parsers without committing
npm run test:codex-usage-parser
npm run test:antigravity-usage-parser
```

### Development

```bash
# Install dependencies
npm install

# Start Chrome with CDP enabled (for Codex automation)
npm run chrome:cdp

# Run Playwright scripts
node scripts/update-codex-usage-playwright.mjs --headed
node scripts/update-codex-usage-playwright.mjs --cdp
```

### Deployment

The webapp is deployed to Vercel. Deployments are triggered manually via GitHub Actions:

- **Preview**: Run workflow `.github/workflows/vercel-preview.yml`
- **Production**: Run workflow `.github/workflows/vercel-production.yml`

Deploy URLs are published in the GitHub Actions job summary.

## Code Architecture

### Webapp Logic (`webapp/app.js`)

The dashboard performs **real-time calculations** on every render:

1. Fetches usage data from `/api/usage`
2. Calculates derived metrics:
   - `realDailyRate`: actual usage rate based on elapsed cycle time
   - `safeDailyRate`: safe rate to stay within weekly limit
   - `dailyDiff`: difference between real and safe rates
   - `weeklyProjection`: projected remaining % at end of cycle
   - `zeroIn`: estimated time until limit exhaustion
3. Updates UI with status indicators and warnings

**Important**: All calculations happen client-side. The logic is **100% preserved from the original implementation** - only the UI was refactored.

### API Enrichment (`webapp/api/usage.js`)

The Vercel serverless function:
1. Tries to read `CODEX_USAGE_PAYLOAD` from environment (set during deploy)
2. Falls back to fetching from GitHub raw URL
3. Enriches the payload with calculated metrics
4. Returns JSON with formatted strings for display

### Automation Scripts

**`update-codex-usage-playwright.mjs`**:
- Connects to Chrome via CDP or launches Playwright browser
- Navigates to Codex analytics page
- Extracts usage percentages and reset times
- Updates `codex_usage.json` and rebuilds `usage_summary.json`
- Optionally commits and pushes changes

**`update-antigravity-usage-auto.mjs`**:
- Checks if Antigravity app is running
- Uses macOS UI automation to navigate to Settings > Models
- Screenshots the window and extracts quota bar percentages
- Parses refresh times from visible text
- Updates `antigravity_usage.json` and rebuilds `usage_summary.json`

**`build-usage-summary.mjs`**:
- Combines `codex_usage.json` and `antigravity_usage.json`
- Writes `usage_summary.json` with latest timestamp

## Design System

The webapp uses a modern, responsive design:

- **CSS Custom Properties**: All colors, spacing, and timing defined as CSS variables
- **Dark mode by default**: Automatically switches to light mode via `prefers-color-scheme`
- **Mobile-first responsive**: Breakpoints at 480px, 640px, 768px, 1024px
- **Fluid typography**: Uses `clamp()` for responsive font sizes
- **Animations**: Subtle transitions with `prefers-reduced-motion` support
- **Accessibility**: WCAG AA+ compliant, semantic HTML, ARIA attributes

## GitHub Actions

**`codex-usage-trigger-email.yml`**:
- Runs every 30 minutes via cron
- Reads `fiveHourPercent` from `codex_usage.json`
- Sends email trigger if usage is between 0-100% (active usage)
- Skips if at boundary (0% or 100%)

## Browser Profiles

The Playwright scripts use persistent browser profiles stored **outside the repo**:

- **Default profile**: `/Users/leosaquetto/Developer/BrowserProfiles/codex-chrome-profile`
- **CDP profile**: `/Users/leosaquetto/Developer/BrowserProfiles/codex-cdp-profile`

These profiles maintain authentication state for ChatGPT/Codex without storing credentials in the repo.

## Important Notes

- **No API keys or tokens**: All authentication happens via browser sessions
- **Portuguese language**: All user-facing text is in pt-BR
- **Logic preservation**: The calculation logic in `app.js` and `api/usage.js` is unchanged from the original - only UI was refactored
- **Automation requires permissions**: macOS Accessibility and Screen Recording permissions needed for Antigravity automation
- **CDP for efficiency**: Chrome DevTools Protocol allows reusing an already-authenticated browser session
- **No file duplication**: Frontend files exist ONLY in `webapp/`, data files ONLY in root. Never duplicate files between locations.
- **Work on staging branch**: All development happens on `staging`. Only merge to `main` when ready to deploy.

## Testing

Run parser tests to validate data extraction without making commits:

```bash
npm run test:codex-usage-parser
npm run test:antigravity-usage-parser
```

These scripts test the parsing logic against sample data or live sources without writing files or committing changes.
