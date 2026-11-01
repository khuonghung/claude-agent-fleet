import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentsIn, CLOSED, cycleTime, median, SEVERITY_RANK, span, staleness, statusLabel, statusSince } from "../lib";
import type { FleetState, Thread, Ticket } from "../types";
import { SearchField, Slider } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { spotlight, useFlip } from "../ui/motion";
import { Avatar } from "./Fleet";

type View = "board" | "list";
type SortKey = "id" | "title" | "sev" | "status" | "owner" | "verifier" | "stage" | "area";
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const COLUMN_LIMIT = 12;

/** What the viewer chose last time (a per-viewer convenience; the page works without it). */
interface Prefs {
  view: View;
  sev: string[];
  owner: string;
  attention: boolean;
  parked: boolean;
}
const DEFAULTS: Prefs = { view: "board", sev: [], owner: "", attention: false, parked: false };
const loadPrefs = (): Prefs => {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem("fleet-flow") ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
};

/** Everything a card or row needs about one ticket, worked out once per render. */
interface Row {
  tk: Ticket;
  owners: ReturnType<typeof agentsIn>;
  crew: ReturnType<typeof agentsIn>;
  verifier: ReturnType<typeof agentsIn>[number] | undefined;
  since: number;
  stale: boolean;
  idle: number;
  attention: boolean;
  thread: Thread | undefined;
  fresh: { from: string | null } | undefined;
}

function rowsOf(s: FleetState, now: number): Row[] {
  const threads = s.board?.threads ?? [];
  return (s.board?.tickets ?? []).map((tk) => {
    const { stale, idle } = staleness(s, tk, now);
    const moved = s.transitions.findLast((x) => x.id === tk.id);
    return {
      tk,
      owners: agentsIn(s, tk.owner),
      crew: agentsIn(s, tk.crew),
      verifier: agentsIn(s, tk.verifier)[0],
      since: statusSince(s, tk),
      stale,
      idle,
      attention: stale || s.flow.attention.includes(tk.status) || (tk.severity === "critical" && !CLOSED.includes(tk.status)),
      thread: threads.find((th) => th.ticket === tk.id || th.name === tk.id),
      fresh: moved && now - Date.parse(moved.at) < 3 * 60_000 ? { from: moved.from } : undefined,
    };
  });
}

/** In a column: what needs someone first (stale, reopened), then by severity, then the most recently touched. */
const byUrgency = (a: Row, b: Row) => Number(b.attention) - Number(a.attention) || (SEVERITY_RANK[a.tk.severity] ?? 9) - (SEVERITY_RANK[b.tk.severity] ?? 9) || b.tk.updated.localeCompare(a.tk.updated);

function People({ row }: { row: Row }) {
  const { t } = useI18n();
  const doers = [...row.owners, ...row.crew.filter((c) => !row.owners.includes(c))];
  return (
    <span className="tk-people">
      <span className="tk-stack" title={`${t("flow.h.owner")}: ${row.tk.owner}${row.tk.crew ? ` · ${t("flow.crew")}: ${row.tk.crew}` : ""}`}>
        {doers.slice(0, 3).map((a) => (
          <Avatar key={a.id} agent={a} size="sm" />
        ))}
        {doers.length > 3 && <em>+{doers.length - 3}</em>}
      </span>
      {row.verifier && (
        <span className="tk-verifier" title={`${t("flow.h.verifier")}: ${row.tk.verifier}`}>
          <Icon name="check" size={11} />
          <Avatar agent={row.verifier} size="sm" />
        </span>
      )}
    </span>
  );
}

function Age({ row, now }: { row: Row; now: number }) {
  const { t } = useI18n();
  const closed = CLOSED.includes(row.tk.status);
  if (row.stale)
    return (
      <span className="tk-age is-stale" title={t("flow.stale", { t: span(row.idle) })}>
        <Icon name="stall" size={12} />
        {span(row.idle)}
      </span>
    );
  return (
    <span className="tk-age" title={t("flow.inStage", { t: span(now - row.since) })}>
      {row.fresh?.from ? `${statusLabel(t, row.fresh.from)} → ` : ""}
      {closed ? span(now - row.since) : <b>{span(now - row.since)}</b>}
    </span>
  );
}

function Card({ row, now, onOpen }: { row: Row; now: number; onOpen: () => void }) {
  const { t } = useI18n();
  const { tk, thread } = row;
  return (
    <button
      type="button"
      data-flip={tk.id}
      className={`tk sev-${tk.severity || "none"}${row.fresh ? " is-fresh" : ""}${row.stale ? " is-stale" : ""}`}
      onClick={onOpen}
      onPointerMove={spotlight}
    >
      <span className="tk-top">
        <span className="tk-id mono">{tk.id}</span>
        <span className={`sev sev-${tk.severity || "none"}`}>{tk.severity || "?"}</span>
        <span className="tk-flags">
          {thread && (
            <span className={`tk-flag th-${thread.status}`} title={`${t("flow.thread")}: ${thread.title}`}>
              <Icon name="chat" size={12} />
              {thread.posts.length}
            </span>
          )}
          {tk.fix && (
            <span className="tk-flag" title={tk.fix}>
              <Icon name="branch" size={12} />
            </span>
          )}
        </span>
      </span>
      <span className="tk-title">{tk.title}</span>
      <span className="tk-foot">
        <People row={row} />
        <Age row={row} now={now} />
      </span>
    </button>
  );
}

/** The pipeline at a glance: one segment per stage, as wide as its share of tickets; a click focuses that stage. */
function Strip({ s, rows, stage, onStage }: { s: FleetState; rows: Row[]; stage: string; onStage: (id: string) => void }) {
  const { t } = useI18n();
  const stages = [...s.flow.attention, ...s.flow.flow, ...(rows.some((r) => s.flow.parked.includes(r.tk.status)) ? ["parked"] : [])];
  const count = (id: string) => rows.filter((r) => (id === "parked" ? s.flow.parked.includes(r.tk.status) : r.tk.status === id)).length;
  const total = Math.max(1, rows.length);
  return (
    <div className="strip" role="group" aria-label={t("flow.title")}>
      {stages.map((id) => {
        const n = count(id);
        if (n === 0 && s.flow.attention.includes(id)) return null;
        const label = id === "parked" ? t("flow.parked", { n: "" }).replace(/·\s*$/, "") : statusLabel(t, id);
        return (
          <button
            key={id}
            type="button"
            className={`strip-seg st-${id}${n === 0 ? " is-empty" : ""}${stage === id ? " is-on" : ""}`}
            style={{ flexGrow: n === 0 ? 0 : Math.max(1, (n / total) * 12) }}
            onClick={() => onStage(stage === id ? "" : id)}
            aria-pressed={stage === id}
            title={`${label}: ${n}`}
          >
            <b>{n}</b>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Metrics({ s, rows, now }: { s: FleetState; rows: Row[]; now: number }) {
  const { t } = useI18n();
  const flight = rows.filter((r) => !CLOSED.includes(r.tk.status)).length;
  const waiting = rows.filter((r) => r.tk.status === "fixed" || r.tk.status === "integrated").length;
  const verified = rows.filter((r) => r.tk.status === "verified").length;
  const cycle = median(rows.map((r) => cycleTime(r.tk)).filter((x): x is number => x !== undefined));
  const rate = rows.filter((r) => r.tk.verifiedAt && now - Date.parse(r.tk.verifiedAt) < 3_600_000).length;
  const stale = rows.filter((r) => r.stale).length;
  const items = [
    { k: "flow.m.flight", v: String(flight), icon: "bolt" },
    { k: "flow.m.waiting", v: String(waiting), icon: "clock", tone: waiting > 4 ? "warn" : "" },
    { k: "flow.m.verified", v: `${verified}/${rows.length}`, icon: "check", tone: "ok" },
    { k: "flow.m.cycle", v: cycle === undefined ? "—" : span(cycle), icon: "arrow" },
    { k: "flow.m.rate", v: String(rate), icon: "spark" },
    { k: "flow.m.stale", v: String(stale), icon: "stall", tone: stale ? "bad" : "" },
  ] as const;
  void s;
  return (
    <div className="fm">
      {items.map((x) => (
        <span key={x.k} className={`fm-item${"tone" in x && x.tone ? ` is-${x.tone}` : ""}`}>
          <Icon name={x.icon} size={14} />
          <b>{x.v}</b>
          <span>{t(x.k)}</span>
        </span>
      ))}
    </div>
  );
}

function Column({ s, id, label, list, now, tone, wide, onTicket }: { s: FleetState; id: string; label: string; list: Row[]; now: number; tone: string; wide: boolean; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = wide || all ? list : list.slice(0, COLUMN_LIMIT);
  void s;
  if (list.length === 0 && !wide)
    return (
      <div className={`col is-rail st-${id}`} title={`${label}: 0`}>
        <b>0</b>
        <span>{label}</span>
      </div>
    );
  return (
    <div className={`col st-${id}${tone ? ` is-${tone}` : ""}${wide ? " is-wide" : ""}`}>
      <div className="col-hd">
        <span>{label}</span>
        <b>{list.length}</b>
      </div>
      <div className="col-body">
        {shown.map((r) => (
          <Card key={r.tk.id} row={r} now={now} onOpen={() => onTicket(r.tk.id)} />
        ))}
        {list.length === 0 && <span className="col-empty">{t("flow.empty")}</span>}
        {!wide && list.length > COLUMN_LIMIT && (
          <button type="button" className="col-more" onClick={() => setAll((v) => !v)}>
            {all ? t("flow.less") : t("flow.more", { n: list.length })}
          </button>
        )}
      </div>
    </div>
  );
}

function List({ rows, now, onTicket }: { rows: Row[]; now: number; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "sev", dir: 1 });
  const value = (r: Row, key: SortKey): string | number =>
    key === "sev" ? (SEVERITY_RANK[r.tk.severity] ?? 9)
    : key === "stage" ? -(now - r.since)
    : key === "owner" ? r.tk.owner
    : key === "verifier" ? r.tk.verifier
    : key === "status" ? r.tk.status
    : key === "area" ? r.tk.area
    : key === "title" ? r.tk.title
    : r.tk.id;
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir || byUrgency(a, b);
  });
  const head: [SortKey, string][] = [
    ["id", "flow.h.id"],
    ["title", "flow.h.title"],
    ["sev", "flow.h.sev"],
    ["status", "flow.h.status"],
    ["owner", "flow.h.owner"],
    ["verifier", "flow.h.verifier"],
    ["stage", "flow.h.stage"],
    ["area", "flow.h.area"],
  ];
  return (
    <div className="tl" role="table" aria-label={t("flow.title")}>
      <div className="tl-head" role="row">
        {head.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="columnheader"
            aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
            className={sort.key === key ? "is-on" : ""}
            onClick={() => setSort((cur) => ({ key, dir: cur.key === key ? (cur.dir === 1 ? -1 : 1) : 1 }))}
          >
            {t(label as Parameters<typeof t>[0])}
            {sort.key === key && <Icon name="chevron" size={12} className={sort.dir === -1 ? "is-up" : ""} />}
          </button>
        ))}
      </div>
      {sorted.map((r) => (
        <button key={r.tk.id} type="button" role="row" data-flip={r.tk.id} className={`tl-row sev-${r.tk.severity || "none"}${r.stale ? " is-stale" : ""}`} onClick={() => onTicket(r.tk.id)}>
          <span className="mono">{r.tk.id}</span>
          <span className="tl-title">
            {r.tk.title}
            {r.thread && <Icon name="chat" size={12} />}
          </span>
          <span>
            <span className={`sev sev-${r.tk.severity || "none"}`}>{r.tk.severity || "?"}</span>
          </span>
          <span>
            <span className={`tl-status st-${r.tk.status}`}>{statusLabel(t, r.tk.status)}</span>
          </span>
          <span>
            <People row={{ ...r, verifier: undefined }} />
          </span>
          <span>{r.verifier ? <Avatar agent={r.verifier} size="sm" /> : "—"}</span>
          <span>
            <Age row={r} now={now} />
          </span>
          <span className="tl-area mono" title={r.tk.area}>
            {r.tk.area || "—"}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Flow({ s, now, onTicket }: { s: FleetState; now: number; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const set = (next: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...next }));
  useEffect(() => {
    try {
      localStorage.setItem("fleet-flow", JSON.stringify(prefs));
    } catch {
      // Private window: the choice lasts this visit.
    }
  }, [prefs]);

  const board = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => rowsOf(s, now), [s, now]);
  useFlip(board, [s.rev, q, stage, prefs]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = rows.filter((r) => {
    const text = `${r.tk.id} ${r.tk.title} ${r.tk.owner} ${r.tk.crew ?? ""} ${r.tk.verifier} ${r.tk.severity} ${r.tk.area} ${r.tk.status}`.toLowerCase();
    return (
      words.every((w) => text.includes(w)) &&
      (prefs.sev.length === 0 || prefs.sev.includes(r.tk.severity)) &&
      (!prefs.owner || r.owners.some((a) => a.id === prefs.owner) || r.crew.some((a) => a.id === prefs.owner) || r.verifier?.id === prefs.owner) &&
      (!prefs.attention || r.attention)
    );
  });
  const parkedOf = (r: Row) => s.flow.parked.includes(r.tk.status);
  const inStage = (r: Row, id: string) => (id === "parked" ? parkedOf(r) : r.tk.status === id);
  const known = new Set([...s.flow.flow, ...s.flow.parked, ...s.flow.attention]);
  const other = [...new Set(filtered.filter((r) => !known.has(r.tk.status)).map((r) => r.tk.status))];

  const columns = stage
    ? [{ id: stage, statuses: [stage], tone: s.flow.attention.includes(stage) ? "bad" : "" }]
    : [
        ...s.flow.attention.map((id) => ({ id, statuses: [id], tone: "bad" })),
        ...s.flow.flow.map((id) => ({ id, statuses: [id], tone: "" })),
        ...(other.length ? [{ id: "other", statuses: other, tone: "" }] : []),
        ...(prefs.parked ? [{ id: "parked", statuses: s.flow.parked, tone: "parked" }] : []),
      ];
  // Open work: what needs someone first; finished or parked work: the most recent first.
  const listOf = (statuses: string[], id: string) => {
    const list = filtered.filter((r) => (id === "parked" ? parkedOf(r) : id === stage ? inStage(r, id) : statuses.includes(r.tk.status)));
    return id === "parked" || CLOSED.includes(id) ? list.sort((a, b) => b.since - a.since) : list.sort(byUrgency);
  };
  const visible = columns.filter((c) => !(c.tone === "bad" && listOf(c.statuses, c.id).length === 0));
  // With a single stage holding tickets, it spreads its cards across the board instead of one long column.
  const spread = stage !== "" || visible.filter((c) => listOf(c.statuses, c.id).length > 0).length === 1;
  const ownerCounts = s.agents.map((a) => ({ a, n: rows.filter((r) => r.owners.includes(a) || r.crew.includes(a)).length })).filter((x) => x.n > 0);
  const attentionCount = rows.filter((r) => r.attention).length;
  const filtersOn = prefs.sev.length > 0 || prefs.owner !== "" || prefs.attention || q !== "" || stage !== "";
  const listRows = filtered.filter((r) => (stage ? inStage(r, stage) : prefs.parked || !parkedOf(r)));
  const found = rows.filter((r) => Date.parse(r.tk.created) >= Date.parse(s.mission.startAt)).length;
  const label = (id: string) => (id === "other" ? t("flow.other") : id === "parked" ? t("flow.parked", { n: "" }).replace(/·\s*$/, "") : statusLabel(t, id));

  return (
    <section className="flow" aria-label={t("flow.title")}>
      <div className="sec-hd">
        <h2>{t("flow.title")}</h2>
        <span className="sec-note">{t("flow.note", { n: rows.length, m: found })}</span>
        <Slider
          kind="seg"
          label={t("flow.title")}
          value={prefs.view}
          onChange={(view) => set({ view })}
          items={[
            { id: "board", label: <><Icon name="board" size={13} /> {t("flow.board")}</> },
            { id: "list", label: <><Icon name="list" size={13} /> {t("flow.list")}</> },
          ]}
        />
        <SearchField value={q} onChange={setQ} placeholder={t("flow.search")} />
      </div>

      <Strip s={s} rows={rows} stage={stage} onStage={setStage} />
      <Metrics s={s} rows={rows} now={now} />

      <div className="flt">
        <Icon name="filter" size={14} className="flt-icon" />
        {SEVERITIES.map((sev) => {
          const n = rows.filter((r) => r.tk.severity === sev).length;
          const on = prefs.sev.includes(sev);
          return (
            <button key={sev} type="button" className={`chip sev-chip sev-${sev}${on ? " is-on" : ""}`} aria-pressed={on} disabled={n === 0} onClick={() => set({ sev: on ? prefs.sev.filter((x) => x !== sev) : [...prefs.sev, sev] })}>
              <i />
              {sev} <small>{n}</small>
            </button>
          );
        })}
        <span className="flt-sep" />
        <button type="button" className={`chip${prefs.attention ? " is-on is-bad" : ""}`} aria-pressed={prefs.attention} onClick={() => set({ attention: !prefs.attention })}>
          <Icon name="alert" size={12} />
          {t("flow.attention", { n: attentionCount })}
        </button>
        <button type="button" className={`chip${prefs.parked ? " is-on" : ""}`} aria-pressed={prefs.parked} onClick={() => set({ parked: !prefs.parked })}>
          {t("flow.parked", { n: rows.filter(parkedOf).length })}
        </button>
        <span className="flt-sep" />
        <div className="flt-owners" role="group" aria-label={t("flow.byOwner")}>
          {ownerCounts.map(({ a, n }) => (
            <button key={a.id} type="button" className={`chip chip-av${prefs.owner === a.id ? " is-on" : ""}`} aria-pressed={prefs.owner === a.id} title={`${a.name} · ${n}`} onClick={() => set({ owner: prefs.owner === a.id ? "" : a.id })}>
              <Avatar agent={a} size="sm" />
            </button>
          ))}
        </div>
        <span className="flt-count">{t("flow.shown", { n: prefs.view === "list" ? listRows.length : filtered.length, m: rows.length })}</span>
        {filtersOn && (
          <button type="button" className="chip flt-clear" onClick={() => (setQ(""), setStage(""), set({ sev: [], owner: "", attention: false }))}>
            <Icon name="close" size={12} />
            {t("flow.clear")}
          </button>
        )}
      </div>

      {prefs.view === "board" ? (
        <div className={`kanban${stage ? " is-focused" : ""}`} ref={board}>
          {visible.map((col) => {
            const list = listOf(col.statuses, col.id);
            return <Column key={col.id} s={s} id={col.id} label={label(col.id)} list={list} now={now} tone={col.tone} wide={stage !== "" || (spread && list.length > 0)} onTicket={onTicket} />;
          })}
        </div>
      ) : (
        <div ref={board}>{listRows.length ? <List rows={listRows} now={now} onTicket={onTicket} /> : null}</div>
      )}
      {(prefs.view === "board" ? filtered.length : listRows.length) === 0 && rows.length > 0 && <p className="flow-none">{t("flow.none")}</p>}
    </section>
  );
}
