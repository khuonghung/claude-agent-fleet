// Agent Fleet server: collects board, git, transcripts and port probes, and streams the fleet state
// to the dashboard over Server-Sent Events. No dependencies beyond Node.
//
//   node scripts/server/index.mjs <.fleet/<slug>/fleet.json>
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
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

const state = {
  rev: 0,
  startedAt: new Date().toISOString(),
  mission: cfg.mission,
  budget: cfg.budget ?? {},
  launch: cfg.launch ?? "session",
  squads: cfg.squads,
  agents: cfg.agents.map(({ match, ...a }) => a),
  flow: cfg.board,
  board: null,
  git: null,
  telemetry: {},
  probes: [],
  transitions: [],
  history: history.points(),
};
let dirty = true;
const lastStatus = new Map();

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
const transcripts = createTranscripts(cfg, { sessionNames });

async function refreshBoard() {
  const board = await readBoard(cfg);
  const now = new Date().toISOString();
  for (const t of board.tickets) {
    const prev = lastStatus.get(t.id);
    if (prev === undefined && state.board) state.transitions.push({ id: t.id, from: null, to: t.status, at: now });
    else if (prev !== undefined && prev !== t.status) state.transitions.push({ id: t.id, from: prev, to: t.status, at: now });
    lastStatus.set(t.id, t.status);
  }
  if (state.transitions.length > 300) state.transitions.splice(0, state.transitions.length - 300);
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

async function refreshTranscripts() {
  if (await transcripts.poll()) {
    state.telemetry = transcripts.snapshot();
    dirty = true;
  }
}

// Board: watch the folder, debounce bursts; also re-read every 20 s in case a watch event is lost.
let boardTimer = null;
const scheduleBoard = () => {
  clearTimeout(boardTimer);
  boardTimer = setTimeout(() => refreshBoard().catch(() => {}), 350);
};
try {
  fs.watch(cfg.board.dir, { recursive: true }, scheduleBoard);
} catch {
  // No recursive watch on this platform: the interval below still refreshes.
}

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
    if (clients.size === 1) Promise.all([refreshGit(), refreshProbes()]).catch(() => {});
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
setTimeout(() => every(60000, sampleHistory), 5000);

server.listen(port, "127.0.0.1", () => console.log(`Agent Fleet control room: http://localhost:${port} (${path.basename(cfgFile)})`));
