// `fleet doctor`: what to check before a fleet launches, so members do not find it out one by one. Each check is
// `ok`, `warn` (the fleet can run, but someone should know) or `fail` (fix it first). The worst one seen in a real run:
// a worktree with no `.env` and a task runner that drops the variables, where the API tests skipped themselves and
// were reported green.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentNameOf } from "./board-init.mjs";
import { commandLine } from "./harness.mjs";
import { versionNote, PLUGIN_VERSION } from "./plan.mjs";

const git = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
};

/** The variable names an env file sets (`KEY=…`, `export KEY=…`), comments and blanks skipped. */
export function envKeys(text) {
  return [...String(text).matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
}

/** The env files git ignores in a checkout: what a fresh worktree will not have. */
export function ignoredEnvFiles(dir) {
  const { ok, out } = git(dir, "ls-files", "--others", "--ignored", "--exclude-standard");
  if (!ok) return [];
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && !f.includes("node_modules/") && /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template)$/.test(f));
}

/** The variables turbo passes to tasks (strict mode), from turbo.json; `undefined` when turbo is not used or is loose. */
export function turboEnv(dir) {
  const file = path.join(dir, "turbo.json");
  if (!fs.existsSync(file)) return undefined;
  let config;
  try {
    // turbo.json may carry comments.
    config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
  } catch {
    return undefined;
  }
  if (config.envMode === "loose") return undefined;
  const tasks = Object.values(config.tasks ?? config.pipeline ?? {});
  return [config.globalEnv, config.globalPassThroughEnv, ...tasks.flatMap((t) => [t?.env, t?.passThroughEnv])].flat().filter((x) => typeof x === "string" && !x.startsWith("!"));
}

/** Whether a variable is among turbo's declared names; a trailing `*` matches a prefix. */
const declared = (name, list) => list.some((p) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : p === name));

/**
 * Every check, in the order a lead fixes them. `probe(port)` says what answers on a port: "free", "ours" (this
 * fleet's dashboard) or "other".
 */
export async function doctor(fleet, { fleetDir, probe, now = new Date() }) {
  const checks = [];
  const add = (name, state, detail) => checks.push({ name, state, detail });
  const dir = fleet.repo.dir;

  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 22 ? "ok" : "fail", `Node ${process.versions.node}${major >= 22 ? "" : ": the fleet CLI and dashboard need 22 or later"}`);

  const note = versionNote(fleet);
  add("plugin", note ? "warn" : "ok", note ?? `agent-fleet ${PLUGIN_VERSION}${fleet.plugin?.version && fleet.plugin.version !== PLUGIN_VERSION ? ` (the fleet was written by ${fleet.plugin.version})` : ""}`);

  const left = Math.round((Date.parse(fleet.mission.endAt) - now.getTime()) / 60_000);
  add("time", left > 0 ? "ok" : "warn", left > 0 ? `${Math.floor(left / 60)} h ${left % 60} min left, until ${new Date(fleet.mission.endAt).toLocaleString()}` : `the fleet ended at ${new Date(fleet.mission.endAt).toLocaleString()}: extend it with /agent-fleet:extend first`);

  if (!git(dir, "rev-parse", "--show-toplevel").ok) {
    add("git", "fail", `${dir} is not a git repository: members commit on branches and worktrees`);
  } else {
    const base = fleet.repo.base;
    const baseOk = git(dir, "rev-parse", "--verify", "--quiet", `${base}^{commit}`).ok;
    add("base branch", baseOk ? "ok" : "fail", baseOk ? base : `${base} does not exist`);
    const dirty = git(dir, "status", "--porcelain").out.split("\n").filter(Boolean);
    add("working tree", dirty.length === 0 ? "ok" : "warn", dirty.length === 0 ? "clean" : `${dirty.length} uncommitted change(s) in the main checkout: worktrees start from the last commit, without them`);
    if (fleet.repo.integration) {
      const exists = git(dir, "rev-parse", "--verify", "--quiet", `${fleet.repo.integration}^{commit}`).ok;
      add("integration branch", "ok", `${fleet.repo.integration}${exists ? "" : " (not created yet: the lead creates it from the base)"}`);
    }
    const worktrees = fleet.agents.some((a) => a.worktree);
    const envFiles = worktrees ? ignoredEnvFiles(dir) : [];
    if (worktrees) {
      add(
        "env files",
        envFiles.length === 0 ? "ok" : "warn",
        envFiles.length === 0
          ? "no git-ignored .env file: worktrees get what the tests need from git"
          : `worktrees will not have ${envFiles.join(", ")} (git ignores them): copy them into each worktree before running tests, or tests that need them skip themselves and still pass`,
      );
    }
    const turbo = turboEnv(dir);
    if (turbo !== undefined) {
      const keys = [...new Set(envFiles.flatMap((f) => envKeys(fs.readFileSync(path.join(dir, f), "utf8"))))];
      const dropped = keys.filter((k) => !declared(k, turbo));
      add(
        "turbo env",
        dropped.length === 0 ? "ok" : "warn",
        dropped.length === 0
          ? "turbo passes the env files' variables to tasks"
          : `turbo runs tasks in strict env mode and drops ${dropped.join(", ")}: declare them in turbo.json (globalPassThroughEnv, or the test task's passThroughEnv), or tests run without them`,
      );
    }
  }

  const board = fleet.board.dir;
  const missingBriefs = fleet.agents.filter((a) => !fs.existsSync(path.join(board, "briefs", `${a.id}.md`))).map((a) => a.id);
  add("briefs", missingBriefs.length === 0 ? "ok" : "fail", missingBriefs.length === 0 ? `${fleet.agents.length} briefs` : `no brief for ${missingBriefs.join(", ")}: run fleet init again`);
  const subagents = fleet.agents.filter((a) => a.launch === "subagent");
  if (subagents.length > 0) {
    const missing = subagents.filter((a) => !fs.existsSync(path.join(dir, ".claude", "agents", `${agentNameOf(fleet, a)}.md`))).map((a) => a.id);
    add("subagents", missing.length === 0 ? "ok" : "fail", missing.length === 0 ? `${subagents.length} agents installed in .claude/agents` : `not installed: ${missing.join(", ")}: run fleet init again`);
  }
  if (fleet.agents.some((a) => a.launch === "headless")) {
    const claude = spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32", windowsHide: true });
    add("claude CLI", claude.status === 0 ? "ok" : "fail", claude.status === 0 ? (claude.stdout ?? "").trim() : "headless members need `claude` on the PATH");
  }
  // Members in other agent CLIs: each CLI must run here, and its profile should have passed a live check.
  for (const id of [...new Set(fleet.agents.filter((a) => a.launch === "runner").map((a) => a.harness))]) {
    const profile = fleet.harnesses?.[id];
    if (profile === undefined) {
      add(`${id} harness`, "fail", `no profile in fleet.json: research it with the onboard-harness skill and run fleet init again`);
      continue;
    }
    const win = process.platform === "win32";
    const checkArgs = profile.check ?? ["--version"];
    const r = spawnSync(win ? commandLine(profile.command, checkArgs) : profile.command, win ? [] : checkArgs, { encoding: "utf8", shell: win, windowsHide: true, timeout: 30_000 });
    const members = fleet.agents.filter((a) => a.harness === id).map((a) => a.id).join(", ");
    if (r.status !== 0) add(`${id} harness`, "fail", `${profile.command} does not run here (${members} need it): install it and sign in`);
    else add(`${id} harness`, profile.verified ? "ok" : "warn", `${(r.stdout ?? "").trim().split(/\r?\n/)[0]} for ${members}${profile.verified ? `; profile checked ${profile.verified.at.slice(0, 10)}` : `; the profile was never proven here: run \`fleet harness check ${id} --live\`, then fleet init again`}`);
  }
  const home = path.dirname(fleetDir);
  const current = fs.existsSync(path.join(home, "current")) ? fs.readFileSync(path.join(home, "current"), "utf8").trim() : "";
  if (current !== fleet.mission.slug) add("current fleet", "warn", `the current fleet is "${current || "none"}", not "${fleet.mission.slug}": fleet commands without --fleet act on that one`);

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(path.join(fleetDir, "dashboard.json"), "utf8")).port;
  } catch {
    saved = undefined;
  }
  const port = saved ?? fleet.port ?? 4600;
  const seen = await probe(port);
  add("dashboard port", seen === "other" ? "warn" : "ok", seen === "ours" ? `${port}: this fleet's dashboard runs there` : seen === "free" ? `${port} is free` : `${port} is taken by something else: the dashboard will take the next free port`);

  add("token limit", "ok", fleet.budget?.outputTokens ? `${Math.round(fleet.budget.outputTokens / 1000)}k output tokens, then ${fleet.budget.onLimit}` : "none set (tokens are only measured)");
  return checks;
}
