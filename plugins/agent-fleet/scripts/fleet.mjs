#!/usr/bin/env node
// The agent-fleet CLI: what the plugin's commands run. Node only, no dependencies.
//
//   fleet catalog                     the roles, models and efforts a plan can use (JSON)
//   fleet validate <plan.json>        checks a plan and prints it completed
//   fleet estimate [plan.json]        output tokens per member and in total, from measured rates, and a budget
//   fleet init <plan.json>            writes .fleet/<slug>/ (fleet.json, board, briefs, one agent per member) and makes it current
//   fleet add <member.json> [--dry-run] adds one member (or an array) to the running fleet; prints what to launch for it
//   fleet launch-plan                 what to start for each member (JSON), for /agent-fleet:launch
//   fleet brief <member>              prints a member's brief
//   fleet roster <member> <key=value> records a member's session id, worktree or branch in ROSTER.md
//   fleet say <member> <kind> <text>  posts one line to the team channel (kind: heads-up, ask, answer, fyi)
//   fleet dashboard [--port N] [--json] starts the dashboard for the current fleet (or says where it runs) and prints its URL
//   fleet stop                        stops the dashboard
//   fleet status [--json]             tickets, members, time left and output tokens against the limit
//   fleet spawn <member>              starts a member as a headless `claude -p` process (launch: headless)

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { CHANNEL_HEAD, launchPlan, writeAgents, writeBoard } from "./lib/board-init.mjs";
import { estimateFleet, memberEstimate } from "./lib/estimate.mjs";
import { addToPlan, budgetState, catalog, modelId, normalizePlan, PLUGIN_ROOT, readFleet } from "./lib/plan.mjs";
import { normStatus } from "./server/board.mjs";
import { createTranscripts } from "./server/transcripts.mjs";

const [command, ...args] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const out = (value) => process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** The nearest `.fleet` folder from the working directory up (a member's worktree finds the main checkout's). */
function fleetHome(from = process.cwd()) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".fleet"))) return path.join(dir, ".fleet");
    if (path.dirname(dir) === dir) return undefined;
  }
}

function currentFleetFile() {
  const explicit = flag("fleet");
  if (explicit !== undefined) return fs.statSync(explicit).isDirectory() ? path.join(explicit, "fleet.json") : path.resolve(explicit);
  const home = fleetHome();
  const slug = home && fs.existsSync(path.join(home, "current")) ? fs.readFileSync(path.join(home, "current"), "utf8").trim() : undefined;
  if (home === undefined || slug === undefined) fail("No fleet here: plan one with /agent-fleet:new (or pass --fleet <dir>).");
  return path.join(home, slug, "fleet.json");
}

const leadOf = () => {
  const home = fleetHome();
  try {
    return home === undefined ? undefined : JSON.parse(fs.readFileSync(path.join(home, "lead.json"), "utf8"));
  } catch {
    return undefined;
  }
};

const hhmm = (at = new Date()) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

/** Posts one line to the team channel: the clock's time, one append per post, so posts at the same moment never erase each other. */
function post(fleet, id, kind, text) {
  const file = path.join(fleet.board.dir, "CHANNEL.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, CHANNEL_HEAD);
  const line = `- ${hhmm()} ${id} · ${kind}: ${text}
`;
  fs.appendFileSync(file, line);
  return line.trimEnd();
}

const answers = (port) =>
  new Promise((done) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(600, () => (socket.destroy(), done(false)));
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
  });

switch (command) {
  case "catalog":
    out(catalog);
    break;

  case "validate":
  case "init": {
    const file = args.find((a) => !a.startsWith("--"));
    if (file === undefined) fail(`usage: fleet ${command} <plan.json>`);
    let plan;
    try {
      plan = normalizePlan(JSON.parse(fs.readFileSync(file, "utf8")), { lead: leadOf() });
    } catch (error) {
      fail(error.message);
    }
    if (command === "validate") {
      out(plan);
      break;
    }
    // The base branch's commit now: the dashboard warns when it moves (nobody but the owner merges into it).
    plan.repo.baseline ??= await new Promise((done) => {
      const git = spawn("git", ["-C", plan.repo.dir, "rev-parse", "--short=8", plan.repo.base], { windowsHide: true });
      let text = "";
      git.stdout.on("data", (chunk) => (text += chunk));
      git.on("close", () => done(text.trim() || undefined));
      git.on("error", () => done(undefined));
    });
    const written = writeBoard(plan);
    // One agent definition per member, specialised from the plan (role duties + specialty, area, model, effort, window).
    const agents = writeAgents(plan);
    // The fleet's working files stay out of git without touching the project's .gitignore.
    const exclude = path.join(plan.repo.dir, ".git", "info", "exclude");
    if (fs.existsSync(path.dirname(exclude))) {
      const have = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8").split(/\r?\n/).map((line) => line.trim()) : [];
      const missing = [".fleet/", ".claude/agents/fleet-*"].filter((pattern) => !have.includes(pattern));
      if (missing.length > 0) fs.appendFileSync(exclude, `\n# agent-fleet working files\n${missing.join("\n")}\n`);
    }
    out({ ...written, agentsDir: agents.dir, installedAgents: agents.installed, slug: plan.mission.slug, members: plan.agents.length, startAt: plan.mission.startAt, endAt: plan.mission.endAt });
    break;
  }

  case "add": {
    const fleetFile = currentFleetFile();
    const fleet = readFleet(fleetFile);
    const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--fleet");
    if (file === undefined) fail("usage: fleet add <member.json> [--dry-run]  (one member object, or an array of them)");
    let result;
    try {
      result = addToPlan(fleet, JSON.parse(fs.readFileSync(file, "utf8")), { lead: leadOf() });
    } catch (error) {
      fail(error.message);
    }
    const { plan, added, warnings } = result;
    const estimate = added.map((a) => memberEstimate(plan, a));
    if (args.includes("--dry-run")) {
      out({ members: added, warnings, estimate });
      break;
    }
    // The fleet keeps its folder and whether it is the current one; the dashboard re-reads fleet.json by itself.
    writeBoard(plan, { makeCurrent: false });
    writeAgents(plan);
    const leadId = plan.agents.find((a) => a.launch === "self")?.id ?? "owner";
    for (const a of added) {
      const boss = a.reportsTo === undefined ? "" : `, reports to ${a.reportsTo}`;
      const area = a.owns.length > 0 ? `, owns ${a.owns.join(", ")}` : "";
      fs.appendFileSync(path.join(plan.board.dir, "NOTICES.md"), `- ${hhmm()} ${leadId}: ${a.id} (${a.title}) joined the fleet${boss}${area}.
`);
      post(plan, leadId, "heads-up", `${a.id} (${a.title}) joined the fleet${boss}${area}. Brief: briefs/${a.id}.md`);
    }
    const ids = new Set(added.map((a) => a.id));
    out({ added: [...ids], warnings, estimate, launch: launchPlan(plan).filter((entry) => ids.has(entry.id)) });
    break;
  }

  case "estimate": {
    const file = args.find((a) => !a.startsWith("--"));
    let fleet;
    try {
      fleet = file === undefined ? readFleet(currentFleetFile()) : normalizePlan(JSON.parse(fs.readFileSync(file, "utf8")), { lead: leadOf() });
    } catch (error) {
      fail(error.message);
    }
    const estimate = estimateFleet(fleet);
    if (args.includes("--json")) {
      out(estimate);
      break;
    }
    const k = (n) => `${Math.round(n / 1000)}k`;
    const name = (model) => (model === "inherit" ? "Inherit (session)" : catalog.models[model]?.name ?? model);
    out(
      [
        `Estimated output tokens for ${fleet.agents.length} members (rates measured ${estimate.basis}):`,
        ...estimate.members.map((m) => {
          const a = fleet.agents.find((x) => x.id === m.id);
          return `  ${m.id.padEnd(16)} ${name(a.model).padEnd(18)} ${m.effort.padEnd(6)} ${String(m.hours).padStart(5)} h  ~${k(m.perHour)}/active h  ${k(m.low)}–${k(m.high)}`;
        }),
        `  total: expected ${k(estimate.total.expected)}, range ${k(estimate.total.low)}–${k(estimate.total.high)}; suggested budget ${k(estimate.suggestedBudget)}`,
      ].join("\n"),
    );
    break;
  }

  case "launch-plan":
    out(launchPlan(readFleet(currentFleetFile())));
    break;

  case "brief": {
    const fleet = readFleet(currentFleetFile());
    const id = args[0];
    if (!fleet.agents.some((a) => a.id === id)) fail(`No member ${id}; members: ${fleet.agents.map((a) => a.id).join(", ")}`);
    out(fs.readFileSync(path.join(fleet.board.dir, "briefs", `${id}.md`), "utf8"));
    break;
  }

  case "roster": {
    const fleet = readFleet(currentFleetFile());
    // `--fleet <dir>` may come anywhere: the rest is the member and its key=value pairs.
    const [id, ...pairs] = args.filter((a, i) => a !== "--fleet" && args[i - 1] !== "--fleet");
    const file = path.join(fleet.board.dir, "ROSTER.md");
    const columns = { session: 3, worktree: 4, branch: 5 };
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => {
      const cells = line.split("|");
      if (cells[1]?.trim() !== id) return line;
      for (const pair of pairs) {
        const [key, ...rest] = pair.split("=");
        const at = columns[key];
        if (at !== undefined) cells[at] = ` ${rest.join("=")} `;
      }
      return cells.join("|");
    });
    fs.writeFileSync(file, lines.join("\n"));
    out(`roster: ${id} updated`);
    break;
  }

  case "say": {
    const fleet = readFleet(currentFleetFile());
    const [id, kind, ...words] = args.filter((a, i) => a !== "--fleet" && args[i - 1] !== "--fleet");
    const kinds = ["heads-up", "ask", "answer", "fyi"];
    if (id !== "owner" && !fleet.agents.some((a) => a.id === id)) fail(`No member ${id}; members: ${fleet.agents.map((a) => a.id).join(", ")} (or owner)`);
    if (!kinds.includes(kind)) fail(`usage: fleet say <member> <${kinds.join(" | ")}> <text>`);
    // One line, whatever the shell passed: the channel is read a line at a time.
    const text = words.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
    if (text === "") fail("say what? the text is empty");
    out(post(fleet, id, kind, text));
    break;
  }

  case "dashboard": {
    const fleetFile = currentFleetFile();
    const fleet = readFleet(fleetFile);
    const stateFile = path.join(path.dirname(fleetFile), "dashboard.json");
    // The dashboard of this fleet may already run; another fleet's (or anything else) on the port means the next free one.
    // Plain http with no kept-alive socket: fetch leaves one open, and exiting with it crashes Node on Windows.
    const ours = (p) =>
      new Promise((done) => {
        const req = http.get({ host: "127.0.0.1", port: p, path: "/api/state", agent: false, timeout: 1500 }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              done(JSON.parse(body)?.mission?.slug === fleet.mission.slug);
            } catch {
              done(false);
            }
          });
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => done(false));
      });
    // The URL goes on a line of its own, nothing glued to it, so a terminal (or Claude's reply) makes it a link;
    // `--json` keeps the machine form.
    const report = (result) => {
      if (args.includes("--json")) return out(result);
      const stop = `node "${path.join(PLUGIN_ROOT, "scripts", "fleet.mjs").replaceAll("\\", "/")}" stop`;
      out(
        [
          `Agent Fleet dashboard for "${fleet.mission.name}":`,
          "",
          `  ${result.url}`,
          "",
          result.reused ? "It was already running." : result.running ? `Started (pid ${result.pid}).` : `Started (pid ${result.pid}), but it does not answer yet: see ${path.join(path.dirname(fleetFile), "dashboard.log")}.`,
          ...(result.port !== wanted ? [`Port ${wanted} was taken, so it runs on ${result.port}.`] : []),
          `Stop it with: ${stop}`,
        ].join("\n"),
      );
    };
    const wanted = Number(flag("port", fleet.port ?? 4600));
    let port = wanted;
    let reused = false;
    for (let tries = 0; tries < 20 && (await answers(port)); tries++) {
      if ((reused = await ours(port))) break;
      port += 1;
    }
    if (reused) {
      report({ url: `http://localhost:${port}`, port, running: true, reused: true });
      break;
    }
    const log = fs.openSync(path.join(path.dirname(fleetFile), "dashboard.log"), "a");
    const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, "scripts", "server", "index.mjs"), fleetFile], {
      env: { ...process.env, PORT: String(port) },
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    child.unref();
    for (let i = 0; i < 40 && !(await answers(port)); i++) await new Promise((r) => setTimeout(r, 150));
    fs.writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port, url: `http://localhost:${port}`, startedAt: new Date().toISOString() }, null, 2));
    report({ url: `http://localhost:${port}`, port, running: await answers(port), pid: child.pid, reused: false });
    break;
  }

  case "stop": {
    const fleetFile = currentFleetFile();
    const stateFile = path.join(path.dirname(fleetFile), "dashboard.json");
    try {
      const { pid } = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      process.kill(pid);
      fs.rmSync(stateFile);
      out(`dashboard ${pid} stopped`);
    } catch {
      out("no dashboard of this fleet is running");
    }
    break;
  }

  case "status": {
    const fleet = readFleet(currentFleetFile());
    const ticketsDir = path.join(fleet.board.dir, "tickets");
    const tickets = fs.existsSync(ticketsDir) ? fs.readdirSync(ticketsDir).filter((f) => f.endsWith(".md")) : [];
    const statuses = {};
    for (const file of tickets) {
      // Read as the dashboard reads it: "In progress" is in-progress, not "In".
      const status = normStatus(/^[ \t]*-[ \t]*Status:[ \t]*(.*)$/im.exec(fs.readFileSync(path.join(ticketsDir, file), "utf8"))?.[1] ?? "");
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    const left = Math.max(0, Math.round((Date.parse(fleet.mission.endAt) - Date.now()) / 60_000));
    // Output tokens read from the members' transcripts, the way the dashboard counts them (each message once).
    const transcripts = createTranscripts(fleet, { sessionNames: (id) => id });
    await transcripts.discover();
    await transcripts.poll();
    const used = Object.values(transcripts.snapshot()).reduce((n, t) => n + (t?.outputTokens ?? 0), 0);
    const budget = budgetState(fleet.budget, used);
    const status = { mission: fleet.mission.name, goal: fleet.mission.goal, minutesLeft: left, members: fleet.agents.length, tickets: tickets.length, statuses, budget };
    const k = (n) => `${Math.round(n / 1000)}k`;
    const tokens = budget.state === "none" ? `${k(used)} output tokens (no limit)` : `${k(used)} / ${k(budget.limit)} output tokens (${Math.round(budget.share * 100)}%, ${budget.state}; at the limit: ${budget.onLimit})`;
    if (args.includes("--json")) out(status);
    else out(`${status.mission}: ${left} min left · ${status.members} members · ${status.tickets} tickets · ${Object.entries(statuses).map(([key, v]) => `${key} ${v}`).join(", ") || "none yet"} · ${tokens}`);
    break;
  }

  case "spawn": {
    const fleetFile = currentFleetFile();
    const fleet = readFleet(fleetFile);
    const agent = fleet.agents.find((a) => a.id === args[0]);
    if (agent === undefined) fail(`No member ${args[0]}`);
    const brief = fs.readFileSync(path.join(fleet.board.dir, "briefs", `${agent.id}.md`), "utf8");
    const logDir = path.join(path.dirname(fleetFile), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, `${agent.id}.log`), "a");
    // A session id chosen here names the transcript file, so the dashboard finds it without guessing.
    const sessionId = randomUUID();
    // The brief goes in on stdin: a multi-line argument does not survive the Windows shell that starts claude.cmd.
    const cliArgs = [
      "-p",
      "--name",
      agent.match.title,
      "--session-id",
      sessionId,
      "--effort",
      agent.effort,
      ...(modelId(agent.model) ? ["--model", modelId(agent.model)] : []),
      ...(agent.worktree ? ["--worktree", `${fleet.mission.slug}-${agent.id}`.slice(0, 40)] : []),
      ...(flag("permission-mode") === undefined ? [] : ["--permission-mode", flag("permission-mode")]),
    ];
    const child = spawn("claude", cliArgs.map((a) => (process.platform === "win32" && /\s/.test(a) ? `"${a}"` : a)), { cwd: fleet.repo.dir, detached: true, stdio: ["pipe", log, log], shell: process.platform === "win32", windowsHide: true });
    child.stdin.end(brief);
    child.unref();
    agent.match.sessionId = sessionId;
    fs.writeFileSync(fleetFile, `${JSON.stringify(fleet, null, 2)}\n`);
    out({ member: agent.id, pid: child.pid, sessionId, log: path.join(logDir, `${agent.id}.log`) });
    break;
  }

  default:
    {
      // The usage is the comment block at the top of this file, whatever its length.
      const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split(/\r?\n/).slice(1);
      out(lines.slice(1, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.slice(3)).join("\n"));
    }
}
