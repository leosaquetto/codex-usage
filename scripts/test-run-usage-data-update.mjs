import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { ensureDataWorktree, publishDataBranch, runDataUpdate } from "./run-usage-data-update.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture(t, { remoteData = true, guard = true } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "usage-sync-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origin = resolve(directory, "origin.git");
  const repo = resolve(directory, "repo");
  git(directory, "init", "--bare", origin);
  git(directory, "init", "-b", "main", repo);
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.hooksPath", "/dev/null");
  git(repo, "remote", "add", "origin", origin);
  // Production is a main-only clone; the wrapper must fetch data explicitly.
  git(repo, "config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main");
  await mkdir(resolve(repo, "webapp"));
  await mkdir(resolve(repo, "scripts"));
  await writeFile(resolve(repo, ".gitignore"), ".local/\n");
  await writeFile(resolve(repo, "webapp/vercel.json"), JSON.stringify({ git: { deploymentEnabled: { "usage-data": !guard } } }));
  // Synthetic updater: no accounts, credentials, quota source or network.
  await writeFile(resolve(repo, "scripts/update-codex-usage-from-switcher.mjs"), `
    import { writeFileSync } from "node:fs";
    import { spawnSync } from "node:child_process";
    const args = process.argv.slice(2);
    if (args.includes("--push")) throw new Error("Updater must not push");
    if (!args.includes("--commit")) throw new Error("Missing commit");
    if (args.includes("--fixture-fail")) process.exit(2);
    if (args.includes("--fixture-update")) {
      writeFileSync("fixture-data.txt", "synthetic update");
      for (const command of [["add", "fixture-data.txt"], ["commit", "-m", "Fixture data"]]) {
        if (spawnSync("git", command, { stdio: "ignore" }).status !== 0) process.exit(3);
      }
    }
  `);
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Fixture main");
  git(repo, "push", "origin", "main");
  if (remoteData) git(repo, "push", "origin", "HEAD:refs/heads/usage-data");
  return { directory, repo, origin, worktree: resolve(repo, ".local/usage-data-worktree") };
}

async function commitFile(repo, name, value) {
  await writeFile(resolve(repo, name), value);
  git(repo, "add", name);
  git(repo, "commit", "-m", `Fixture ${name}`);
  return git(repo, "rev-parse", "HEAD");
}

async function peer(f) {
  const other = resolve(f.directory, "peer");
  git(f.directory, "clone", "-b", "usage-data", f.origin, other);
  git(other, "config", "user.name", "Fixture");
  git(other, "config", "user.email", "fixture@example.invalid");
  git(other, "config", "commit.gpgsign", "false");
  git(other, "config", "core.hooksPath", "/dev/null");
  return other;
}

async function traced(f, action) {
  const trace = resolve(f.directory, "trace.log");
  await writeFile(trace, "");
  const previous = process.env.GIT_TRACE;
  process.env.GIT_TRACE = trace;
  let value;
  try { value = await action(); } finally {
    if (previous === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = previous;
  }
  const lines = await readFile(trace, "utf8");
  return {
    value,
    fetches: (lines.match(/built-in: git fetch /g) || []).length,
    pushes: (lines.match(/built-in: git push /g) || []).length,
    pulls: (lines.match(/built-in: git pull /g) || []).length,
  };
}

test("bootstrap pushes once; unchanged cycle fetches once and never pushes", async (t) => {
  const f = await fixture(t, { remoteData: false });
  let dispatches = 0;
  const options = { repositoryRoot: f.repo, dispatch: async () => { dispatches += 1; } };
  const first = await traced(f, () => runDataUpdate("switcher", [], options));
  assert.deepEqual([first.fetches, first.pushes, first.pulls], [1, 1, 0]);
  assert.equal(first.value.pushed, true);
  const second = await traced(f, () => runDataUpdate("switcher", [], options));
  assert.deepEqual([second.fetches, second.pushes, second.pulls], [1, 0, 0]);
  assert.equal(second.value.pushed, false);
  assert.equal(dispatches, 2);
});

test("one push includes main advancement and data update; updater cannot push", async (t) => {
  const f = await fixture(t);
  await ensureDataWorktree(f.repo);
  const main = await commitFile(f.repo, "new-main.txt", "new main");
  git(f.repo, "push", "origin", "main");
  const result = await traced(f, () => runDataUpdate("switcher", ["--fixture-update", "--push"], { repositoryRoot: f.repo, dispatch: async () => {} }));
  assert.deepEqual([result.fetches, result.pushes, result.pulls], [1, 1, 0]);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), git(f.worktree, "rev-parse", "HEAD"));
  git(f.worktree, "merge-base", "--is-ancestor", main, "HEAD");
});

test("main advancement is published even when data does not change", async (t) => {
  const f = await fixture(t);
  await ensureDataWorktree(f.repo);
  const main = await commitFile(f.repo, "new-main.txt", "new main");
  git(f.repo, "push", "origin", "main");
  const result = await runDataUpdate("switcher", [], { repositoryRoot: f.repo, dispatch: async () => {} });
  assert.equal(result.pushed, true);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), main);
});

test("remote data is fast-forwarded without another push", async (t) => {
  const f = await fixture(t);
  await ensureDataWorktree(f.repo);
  const other = await peer(f);
  const remote = await commitFile(other, "remote-data.txt", "remote data");
  git(other, "push", "origin", "usage-data");
  const result = await runDataUpdate("switcher", [], { repositoryRoot: f.repo, dispatch: async () => {} });
  assert.equal(result.pushed, false);
  assert.equal(git(f.worktree, "rev-parse", "HEAD"), remote);
});

test("existing local usage-data branch is preserved and its pending commit published", async (t) => {
  const f = await fixture(t);
  git(f.repo, "checkout", "-b", "usage-data");
  const pending = await commitFile(f.repo, "pending-data.txt", "pending");
  git(f.repo, "checkout", "main");
  const result = await runDataUpdate("switcher", [], { repositoryRoot: f.repo, dispatch: async () => {} });
  assert.equal(result.pushed, true);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), pending);
});

test("divergent local and remote data branches fail closed, preserving local commit", async (t) => {
  const f = await fixture(t);
  await ensureDataWorktree(f.repo);
  const pending = await commitFile(f.worktree, "local-data.txt", "local");
  const other = await peer(f);
  const remote = await commitFile(other, "remote-data.txt", "remote");
  git(other, "push", "origin", "usage-data");
  await assert.rejects(ensureDataWorktree(f.repo), /ff-only/);
  assert.equal(git(f.worktree, "rev-parse", "HEAD"), pending);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), remote);
});

test("remote advancement between fetch and push is rejected without overwrite", async (t) => {
  const f = await fixture(t);
  await ensureDataWorktree(f.repo);
  await commitFile(f.worktree, "local-data.txt", "local");
  const other = await peer(f);
  const remote = await commitFile(other, "remote-data.txt", "remote");
  git(other, "push", "origin", "usage-data");
  await assert.rejects(publishDataBranch(f.worktree), /push/);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), remote);
});

test("deployment guard blocks before updater or publication", async (t) => {
  const f = await fixture(t, { guard: false });
  const before = git(f.origin, "rev-parse", "usage-data");
  await assert.rejects(runDataUpdate("switcher", ["--fixture-update"], { repositoryRoot: f.repo, dispatch: async () => assert.fail("must not dispatch") }), /desativar deployments/);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), before);
});

test("failed updater neither publishes nor dispatches", async (t) => {
  const f = await fixture(t);
  const before = git(f.origin, "rev-parse", "usage-data");
  await commitFile(f.repo, "new-main.txt", "unpublished main merge");
  git(f.repo, "push", "origin", "main");
  await assert.rejects(runDataUpdate("switcher", ["--fixture-fail"], { repositoryRoot: f.repo, dispatch: async () => assert.fail("must not dispatch") }), /exit 2/);
  assert.equal(git(f.origin, "rev-parse", "usage-data"), before);
});
