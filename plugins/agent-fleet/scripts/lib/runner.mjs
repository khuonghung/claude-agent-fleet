// The runner of a member in another agent CLI (`fleet run <member>`, started by `fleet spawn`). Those CLIs end when a
// turn ends and cannot be messaged, so the runner keeps the member going until its window ends: it starts the first
// turn with the brief, then waits on the board — the member's inbox, its tickets, the threads and channel posts that
// name it — and resumes the same session with a short note saying what changed. Each turn is written to
// `.fleet/<slug>/runner/<id>.jsonl` in Claude Code's transcript shape, so the dashboard and `fleet status` count it.
//
//   runner/<id>.json   the runner's state: pid, the CLI's pid during a turn, session id, turn, phase
//   runner/<id>.stop   asks the runner to stop after the current turn (`fleet halt`)

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { branchOf, cli } from "./board-init.mjs";
import { argsOf, expandPath, readTurn, runTurn, transcriptLines, valuesOf } from "./harness.mjs";
import { messagesOf, send } from "./inbox.mjs";
import { readFleet } from "./plan.mjs";
import { markerOf, openTicketsOf, recordSession } from "./sessions.mjs";

const hhmm = (at) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};
const mtime = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

export const runnerFiles = (fleetDir, id) => {
  const dir = path.join(fleetDir, "runner");
  return { dir, state: path.join(dir, `${id}.json`), transcript: path.join(dir, `${id}.jsonl`), stop: path.join(dir, `${id}.stop`) };
};

/** Sets a member's cells in ROSTER.md (session, worktree, branch), as `fleet roster` does. */
export function setRoster(boardDir, id, values) {
  const file = path.join(boardDir, "ROSTER.md");
  if (!fs.existsSync(file)) return;
  const columns = { session: 3, worktree: 4, branch: 5 };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => {
    const cells = line.split("|");
    if (cells[1]?.trim() !== id) return line;
    for (const [key, value] of Object.entries(values)) if (columns[key] !== undefined && value !== undefined) cells[columns[key]] = ` ${value} `;
    return cells.join("|");
  });
  fs.writeFileSync(file, lines.join("\n"));
}

/**
 * The folder a member works in: the main checkout, or its own worktree on its own branch, made here (Claude Code's
 * `--worktree` does it for a Claude member; another CLI does not). An existing worktree is reused.
 */
export function ensureWorktree(fleet, agent) {
  if (!agent.worktree) return { dir: fleet.repo.dir };
  const branch = branchOf(fleet, agent, 40);
  const dir = path.join(path.dirname(fleet.board.dir), "worktrees", agent.id);
  if (fs.existsSync(path.join(dir, ".git"))) return { dir, branch };
  const git = (...args) => spawnSync("git", ["-C", fleet.repo.dir, ...args], { encoding: "utf8", windowsHide: true });
  let r = git("worktree", "add", "-b", branch, dir, fleet.repo.base);
  if (r.status !== 0 && /already exists/.test(r.stderr ?? "")) r = git("worktree", "add", dir, branch);
  if (r.status !== 0) throw new Error(`git worktree add for ${agent.id} failed: ${(r.stderr ?? "").trim()}`);
  return { dir, branch };
}

/**
 * What concerns a member on the board right now: its newest inbox message, its open tickets, the threads that name it
 * and the channel posts that @mention it. The runner compares two of these to know whether to wake the member.
 */
export function stampOf(fleet, id) {
  const board = fleet.board.dir;
  const tickets = Object.fromEntries(openTicketsOf(board, id).map((t) => [t.id, `${t.status}@${mtime(path.join(board, "tickets", `${t.id}.md`))}`]));
  const threads = {};
  try {
    for (const f of fs.readdirSync(path.join(board, "threads")).filter((x) => x.endsWith(".md"))) {
      const file = path.join(board, "threads", f);
      if (new RegExp(`\\b${id}\\b`).test(readText(file) ?? "")) threads[f.replace(/\.md$/, "")] = mtime(file);
    }
  } catch {
    // No threads yet.
  }
  const mention = new RegExp(`@${id}(?![\\w-])`);
  const mentions = (readText(path.join(board, "CHANNEL.md")) ?? "").split(/\r?\n/).filter((l) => mention.test(l) && !new RegExp(`^- \\d{1,2}:\\d{2} ${id} `).test(l)).length;
  const lastMessage = Math.max(0, ...messagesOf(board, id).map((m) => m.n));
  return { lastMessage, tickets, threads, mentions };
}

/** Why a member should wake, from two stamps; empty when nothing that concerns it changed. */
export function reasonsOf(before, after) {
  const reasons = [];
  if (after.lastMessage > before.lastMessage) reasons.push(`${after.lastMessage - before.lastMessage} new message(s) in your inbox`);
  const changed = Object.keys(after.tickets).filter((t) => before.tickets[t] !== after.tickets[t]);
  if (changed.length) reasons.push(`ticket ${changed.join(", ")} changed or was given to you`);
  const threads = Object.keys(after.threads).filter((t) => before.threads[t] !== after.threads[t]);
  if (threads.length) reasons.push(`thread ${threads.map((t) => `threads/${t}.md`).join(", ")} has news`);
  if (after.mentions > before.mentions) reasons.push("the team channel mentions you");
  return reasons;
}

/** The prompt that resumes a member: why it was woken, its unread messages, its open tickets, when to end the turn. */
export function wakeNote(fleet, id, reasons) {
  const agent = fleet.agents.find((a) => a.id === id);
  const board = fleet.board.dir.replaceAll("\\", "/");
  const unread = messagesOf(fleet.board.dir, id).filter((m) => !m.read);
  const tickets = openTicketsOf(fleet.board.dir, id).sort((a, b) => (b.status === "in-progress") - (a.status === "in-progress"));
  const end = new Date(agent.window?.to ?? fleet.mission.endAt);
  return [
    markerOf(fleet.mission.slug, id),
    "",
    `The fleet's runner woke you: ${reasons.join("; ")}.`,
    ...(unread.length
      ? ["", `Unread in your inbox:`, ...unread.slice(-10).map((m) => `- #${m.n} ${m.time} ${m.from}: ${m.text}`), `Act on them, then acknowledge: \`${cli(fleet, `ack ${id} ${unread.map((m) => m.n).join(" ")}`)}\``]
      : []),
    "",
    `Your open tickets: ${tickets.length ? tickets.map((t) => `${t.id} (${t.status}, ${t.part})`).join(", ") : "none"}.`,
    `Carry on with your duties (brief: \`${board}/briefs/${id}.md\`). When nothing is left for you to do now, end your turn: you are woken when your inbox, your tickets, a thread or a channel post that names you changes. Before you end it, your tickets' Logs say where you are. Your window ends at ${hhmm(end)}.`,
    "",
  ].join("\n");
}

/** The last prompt of a member, when its window has ended. */
export function finalNote(fleet, id) {
  const board = fleet.board.dir.replaceAll("\\", "/");
  return [
    markerOf(fleet.mission.slug, id),
    "",
    `Your window has ended. Start nothing new: hand over what you hold (a Log line in each ticket you own, a \`handoff\` post in each thread you are part of), write \`${board}/reports/${id}.md\` — what you did, what you found, what is left — then end your turn.`,
    "",
  ].join("\n");
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tail = (text) => String(text ?? "").trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 200) ?? "";

/**
 * Drives one member until its window ends or it is halted. The fleet is re-read on every turn (`/agent-fleet:extend`
 * moves the end). A runner started again picks up its session from its state file.
 */
export async function runMember(fleetFile, id, { log, pollMs = 20_000, heartbeatMin = 15, sleep = sleepFor, now = () => new Date() } = {}) {
  const fleetDir = path.dirname(fleetFile);
  const files = runnerFiles(fleetDir, id);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.rmSync(files.stop, { force: true });
  let fleet = readFleet(fleetFile);
  const memberOf = (f) => f.agents.find((a) => a.id === id);
  if (memberOf(fleet) === undefined) throw new Error(`No member ${id}`);
  const profile = fleet.harnesses?.[memberOf(fleet).harness];
  if (profile === undefined) throw new Error(`${id} runs in ${memberOf(fleet).harness}, which has no profile in fleet.json`);
  const where = ensureWorktree(fleet, memberOf(fleet));
  setRoster(fleet.board.dir, id, { worktree: where.dir.replaceAll("\\", "/"), branch: where.branch ?? fleet.repo.base });

  const state = { ...readJson(files.state, {}), pid: process.pid, child: null, harness: profile.id };
  const save = (extra = {}) => fs.writeFileSync(files.state, `${JSON.stringify(Object.assign(state, extra, { at: now().toISOString() }), null, 2)}\n`);
  const append = (lines) => fs.appendFileSync(files.transcript, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const brief = fs.readFileSync(path.join(fleet.board.dir, "briefs", `${id}.md`), "utf8");
  let prompt = state.sessionId ? wakeNote(fleet, id, ["its runner started again"]) : brief;
  let failures = 0;
  let finalDone = false;
  let rewakes = 0;
  state.stamp ??= stampOf(fleet, id);

  for (;;) {
    fleet = readFleet(fleetFile);
    const agent = memberOf(fleet);
    if (agent === undefined || fs.existsSync(files.stop)) break;
    const first = !state.sessionId;
    const values = { ...valuesOf(profile, agent), sessionId: state.sessionId ?? (profile.sessionId === "set" ? randomUUID() : ""), boardDir: fleet.board.dir, cwd: where.dir, name: agent.match?.title ?? id, prompt };
    state.turn = (state.turn ?? 0) + 1;
    const at = now().toISOString();
    append(transcriptLines({ turn: state.turn, at, prompt }));
    save({ phase: "turn", turnStartedAt: at });
    const result = await runTurn(profile, argsOf(first ? profile.run : profile.resume, values), { cwd: where.dir, prompt, log, onSpawn: (child) => save({ child: child.pid }) });
    const usageText = profile.usage?.file ? readText(expandPath(profile.usage.file, values)) : undefined;
    const turn = readTurn(profile, result.stdout, { usageText });
    if (first) {
      const sessionId = profile.sessionId === "set" ? values.sessionId : turn.sessionId;
      if (sessionId && result.code === 0) {
        state.sessionId = sessionId;
        recordSession(fleetDir, id, { sessionId, transcriptPath: files.transcript, harness: profile.id });
        setRoster(fleet.board.dir, id, { session: sessionId });
      }
    }
    let outputTokens = turn.outputTokens ?? 0;
    if (profile.usage?.cumulative && turn.outputTokens !== undefined) {
      outputTokens = Math.max(0, turn.outputTokens - (state.cumulative ?? 0));
      state.cumulative = turn.outputTokens;
    }
    const failed = result.code !== 0 ? `exit ${result.code}${tail(result.stderr) ? `: ${tail(result.stderr)}` : ""}` : first && !state.sessionId ? "no session id in the output" : undefined;
    append(transcriptLines({ turn: state.turn, at, end: now().toISOString(), prompt, reply: turn.reply, outputTokens, model: values.model || profile.id, failed }));
    save({ phase: "waiting", child: null, lastExit: result.code, outputTokens: (state.outputTokens ?? 0) + outputTokens });

    if (failed) {
      failures += 1;
      if (failures >= 3) {
        const lead = fleet.agents.find((a) => a.launch === "self")?.id ?? "lead";
        send(fleet.board.dir, { from: id, to: lead, text: `My runner stopped after 3 failed turns of ${profile.title ?? profile.id} (${failed}). Log: ${path.join(fleetDir, "logs", `${id}.log`)}` });
        save({ phase: "failed" });
        return state;
      }
      await sleep(failures * 60_000);
      continue;
    }
    failures = 0;
    if (finalDone) break;
    const end = Date.parse(agent.window?.to ?? fleet.mission.endAt);
    if (now().getTime() >= end) {
      finalDone = true;
      prompt = finalNote(fleet, id);
      continue;
    }

    // Wait for something that concerns the member. Its own edits during the turn (a ticket moved, a post) are no news:
    // the board as the turn left it is the baseline, but for messages and mentions that came in during the turn. A
    // ticket left in progress is picked up again twice at most without news, then the member waits like the others
    // (it may be waiting on someone on purpose).
    const afterTurn = stampOf(fleet, id);
    const before = { ...afterTurn, lastMessage: state.stamp?.lastMessage ?? afterTurn.lastMessage, mentions: state.stamp?.mentions ?? afterTurn.mentions };
    const inProgress = openTicketsOf(fleet.board.dir, id).filter((t) => t.status === "in-progress" && t.part === "owner");
    let reasons = reasonsOf(before, afterTurn);
    if (reasons.length === 0 && inProgress.length && rewakes < 2) {
      rewakes += 1;
      reasons = [`your ticket ${inProgress.map((t) => t.id).join(", ")} is still in progress`];
    }
    const waitFrom = now().getTime();
    while (reasons.length === 0) {
      await sleep(pollMs);
      if (fs.existsSync(files.stop)) break;
      fleet = readFleet(fleetFile);
      const member = memberOf(fleet);
      if (member === undefined) break;
      if (now().getTime() >= Date.parse(member.window?.to ?? fleet.mission.endAt)) {
        reasons = ["your window has ended"];
        break;
      }
      reasons = reasonsOf(before, stampOf(fleet, id));
      if (reasons.length === 0 && now().getTime() - waitFrom >= heartbeatMin * 60_000) reasons = [`nothing has named you for ${heartbeatMin} minutes: check the board for work`];
    }
    if (reasons.length === 0) break;
    if (!reasons.some((r) => r.startsWith("your ticket"))) rewakes = 0;
    state.stamp = stampOf(fleet, id);
    if (reasons[0] === "your window has ended") {
      finalDone = true;
      prompt = finalNote(fleet, id);
    } else prompt = wakeNote(fleet, id, reasons);
  }
  save({ phase: "stopped", child: null });
  return state;
}

/**
 * A live check of a profile: two short turns — one started, one resumed — in a scratch board, and what came of them.
 * It proves what a fleet relies on: the turn exits cleanly, the session id is known, resuming works, and the output
 * tokens are read. The event types seen are printed so a profile's usage and reply paths can be written from them.
 */
export async function checkLive(profile, { cwd, model = "", effort = "" } = {}) {
  const boardDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-harness-"));
  const problems = [];
  const turns = [];
  let sessionId = profile.sessionId === "set" ? randomUUID() : "";
  let total = 0;
  const prompts = ["This is a connection test from agent-fleet. Do not run any tool and do not change any file. Reply with exactly one word: ready", "Second turn of the same test. Reply with exactly one word: again"];
  for (const [i, prompt] of prompts.entries()) {
    const values = { model, effort: profile.efforts ? (profile.efforts[effort] ?? "") : effort, sessionId, boardDir, cwd, name: "agent-fleet harness check", prompt };
    const args = argsOf(i === 0 ? profile.run : profile.resume, values);
    const started = Date.now();
    const result = await runTurn(profile, args, { cwd, prompt });
    const usageText = profile.usage?.file ? readText(expandPath(profile.usage.file, values)) : undefined;
    const turn = readTurn(profile, result.stdout, { usageText });
    if (i === 0 && profile.sessionId !== "set") sessionId = turn.sessionId ?? "";
    let outputTokens = turn.outputTokens;
    if (profile.usage?.cumulative && outputTokens !== undefined) {
      const delta = outputTokens - total;
      if (delta < 0) problems.push("usage is marked cumulative but went down between turns: it is per turn");
      total = outputTokens;
      outputTokens = Math.max(0, delta);
    }
    const samples = {};
    for (const line of String(result.stdout).split(/\r?\n/)) {
      try {
        const o = JSON.parse(line);
        const type = o.type ?? o.event ?? o.kind;
        if (type && samples[type] === undefined) samples[type] = line.slice(0, 400);
      } catch {
        // Not a JSON line.
      }
    }
    turns.push({ command: [profile.command, ...args].join(" "), code: result.code, seconds: Math.round((Date.now() - started) / 100) / 10, sessionId: i === 0 ? sessionId || null : undefined, outputTokens: outputTokens ?? null, reply: turn.reply.slice(0, 200), types: turn.types, samples, stderr: String(result.stderr).trim().split(/\r?\n/).slice(-5).join("\n") });
    if (result.code !== 0) {
      // The CLI's own words say why (not signed in, an unknown flag): the first line it wrote to stderr.
      const why = String(result.stderr).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      problems.push(`turn ${i + 1} exited with ${result.code}${why ? `: ${why}` : ""}`);
      break;
    }
    if (i === 0 && !sessionId) {
      problems.push(`no session id: nothing in the output has the field ${profile.sessionId?.key}`);
      break;
    }
  }
  if (turns.length === 2 && turns.some((t) => t.outputTokens === null)) problems.push(profile.usage ? "the output tokens were not found where usage points: fix usage from the samples" : "no usage in the profile: this member's tokens would count as 0 against the fleet's limit");
  if (turns[0]?.code === 0 && !/ready/i.test(turns[0].reply) && profile.reply) problems.push("the reply was not found where reply points (or the model did not answer ready)");
  fs.rmSync(boardDir, { recursive: true, force: true });
  return { ok: problems.length === 0, problems, turns };
}
