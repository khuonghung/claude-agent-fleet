// `fleet integrate`: the mechanical half of an integration round, read-only. It lists the `fixed` tickets, finds each
// one's commit, sees what merging it would bring along (another fixed ticket: merged together; a ticket not ready:
// blocked), names the merge, and says which checks the round needs. The release manager still runs the merges and
// the checks; this only saves them the git archaeology that made each round take 10–20 minutes.

import { spawnSync } from "node:child_process";
import { integrationOf } from "../server/git.mjs";
import { listTickets } from "./tickets.mjs";

const git = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
};

/** The commit a `Fix:` line names: the last hex word of 7 to 40 characters ("dev-api/fix @ 3f2a1c9" → 3f2a1c9). */
export const shaOfFix = (fix) => [...String(fix).matchAll(/\b([0-9a-f]{7,40})\b/gi)].at(-1)?.[1];

/** A package folder: `apps/api/src/x.ts` → `apps/api`; a root file → "" (shared: the lockfile, root config). */
const PACKAGE_ROOTS = new Set(["apps", "packages", "libs", "services", "modules", "crates", "plugins"]);
export function packageOf(file) {
  const parts = file.split("/");
  if (parts.length === 1) return "";
  return PACKAGE_ROOTS.has(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * The plan of a round: `merges` in order (each with its tickets, commit, packages and the exact command), `blocked`
 * (a fix that would bring unready work along), `merged` (already in the integration branch: set them integrated),
 * `missing` (no commit found), `unticketed` commits a merge would bring, and whether the round needs the full suite.
 */
export function integrationPlan(fleet, roster) {
  const dir = fleet.repo.dir;
  const into = integrationOf(fleet, roster);
  if (!into) throw new Error("no integration branch yet: set repo.integration in fleet.json, or the release manager records its branch in ROSTER.md");
  if (!git(dir, "rev-parse", "--verify", "--quiet", `${into}^{commit}`).ok) throw new Error(`the integration branch ${into} does not exist yet: create it from ${fleet.repo.base}`);
  const tickets = listTickets(fleet.board.dir);
  const ids = new Set(tickets.map((t) => t.id));
  const full = new Map();
  for (const t of tickets) {
    const sha = shaOfFix(t.fix);
    const resolved = sha && git(dir, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`);
    if (resolved?.ok) full.set(t.id, resolved.out);
  }
  const byCommit = new Map([...full].map(([id, sha]) => [sha, id]));
  const ticketOf = (sha, subject) => byCommit.get(sha) ?? [...ids].find((id) => new RegExp(`\\b${id}\\b`).test(subject));
  const ready = tickets.filter((t) => t.status === "fixed");
  const merged = [];
  const missing = [];
  const candidates = [];
  for (const t of ready) {
    const sha = full.get(t.id);
    if (sha === undefined) {
      missing.push({ id: t.id, fix: t.fix || "(no Fix: line)" });
      continue;
    }
    if (git(dir, "merge-base", "--is-ancestor", sha, into).ok) {
      merged.push({ id: t.id, sha: sha.slice(0, 7) });
      continue;
    }
    const commits = git(dir, "log", "--reverse", "--format=%H%x1f%s", `${into}..${sha}`)
      .out.split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, subject] = line.split("\x1f");
        return { sha: hash, subject, ticket: ticketOf(hash, subject) };
      });
    candidates.push({ ticket: t, sha, commits });
  }
  const readyIds = new Set(ready.map((t) => t.id));
  const status = new Map(tickets.map((t) => [t.id, t.status]));
  // A fix whose commit another candidate brings along merges with it, not on its own.
  const inside = new Set(candidates.flatMap((c) => c.commits.filter((k) => k.ticket !== c.ticket.id && readyIds.has(k.ticket ?? "")).map((k) => k.ticket)));
  const merges = [];
  const blocked = [];
  const unticketed = [];
  for (const c of candidates.filter((x) => !inside.has(x.ticket.id)).sort((a, b) => a.commits.length - b.commits.length)) {
    const unready = c.commits.filter((k) => k.ticket && k.ticket !== c.ticket.id && !readyIds.has(k.ticket));
    if (unready.length > 0) {
      blocked.push({ id: c.ticket.id, owner: c.ticket.owner, below: unready.map((k) => ({ sha: k.sha.slice(0, 7), ticket: k.ticket, status: status.get(k.ticket) })) });
      continue;
    }
    for (const k of c.commits.filter((x) => !x.ticket)) unticketed.push({ with: c.ticket.id, sha: k.sha.slice(0, 7), subject: k.subject });
    const along = [...new Set(c.commits.map((k) => k.ticket).filter((id) => id && id !== c.ticket.id))];
    const all = [...along, c.ticket.id].map((id) => tickets.find((t) => t.id === id));
    const files = git(dir, "diff", "--name-only", `${into}...${c.sha}`).out.split("\n").filter(Boolean);
    const packages = [...new Set(files.map(packageOf))];
    const named = packages.filter(Boolean).map((p) => p.split("/").at(-1));
    const scope = named.length === 0 ? "repo" : named.length <= 2 ? named.join(",") : "multi";
    const subject = `merge(${scope}): ${all.map((t) => t.title || t.id).join("; ")}`.replace(/"/g, "'");
    const message = subject.length > 72 ? `${subject.slice(0, 71)}…` : subject;
    const list = all.map((t) => t.id).join(", ");
    merges.push({
      tickets: all.map((t) => t.id),
      sha: c.sha.slice(0, 7),
      commits: c.commits.length,
      packages: packages.map((p) => p || "(root)"),
      message,
      command: `git merge --no-ff ${c.sha.slice(0, 7)} -m "${message}" -m "Tickets: ${list}"`,
    });
  }
  const touched = new Set(merges.flatMap((m) => m.packages));
  const shared = [...touched].filter((p) => p === "(root)" || p.startsWith("packages/") || p.startsWith("libs/"));
  return {
    into,
    head: git(dir, "rev-parse", "--short=7", into).out,
    merges,
    blocked,
    merged,
    missing,
    unticketed,
    fullSuite: { needed: shared.length > 0, because: shared },
  };
}

/** The plan as the release manager reads it. */
export function formatPlan(plan, { by = "<your id>", ticketCmd = "fleet ticket set" } = {}) {
  const lines = [`Integration into ${plan.into} (${plan.head}): ${plan.merges.length} merge(s) ready, ${plan.blocked.length} blocked, ${plan.merged.length} already in. Nothing is merged by this command.`];
  plan.merges.forEach((m, i) => {
    lines.push("", `${i + 1}. ${m.tickets.join(" + ")} — ${m.commits} commit(s), ${m.packages.join(", ")}`, `   ${m.command}`, `   then the checks of ${m.packages.join(", ")} and their dependents`);
  });
  if (plan.blocked.length > 0) {
    lines.push("", "Blocked (merging would bring work that is not ready):");
    for (const b of plan.blocked) lines.push(`- ${b.id}: ${b.below.map((k) => `${k.sha} of ${k.ticket} (${k.status})`).join(", ")} below its fix. Ask ${b.owner || "its owner"} to move the fix onto its own branch from ${plan.into}, and say so in both tickets.`);
  }
  if (plan.merged.length > 0) lines.push("", `Already in ${plan.into}: ${plan.merged.map((m) => `${m.id} (${m.sha})`).join(", ")} — set each integrated: ${ticketCmd} <ID> integrated --by ${by} --note '<merge commit, checks and counts>'`);
  if (plan.missing.length > 0) lines.push("", `No commit found: ${plan.missing.map((m) => `${m.id} (${m.fix})`).join(", ")} — ask the owner for the branch @ sha.`);
  if (plan.unticketed.length > 0) lines.push("", `Commits with no ticket that a merge brings: ${plan.unticketed.map((u) => `${u.sha} "${u.subject}" (with ${u.with})`).join(", ")} — check them with their owner before merging.`);
  lines.push("", plan.fullSuite.needed ? `Full suite after the round: yes — it touches shared code (${plan.fullSuite.because.join(", ")}).` : "Full suite after the round: not needed (no shared code touched); at the freeze, always.");
  return lines.join("\n");
}
