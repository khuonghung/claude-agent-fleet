// The transcript collector: follows each agent's Claude Code session log (.jsonl) incrementally
// and turns it into live telemetry: what the agent is doing now, what it said last, tokens, tool mix.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sessionsOf } from "../lib/sessions.mjs";

const RECENT = 60;
const BUCKET_MIN = 5;

/**
 * The user's home folder as it shows up in commands and paths — `C:\Users\me`, `C:/Users/me`, `/c/Users/me`,
 * `/home/me` — so the dashboard (often on a shared screen) shows `~` instead of the account name.
 */
const HOME = (() => {
  const home = os.homedir();
  if (!home || home.length < 4) return null;
  const forward = home.replaceAll("\\", "/");
  const msys = forward.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  const forms = [...new Set([home, forward, msys])].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\\|\//g, "[\\\\/]+"));
  // Claude Code's transcript folders spell the same path with every other character as "-" (C--Users-me-…).
  const dashed = home.replace(/[^A-Za-z0-9]/g, "-").replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(?:${forms.join("|")})(?=$|[\\\\/\\s"'\`])|${dashed}(?=$|-)`, "gi");
})();
export const redactHome = (text) => (HOME ? String(text).replace(HOME, "~") : String(text));

function short(s, n = 140) {
  const one = redactHome(String(s ?? "").replace(/\s+/g, " ").trim());
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function summarizeTool(name, input = {}, nameOfSession) {
  const base = (p) => (p ? String(p).split(/[\\/]/).slice(-2).join("/") : "");
  switch (name) {
    case "Bash":
    case "PowerShell":
      return short(input.description || input.command);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return base(input.file_path);
    case "Grep":
    case "Glob":
      return short(`${input.pattern ?? ""}${input.path ? ` in ${base(input.path)}` : ""}`);
    case "SendMessage":
      return short(`→ ${nameOfSession(input.to) ?? input.to}: ${input.summary || input.message || ""}`);
    case "Agent":
      return short(input.description || input.prompt);
    case "Monitor":
      return short(input.description || input.command || "waiting");
    default:
      if (name.startsWith("mcp__")) {
        const tool = name.split("__").slice(-1)[0];
        const hint = input.action_summary || input.action || input.url || input.query || input.text || "";
        return short(`${tool}${hint ? ` · ${hint}` : ""}`);
      }
      return short(JSON.stringify(input));
  }
}

function emptyStats() {
  return {
    file: "",
    sessionId: "",
    model: "",
    firstAt: null,
    lastAt: null,
    phase: "unknown", // tool | thinking | replied | prompt
    pendingTool: null, // {name, summary, at}
    toolCalls: 0,
    toolMix: {},
    prompts: 0,
    messages: 0,
    outputTokens: 0,
    processedTokens: 0,
    contextTokens: 0,
    lastText: "",
    lastTextAt: null,
    recent: [],
    buckets: {},
    tokenBuckets: {},
    messagesTo: {},
  };
}

/**
 * Follows the transcripts of the configured agents. A member may have several — a desktop session cleared to save
 * tokens starts a new one — and its telemetry sums them, oldest first, so its live state is its newest. `fleetDir` is
 * where the hook records each member's sessions (`sessions/<id>.jsonl`).
 */
export function createTranscripts(cfg, { sessionNames, fleetDir }) {
  const byAgent = new Map(); // agent id -> {stats, files: [{file, offset, partial}]}
  // `cfg` is read at each use, not captured: the server updates it in place when fleet.json changes.
  const bucketOf = (iso) => {
    const minutes = Math.floor((Date.parse(iso) - Date.parse(cfg.mission.startAt)) / 60000);
    return minutes < 0 ? null : Math.floor(minutes / BUCKET_MIN);
  };

  const push = (s, item) => {
    s.recent.push(item);
    if (s.recent.length > RECENT) s.recent.splice(0, s.recent.length - RECENT);
  };

  const readText = () => cfg.privacy?.readText !== false;
  /** Per member: the output tokens already counted for each model message id. */
  const usageSeen = new WeakMap();

  function ingest(s, o) {
    const at = o.timestamp ?? null;
    if (at) {
      s.firstAt ??= at;
      if (!s.lastAt || at > s.lastAt) s.lastAt = at;
    }
    if (o.type === "assistant" && o.message) {
      const m = o.message;
      if (m.model && !m.model.startsWith("<")) s.model = m.model;
      // Claude Code writes one line per content block of a model message, each repeating the message's usage: a
      // message's tokens count once, by its id (the largest output count seen for it, as a streamed one grows).
      const u = m.usage ?? {};
      const seen = usageSeen.get(s) ?? new Map();
      usageSeen.set(s, seen);
      const id = m.id ?? `${at}-${s.toolCalls}`;
      const before = seen.get(id);
      const output = u.output_tokens ?? 0;
      const delta = Math.max(0, output - (before ?? 0));
      if (before === undefined) {
        s.messages += 1;
        const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        s.processedTokens += ctx;
        if (ctx) s.contextTokens = ctx;
      }
      seen.set(id, Math.max(before ?? 0, output));
      s.outputTokens += delta;
      const tb = at ? bucketOf(at) : null;
      if (tb !== null && delta) s.tokenBuckets[tb] = (s.tokenBuckets[tb] ?? 0) + delta;
      for (const c of m.content ?? []) {
        if (c.type === "tool_use") {
          const summary = summarizeTool(c.name, c.input, sessionNames);
          s.toolCalls += 1;
          s.toolMix[c.name] = (s.toolMix[c.name] ?? 0) + 1;
          s.pendingTool = { name: c.name, summary, at };
          s.phase = "tool";
          if (c.name === "SendMessage" && c.input?.to) {
            const to = sessionNames(c.input.to) ?? String(c.input.to);
            s.messagesTo[to] = (s.messagesTo[to] ?? 0) + 1;
          }
          const b = at ? bucketOf(at) : null;
          if (b !== null) s.buckets[b] = (s.buckets[b] ?? 0) + 1;
          push(s, { at, kind: "tool", tool: c.name, summary });
        } else if (readText() && c.type === "text" && c.text?.trim()) {
          s.lastText = short(c.text, 320);
          s.lastTextAt = at;
          push(s, { at, kind: "text", summary: short(c.text, 200) });
        }
      }
      if (m.stop_reason === "end_turn") {
        s.phase = "replied";
        s.pendingTool = null;
      }
    } else if (o.type === "user" && o.message) {
      const content = o.message.content;
      const isResult = Array.isArray(content) && content.some((c) => c?.type === "tool_result");
      if (isResult) {
        s.pendingTool = null;
        s.phase = "thinking";
      } else {
        const raw = typeof content === "string" ? content : (content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join(" ");
        const from = /<cross-session-message from="[^"]*"\s+from-name="([^"]*)"/.exec(raw)?.[1];
        // What the agent was asked, without the harness's reminder blocks.
        const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ").replace(/<[^>]+>/g, " ").trim();
        if (text && !o.isMeta && !/^\[?(Request interrupted|SYSTEM NOTIFICATION)/.test(text)) {
          s.prompts += 1;
          s.phase = "prompt";
          push(s, { at, kind: "prompt", summary: readText() ? short(from ? `✉ ${sessionNames(from) ?? from}: ${text}` : text, 200) : from ? `✉ ${sessionNames(from) ?? from}` : "" });
        }
      }
    } else if (o.type === "api-request") {
      if (s.phase !== "tool") s.phase = "thinking";
    }
  }

  async function discover() {
    let dirs = [];
    try {
      dirs = (await fs.readdir(cfg.transcripts.root, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name.startsWith(cfg.transcripts.dirPrefix))
        .map((d) => path.join(cfg.transcripts.root, d.name));
    } catch {
      return;
    }
    const candidates = [];
    const since = Math.min(Date.parse(cfg.mission.startAt), Date.now()) - 6 * 3600 * 1000;
    const add = async (file, extra) => {
      try {
        const stat = await fs.stat(file);
        if (stat.mtimeMs < since) return;
        candidates.push({ file, mtime: stat.mtimeMs, size: stat.size, ...extra });
      } catch {
        // Gone between readdir and stat.
      }
    };
    for (const dir of dirs) {
      let entries = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          await add(path.join(dir, entry.name), { sessionId: entry.name.replace(/\.jsonl$/, "") });
        } else if (entry.isDirectory()) {
          // A session's subagents (Agent tool, workflows): <session>/subagents/agent-*.jsonl with a .meta.json beside each.
          const sub = path.join(dir, entry.name, "subagents");
          let files = [];
          try {
            files = (await fs.readdir(sub)).filter((f) => f.endsWith(".jsonl"));
          } catch {
            continue;
          }
          for (const f of files) {
            let meta = {};
            try {
              meta = JSON.parse(await fs.readFile(path.join(sub, f.replace(/\.jsonl$/, ".meta.json")), "utf8"));
            } catch {
              // No meta: matched by its file only.
            }
            await add(path.join(sub, f), { sessionId: f.replace(/\.jsonl$/, ""), parentSession: entry.name, subagent: true, description: meta.description ?? "", agentType: meta.agentType ?? "" });
          }
        }
      }
    }
    // A member in another agent CLI: its runner writes each turn to `runner/<id>.jsonl` in the same shape.
    const runnerFile = (agent) => (fleetDir ? path.join(fleetDir, "runner", `${agent.id}.jsonl`) : undefined);
    for (const agent of cfg.agents.filter((a) => a.launch === "runner" && runnerFile(a))) await add(runnerFile(agent), { sessionId: `runner-${agent.id}` });
    const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const recorded = fleetDir ? sessionsOf(fleetDir) : {};
    // A member taken out of the plan is no longer followed.
    for (const id of byAgent.keys()) if (!cfg.agents.some((a) => a.id === id)) byAgent.delete(id);
    for (const agent of cfg.agents) {
      const m = agent.match ?? {};
      const mine = recorded[agent.id] ?? [];
      const hits = [];
      for (const c of candidates) {
        if (agent.launch === "runner") {
          if (same(c.file, runnerFile(agent))) hits.push(c);
          continue;
        }
        let hit = mine.some((r) => (r.transcriptPath && same(c.file, r.transcriptPath)) || (r.sessionId && !c.subagent && c.sessionId === r.sessionId));
        if (hit) {
          // Recorded by the hook: this member's, whatever its title.
        } else if (m.transcript) hit = same(c.file, m.transcript);
        else if (m.sessionId && c.sessionId === m.sessionId) hit = true;
        else if (c.subagent) hit = Boolean(m.description) && (c.description === m.description || c.description.startsWith(`${m.description} `));
        else if (m.title && !m.sessionId) {
          c.title ??= await titleOf(c.file, c.size);
          hit = c.title?.startsWith(m.title) ?? false;
        }
        if (hit) hits.push(c);
      }
      if (hits.length === 0) continue;
      hits.sort((a, b) => a.mtime - b.mtime);
      const cur = byAgent.get(agent.id);
      const files = hits.map((c) => c.file);
      // A transcript more (or less) than before: read them all again, oldest first, so the sums and the live state hold.
      if (cur?.files.length !== files.length || cur.files.some((f) => !files.includes(f.file))) {
        const best = hits[hits.length - 1];
        byAgent.set(agent.id, { files: files.map((file) => ({ file, offset: 0, partial: "" })), stats: { ...emptyStats(), file: best.file, sessionId: best.sessionId, kind: best.subagent ? "subagent" : "session" } });
      }
    }
  }

  /** Session titles by transcript file: a title is read once per file and size, not on every discovery. */
  const titles = new Map();

  async function titleOf(file, size) {
    const cached = titles.get(file);
    if (cached !== undefined && (cached.title !== null || cached.size === size)) return cached.title;
    const title = await readTitle(file, size);
    titles.set(file, { size, title });
    return title;
  }

  async function readTitle(file, size) {
    const fh = await fs.open(file, "r");
    try {
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const text = buf.toString("utf8");
      const all = [...text.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)];
      return all.length ? JSON.parse(`"${all[all.length - 1][1]}"`) : null;
    } finally {
      await fh.close();
    }
  }

  /** Reads what each transcript gained since the last call; true when anything changed. */
  async function poll() {
    let changed = false;
    for (const t of [...byAgent.values()].flatMap((entry) => entry.files.map((f) => Object.assign(f, { stats: entry.stats })))) {
      let size;
      try {
        size = (await fs.stat(t.file)).size;
      } catch {
        continue;
      }
      if (size <= t.offset) continue;
      const fh = await fs.open(t.file, "r");
      try {
        const len = size - t.offset;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, t.offset);
        t.offset = size;
        const text = t.partial + buf.toString("utf8");
        const lines = text.split("\n");
        t.partial = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            ingest(t.stats, JSON.parse(line));
          } catch {
            // A line we cannot read; skip it.
          }
        }
        changed = true;
      } finally {
        await fh.close();
      }
    }
    return changed;
  }

  function snapshot() {
    const out = {};
    for (const agent of cfg.agents) {
      const t = byAgent.get(agent.id);
      out[agent.id] = t ? t.stats : null;
    }
    return out;
  }

  return { discover, poll, snapshot };
}
