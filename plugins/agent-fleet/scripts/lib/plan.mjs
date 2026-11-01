// The fleet plan: what `/agent-fleet:new` writes and every other part reads. A plan is checked and completed here
// (defaults from the role catalog, the timeline from the time budget, how each member's transcript is found), so the
// commands, the board, the launcher and the dashboard all read one shape: `.fleet/<slug>/fleet.json`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const catalog = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "assets", "role-catalog.json"), "utf8"));

/** The plugin's skills (`skills/<name>/SKILL.md`), by name, with the description from their front matter. */
export const skills = Object.fromEntries(
  fs
    .readdirSync(path.join(PLUGIN_ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const text = fs.readFileSync(path.join(PLUGIN_ROOT, "skills", entry.name, "SKILL.md"), "utf8");
      return [entry.name, /^description:\s*(.+)$/m.exec(text)?.[1].trim() ?? ""];
    }),
);

const ID = /^[a-z][a-z0-9-]{0,39}$/;
export const BUDGET_ACTIONS = ["warn", "wrap-up", "stop"];

/** Where a fleet stands against its token limit: "none" without one, else "ok", "near" (past warnAt) or "over". */
export function budgetState(budget, used) {
  const limit = budget?.outputTokens;
  if (!limit) return { state: "none", used };
  const share = used / limit;
  return { state: share >= 1 ? "over" : share >= (budget.warnAt ?? 0.8) ? "near" : "ok", used, limit, share: Math.round(share * 1000) / 1000, onLimit: budget.onLimit ?? "warn" };
}
/** The context size (input tokens of a member's last model call) a member is kept under: the default. */
export const COMPACT_AT = 100_000;

/**
 * The members worth clearing to save tokens: a desktop session over `context.compactAt` whose turn has ended (the
 * board holds its state, so a fresh context loses nothing). Every model call re-reads the whole context, so a member
 * carrying 150k tokens into its next ticket pays for them on each step. `compactAt: 0` turns it off.
 */
export function contextState(fleet, telemetry, { inProgress = {} } = {}) {
  const limit = fleet.context?.compactAt ?? COMPACT_AT;
  const members = fleet.agents.map((agent) => {
    const t = telemetry[agent.id];
    return { id: agent.id, launch: agent.launch, tokens: t?.contextTokens ?? 0, idle: t?.phase === "replied", inProgress: inProgress[agent.id] ?? [] };
  });
  const clear = limit ? members.filter((m) => m.launch === "session" && m.idle && m.tokens >= limit).map((m) => m.id) : [];
  return { compactAt: limit, members, clear };
}

const FLOW = ["new", "triaged", "assigned", "in-progress", "fixed", "integrated", "verified"];

/** How Claude Code names the transcript folder of a working directory: every character but a letter or digit is a dash. */
export const transcriptFolderOf = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, "-");

export const slugOf = (text) =>
  String(text ?? "")
    // Đ/đ has no decomposition: NFKD alone would drop it.
    .replace(/[Đđ]/g, (c) => (c === "Đ" ? "D" : "d"))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "fleet";

/** Two or three capitals for session titles ("night-team" → "NT"). */
export const codeOf = (slug) => (slug.split("-").filter(Boolean).map((part) => part[0]).join("").toUpperCase() || "AF").slice(0, 3);

/** Default phases over the mission: start, work, freeze, report (10%, 65%, 10%, 15%). */
export function defaultPhases(startAt, endAt) {
  const start = Date.parse(startAt);
  const span = Date.parse(endAt) - start;
  const cuts = [0, 0.1, 0.75, 0.85, 1].map((f) => new Date(start + Math.round((span * f) / 60_000) * 60_000).toISOString());
  return ["Start-up", "Build & verify", "Code freeze", "Reports"].map((name, i) => ({ name, from: cuts[i], to: cuts[i + 1] }));
}

/** Checks a plan and completes it; throws with every problem at once. */
export function normalizePlan(input, { cwd = process.cwd(), now = new Date(), lead } = {}) {
  const problems = [];
  const plan = structuredClone(input ?? {});
  const mission = (plan.mission ??= {});
  if (!mission.name) problems.push("mission.name is required");
  if (!mission.goal) problems.push("mission.goal is required: one or two sentences on what done means");
  mission.slug = slugOf(mission.slug ?? mission.name);
  mission.code ??= codeOf(mission.slug);
  mission.startAt ??= now.toISOString();
  if (mission.endAt === undefined) {
    const hours = Number(mission.hours ?? 4);
    if (!(hours > 0 && hours <= 72)) problems.push("mission.hours must be between 0 and 72");
    mission.endAt = new Date(Date.parse(mission.startAt) + hours * 3_600_000).toISOString();
  }
  if (!(Date.parse(mission.endAt) > Date.parse(mission.startAt))) problems.push("mission.endAt must be after mission.startAt");
  mission.phases ??= defaultPhases(mission.startAt, mission.endAt);
  mission.language ??= "en";

  plan.repo ??= {};
  plan.repo.dir = path.resolve(cwd, plan.repo.dir ?? ".");
  plan.repo.base ??= "main";
  if (plan.repo.integration !== undefined && !(typeof plan.repo.integration === "string" && plan.repo.integration.trim())) problems.push("repo.integration must be a branch name");
  plan.launch ??= "session";
  if (!["session", "subagent", "headless"].includes(plan.launch)) problems.push(`launch must be session, subagent or headless, not ${plan.launch}`);
  // An output-token limit is the user's choice: none (only measured), or a limit with what the lead does on reaching
  // it — warn the user, wrap the fleet up, or stop it. The lead warns once at `warnAt` of the limit in every case.
  plan.budget ??= {};
  const limit = plan.budget.outputTokens;
  if (limit !== undefined && !(Number.isFinite(limit) && limit > 0)) problems.push(`budget.outputTokens must be a positive number of output tokens, not ${limit}`);
  if (limit !== undefined) {
    plan.budget.onLimit ??= "warn";
    plan.budget.warnAt ??= 0.8;
    if (!BUDGET_ACTIONS.includes(plan.budget.onLimit)) problems.push(`budget.onLimit must be one of ${BUDGET_ACTIONS.join(", ")}, not ${plan.budget.onLimit}`);
    if (!(plan.budget.warnAt > 0 && plan.budget.warnAt < 1)) problems.push(`budget.warnAt must be a share between 0 and 1, not ${plan.budget.warnAt}`);
  } else if (plan.budget.onLimit !== undefined) problems.push("budget.onLimit needs budget.outputTokens");
  // Context kept lean at `compactAt` tokens: subagents and headless members compact there on their own (their
  // auto-compact window), and the lead clears an idle desktop member past it, which then resumes from the board.
  // Claude Code takes a window of 100k to 1M tokens; 0 turns it all off.
  plan.context ??= {};
  plan.context.compactAt ??= COMPACT_AT;
  const at = plan.context.compactAt;
  if (!(at === 0 || (Number.isInteger(at) && at >= 100_000 && at <= 1_000_000))) problems.push(`context.compactAt must be a number of tokens from 100000 to 1000000, or 0 to turn it off, not ${at}`);
  plan.privacy ??= { readText: true };
  plan.board ??= {};
  plan.board.dir = path.resolve(cwd, plan.board.dir ?? path.join(".fleet", mission.slug, "board"));
  plan.board.flow ??= FLOW;
  plan.board.parked ??= ["deferred", "wont-fix", "duplicate"];
  plan.board.attention ??= ["reopened"];
  plan.transcripts ??= {};
  plan.transcripts.root ??= path.join(os.homedir(), ".claude", "projects");
  plan.transcripts.dirPrefix ??= transcriptFolderOf(plan.repo.dir);
  plan.squads ??= catalog.squads;
  plan.probes ??= [];

  const agents = (plan.agents ??= []);
  if (agents.length === 0) problems.push("the plan has no agents");
  const ids = new Set();
  for (const [index, agent] of agents.entries()) {
    const where = `agents[${index}]${agent.id ? ` (${agent.id})` : ""}`;
    const role = catalog.roles[agent.role];
    if (!ID.test(agent.id ?? "")) problems.push(`${where}: id must be lowercase kebab-case`);
    if (ids.has(agent.id)) problems.push(`${where}: id is used twice`);
    ids.add(agent.id);
    if (role === undefined && !agent.title) problems.push(`${where}: role ${agent.role} is not in the catalog; give it a title, squad and duties`);
    agent.name ??= agent.id;
    agent.title ??= role?.title ?? agent.role;
    agent.squad ??= role?.squad ?? "build";
    agent.model ??= role?.model ?? "sonnet";
    agent.effort ??= role?.effort ?? "medium";
    agent.launch ??= role?.launch === "self" ? "self" : plan.launch;
    agent.worktree ??= role?.worktree ?? false;
    agent.readOnly ??= role?.readOnly ?? false;
    agent.duties ??= role?.duties ?? "";
    agent.skills ??= role?.skills ?? ["verify-before-done", "team-communication", "status-report"];
    for (const skill of agent.skills) if (!(skill in skills)) problems.push(`${where}: skill ${skill} is not one of ${Object.keys(skills).join(", ")}`);
    agent.specialty ??= "";
    agent.owns ??= [];
    agent.mascot ??= role?.mascot;
    if (!(agent.model in catalog.models) && !/^claude-/.test(agent.model)) problems.push(`${where}: model ${agent.model} is not opus, sonnet, haiku, inherit or a claude-* id`);
    if (!catalog.efforts.includes(agent.effort)) problems.push(`${where}: effort must be one of ${catalog.efforts.join(", ")}`);
    if (!plan.squads.some((squad) => squad.id === agent.squad)) problems.push(`${where}: squad ${agent.squad} is not in squads`);
    // How the dashboard finds the member's transcript: a session by its title, a subagent by its description.
    agent.match ??= {};
    if (agent.launch === "self" && lead?.transcriptPath) agent.match.transcript ??= lead.transcriptPath;
    if (agent.launch === "self" && lead?.sessionId) agent.match.sessionId ??= lead.sessionId;
    agent.match.title ??= `${mission.code} · ${agent.name}`;
    agent.match.description ??= `${mission.slug}/${agent.id}`;
  }
  for (const agent of agents) {
    if (agent.reportsTo !== undefined && !ids.has(agent.reportsTo)) problems.push(`${agent.id}: reportsTo ${agent.reportsTo} is not an agent of the plan`);
  }
  // No one reports to themselves through a chain.
  for (const agent of agents) {
    const seen = new Set([agent.id]);
    for (let up = agent.reportsTo; up !== undefined; up = agents.find((a) => a.id === up)?.reportsTo) {
      if (seen.has(up)) {
        problems.push(`${agent.id}: the reportsTo chain loops through ${up}`);
        break;
      }
      seen.add(up);
    }
  }
  if (problems.length > 0) throw new Error(`The fleet plan has problems:\n- ${problems.join("\n- ")}`);
  plan.version = 2;
  return plan;
}

/** A path a member owns, compared as a folder: slashes, a leading ./ and a trailing /** do not count. */
const ownedPath = (p) => String(p).replaceAll("\\", "/").replace(/^\.\//, "").replace(/(\/\*\*?)+$/, "").replace(/\/+$/, "");
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/**
 * Adds members to a fleet that is already running: the fleet as it is (its start, members and session ids kept) plus the
 * new ones, completed and checked as a plan is. A new member works from now (or the start, if it is still ahead) to the
 * end unless it brings its own window. Paths it owns that another builder owns are warnings, not errors: a handover or
 * a swarm may share them on purpose, and the lead settles it with the user.
 */
export function addToPlan(fleet, members, { now = new Date(), lead } = {}) {
  const list = Array.isArray(members) ? members : [members];
  if (list.length === 0) throw new Error("no member to add");
  const end = Date.parse(fleet.mission.endAt);
  if (!(now.getTime() < end)) throw new Error(`the fleet ended at ${fleet.mission.endAt}: there is no time left to add a member`);
  const from = new Date(Math.floor(Math.max(now.getTime(), Date.parse(fleet.mission.startAt)) / 60_000) * 60_000).toISOString();
  const added = list.map((member) => {
    if (member?.role === "lead" || member?.launch === "self") throw new Error(`${member.id ?? "a member"}: a fleet has one lead, and it has one already`);
    return { ...member, window: member.window ?? { from, to: fleet.mission.endAt } };
  });
  const plan = normalizePlan({ ...fleet, agents: [...fleet.agents, ...added] }, { now, lead });
  const ids = new Set(added.map((a) => a.id));
  const warnings = [];
  for (const agent of plan.agents.filter((a) => ids.has(a.id))) {
    for (const other of plan.agents.filter((a) => a.id !== agent.id && !a.readOnly)) {
      for (const mine of agent.owns) {
        const theirs = other.owns.find((p) => overlaps(ownedPath(mine), ownedPath(p)));
        if (theirs !== undefined && (!ids.has(other.id) || agent.id < other.id)) warnings.push(`${agent.id} owns ${mine}, which overlaps ${other.id}'s ${theirs}`);
      }
    }
  }
  return { plan, added: plan.agents.filter((a) => ids.has(a.id)), warnings };
}

/** A model alias as the id a session is started with ("" for inherit). */
export const modelId = (model) => catalog.models[model]?.id ?? model;

/**
 * Reads a fleet config; an older night-team config (mission.date + HH:MM times, ADR-free POC shape) is read as v2.
 */
export function readFleet(file) {
  const fleet = JSON.parse(fs.readFileSync(file, "utf8"));
  const m = fleet.mission ?? {};
  if (m.startAt === undefined && m.date !== undefined) {
    const at = (hhmm) => {
      const [h = 0, min = 0] = String(hhmm).split(":").map(Number);
      const d = new Date(`${m.date}T00:00:00`);
      d.setHours(h, min, 0, 0);
      if (h >= 12) d.setDate(d.getDate() - 1);
      return d.toISOString();
    };
    m.startAt = at(m.start);
    m.endAt = at(m.end);
    m.phases = (m.phases ?? []).map((p) => ({ name: p.name, from: at(p.from), to: at(p.to) }));
  }
  m.slug ??= slugOf(m.name);
  return fleet;
}
