#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const dataBranch = "usage-data";
const dataWorktree = resolve(root, ".local/usage-data-worktree");
const statusPath = resolve(root, "last_status.json");

const modes = {
  switcher: "scripts/update-codex-usage-from-switcher.mjs",
  playwright: "scripts/update-codex-usage-playwright.mjs",
  antigravity: "scripts/update-antigravity-usage-auto.mjs",
};

function usage() {
  return [
    "Usage:",
    "  node scripts/run-usage-data-update.mjs switcher",
    "  node scripts/run-usage-data-update.mjs playwright --ensure-cdp --close-cdp",
    "  node scripts/run-usage-data-update.mjs antigravity",
    "",
    "Runs the selected updater inside a dedicated usage-data worktree,",
    "so automated JSON commits never land on the Vercel production branch.",
  ].join("\n");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });

  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} falhou: ${detail || \`exit \${result.status}\`}`);
  }
  return result;
}

function git(args, options = {}) {
  return run("git", args, options);
}

async function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function updateStateAndAlert() {
  const codexPath = resolve(dataWorktree, "codex_usage.json");
  const antigravityPath = resolve(dataWorktree, "antigravity_usage.json");

  const codex = await readJson(codexPath, null);
  const antigravity = await readJson(antigravityPath, null);
  const lastStatus = await readJson(statusPath, { codex: {}, antigravity: {} });

  let alertText = "";
  const significantThreshold = 5;

  if (codex && codex.weeklyPercent !== null) {
    const lastPercent = lastStatus.codex.weeklyPercent;
    if (lastPercent !== undefined && lastPercent !== null) {
      const diff = lastPercent - codex.weeklyPercent;
      if (Math.abs(diff) >= significantThreshold) {
        alertText += `Codex: \${lastPercent}% -> \${codex.weeklyPercent}%\n`;
      }
    }
    lastStatus.codex.weeklyPercent = codex.weeklyPercent;
    lastStatus.codex.lastUpdated = codex.lastUpdated;
  }

  if (antigravity && Array.isArray(antigravity.models)) {
    lastStatus.antigravity.models = lastStatus.antigravity.models || {};
    for (const model of antigravity.models) {
      const lastModel = lastStatus.antigravity.models[model.id];
      if (lastModel && lastModel.remainingPercent !== undefined) {
        const diff = lastModel.remainingPercent - model.remainingPercent;
        if (Math.abs(diff) >= significantThreshold) {
          alertText += `Antigravity \${model.name}: \${lastModel.remainingPercent}% -> \${model.remainingPercent}%\n`;
        }
      }
      lastStatus.antigravity.models[model.id] = {
        name: model.name,
        remainingPercent: model.remainingPercent
      };
    }
    lastStatus.antigravity.lastUpdated = antigravity.lastUpdated;
  }

  if (alertText) {
    console.log("Significant changes detected:\n" + alertText);
  }

  await writeFile(statusPath, JSON.stringify(lastStatus, null, 2) + "\n");
  
  git(["add", "last_status.json"]);
  const diff = git(["diff", "--cached", "--quiet"], { allowFailure: true });
  if (diff.status === 1) {
    git(["commit", "-m", "chore: update last_status.json [skip ci]"]);
  }
}

async function pushDispatchConfig() {
  const config = {
    url: process.env.PUSH_DISPATCH_URL || "",
    secret: process.env.PUSH_DISPATCH_SECRET || "",
  };
  const envPath = resolve(root, ".local/push-dispatch.env");
  if ((!config.url || !config.secret) && existsSync(envPath)) {
    const source = await readFile(envPath, "utf8");
    for (const line of source.split(/\\r?\\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      if (match[1] === "PUSH_DISPATCH_URL" && !config.url) config.url = match[2];
      if (match[1] === "PUSH_DISPATCH_SECRET" && !config.secret) config.secret = match[2];
    }
  }
  return config;
}

async function dispatchPushNotifications() {
  const config = await pushDispatchConfig();
  if (!config.url || !config.secret) {
    console.log("Web Push dispatch ignorado: configuração local ausente.");
    return;
  }
  const usage = JSON.parse(await readFile(resolve(dataWorktree, "codex_usage.json"), "utf8"));
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${config.secret}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usage }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(\`Web Push dispatch falhou (\${response.status}): \${payload.error || "erro desconhecido"}\`);
  }
  console.log(\`Web Push: \${payload.sent || 0} enviados para \${payload.subscriptions || 0} subscriptions.\`);
}

function remoteDataBranchExists() {
  return git(["show-ref", "--verify", "--quiet", \`refs/remotes/origin/\${dataBranch}\`], {
    allowFailure: true,
  }).status === 0;
}

async function assertVercelDataBranchGuard() {
  const config = JSON.parse(await readFile(resolve(dataWorktree, "webapp/vercel.json"), "utf8"));
  if (config?.git?.deploymentEnabled?.[dataBranch] !== false) {
    throw new Error(\`webapp/vercel.json precisa desativar deployments Git para a branch \${dataBranch}.\`);
  }
}

async function ensureDataWorktree() {
  await mkdir(resolve(root, ".local"), { recursive: true });
  git(["fetch", "origin", "main"]);
  git(["fetch", "origin", \`\${dataBranch}:refs/remotes/origin/\${dataBranch}\`], { allowFailure: true });

  const hasRemoteDataBranch = remoteDataBranchExists();
  if (!existsSync(resolve(dataWorktree, ".git"))) {
    git(["worktree", "prune"]);
    if (hasRemoteDataBranch) {
      git(["worktree", "add", "--force", "-B", dataBranch, dataWorktree, \`origin/\${dataBranch}\`]);
    } else {
      git(["worktree", "add", "-b", dataBranch, dataWorktree, "origin/main"]);
    }
  } else {
    const currentBranch = git(["branch", "--show-current"], { cwd: dataWorktree }).stdout.trim();
    if (currentBranch !== dataBranch) {
      throw new Error(\`Worktree de dados está na branch \${currentBranch || "<detached>"}, esperado \${dataBranch}.\`);
    }
    if (hasRemoteDataBranch) {
      git(["pull", "--ff-only", "origin", dataBranch], { cwd: dataWorktree });
    }
  }

  git(["merge", "--no-edit", "origin/main"], { cwd: dataWorktree });
  await assertVercelDataBranchGuard();
  git(["push", "--set-upstream", "origin", \`HEAD:refs/heads/\${dataBranch}\`], { cwd: dataWorktree });
}

async function main() {
  const [mode, ...updaterArgs] = process.argv.slice(2);
  if (!mode || mode === "--help" || mode === "help" || !modes[mode]) {
    console.log(usage());
    if (!mode || mode === "--help" || mode === "help") return;
    process.exitCode = 1;
    return;
  }

  await ensureDataWorktree();

  const updater = resolve(dataWorktree, modes[mode]);
  const result = run(process.execPath, [updater, ...updaterArgs, "--commit", "--push"], {
    cwd: dataWorktree,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);

  // Track state and prepare alerts after updater succeeds
  await updateStateAndAlert();

  // Also publish a main -> usage-data merge when the updater skipped unchanged data.
  git(["push", "origin", \`HEAD:refs/heads/\${dataBranch}\`], { cwd: dataWorktree });
  await dispatchPushNotifications();
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
