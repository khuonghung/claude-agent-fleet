// The board collector: a folder of Markdown tickets, a roster, reports and notices.
import fs from "node:fs/promises";
import path from "node:path";

const LOG_LINE = /^\s*-\s*(\d{1,2}:\d{2})\s+([^:]+?):\s*(.*)$/;
const ALIASES = { wontfix: "wont-fix", "won't-fix": "wont-fix", inprogress: "in-progress", done: "fixed" };

function field(text, name) {
  const m = new RegExp(`^[ \\t]*-[ \\t]*${name}:[ \\t]*(.*)$`, "im").exec(text);
  return m ? m[1].trim() : "";
}

/**
 * A ticket's Status field as one flow id. Only the status word counts: "duplicate → N-019", "fixed — dev-api @ 7f3a"
 * and "deferred to next sweep" read as duplicate, fixed and deferred; "In progress" and "in_progress" as in-progress.
 * A leading in / on / not / won't keeps its next word: "won't fix" is wont-fix, "on hold" stays on-hold.
 */
export function normStatus(raw) {
  const s = String(raw ?? "").toLowerCase().replace(/[`*]/g, "").replaceAll("_", "-").trim().replace(/^(in|on|not|won'?t)[\s-]+([a-z]+)/, "$1-$2");
  const word = /^[a-z][a-z'-]*/.exec(s)?.[0].replace(/-+$/, "") ?? "";
  return ALIASES[word] ?? (word || "new");
}

/** A log line's "HH:MM" (local time) as the first such moment from an hour before the mission's start on. */
export function clockToIso(startAt, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const start = new Date(startAt);
  const d = new Date(start);
  d.setHours(h, m, 0, 0);
  while (d.getTime() < start.getTime() - 3_600_000) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

async function readOr(file, fallback = "") {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return fallback;
  }
}

function parseTicket(id, text, stat, date) {
  const head = /^#\s*([^:\n]+):\s*(.*)$/m.exec(text);
  const log = [];
  const tail = text.includes("## Log") ? text.split("## Log")[1] : "";
  for (const line of tail.split(/\r?\n/)) {
    const m = LOG_LINE.exec(line);
    if (!m) continue;
    // A line cannot be written after the file was last saved: a later time is a guessed clock, read as that save.
    const at = clockToIso(date, m[1]);
    log.push({ time: m[1].padStart(5, "0"), at: Date.parse(at) > stat.mtimeMs + 60_000 ? stat.mtime.toISOString() : at, who: m[2].trim(), note: m[3].trim().slice(0, 240) });
  }
  const severity = (field(text, "Severity").split(/\s+/)[0] ?? "").toLowerCase().replace(/[`*]/g, "");
  const status = normStatus(field(text, "Status"));
  // When it was fixed or verified, from the Log (the board keeps no status history): fixed at the owner's last line that
  // says so, since a reopened ticket is fixed again; verified at the last line, since earlier ones are pre-checks.
  const owner = field(text, "Owner").replace(/\s*\(proposed\)/i, "").trim();
  const lastSaying = (re, who) => log.findLast((l) => re.test(l.note) && (who === undefined || l.who === who))?.at ?? null;
  const fixLine = /\b(fixed|committed)\b/i;
  const doneAt = ["fixed", "integrated", "verified"].includes(status) ? (lastSaying(fixLine, owner) ?? lastSaying(fixLine) ?? lastSaying(/\b(integrated|merged|verified)\b/i) ?? stat.mtime.toISOString()) : null;
  const verifiedAt = status === "verified" ? (lastSaying(/\bverified\b/i) ?? stat.mtime.toISOString()) : null;
  return {
    id,
    title: (head?.[2] ?? id).trim().slice(0, 160),
    severity,
    status,
    doneAt,
    verifiedAt,
    owner,
    crew: field(text, "Crew").replace(/^[—-]$/, ""),
    verifier: field(text, "Verifier"),
    decision: field(text, "Decision").slice(0, 200),
    fix: field(text, "Fix").slice(0, 120),
    area: field(text, "Area").slice(0, 120),
    // Filed at its first Log line, when that is earlier: a file's birth time moves when an editor saves by replacing it.
    created: new Date(Math.min(stat.birthtimeMs, ...log.map((l) => Date.parse(l.at)))).toISOString(),
    updated: stat.mtime.toISOString(),
    log,
    mentions: mentionsOf(id, text),
    files: filesOf(text),
  };
}

/** Ticket-like ids a ticket names besides its own ("see T1-014", "duplicate of QA-R2"); the board keeps the real ones. */
const mentionsOf = (id, text) => [...new Set(text.match(/\b[A-Z][A-Z0-9]{0,5}-[A-Z0-9]{1,5}\b/g) ?? [])].filter((x) => x !== id && /\d/.test(x)).slice(0, 40);

/** The code locations a ticket points at: `path/to/file.ext` or `file.ext:12-30`, in backticks or bare. */
const filesOf = (text) =>
  [...new Set([...text.matchAll(/`?((?:[\w@.-]+\/)+[\w@.-]+\.[a-z]{1,6}(?::\d+(?:-\d+)?)?)`?/gi)].map((m) => m[1]))].filter((f) => !/^https?:/i.test(f)).slice(0, 30);

const POST = /^###\s+(\d{1,2}:\d{2})\s+([a-z][a-z0-9-]*)\s*(?:[·\-–—|:]\s*([a-z-]+))?/i;
const POST_KINDS = new Set(["question", "proposal", "answer", "concern", "agree", "decision", "ready", "blocked", "handoff", "status"]);

/** A discussion thread: its header fields and its posts (`### HH:MM <id> · <kind>` and the text under it). */
export function parseThread(name, text, stat, startAt) {
  const posts = [];
  const body = text.includes("## Posts") ? text.split("## Posts").slice(1).join("## Posts") : "";
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const m = POST.exec(line);
    if (m) {
      const kind = (m[3] ?? "").toLowerCase();
      current = { time: m[1].padStart(5, "0"), at: clockToIso(startAt, m[1]), who: m[2], kind: POST_KINDS.has(kind) ? kind : "post", text: "" };
      posts.push(current);
    } else if (current) current.text += `${line}\n`;
  }
  for (const p of posts) p.text = p.text.trim().slice(0, 600);
  const list = (value) => value.split(/[,\s]+/).map((x) => x.replace(/[`*@]/g, "")).filter((x) => /^[a-z][a-z0-9-]*$/.test(x));
  const status = field(text, "Status").toLowerCase().split(/\s/)[0] || "open";
  return {
    name,
    title: (/^#\s+(.*)$/m.exec(text)?.[1] ?? name).trim().slice(0, 160),
    status: ["open", "decided", "closed"].includes(status) ? status : "open",
    ticket: field(text, "Ticket").replace(/^[—-]$/, ""),
    owner: list(field(text, "Owner"))[0] ?? "",
    members: list(field(text, "Members")),
    decideBy: field(text, "Decide by").slice(0, 20),
    decideAt: /^\d{1,2}:\d{2}/.test(field(text, "Decide by")) ? clockToIso(startAt, field(text, "Decide by").slice(0, 5).replace(/[^\d:]/g, "")) : null,
    decision: field(text, "Decision").slice(0, 300),
    updated: stat.mtime.toISOString(),
    posts: posts.slice(-40),
  };
}

const CHANNEL_LINE = /^\s*-\s*(\d{1,2}:\d{2})\s+([a-z][a-z0-9-]*)\s*(?:[·\-–—|]\s*([a-z-]+))?\s*:\s*(.+)$/i;
const CHANNEL_KINDS = new Set(["heads-up", "ask", "answer", "fyi"]);

/** The team channel (`CHANNEL.md`): its last posts, one a line (`- HH:MM <id> · <kind>: <text>`), oldest first. */
export function parseChannel(text, stat, startAt) {
  const posts = [];
  for (const line of text.split(/\r?\n/)) {
    const m = CHANNEL_LINE.exec(line);
    if (!m) continue;
    const kind = (m[3] ?? "").toLowerCase();
    // As in tickets: a time after the file's last save is a guessed clock, read as that save.
    const at = clockToIso(startAt, m[1]);
    posts.push({ time: m[1].padStart(5, "0"), at: Date.parse(at) > stat.mtimeMs + 60_000 ? stat.mtime.toISOString() : at, who: m[2], kind: CHANNEL_KINDS.has(kind) ? kind : "post", text: m[4].trim().slice(0, 400) });
  }
  return { updated: stat.mtime.toISOString(), posts: posts.slice(-200) };
}

export function parseRoster(text) {
  const roster = {};
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 5 && /^[a-z][a-z0-9-]+$/.test(cells[1] ?? "") && cells[1] !== "name") {
      roster[cells[1]] = { sessionId: cells[3] ?? "", worktree: cells[4] ?? "", branch: (cells[5] ?? "").split(/\s/)[0] ?? "" };
    }
  }
  return roster;
}

/** Reads the whole board; the server diffs ticket statuses between reads. */
export async function readBoard(cfg) {
  const dir = cfg.board.dir;
  const tickets = [];
  let files = [];
  try {
    files = (await fs.readdir(path.join(dir, "tickets"))).filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }
  await Promise.all(
    files.map(async (f) => {
      const file = path.join(dir, "tickets", f);
      try {
        const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
        tickets.push(parseTicket(f.replace(/\.md$/, ""), text, stat, cfg.mission.startAt));
      } catch {
        // A ticket being rewritten right now; the next read gets it.
      }
    }),
  );
  tickets.sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(tickets.map((t) => t.id));
  for (const t of tickets) t.mentions = t.mentions.filter((x) => ids.has(x));

  const reports = [];
  try {
    for (const f of (await fs.readdir(path.join(dir, "reports"))).filter((x) => x.endsWith(".md"))) {
      const file = path.join(dir, "reports", f);
      const [text, stat] = await Promise.all([readOr(file), fs.stat(file)]);
      reports.push({ name: f.replace(/\.md$/, ""), updated: stat.mtime.toISOString(), size: stat.size, title: (/^#\s+(.*)$/m.exec(text)?.[1] ?? f).slice(0, 120) });
    }
  } catch {
    // No reports yet.
  }

  const threads = [];
  try {
    const names = (await fs.readdir(path.join(dir, "threads"))).filter((x) => x.endsWith(".md"));
    await Promise.all(
      names.map(async (f) => {
        const file = path.join(dir, "threads", f);
        try {
          const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
          threads.push(parseThread(f.replace(/\.md$/, ""), text, stat, cfg.mission.startAt));
        } catch {
          // A thread being written right now; the next read gets it.
        }
      }),
    );
  } catch {
    // No threads yet (or a board from before threads).
  }
  threads.sort((a, b) => b.updated.localeCompare(a.updated));

  let channel = null;
  try {
    const file = path.join(dir, "CHANNEL.md");
    const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    channel = parseChannel(text, stat, cfg.mission.startAt);
  } catch {
    // No channel (a board from before it): the dashboard leaves it out.
  }

  const notices = (await readOr(path.join(dir, "NOTICES.md"))).trim();
  const boardMd = await readOr(path.join(dir, "BOARD.md"));
  const stack = /^.*Stack[^:\n]*:\s*(.*)$/im.exec(boardMd)?.[1]?.trim() ?? "";
  let finalReport = null;
  try {
    const stat = await fs.stat(path.join(dir, "FINAL-REPORT.md"));
    finalReport = { updated: stat.mtime.toISOString(), size: stat.size };
  } catch {
    finalReport = null;
  }

  return {
    tickets,
    threads,
    channel,
    roster: parseRoster(await readOr(path.join(dir, "ROSTER.md"))),
    reports,
    notices: notices.split(/\r?\n/).slice(0, 30).join("\n"),
    stack: stack.slice(0, 240),
    finalReport,
  };
}

/** Raw Markdown of one board document, for the detail drawers. */
export async function readBoardDoc(cfg, kind, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const file =
    kind === "ticket" ? path.join(cfg.board.dir, "tickets", `${name}.md`)
    : kind === "report" ? path.join(cfg.board.dir, "reports", `${name}.md`)
    : kind === "thread" ? path.join(cfg.board.dir, "threads", `${name}.md`)
    : kind === "board" && ["BOARD", "FINAL-REPORT", "README", "NOTICES", "ROSTER", "CHANNEL"].includes(name) ? path.join(cfg.board.dir, `${name}.md`)
    : null;
  return file ? readOr(file, null) : null;
}
