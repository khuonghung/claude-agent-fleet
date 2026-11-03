// Members that run in another agent CLI (Codex CLI, Copilot CLI, Gemini CLI, …) instead of Claude Code. No CLI is
// built in: each is described by a profile — how to start a turn, resume it, pass the model and effort, run unattended,
// reach the board, find the session id and the output tokens — that the `onboard-harness` skill researches with the
// user and `fleet harness check --live` proves. A runner (`fleet run <member>`) then drives the member turn by turn:
// those CLIs exit when a turn ends and have no SendMessage, so the runner is their doorbell — it wakes the member with
// its inbox and tickets when the board changes — and writes each turn as a transcript the dashboard reads.
//
// Profiles live in `<repo>/.fleet/harnesses/<id>.json` (researched here, kept across fleets); the plugin ships starting
// points in `assets/harnesses/`. A plan copies the profiles its members use into `fleet.json`, so a fleet keeps working
// when a profile file changes later.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Not plan.mjs's: plan.mjs reads profiles through this module.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CLAUDE = "claude";
const ID = /^[a-z][a-z0-9-]{0,39}$/;
/** The values a profile's arguments may name, as `{name}`. */
export const PLACEHOLDERS = ["model", "effort", "sessionId", "boardDir", "cwd", "name", "prompt"];

const dirsOf = (repoDir) => [
  { source: "project", dir: path.join(repoDir, ".fleet", "harnesses") },
  { source: "plugin", dir: path.join(PLUGIN_ROOT, "assets", "harnesses") },
];

/** Every profile within reach: the project's first, then the plugin's starting points (a project one of the same id wins). */
export function listHarnesses(repoDir) {
  const seen = new Map();
  for (const { source, dir } of dirsOf(repoDir)) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      const id = f.replace(/\.json$/, "");
      if (seen.has(id)) continue;
      try {
        const profile = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        seen.set(id, { id, title: profile.title ?? id, source, file: path.join(dir, f), verified: profile.verified ?? null, profile });
      } catch (error) {
        seen.set(id, { id, title: id, source, file: path.join(dir, f), error: error.message });
      }
    }
  }
  return [...seen.values()];
}

/** One profile by id (or a path to a profile file); undefined when there is none. */
export function loadHarness(idOrFile, repoDir) {
  if (/[\\/]|\.json$/.test(idOrFile) && fs.existsSync(idOrFile)) return { ...JSON.parse(fs.readFileSync(idOrFile, "utf8")), file: path.resolve(idOrFile) };
  const hit = listHarnesses(repoDir).find((h) => h.id === idOrFile && h.profile);
  return hit ? { ...hit.profile, source: hit.source, file: hit.file } : undefined;
}

const placeholdersIn = (args) => args.flat().flatMap((a) => [...String(a).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

/** What is wrong with a profile, as sentences; empty when it can be used. */
export function profileProblems(p) {
  const problems = [];
  if (!ID.test(p?.id ?? "")) problems.push("id must be lowercase kebab-case");
  if (p?.id === CLAUDE) problems.push(`"${CLAUDE}" is Claude Code itself, which needs no profile`);
  if (!p?.command || typeof p.command !== "string") problems.push("command is required: the program to run (codex, copilot, gemini…)");
  for (const key of ["run", "resume"]) {
    if (!Array.isArray(p?.[key])) problems.push(`${key} must be an array of arguments (an inner array is a group dropped when one of its values is empty)`);
    else if (p[key].some((a) => !(typeof a === "string" || (Array.isArray(a) && a.every((b) => typeof b === "string"))))) problems.push(`${key}: each argument is a string or an array of strings`);
  }
  const prompt = p?.prompt ?? "stdin";
  if (!["stdin", "arg"].includes(prompt)) problems.push('prompt must be "stdin" or "arg"');
  const args = [...(Array.isArray(p?.run) ? p.run : []), ...(Array.isArray(p?.resume) ? p.resume : [])];
  for (const name of placeholdersIn(args)) if (!PLACEHOLDERS.includes(name)) problems.push(`{${name}} is not a value the runner knows (${PLACEHOLDERS.map((n) => `{${n}}`).join(", ")})`);
  if (prompt === "arg" && !placeholdersIn(p.run ?? []).includes("prompt")) problems.push('prompt "arg" needs {prompt} in run and resume');
  if (Array.isArray(p?.resume) && !placeholdersIn(p.resume).includes("sessionId")) problems.push("resume must name {sessionId}: the turns of a member are one session");
  const sid = p?.sessionId;
  if (sid !== "set" && typeof sid?.key !== "string") problems.push('sessionId must be "set" (the runner chooses it and passes {sessionId} to run) or { "key": "<field>" } (read from the output)');
  if (sid === "set" && Array.isArray(p?.run) && !placeholdersIn(p.run).includes("sessionId")) problems.push('sessionId "set" needs {sessionId} in run');
  if (!["jsonl", "json", "text"].includes(p?.output ?? "text")) problems.push('output must be "jsonl", "json" or "text"');
  if (typeof sid?.key === "string" && (p?.output ?? "text") === "text") problems.push("a session id read from the output needs output jsonl or json");
  if (p?.usage !== undefined && typeof p.usage.output !== "string") problems.push('usage.output is the dotted path of the output tokens in the matched line (e.g. "usage.output_tokens")');
  if (p?.efforts !== undefined && (typeof p.efforts !== "object" || Array.isArray(p.efforts))) problems.push("efforts maps the fleet's efforts (low … max) to the CLI's, null where it has none");
  return problems;
}

/**
 * A profile's arguments with the values filled in. An inner array is a group — a flag and its value — dropped whole when
 * one of its values is empty, so a member without a model simply gets the CLI's default.
 */
export function argsOf(template, values) {
  const fillOne = (arg) => {
    let empty = false;
    const text = String(arg).replace(/\{(\w+)\}/g, (_, name) => {
      const v = values[name];
      if (v === undefined || v === null || v === "") empty = true;
      return v ?? "";
    });
    return { text, empty };
  };
  return template.flatMap((arg) => {
    if (Array.isArray(arg)) {
      const parts = arg.map(fillOne);
      return parts.some((p) => p.empty) ? [] : parts.map((p) => p.text);
    }
    const one = fillOne(arg);
    return one.empty && /\{\w+\}/.test(arg) && one.text === "" ? [] : [one.text];
  });
}

/** The model and effort a member passes to its CLI: Claude's aliases mean nothing there, so they become the CLI's default. */
export function valuesOf(profile, agent) {
  const model = agent.model && agent.model !== "inherit" && !/^(opus|sonnet|haiku)$/.test(agent.model) ? agent.model : (profile.model ?? "");
  const effort = profile.efforts ? (profile.efforts[agent.effort] ?? "") : agent.effort;
  return { model, effort };
}

const get = (o, dotted) => String(dotted).split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);
const matches = (o, match = {}) => Object.entries(match).every(([k, v]) => get(o, k) === v);
/** The first value of a field anywhere in an object, at any depth. */
function findKey(o, key, depth = 0) {
  if (o === null || typeof o !== "object" || depth > 6) return undefined;
  if (typeof o[key] === "string" && o[key]) return o[key];
  for (const v of Object.values(o)) {
    const hit = findKey(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** The JSON objects in a CLI's output: one per line (jsonl), the whole output (json), none (text). */
export function eventsOf(text, output = "jsonl") {
  if (output === "text") return [];
  if (output === "json") {
    try {
      return [JSON.parse(text)];
    } catch {
      // A JSON object after some banner lines: from its first brace.
      try {
        return [JSON.parse(text.slice(text.indexOf("{")))];
      } catch {
        return [];
      }
    }
  }
  return String(text)
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim().startsWith("{")) return [];
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/**
 * What one turn told us, from its output (and, for usage, the file the profile names): the session id, the output
 * tokens (as the CLI reports them — per turn, or for the whole session when `usage.cumulative`), the reply, and the
 * event types seen, which `fleet harness check` prints to help write a profile.
 */
export function readTurn(profile, stdout, { usageText } = {}) {
  const output = profile.output ?? "text";
  const events = eventsOf(stdout, output);
  const sessionId = typeof profile.sessionId?.key === "string" ? events.map((e) => findKey(e, profile.sessionId.key)).find(Boolean) : undefined;
  let outputTokens;
  if (profile.usage) {
    const source = usageText === undefined ? events : eventsOf(usageText, "jsonl");
    const hits = source.filter((e) => matches(e, profile.usage.match)).map((e) => Number(get(e, profile.usage.output))).filter(Number.isFinite);
    // Per turn: every matching line is one model call or one turn, summed. Cumulative: the last one is the session's total.
    if (hits.length) outputTokens = profile.usage.cumulative ? hits[hits.length - 1] : hits.reduce((a, b) => a + b, 0);
  }
  let reply = "";
  if (profile.reply) {
    const texts = events.filter((e) => matches(e, profile.reply.match)).map((e) => get(e, profile.reply.text)).filter((t) => typeof t === "string" && t.trim());
    reply = texts[texts.length - 1] ?? "";
  } else if (output === "text") reply = String(stdout).trim().slice(-2000);
  const types = [...new Set(events.map((e) => e.type ?? e.event ?? e.kind).filter(Boolean))];
  return { sessionId, outputTokens, reply, types, events: events.length };
}

/** A path from a profile (`~` is the home folder; {sessionId} and the like filled in). */
export const expandPath = (template, values) => argsOf([template], values)[0]?.replace(/^~(?=[\\/]|$)/, os.homedir());

/** A transcript line in Claude Code's shape, so the dashboard reads a runner's turns as it reads a session. */
export function transcriptLines({ turn, at, end, prompt, reply, outputTokens, model, failed }) {
  const lines = [{ type: "user", timestamp: at, message: { role: "user", content: String(prompt).slice(0, 4000) } }];
  if (end) {
    lines.push({
      type: "assistant",
      timestamp: end,
      message: { id: `turn-${turn}`, model: model || "", usage: { output_tokens: outputTokens ?? 0 }, content: reply || failed ? [{ type: "text", text: failed ? `(turn failed: ${failed})` : reply }] : [], stop_reason: "end_turn" },
    });
  }
  return lines;
}

const SHELL_SPECIAL = /[\s()&|<>^"]/;
/** A command and its arguments as one line for the Windows shell. */
export const commandLine = (command, args) => [command, ...args].map((a) => (a === "" || SHELL_SPECIAL.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)).join(" ");
/**
 * Runs one turn of a CLI: the prompt on stdin (a multi-line argument does not survive the Windows shell that starts a
 * `.cmd` shim), stdout kept for reading, both streams copied to the member's log. Resolves when the process exits.
 */
export function runTurn(profile, args, { cwd, prompt, env = {}, log, onSpawn } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    // Windows starts a CLI's .cmd shim through the shell, as one command line with each argument quoted where needed.
    const child = spawn(win ? commandLine(profile.command, args) : profile.command, win ? [] : args, {
      cwd,
      env: { ...process.env, ...(profile.env ?? {}), ...env },
      shell: win,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      log?.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      log?.write(d);
    });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end((profile.prompt ?? "stdin") === "stdin" ? prompt : "");
  });
}

/** Ends a process and what it started (a CLI behind a shell on Windows). */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
}
