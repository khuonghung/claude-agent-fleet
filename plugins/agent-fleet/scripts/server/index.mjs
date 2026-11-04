// Agent Fleet server: collects board, git, transcripts, port probes, the integration plan and the pre-flight checks,
// and streams the fleet state to the dashboard over Server-Sent Events. No dependencies beyond Node.
//
//   node scripts/server/index.mjs <.fleet/<slug>/fleet.json>
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { currentEfforts } from "../lib/effort.mjs";
import { PLUGIN_ROOT, readFleet } from "../lib/plan.mjs";
import { readBoard, readBoardDoc } from "./board.mjs";
import { readGit } from "./git.mjs";
import { createHistory } from "./history.mjs";
import { createTranscripts, redactHome } from "./transcripts.mjs";

/** What leaves the server: the account's home folder shows as ~ (the dashboard is often on a shared screen). */
const out = (value) => redactHome(JSON.stringify(value));

if (process.argv[2] === undefined) {
  console.error("usage: node scripts/server/index.mjs <fleet.json>");
  process.exit(1);
}
const cfgFile = path.resolve(process.argv[2]);
const cfg = readFleet(cfgFile);
const port = Number(process.env.PORT ?? cfg.port ?? 4600);
const dist = path.join(PLUGIN_ROOT, "assets", "dashboard");
const history = createHistory(path.join(path.dirname(cfgFile), "history.json"));

/** The parts of the state that come straight from fleet.json. */
const planState = () => ({
  mission: cfg.mission,
  budget: cfg.budget ?? {},
  launch: cfg.launch ?? "session",
  autoEffort: cfg.autoEffort === true,
  squads: cfg.squads,
  agents: cfg.agents.map(({ match, ...a }) => a),
  flow: cfg.board,
});

const state = {
  rev: 0,
  startedAt: new Date().toISOString(),
  ...planState(),
  board: null,
  git: null,
  telemetry: {},
  efforts: {},
  probes: [],
  integration: null,
  doctor: null,
  transitions: [],
  history: history.points(),
};
let dirty = true;

// Status moves are what the board does not keep: they are saved beside the history, so a restart keeps each ticket's
// time in its stage, and a move made while the server was down is still recorded (at the ticket file's last change).
const movesFile = path.join(path.dirname(cfgFile), "transitions.json");
const lastStatus = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(movesFile, "utf8"));
  for (const [id, status] of Object.entries(saved.statuses ?? {})) lastStatus.set(id, status);
  state.transitions = Array.isArray(saved.transitions) ? saved.transitions : [];
} catch {
  // First run, or an unreadable file: moves are recorded from now on.
}
const saveMoves = () => {
  try {
    fs.writeFileSync(movesFile, JSON.stringify({ statuses: Object.fromEntries(lastStatus), transitions: state.transitions }));
  } catch {
    // A read-only disk only costs the moves across restarts.
  }
};

/** The agent id behind a session id, an agent id or a session title (as messages address them). */
const sessionNames = (id) => {
  const key = String(id ?? "").trim();
  const hit = Object.entries(state.board?.roster ?? {}).find(([, r]) => r.sessionId && r.sessionId === key);
  if (hit) return hit[0];
  const agent = cfg.agents.find(
    (a) => a.id === key || (a.match.title && key.startsWith(a.match.title)) || (a.match.sessionId && key === a.match.sessionId) || (a.match.aliases ?? []).includes(key),
  );
  if (agent) return agent.id;
  if (key.startsWith("uds:")) return "peer";
  return /^local_/.test(key) ? null : key.split(/\s+/)[0] || null;
};
const transcripts = createTranscripts(cfg, { sessionNames, fleetDir: path.dirname(cfgFile) });

async function refreshBoard() {
  const board = await readBoard(cfg);
  const now = new Date().toISOString();
  // On the first read of a run, what changed since the saved statuses happened while the server was down.
  const first = state.board === null;
  const known = !first || lastStatus.size > 0;
  let moved = false;
  for (const t of board.tickets) {
    const prev = lastStatus.get(t.id);
    if (prev === undefined ? known : prev !== t.status) {
      state.transitions.push({ id: t.id, from: prev ?? null, to: t.status, at: !first ? now : prev === undefined ? t.created : t.updated });
      moved = true;
    }
    lastStatus.set(t.id, t.status);
  }
  if (state.transitions.length > 1000) state.transitions.splice(0, state.transitions.length - 1000);
  if (moved || first) saveMoves();
  state.board = board;
  dirty = true;
}

// Git and the port probes only matter to someone watching: with no client they keep their last reading.
async function refreshGit() {
  if (!state.board || (clients.size === 0 && state.git)) return;
  const next = await readGit(cfg, state.board.roster);
  if (JSON.stringify(next) !== JSON.stringify(state.git)) {
    state.git = next;
    dirty = true;
  }
}

const probe = (p) =>
  new Promise((done) => {
    const socket = net.connect({ port: p.port, host: "127.0.0.1" });
    const finish = (up) => {
      socket.destroy();
      done({ ...p, up });
    };
    socket.setTimeout(800, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

async function refreshProbes() {
  if (clients.size === 0 && state.probes.length) return;
  const next = await Promise.all((cfg.probes ?? []).map(probe));
  if (JSON.stringify(next) !== JSON.stringify(state.probes)) {
    state.probes = next;
    dirty = true;
  }
}

/**
 * Runs a read-only fleet CLI command as a child process and parses its JSON: `fleet integrate` makes a git call per
 * ticket, and `fleet doctor` probes git and the ports, which must not stall the stream. A refusal comes back as
 * `{ error }` (no integration branch yet, say), so the page can say why.
 */
const cli = (...args) =>
  new Promise((done) => {
    execFile(process.execPath, [path.join(PLUGIN_ROOT, "scripts", "fleet.mjs"), ...args, "--json", "--fleet", path.dirname(cfgFile)], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      try {
        done(JSON.parse(stdout));
      } catch {
        done({ error: (stderr || error?.message || "no answer").trim().split("\n").filter((l) => !l.startsWith("warning:")).join(" ").slice(0, 400) });
      }
    });
  });

async function refreshIntegration() {
  if (clients.size === 0 && state.integration) return;
  const next = { ...(await cli("integrate")), at: new Date().toISOString() };
  const { at, ...rest } = next;
  const { at: _, ...prev } = state.integration ?? {};
  if (JSON.stringify(rest) !== JSON.stringify(prev)) {
    state.integration = next;
    dirty = true;
  }
}

async function refreshDoctor() {
  if (clients.size === 0 && state.doctor) return;
  const next = await cli("doctor");
  state.doctor = { ...next, at: new Date().toISOString() };
  dirty = true;
}

async function refreshTranscripts() {
  if (await transcripts.poll()) {
    state.telemetry = transcripts.snapshot();
    dirty = true;
  }
  refreshEfforts();
}

/** The effort each member runs at now (auto effort: the lead records each switch), beside the planned one. */
function refreshEfforts() {
  const efforts = currentEfforts(cfg, path.dirname(cfgFile));
  if (JSON.stringify(efforts) === JSON.stringify(state.efforts)) return;
  state.efforts = efforts;
  dirty = true;
}

// Board: watch the folder, debounce bursts; also re-read every 20 s in case a watch event is lost.
let boardTimer = null;
const scheduleBoard = () => {
  clearTimeout(boardTimer);
  boardTimer = setTimeout(() => refreshBoard().catch(() => {}), 350);
};
let boardWatch = null;
const watchBoard = () => {
  boardWatch?.close();
  boardWatch = null;
  try {
    boardWatch = fs.watch(cfg.board.dir, { recursive: true }, scheduleBoard).on("error", () => {});
  } catch {
    // No recursive watch on this platform (or no folder yet): the interval below still refreshes.
  }
};
watchBoard();

// fleet.json: re-read when it changes (a member added or renamed, `fleet spawn` recording a session id, the window or
// the limit moved). The board, git and transcript readers hold `cfg` itself, so it is updated in place. A file caught
// mid-write does not parse and is skipped: the write that completes it changes it again. The port stays as it is.
let cfgText = fs.readFileSync(cfgFile, "utf8");
async function reloadFleet() {
  const text = fs.readFileSync(cfgFile, "utf8");
  if (text === cfgText) return;
  let next;
  try {
    next = readFleet(cfgFile);
    if (!Array.isArray(next.agents) || !next.board?.dir || !next.mission?.startAt) throw new Error("not a fleet plan");
  } catch (error) {
    console.error(`fleet.json not reloaded: ${error.message}`);
    return;
  }
  cfgText = text;
  const boardMoved = path.resolve(next.board.dir) !== path.resolve(cfg.board.dir);
  for (const key of Object.keys(cfg)) delete cfg[key];
  Object.assign(cfg, next);
  Object.assign(state, planState());
  // Every member of the new plan has its telemetry slot at once (empty until its transcript is found).
  state.telemetry = transcripts.snapshot();
  if (boardMoved) {
    watchBoard();
    lastStatus.clear();
    state.board = null;
    state.transitions = [];
    saveMoves();
  }
  await refreshBoard();
  await transcripts.discover();
  state.telemetry = transcripts.snapshot();
  dirty = true;
  await Promise.all([refreshGit(), refreshProbes()]);
  console.log(`fleet.json reloaded: ${cfg.agents.length} members`);
}
let fleetTimer = null;
// Polled rather than watched: an editor that saves by replacing the file would end a plain watch.
fs.watchFile(cfgFile, { interval: 1000 }, (cur, prev) => {
  if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
  clearTimeout(fleetTimer);
  fleetTimer = setTimeout(() => reloadFleet().catch(() => {}), 300);
});

/** One point a minute: ticket counts by stage, active agents, tool calls and tokens so far. */
async function sampleHistory() {
  const tickets = state.board?.tickets ?? [];
  const now = Date.now();
  const byStatus = {};
  for (const t of tickets) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const tele = Object.values(state.telemetry).filter(Boolean);
  const point = {
    at: new Date(now).toISOString(),
    created: tickets.length,
    done: tickets.filter((t) => ["fixed", "integrated", "verified"].includes(t.status)).length,
    verified: byStatus.verified ?? 0,
    open: tickets.filter((t) => !["fixed", "integrated", "verified", "deferred", "wont-fix", "duplicate"].includes(t.status)).length,
    byStatus,
    activeAgents: tele.filter((t) => t.lastAt && now - Date.parse(t.lastAt) < 90_000).length,
    toolCalls: tele.reduce((n, t) => n + t.toolCalls, 0),
    outputTokens: tele.reduce((n, t) => n + t.outputTokens, 0),
  };
  state.history = history.sample(point);
  dirty = true;
}

const every = (ms, fn) => {
  const tick = () => fn().catch(() => {}).finally(() => setTimeout(tick, ms));
  tick();
};

// A client gets the whole state when it connects, then at most once a second a patch with only the parts that
// changed: the top-level keys, and the members' telemetry one member at a time (the board alone is ~300 kB).
const clients = new Set();
const sent = new Map(); // part -> the JSON last sent for it
function patchOf() {
  const patch = {};
  let changed = false;
  for (const [key, value] of Object.entries(state)) {
    if (key === "rev" || key === "serverTime") continue;
    const parts = key === "telemetry" ? Object.entries(value).map(([id, t]) => [`telemetry/${id}`, t, id]) : [[key, value]];
    for (const [part, v, id] of parts) {
      const json = JSON.stringify(v ?? null);
      if (sent.get(part) === json) continue;
      sent.set(part, json);
      changed = true;
      if (id === undefined) patch[key] = v;
      else (patch.telemetry ??= {})[id] = v;
    }
  }
  return changed ? patch : null;
}
/** Sends what changed to the connected clients; with none connected, keeps it for later. */
function flush() {
  if (!dirty || clients.size === 0) return;
  dirty = false;
  const patch = patchOf();
  if (!patch) return;
  state.rev += 1;
  state.serverTime = new Date().toISOString();
  const data = `event: patch\ndata: ${out({ rev: state.rev, serverTime: state.serverTime, patch })}\n\n`;
  for (const res of clients) res.write(data);
}
setInterval(flush, 1000);
// A ping when nothing changed: patches only flow on changes, and the page reads silence as a lost link.
setInterval(() => {
  for (const res of clients) res.write(`event: ping\ndata: ${Date.now()}\n\n`);
}, 15000);

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // Bring the others up to date first, so that what was sent matches what this client starts from.
    flush();
    if (clients.size === 0) {
      sent.clear();
      patchOf();
      dirty = false;
    }
    res.write(`data: ${out({ ...state, serverTime: new Date().toISOString() })}\n\n`);
    clients.add(res);
    if (clients.size === 1) Promise.all([refreshGit(), refreshProbes(), refreshIntegration(), refreshDoctor()]).catch(() => {});
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/api/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(out({ ...state, serverTime: new Date().toISOString() }));
    return;
  }
  const doc = /^\/api\/doc\/(ticket|report|board|thread)\/([^/]+)$/.exec(url.pathname);
  if (doc) {
    const text = await readBoardDoc(cfg, doc[1], decodeURIComponent(doc[2]));
    res.writeHead(text === null ? 404 : 200, { "content-type": "text/markdown; charset=utf-8" });
    res.end(text === null ? "Not found" : redactHome(text));
    return;
  }
  // Static files of the built control room; unknown paths get the app.
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  let file = path.join(dist, rel);
  const inside = path.relative(dist, file);
  if (inside.startsWith("..") || path.isAbsolute(inside) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("The dashboard is not built: run `pnpm build` in the plugin folder.");
    return;
  }
  // Built assets carry a content hash in their names; the page itself must always be fresh.
  const cache = path.relative(dist, file).startsWith(`assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": cache });
  fs.createReadStream(file).pipe(res);
});

await refreshBoard();
await transcripts.discover();
every(20000, refreshBoard);
every(30000, () => transcripts.discover());
every(1500, refreshTranscripts);
every(10000, refreshGit);
every(10000, refreshProbes);
every(30000, refreshIntegration);
every(120000, refreshDoctor);
setTimeout(() => every(60000, sampleHistory), 5000);

server.listen(port, "127.0.0.1", () => console.log(`Agent Fleet control room: http://localhost:${port} (${path.basename(cfgFile)})`));
