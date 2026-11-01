// Writes a fleet's working files from its plan: the board (protocol, roster, board, notices, tickets/, reports/) and one
// brief per member. Existing tickets and reports are never touched, so re-running init after an edit of the plan is safe.

import fs from "node:fs";
import path from "node:path";
import { catalog, modelId, PLUGIN_ROOT, skills } from "./plan.mjs";

// A Windows checkout (core.autocrlf) gives the templates CRLF line ends; what we write is always LF.
const template = (name) => fs.readFileSync(path.join(PLUGIN_ROOT, "assets", "templates", name), "utf8").replace(/\r\n?/g, "\n");
const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ""));
const when = (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const writeIfMissing = (file, text) => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
};

/** The ticket id prefix of a member: its initials, unique within the fleet ("dev-api" → "DA"). */
export function prefixes(agents) {
  const used = new Map();
  for (const agent of agents) {
    const base = agent.id.split("-").map((part) => part[0]).join("").toUpperCase().slice(0, 3) || "X";
    let prefix = base;
    for (let n = 2; [...used.values()].includes(prefix); n++) prefix = `${base}${n}`;
    used.set(agent.id, prefix);
  }
  return used;
}

/** A member's skills as a list: the name to load with the Skill tool and when to use it. */
const skillList = (agent) =>
  (agent.skills ?? []).length === 0 ? "(none)" : agent.skills.map((name) => `- \`agent-fleet:${name}\` — ${(skills[name] ?? "").split(/(?<=\.)\s/).slice(-1)[0]}`).join("\n");

/** A fleet CLI command that finds this fleet's board from any folder (a worktree too). */
const cli = (fleet, args) => `node "${path.join(PLUGIN_ROOT, "scripts", "fleet.mjs").replaceAll("\\", "/")}" ${args} --fleet "${path.dirname(fleet.board.dir).replaceAll("\\", "/")}"`;
/** The shell command that records a member's worktree and branch in ROSTER.md, run as is. */
const rosterCmd = (fleet, id) => cli(fleet, `roster ${id} worktree="$(git rev-parse --show-toplevel)" branch="$(git branch --show-current)"`);
/** The shell command that posts one line to the team channel; the kind is heads-up, ask, answer or fyi. */
const sayCmd = (fleet, id) => cli(fleet, `say ${id} fyi '<one line>'`);

/** The head of a new team channel; posts are appended below it by `fleet say`. */
export const CHANNEL_HEAD = "# Team channel\n\nShort news for everyone, one line per post, newest at the bottom. Post with `fleet say` (see the protocol), never by editing this file.\n\n";

export function briefOf(fleet, agent) {
  const boss = fleet.agents.find((a) => a.id === agent.reportsTo);
  const window = agent.window ?? { from: fleet.mission.startAt, to: fleet.mission.endAt };
  return fill(template("brief.md"), {
    id: agent.id,
    title: agent.title,
    name: fleet.mission.name,
    goal: fleet.mission.goal,
    reportsLine: boss === undefined ? "" : `You report to **${boss.id}** (${boss.title}).`,
    from: when(window.from),
    to: when(window.to),
    model: agent.model,
    effort: agent.effort,
    boardDir: fleet.board.dir.replaceAll("\\", "/"),
    duties: agent.duties || "(see the protocol)",
    specialty: agent.specialty || "(none beyond your role)",
    owns: agent.owns.length > 0 ? agent.owns.map((p) => `- \`${p}\``).join("\n") : agent.readOnly ? "You read; you do not change product code." : "(agree it with the delivery lead before you change files)",
    skills: skillList(agent),
    rosterCmd: rosterCmd(fleet, agent.id),
    sayCmd: sayCmd(fleet, agent.id),
    worktreeNote: agent.worktree ? " (you work in your own git worktree: never touch the base branch, and see \"Writing to the board from a worktree\" in the protocol)" : "",
  });
}

export function writeBoard(fleet) {
  const dir = fleet.board.dir;
  const fleetDir = path.dirname(dir);
  for (const sub of ["tickets", "threads", "reports", "briefs"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const pre = prefixes(fleet.agents);
  const roster = [
    "| Member | Role | Squad | Reports to | Model · effort | Owns | Ticket prefix |",
    "|---|---|---|---|---|---|---|",
    ...fleet.agents.map((a) => `| ${a.id} | ${a.title} | ${a.squad} | ${a.reportsTo ?? "—"} | ${a.model} · ${a.effort} | ${a.owns.map((p) => `\`${p}\``).join(", ") || "—"} | ${pre.get(a.id)} |`),
  ].join("\n");
  const timeline = ["| Phase | From | To |", "|---|---|---|", ...fleet.mission.phases.map((p) => `| ${p.name} | ${when(p.from)} | ${when(p.to)} |`)].join("\n");
  const hours = Math.round(((Date.parse(fleet.mission.endAt) - Date.parse(fleet.mission.startAt)) / 3_600_000) * 10) / 10;
  fs.writeFileSync(
    path.join(dir, "README.md"),
    fill(template("protocol.md"), {
      name: fleet.mission.name,
      goal: fleet.mission.goal,
      start: when(fleet.mission.startAt),
      end: when(fleet.mission.endAt),
      hours,
      boardDir: dir.replaceAll("\\", "/"),
      roster,
      timeline,
      prefixExample: [...pre.values()].slice(0, 3).map((p) => `${p}-001`).join(", "),
      flow: fleet.board.flow.join(" → "),
      parked: fleet.board.parked.join(", "),
      base: fleet.repo.base,
      rosterCmd: rosterCmd(fleet, "<your id>"),
      sayCmd: sayCmd(fleet, "<your id>"),
    }),
  );
  writeIfMissing(
    path.join(dir, "ROSTER.md"),
    ["# Roster", "", "Each member edits only their own row.", "", "| Name | Role | Session id | Worktree | Branch |", "|---|---|---|---|---|", ...fleet.agents.map((a) => `| ${a.id} | ${a.title} |  |  |  |`), ""].join("\n"),
  );
  writeIfMissing(path.join(dir, "BOARD.md"), `# Board\n\nStack: not running\n\nNo tickets yet.\n`);
  writeIfMissing(path.join(dir, "CHANNEL.md"), CHANNEL_HEAD);
  writeIfMissing(path.join(dir, "NOTICES.md"), `# Notices\n\n- ${new Date().toISOString().slice(11, 16)} lead: fleet "${fleet.mission.name}" planned.\n`);
  for (const agent of fleet.agents) fs.writeFileSync(path.join(dir, "briefs", `${agent.id}.md`), briefOf(fleet, agent));
  fs.writeFileSync(path.join(fleetDir, "fleet.json"), `${JSON.stringify(fleet, null, 2)}\n`);
  fs.writeFileSync(path.join(path.dirname(fleetDir), "current"), `${fleet.mission.slug}\n`);
  return { fleetFile: path.join(fleetDir, "fleet.json"), boardDir: dir };
}

const EFFORT_NOTE = {
  low: "do exactly what is asked, quickly; no exploration beyond it.",
  medium: "think enough to get it right; prefer the straightforward path.",
  high: "think carefully, check your work, test what you change.",
  xhigh: "think deeply about design and edge cases before you act, and verify thoroughly.",
  max: "leave nothing unexamined: design, edge cases, verification, and a second look.",
};

/** The subagent name of a member: one agent definition per member of each fleet. */
export const agentNameOf = (fleet, agent) => `fleet-${fleet.mission.slug}-${agent.id}`.slice(0, 64);

/**
 * The agent definition of one member, generated from the plan: its role's duties (catalog) specialised by what the
 * planner and the user decided for it — specialty, area, model, effort, window, who it reports to.
 */
export function agentFileOf(fleet, agent) {
  const boss = fleet.agents.find((a) => a.id === agent.reportsTo);
  const role = catalog.roles[agent.role];
  const extra = [
    ...(agent.readOnly ? ["- You read and write the board; you do not change product code."] : []),
    ...(agent.worktree ? [`- Work in your own git worktree and branch. The board is not in it: read and write it only at \`${fleet.board.dir.replaceAll("\\", "/")}\`, and never commit board files.`] : []),
  ];
  const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();
  // A description is one line: the specialty's first sentence, cut at a word and never mid-word.
  const firstSentence = (text) => oneLine(text).split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "");
  const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, text.lastIndexOf(" ", max - 1))}…`);
  return fill(template("agent.md"), {
    agentName: agentNameOf(fleet, agent),
    description: clip(oneLine(`${agent.title} of the "${fleet.mission.name}" fleet${agent.specialty ? `: ${firstSentence(agent.specialty)}` : ""}`).replace(/:\s/g, " — "), 240).replace(/([^…])$/, "$1.") + ` Use for member ${agent.id} of this fleet.`,
    modelLine: catalog.models[agent.model] === undefined || agent.model === "inherit" ? "" : `model: ${agent.model}\n`,
    id: agent.id,
    title: agent.title,
    name: fleet.mission.name,
    goal: fleet.mission.goal,
    reportsLine: boss === undefined ? "" : `You report to **${boss.id}** (${boss.title}).`,
    boardDir: fleet.board.dir.replaceAll("\\", "/"),
    duties: agent.duties || role?.duties || "(see the protocol)",
    specialty: agent.specialty || "(none beyond your role)",
    owns: agent.owns.length > 0 ? agent.owns.map((p) => `- \`${p}\``).join("\n") : "(agree it with the delivery lead before you change files)",
    effort: agent.effort,
    effortNote: EFFORT_NOTE[agent.effort] ?? "",
    base: fleet.repo.base,
    extraRules: extra.map((line) => `${line}\n`).join(""),
    to: when(agent.window?.to ?? fleet.mission.endAt),
    sayCmd: sayCmd(fleet, agent.id),
    skills: skillList(agent),
  });
}

/**
 * Writes every member's agent definition to `.fleet/<slug>/agents/`, and, when members launch as subagents, installs
 * them as project agents (`.claude/agents/fleet-<slug>-<id>.md`, kept out of git) so the Agent tool can start them.
 */
export function writeAgents(fleet) {
  const dir = path.join(path.dirname(fleet.board.dir), "agents");
  fs.mkdirSync(dir, { recursive: true });
  const members = fleet.agents.filter((a) => a.launch !== "self");
  const install = members.some((a) => a.launch === "subagent");
  const projectAgents = path.join(fleet.repo.dir, ".claude", "agents");
  if (install) fs.mkdirSync(projectAgents, { recursive: true });
  const written = [];
  for (const agent of members) {
    const text = agentFileOf(fleet, agent);
    fs.writeFileSync(path.join(dir, `${agent.id}.md`), text);
    if (install) fs.writeFileSync(path.join(projectAgents, `${agentNameOf(fleet, agent)}.md`), text);
    written.push(agent.id);
  }
  return { dir, installed: install ? projectAgents : undefined, members: written };
}

/** What `/agent-fleet:launch` starts, one entry per member: how, with which model and effort, and the brief. */
export function launchPlan(fleet) {
  const agentsDir = path.join(path.dirname(fleet.board.dir), "agents");
  return fleet.agents.map((a) => ({
    id: a.id,
    launch: a.launch,
    title: a.match.title,
    description: a.match.description,
    subagentType: agentNameOf(fleet, a),
    agentFile: a.launch === "self" ? undefined : path.join(agentsDir, `${a.id}.md`),
    model: a.model,
    modelId: modelId(a.model),
    effort: a.effort,
    worktree: a.worktree,
    readOnly: a.readOnly,
    branch: `${fleet.mission.slug}-${a.id}`.slice(0, 24),
    brief: path.join(fleet.board.dir, "briefs", `${a.id}.md`),
  }));
}
