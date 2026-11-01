// The Report tab: the mission's outcome while it runs and after — a summary the owner can paste, what each member
// delivered, every ticket's outcome (filtered, sorted, exported), what is still at risk and what was decided.

import { useMemo, useState } from "react";
import { useI18n, type T } from "../i18n";
import { agentById, ago, CLOSED, compact, cycleTime, dateTime, DONE, endOf, median, ownerOf, SEVERITY_RANK, span, startOf, statusLabel, verifierOf } from "../lib";
import type { FleetState, Ticket } from "../types";
import { Fold, SearchField, Slider } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

const PARKED = ["deferred", "wont-fix", "duplicate"];

/** How many times each ticket was reopened: the moves the server saw, else the Log lines that say so. */
function reopensOf(s: FleetState): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of s.transitions) if (x.to === "reopened") out.set(x.id, (out.get(x.id) ?? 0) + 1);
  for (const tk of s.board?.tickets ?? []) {
    if (out.has(tk.id)) continue;
    const logged = tk.log.filter((l) => /\breopen(ed|s|ing)?\b/i.test(l.note)).length;
    if (logged > 0 || tk.status === "reopened") out.set(tk.id, Math.max(1, logged));
  }
  return out;
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const csvCell = (text: string | number) => `"${String(text).replace(/"/g, '""')}"`;

/** The tickets as a Markdown table, in the reader's words. */
function ticketsMarkdown(t: T, rows: Ticket[], reopens: Map<string, number>): string {
  return [
    `| ${[t("rp.col.id"), t("rp.col.title"), t("rp.col.sev"), t("rp.col.status"), t("rp.col.owner"), t("rp.col.verifier"), t("rp.col.cycle"), t("rp.col.reopens"), "Fix"].join(" | ")} |`,
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((x) => `| ${[x.id, cell(x.title), x.severity || "—", statusLabel(t, x.status), x.owner || "—", x.verifier || "—", cycleTime(x) !== undefined ? span(cycleTime(x)!) : "—", String(reopens.get(x.id) ?? 0), cell(x.fix || "—")].join(" | ")} |`),
  ].join("\n");
}

interface MemberRow {
  id: string;
  title: string;
  owned: number;
  done: number;
  verifiedFor: number;
  reopens: number;
  commits: number;
  tokens: number;
  report: { updated: string } | undefined;
}

function memberRows(s: FleetState, reopens: Map<string, number>): MemberRow[] {
  const tickets = s.board?.tickets ?? [];
  return s.agents.map((a) => {
    const owned = tickets.filter((x) => ownerOf(x, a.id));
    const branch = (s.git?.branches ?? []).find((b) => b.agent === a.id && b.branch !== s.git?.integration);
    return {
      id: a.id,
      title: a.title ?? a.role,
      owned: owned.length,
      done: owned.filter((x) => DONE.includes(x.status)).length,
      verifiedFor: tickets.filter((x) => x.status === "verified" && verifierOf(x, a.id) && !ownerOf(x, a.id)).length,
      reopens: owned.reduce((n, x) => n + (reopens.get(x.id) ?? 0), 0),
      commits: branch?.commits.filter((c) => !c.merge).length ?? 0,
      tokens: s.telemetry[a.id]?.outputTokens ?? 0,
      report: s.board?.reports.find((r) => r.name === a.id),
    };
  });
}

/** The summary the lead pastes into the final report or a message: numbers, members, tickets, risks, decisions. */
function summaryMarkdown(s: FleetState, t: T, locale: string, reopens: Map<string, number>): string {
  const tickets = s.board?.tickets ?? [];
  const done = tickets.filter((x) => DONE.includes(x.status));
  const cycle = median(tickets.map(cycleTime).filter((x): x is number => x !== undefined));
  const tokens = s.agents.reduce((n, a) => n + (s.telemetry[a.id]?.outputTokens ?? 0), 0);
  const members = memberRows(s, reopens);
  const hot = tickets.filter((x) => (x.severity === "critical" || x.severity === "high") && !CLOSED.includes(x.status));
  const decided = (s.board?.threads ?? []).filter((x) => x.decision);
  return [
    `# ${s.mission.name}`,
    "",
    `${s.mission.goal}`,
    "",
    `${dateTime(s.mission.startAt, locale)} → ${dateTime(s.mission.endAt, locale)}`,
    "",
    `| ${t("rp.found")} | ${t("rp.done")} | ${t("rp.verified")} | ${t("rp.parked")} | ${t("rp.reopened")} | ${t("rp.cycle")} | ${t("rp.tokens")} |`,
    "|---|---|---|---|---|---|---|",
    `| ${tickets.length} | ${done.length} | ${tickets.filter((x) => x.status === "verified").length} | ${tickets.filter((x) => PARKED.includes(x.status)).length} | ${reopens.size} | ${cycle !== undefined ? span(cycle) : "—"} | ${compact(tokens)}${s.budget?.outputTokens ? ` / ${compact(s.budget.outputTokens)}` : ""} |`,
    "",
    `## ${t("rp.members")}`,
    "",
    `| ${t("rp.member")} | ${t("rp.owned")} | ${t("rp.checked")} | ${t("rp.reopens")} | ${t("rp.commits")} | ${t("rp.tokens")} | ${t("rp.report")} |`,
    "|---|---|---|---|---|---|---|",
    ...members.map((m) => `| ${m.id} (${m.title}) | ${m.done}/${m.owned} | ${m.verifiedFor} | ${m.reopens} | ${m.commits} | ${compact(m.tokens)} | ${m.report ? "✓" : t("rp.missing")} |`),
    "",
    `## ${t("rp.tickets")}`,
    "",
    ticketsMarkdown(t, [...tickets].sort((a, b) => a.id.localeCompare(b.id)), reopens),
    "",
    `## ${t("rp.risks")}`,
    "",
    ...(hot.length ? hot.map((x) => `- ${x.id} (${x.severity}, ${statusLabel(t, x.status)}): ${x.title}`) : [`- ${t("rp.noRisks")}`]),
    "",
    `## ${t("rp.decisions")}`,
    "",
    ...(decided.length ? decided.map((x) => `- ${x.title}: ${x.decision}`) : [`- ${t("rp.noDecisions")}`]),
    "",
  ].join("\n");
}

function CopyChip({ text, label, icon = "command" }: { text: () => string; label: string; icon?: "command" | "list" }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`chip copy${done ? " is-on" : ""}`}
      onClick={() =>
        navigator.clipboard?.writeText(text()).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          },
          () => setDone(false),
        )
      }
    >
      <Icon name={done ? "check" : icon} size={12} />
      {done ? t("cd.copied") : label}
    </button>
  );
}

export function Scorecard({ s, now, onDoc }: { s: FleetState; now: number; onDoc: (kind: string, name: string) => void }) {
  const { t, locale } = useI18n();
  const reopens = useMemo(() => reopensOf(s), [s.transitions, s.board]);
  const tickets = s.board?.tickets ?? [];
  const n = (pred: (x: Ticket) => boolean) => tickets.filter(pred).length;
  const verified = n((x) => x.status === "verified");
  const integrated = n((x) => x.status === "integrated");
  const fixed = n((x) => x.status === "fixed");
  const parked = n((x) => PARKED.includes(x.status));
  const open = tickets.length - verified - integrated - fixed - parked;
  const done = verified + integrated + fixed;
  const cycle = median(tickets.map(cycleTime).filter((x): x is number => x !== undefined));
  const tokens = s.agents.reduce((sum, a) => sum + (s.telemetry[a.id]?.outputTokens ?? 0), 0);
  const budget = s.budget?.outputTokens;
  const start = startOf(s.mission);
  const end = endOf(s.mission);
  const when = now < start ? t("rp.notStarted", { time: span(start - now) }) : now < end ? t("rp.running", { left: span(end - now) }) : t("rp.ended", { ago: span(now - end) });
  const final = s.board?.finalReport;
  const segments = [
    { key: "verified", n: verified, cls: "seg-verified" },
    { key: "integrated", n: integrated, cls: "seg-integrated" },
    { key: "fixed", n: fixed, cls: "seg-fixed" },
    { key: "open", n: open, cls: "seg-open" },
    { key: "parked", n: parked, cls: "seg-parked" },
  ];
  const stats = [
    { key: "found", label: t("rp.found"), value: String(tickets.length) },
    { key: "done", label: t("rp.done"), value: String(done), note: tickets.length ? `${Math.round((done / tickets.length) * 100)}%` : "" },
    { key: "verified", label: t("rp.verified"), value: String(verified), note: done ? t("rp.verifiedRate", { pct: Math.round((verified / done) * 100) }) : "" },
    { key: "parked", label: t("rp.parked"), value: String(parked) },
    { key: "reopened", label: t("rp.reopened"), value: String(reopens.size), tone: reopens.size ? "warn" : "" },
    { key: "cycle", label: t("rp.cycle"), value: cycle !== undefined ? span(cycle) : "—" },
    { key: "tokens", label: t("rp.tokens"), value: compact(tokens), note: budget ? `/ ${compact(budget)}` : "" },
  ];
  return (
    <section className="panel score" aria-label={t("rp.summary")}>
      <div className="score-hd">
        <div className="score-title">
          <span className="score-kicker">{t("rp.summary")}</span>
          <h2>{s.mission.name}</h2>
          <p className="goal">{s.mission.goal}</p>
          <span className="score-when">
            <Icon name="clock" size={13} /> {dateTime(s.mission.startAt, locale)} → {dateTime(s.mission.endAt, locale)} · <b>{when}</b>
          </span>
        </div>
        <div className="score-actions">
          <button type="button" className={`final${final ? " is-ready" : ""}`} onClick={() => final && onDoc("board", "FINAL-REPORT")} disabled={!final}>
            <b>{t("sd.final")}</b>
            <span>{final ? t("sd.updated", { ago: ago(now, final.updated) }) : t("sd.notYet")}</span>
          </button>
          <CopyChip text={() => summaryMarkdown(s, t, locale, reopens)} label={t("rp.copyDraft")} icon="list" />
        </div>
      </div>
      <div className="score-stats">
        {stats.map((x, i) => (
          <div key={x.key} className={`score-stat${x.tone ? ` is-${x.tone}` : ""}`} style={{ animationDelay: `${i * 40}ms` }}>
            <span>{x.label}</span>
            <b>{x.value}</b>
            {x.note && <small>{x.note}</small>}
          </div>
        ))}
      </div>
      {tickets.length > 0 && (
        <>
          <div className="score-bar" role="img" aria-label={segments.map((x) => `${x.key} ${x.n}`).join(", ")}>
            {segments.filter((x) => x.n > 0).map((x) => (
              <i key={x.key} className={x.cls} style={{ flexGrow: x.n }} title={`${x.key === "open" ? t("rp.open") : x.key === "parked" ? t("rp.parked") : statusLabel(t, x.key)} · ${x.n}`} />
            ))}
          </div>
          <div className="score-legend">
            {segments.map((x) => (
              <span key={x.key}>
                <i className={x.cls} /> {x.key === "open" ? t("rp.open") : x.key === "parked" ? t("rp.parked") : statusLabel(t, x.key)} <b>{x.n}</b>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function MemberScores({ s, now, onAgent, onDoc }: { s: FleetState; now: number; onAgent: (id: string) => void; onDoc: (kind: string, name: string) => void }) {
  const { t } = useI18n();
  const reopens = useMemo(() => reopensOf(s), [s.transitions, s.board]);
  const rows = memberRows(s, reopens).sort((a, b) => b.done - a.done || b.verifiedFor - a.verifiedFor || b.tokens - a.tokens);
  const ended = now > endOf(s.mission);
  const mostDone = Math.max(1, ...rows.map((r) => r.owned));
  return (
    <Fold id="member-scores" className="panel" title={t("rp.members")} note={t("rp.membersNote")}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("rp.member")}</th>
              <th>{t("rp.owned")}</th>
              <th className="num">{t("rp.checked")}</th>
              <th className="num">{t("rp.reopens")}</th>
              <th className="num">{t("rp.commits")}</th>
              <th className="num">{t("rp.tokens")}</th>
              <th className="num">{t("rp.perTicket")}</th>
              <th>{t("rp.report")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = agentById(s, r.id)!;
              return (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="who" onClick={() => onAgent(r.id)}>
                      <Avatar agent={a} size="sm" />
                      <span>
                        <b>{r.id}</b>
                        <small>{r.title}</small>
                      </span>
                    </button>
                  </td>
                  <td>
                    {r.owned > 0 ? (
                      <>
                        <span className="mini-bar">
                          <i style={{ width: `${(r.owned / mostDone) * 100}%` }} />
                          <i className="is-done" style={{ width: `${(r.done / mostDone) * 100}%` }} />
                        </span>
                        <span className="mono">
                          {r.done}/{r.owned}
                        </span>
                      </>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="num mono">{r.verifiedFor || "—"}</td>
                  <td className={`num mono${r.reopens ? " is-warn" : ""}`}>{r.reopens || "—"}</td>
                  <td className="num mono">{r.commits || "—"}</td>
                  <td className="num mono">{r.tokens ? compact(r.tokens) : "—"}</td>
                  <td className="num mono">{r.done && r.tokens ? compact(Math.round(r.tokens / r.done)) : "—"}</td>
                  <td>
                    {r.report ? (
                      <button type="button" className="link" onClick={() => onDoc("report", r.id)}>
                        <Icon name="check" size={12} /> {ago(now, r.report.updated)}
                      </button>
                    ) : (
                      <span className={ended ? "is-bad" : "faint"}>{t("rp.missing")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Fold>
  );
}

type Group = "all" | "done" | "open" | "parked" | "reopened";
type SortKey = "id" | "severity" | "status" | "owner" | "cycle" | "reopens" | "updated";

export function TicketTable({ s, now, onTicket }: { s: FleetState; now: number; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const reopens = useMemo(() => reopensOf(s), [s.transitions, s.board]);
  const tickets = s.board?.tickets ?? [];
  const flow = s.flow?.flow ?? [];
  const inGroup = (x: Ticket, g: Group) =>
    g === "all" ? true : g === "done" ? DONE.includes(x.status) : g === "parked" ? PARKED.includes(x.status) : g === "reopened" ? reopens.has(x.id) : !DONE.includes(x.status) && !PARKED.includes(x.status);
  const q = query.trim().toLowerCase();
  const value = (x: Ticket, key: SortKey): number | string =>
    key === "severity" ? SEVERITY_RANK[x.severity] ?? 9
    : key === "status" ? (flow.indexOf(x.status) + 1 || 99)
    : key === "cycle" ? cycleTime(x) ?? Number.MAX_SAFE_INTEGER
    : key === "reopens" ? reopens.get(x.id) ?? 0
    : key === "updated" ? x.updated
    : key === "owner" ? x.owner
    : x.id;
  const rows = tickets
    .filter((x) => inGroup(x, group))
    .filter((x) => !q || [x.id, x.title, x.owner, x.verifier, x.area].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sort.dir;
    });
  const groups: { id: Group; label: string }[] = [
    { id: "all", label: `${t("rp.all")} ${tickets.length}` },
    { id: "done", label: `${t("rp.done")} ${tickets.filter((x) => inGroup(x, "done")).length}` },
    { id: "open", label: `${t("rp.open")} ${tickets.filter((x) => inGroup(x, "open")).length}` },
    { id: "parked", label: `${t("rp.parked")} ${tickets.filter((x) => inGroup(x, "parked")).length}` },
    { id: "reopened", label: `${t("rp.reopened")} ${reopens.size}` },
  ];
  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th className={num ? "num" : ""} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className={`th-sort${sort.key === k ? " is-on" : ""}`} onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        <Icon name="chevron" size={11} className={sort.key === k && sort.dir === -1 ? "is-up" : ""} />
      </button>
    </th>
  );
  const download = () => {
    const head = ["id", "title", "severity", "status", "owner", "verifier", "area", "fix", "created", "done", "verified", "cycle_minutes", "reopens"];
    const lines = rows.map((x) => [x.id, x.title, x.severity, x.status, x.owner, x.verifier, x.area, x.fix, x.created, x.doneAt ?? "", x.verifiedAt ?? "", cycleTime(x) !== undefined ? Math.round(cycleTime(x)! / 60_000) : "", reopens.get(x.id) ?? 0].map(csvCell).join(","));
    const blob = new Blob([`${head.join(",")}\n${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${s.mission.slug}-tickets.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Fold
      id="ticket-table"
      open
      className="panel"
      title={t("rp.tickets")}
      actions={
        <span className="tbl-tools">
          <CopyChip text={() => ticketsMarkdown(t, rows, reopens)} label={t("rp.copyMd")} icon="list" />
          <button type="button" className="chip" onClick={download}>
            <Icon name="arrow" size={12} className="is-down" /> {t("rp.csv")}
          </button>
        </span>
      }
    >
      <div className="tbl-filters">
        <Slider kind="seg" label={t("rp.tickets")} value={group} onChange={setGroup} items={groups} />
        <SearchField value={query} onChange={setQuery} placeholder={t("rp.search")} />
      </div>
      <div className="tbl-wrap tbl-tall">
        <table className="tbl tbl-tickets">
          <thead>
            <tr>
              <Th k="id" label={t("rp.col.id")} />
              <th>{t("rp.col.title")}</th>
              <Th k="severity" label={t("rp.col.sev")} />
              <Th k="status" label={t("rp.col.status")} />
              <Th k="owner" label={t("rp.col.owner")} />
              <th>{t("rp.col.verifier")}</th>
              <Th k="cycle" label={t("rp.col.cycle")} num />
              <Th k="reopens" label={t("rp.col.reopens")} num />
              <Th k="updated" label={t("rp.col.updated")} num />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className="is-click" onClick={() => onTicket(x.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onTicket(x.id)}>
                <td className="mono">{x.id}</td>
                <td className="tbl-title">{x.title}</td>
                <td>{x.severity ? <span className={`sev sev-${x.severity}`}>{x.severity}</span> : "—"}</td>
                <td>
                  <span className={`st-pill st-${x.status}`}>{statusLabel(t, x.status)}</span>
                </td>
                <td className="mono">{x.owner || "—"}</td>
                <td className="mono">{x.verifier || "—"}</td>
                <td className="num mono">{cycleTime(x) !== undefined ? span(cycleTime(x)!) : "—"}</td>
                <td className={`num mono${reopens.get(x.id) ? " is-warn" : ""}`}>{reopens.get(x.id) ?? "—"}</td>
                <td className="num mono faint">{ago(now, x.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="fi-empty">{t("rp.none")}</p>}
      </div>
    </Fold>
  );
}

export function Risks({ s, onTicket }: { s: FleetState; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const tickets = s.board?.tickets ?? [];
  const groups = [
    { key: "hot", label: t("rp.hotOpen"), tone: "bad", list: tickets.filter((x) => (x.severity === "critical" || x.severity === "high") && !CLOSED.includes(x.status)) },
    { key: "reopened", label: t("rp.reopenedNow"), tone: "warn", list: tickets.filter((x) => x.status === "reopened") },
    { key: "parked", label: t("rp.parkedList"), tone: "muted", list: tickets.filter((x) => x.status === "deferred" || x.status === "wont-fix") },
  ].filter((g) => g.list.length > 0);
  return (
    <Fold id="risks" className="panel" title={t("rp.risks")}>
      {groups.length === 0 && <p className="fi-empty">{t("rp.noRisks")}</p>}
      {groups.map((g) => (
        <div key={g.key} className={`risk-group is-${g.tone}`}>
          <h3>
            {g.label} <b>{g.list.length}</b>
          </h3>
          <ul>
            {g.list.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onTicket(x.id)}>
                  <span className="mono">{x.id}</span>
                  <span className="risk-title">{x.title}</span>
                  {g.key === "parked" && x.decision && <small>{x.decision}</small>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Fold>
  );
}

export function Decisions({ s, now, onDoc }: { s: FleetState; now: number; onDoc: (kind: string, name: string) => void }) {
  const { t } = useI18n();
  const decided = (s.board?.threads ?? []).filter((x) => x.decision).sort((a, b) => b.updated.localeCompare(a.updated));
  return (
    <Fold id="decisions" className="panel" title={t("rp.decisions")}>
      {decided.length === 0 && <p className="fi-empty">{t("rp.noDecisions")}</p>}
      <ul className="dec-list">
        {decided.map((x) => (
          <li key={x.name}>
            <button type="button" onClick={() => onDoc("thread", x.name)}>
              <b>{x.title}</b>
              <span>{x.decision}</span>
              <small>
                {x.owner ? t("rp.decidedBy", { who: x.owner }) : ""} · {ago(now, x.updated)}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </Fold>
  );
}
