// The Code & infra tab: what the branches hold, what the next integration round merges, whether the ground is ready
// (pre-flight checks, services), when the commits landed, and where members' changes meet.

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentById, ago, clock, compact, endOf, startOf, statusLabel } from "../lib";
import type { AgentDef, Branch, FleetState } from "../types";
import { Num } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { spotlight } from "../ui/motion";
import { Avatar } from "./Fleet";

const short = (branch: string) => branch.replace(/^claude\//, "");
const own = (b: Branch) => b.commits.filter((c) => !c.merge);
/** The members' branches, without the integration branch (it holds the same commits again). */
const memberBranches = (s: FleetState) => (s.git?.branches ?? []).filter((b) => b.branch !== s.git?.integration);

/** The tickets a commit belongs to: the ones whose `Fix:` names its sha, and the ids its subject names. */
function ticketsOf(sha: string, subject: string, s: FleetState): string[] {
  const tickets = s.board?.tickets ?? [];
  const byFix = tickets.filter((x) => (x.fix.match(/\b[0-9a-f]{7,40}\b/gi) ?? []).some((h) => h.startsWith(sha) || sha.startsWith(h))).map((x) => x.id);
  const named = (subject.match(/\b[A-Z][A-Z0-9]{0,5}-[A-Z0-9]{1,5}\b/g) ?? []).filter((id) => tickets.some((x) => x.id === id));
  return [...new Set([...byFix, ...named])];
}

/** A button that copies a text and says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      className={`chip copy${done ? " is-on" : ""}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => setDone(true), () => setDone(false));
      }}
    >
      <Icon name={done ? "check" : "command"} size={12} />
      {done ? t("cd.copied") : label}
    </button>
  );
}

export function CodeKpis({ s }: { s: FleetState }) {
  const { t } = useI18n();
  const branches = memberBranches(s);
  const commits = branches.reduce((n, b) => n + own(b).length, 0);
  const integrated = branches.reduce((n, b) => n + own(b).filter((c) => c.integrated).length, 0);
  const ins = branches.reduce((n, b) => n + (b.stat?.insertions ?? 0), 0);
  const del = branches.reduce((n, b) => n + (b.stat?.deletions ?? 0), 0);
  const files = branches.reduce((n, b) => n + (b.stat?.files ?? 0), 0);
  const noInt = s.git?.integration === null;
  const ready = s.integration?.merges?.length ?? 0;
  const blocked = s.integration?.blocked?.length ?? 0;
  const tiles = [
    { key: "br", icon: "branch", label: t("cd.branches"), value: <Num value={branches.length} />, note: t("cd.withCommits", { n: branches.filter((b) => own(b).length > 0).length }) },
    { key: "cm", icon: "layers", label: t("cd.commits"), value: <Num value={commits} />, note: noInt ? t("kpi.noIntegration") : t("cd.integratedN", { n: integrated, pct: commits ? Math.round((integrated / commits) * 100) : 0 }), tone: !noInt && commits > 0 && integrated === commits ? "ok" : "" },
    { key: "ln", icon: "list", label: t("cd.lines"), value: <span className="diff"><b className="add">+{compact(ins)}</b> <b className="del">−{compact(del)}</b></span>, note: t("cd.files", { n: files }) },
    { key: "rd", icon: "check", label: t("cd.ready"), value: <Num value={ready} />, note: blocked ? t("cd.blockedN", { n: blocked }) : t("cd.readyNote"), tone: blocked ? "bad" : ready ? "ok" : "" },
    { key: "bs", icon: "alert", label: t("cd.base"), value: <span className="mono kpi-mono">{s.git?.base ?? "—"}</span>, note: s.git ? (s.git.baseUntouched ? t("sd.untouched") : t("sd.changed")) : "", tone: s.git && !s.git.baseUntouched ? "bad" : "ok" },
  ] as const;
  return (
    <section className="kpis" aria-label={t("tab.code")}>
      {tiles.map((x, i) => (
        <div key={x.key} className={`kpi${"tone" in x && x.tone ? ` is-${x.tone}` : ""}`} style={{ animationDelay: `${i * 40}ms` }} onPointerMove={spotlight}>
          <span className="kpi-label">
            <Icon name={x.icon} size={14} />
            {x.label}
          </span>
          <span className="kpi-value">{x.value}</span>
          {x.note && <span className="kpi-note">{x.note}</span>}
        </div>
      ))}
    </section>
  );
}

export function IntegrationRound({ s, now, onTicket }: { s: FleetState; now: number; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const p = s.integration;
  const status = (id: string) => s.board?.tickets.find((x) => x.id === id)?.status;
  const Ticket = ({ id }: { id: string }) => (
    <button type="button" className="tk-chip mono" onClick={() => onTicket(id)}>
      {id}
    </button>
  );
  return (
    <section className="panel round" aria-label={t("cd.round")}>
      <div className="sec-hd">
        <h2>{t("cd.round")}</h2>
        {p?.into && <span className="sec-note">{t("cd.roundNote", { branch: short(p.into), head: p.head ?? "", ago: ago(now, p.at) })}</span>}
        {p?.fullSuite && (p.merges?.length ?? 0) > 0 && (
          <span className={`pill${p.fullSuite.needed ? " is-warn" : " is-ok"}`} title={p.fullSuite.needed ? t("cd.fullSuiteWhy", { list: p.fullSuite.because.join(", ") }) : ""}>
            {p.fullSuite.needed ? t("cd.fullSuite") : t("cd.scoped")}
          </span>
        )}
      </div>
      {!p && <p className="fi-empty">{t("cd.loading")}</p>}
      {p?.error && <p className="round-error">{t("cd.roundError", { why: p.error })}</p>}
      {p && !p.error && (
        <>
          {(p.merges ?? []).length === 0 && <p className="fi-empty">{t("cd.roundNone")}</p>}
          <ol className="merges">
            {(p.merges ?? []).map((m, i) => (
              <li key={m.sha} className="merge" style={{ animationDelay: `${i * 50}ms` }}>
                <span className="merge-n">{i + 1}</span>
                <div className="merge-body">
                  <div className="merge-top">
                    {m.tickets.map((id) => (
                      <Ticket key={id} id={id} />
                    ))}
                    <span className="merge-meta">
                      {t("cd.commitsN", { n: m.commits })} · <span className="mono">{m.sha}</span>
                    </span>
                  </div>
                  <code className="merge-msg">{m.message}</code>
                  <div className="merge-foot">
                    {m.packages.map((pk) => (
                      <span key={pk} className="pkg mono">
                        {pk}
                      </span>
                    ))}
                    <CopyButton text={m.command} label={t("cd.copy")} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {(p.blocked ?? []).length > 0 && (
            <div className="round-group is-bad">
              <h3>
                <Icon name="alert" size={13} /> {t("cd.blocked")}
              </h3>
              <ul>
                {p.blocked!.map((b) => (
                  <li key={b.id}>
                    <Ticket id={b.id} />
                    <span>
                      {b.below.map((k) => t("cd.blockedNote", { sha: k.sha, ticket: k.ticket, status: statusLabel(t, k.status), owner: b.owner || "?" })).join(" ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(p.merged ?? []).length > 0 && (
            <div className="round-group is-info">
              <h3>
                <Icon name="check" size={13} /> {t("cd.already", { branch: short(p.into ?? "") })}
              </h3>
              <div className="chips">
                {p.merged!.map((m) => (
                  <Ticket key={m.id} id={m.id} />
                ))}
              </div>
            </div>
          )}
          {(p.missing ?? []).length > 0 && (
            <div className="round-group is-warn">
              <h3>{t("cd.missing")}</h3>
              <ul>
                {p.missing!.map((m) => (
                  <li key={m.id}>
                    <Ticket id={m.id} /> <span className="mono faint">{m.fix}</span> {status(m.id) && <span className="faint">· {statusLabel(t, status(m.id)!)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(p.unticketed ?? []).length > 0 && (
            <div className="round-group is-warn">
              <h3>{t("cd.unticketed")}</h3>
              <ul>
                {p.unticketed!.map((u) => (
                  <li key={u.sha}>
                    <span className="mono">{u.sha}</span> <span>{u.subject}</span> <span className="faint">· {u.with}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Preflight({ s, now }: { s: FleetState; now: number }) {
  const { t } = useI18n();
  const d = s.doctor;
  const order = { fail: 0, warn: 1, ok: 2 } as const;
  const checks = [...(d?.checks ?? [])].sort((a, b) => order[a.state] - order[b.state]);
  const counts = { fail: checks.filter((c) => c.state === "fail").length, warn: checks.filter((c) => c.state === "warn").length };
  return (
    <section className="panel" aria-label={t("cd.preflight")}>
      <div className="sec-hd">
        <h2>{t("cd.preflight")}</h2>
        {d && <span className="sec-note">{t("cd.preflightNote", { ago: ago(now, d.at) })}</span>}
        {d?.checks && <span className={`pill${counts.fail ? " is-bad" : counts.warn ? " is-warn" : " is-ok"}`}>{counts.fail ? t("cd.fails", { n: counts.fail }) : counts.warn ? t("cd.warns", { n: counts.warn }) : t("cd.allGood")}</span>}
      </div>
      {!d && <p className="fi-empty">{t("cd.loading")}</p>}
      {d?.error && <p className="round-error">{d.error}</p>}
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.name} className={`check is-${c.state}`}>
            <i aria-hidden="true">{c.state === "ok" ? "✓" : c.state === "warn" ? "!" : "✗"}</i>
            <b>{c.name}</b>
            <span>{c.detail}</span>
          </li>
        ))}
      </ul>
      <h3 className="sub-hd">
        {t("cd.services")}
        {s.board?.stack && <span className="sec-note">{s.board.stack}</span>}
      </h3>
      <div className="probes">
        {s.probes.map((p) => (
          <span key={p.port} className={`probe${p.up ? " is-up" : ""}`}>
            <i />
            {p.name}
            <span className="mono">:{p.port}</span>
          </span>
        ))}
        {s.probes.length === 0 && <span className="fi-empty">{t("sd.noProbes")}</span>}
      </div>
    </section>
  );
}

/** Width of a box, kept current as the layout changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/** One lane per branch across the mission's window, a dot per commit: filled once it reached the integration branch. */
export function CommitTimeline({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const lanes = [...memberBranches(s), ...(s.git?.branches ?? []).filter((b) => b.branch === s.git?.integration)];
  const times = lanes.flatMap((b) => b.commits.map((c) => Date.parse(c.at)));
  // The mission's window; what a branch carried from before it (merges of the base, an earlier round) sits in a
  // gutter on the left instead of squeezing the window.
  const start = startOf(s.mission);
  const end = Math.max(endOf(s.mission), ...times);
  const early = times.some((at) => at < start);
  const label = 120;
  const gutter = early ? 34 : 0;
  const pad = { r: 14, t: 22, b: 24 };
  const lane = 30;
  const h = pad.t + lanes.length * lane + pad.b;
  const iw = w - label - gutter - pad.r;
  const X = (at: number) => (at < start ? label + gutter / 2 : label + gutter + ((at - start) / (end - start)) * iw);
  const phases = s.mission.phases ?? [];
  const steps = [15, 30, 60, 120, 240, 360, 720, 1440].map((m) => m * 60_000);
  const step = steps.find((x) => (end - start) / x <= Math.max(3, Math.floor(iw / 90))) ?? steps.at(-1)!;
  const ticks: number[] = [];
  for (let at = Math.ceil(start / step) * step; at <= end; at += step) ticks.push(at);
  if (lanes.length === 0) return <p className="fi-empty">{t("cd.noChanges")}</p>;
  return (
    <div className="ct" ref={ref}>
      <svg width={w} height={h} role="img" aria-label={t("cd.timeline")}>
        {phases.map((p, i) => {
          const x1 = X(Math.max(start, Date.parse(p.from)));
          const x2 = X(Math.min(end, Date.parse(p.to)));
          return (
            <g key={p.name} className={`ct-phase${i % 2 ? " is-odd" : ""}${now >= Date.parse(p.from) && now < Date.parse(p.to) ? " is-now" : ""}`}>
              <rect x={x1} y={pad.t - 4} width={Math.max(0, x2 - x1)} height={h - pad.t - pad.b + 4} />
              <text x={x1 + 6} y={12}>
                {p.name}
              </text>
            </g>
          );
        })}
        {early && (
          <g className="ct-early">
            <rect x={label + 2} y={pad.t - 4} width={gutter - 6} height={h - pad.t - pad.b + 4} rx={4} />
            <text x={label + gutter / 2} y={h - 8} textAnchor="middle">
              {t("cd.earlier")}
            </text>
          </g>
        )}
        {ticks.map((at) => (
          <g key={at}>
            <line x1={X(at)} x2={X(at)} y1={pad.t} y2={h - pad.b} className="ct-grid" />
            <text x={X(at)} y={h - 8} className="ct-tick" textAnchor="middle">
              {clock(at, locale)}
            </text>
          </g>
        ))}
        {now >= start && now <= end && <line x1={X(now)} x2={X(now)} y1={pad.t} y2={h - pad.b} className="ct-now" />}
        {lanes.map((b, i) => {
          const y = pad.t + i * lane + lane / 2;
          const isInt = b.branch === s.git?.integration;
          const a = agentById(s, b.agent);
          return (
            <g key={b.branch} className={isInt ? "ct-int" : ""}>
              <line x1={label + gutter} x2={w - pad.r} y1={y} y2={y} className="ct-lane" />
              <text x={label - 8} y={y + 4} textAnchor="end" className="ct-label" onClick={() => a && onAgent(a.id)}>
                {isInt ? t("sd.integration") : b.agent}
              </text>
              {[...b.commits].reverse().map((c) => {
                const x = X(Date.parse(c.at));
                const show = () => setHover({ x, y, text: c.subject, sub: `${c.sha} · ${clock(c.at, locale)}${c.merge ? ` · ${t("cd.mergeCommit")}` : ""}${!isInt ? ` · ${c.integrated ? t("cd.inInt") : t("cd.notInInt")}` : ""}` });
                return c.merge ? (
                  <rect key={c.sha} x={x - 4} y={y - 4} width={8} height={8} transform={`rotate(45 ${x} ${y})`} className="ct-merge" onPointerEnter={show} onPointerLeave={() => setHover(null)} />
                ) : (
                  <circle key={c.sha} cx={x} cy={y} r={5} className={`ct-dot${c.integrated || isInt ? " is-in" : ""}`} onPointerEnter={show} onPointerLeave={() => setHover(null)} />
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tip" style={{ left: Math.min(Math.max(8, hover.x + 12), w - 260), top: Math.max(0, hover.y - 10) }}>
          <b>{hover.text}</b>
          <span className="mono">{hover.sub}</span>
        </div>
      )}
      <div className="ct-legend">
        <span>
          <i className="ct-key is-in" /> {t("cd.inInt")}
        </span>
        <span>
          <i className="ct-key" /> {t("cd.notInInt")}
        </span>
        <span>
          <i className="ct-key is-merge" /> {t("cd.mergeCommit")}
        </span>
      </div>
    </div>
  );
}

export function BranchList({ s, now, onTicket }: { s: FleetState; now: number; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const g = s.git;
  if (!g) return null;
  const integration = g.branches.find((b) => b.branch === g.integration);
  const rows = memberBranches(s);
  const max = Math.max(1, ...rows.map((b) => own(b).length));
  return (
    <section className="panel" aria-label={t("sd.branches")}>
      <div className="sec-hd">
        <h2>{t("sd.branches")}</h2>
      </div>
      <div className={`base${g.baseUntouched ? " is-ok" : " is-bad"}`}>
        <span className="mono">{g.base}</span> @ <span className="mono">{g.baseHead}</span>
        <b>{g.baseUntouched ? t("sd.untouched") : t("sd.changed")}</b>
      </div>
      {g.integration ? (
        <div className="int">
          <span className="int-k">{t("sd.integration")}</span>
          <span className="mono int-v">{short(g.integration)}</span>
          <span className="int-n">{t("sd.merges", { m: integration?.commits.filter((c) => c.merge).length ?? 0, c: integration?.commits.filter((c) => !c.merge).length ?? 0 })}</span>
        </div>
      ) : null}
      <ul className="br-list">
        {rows.map((b) => {
          const a = agentById(s, b.agent);
          const mine = own(b);
          const inInt = mine.filter((c) => c.integrated).length;
          const last = mine[0];
          const isOpen = open === b.branch;
          return (
            <li key={b.branch} className={`br-item${isOpen ? " is-open" : ""}`}>
              <button type="button" className="br" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.branch)}>
                {a ? <Avatar agent={a} size="sm" /> : <span />}
                <span className="br-main">
                  <span className="br-name mono">{short(b.branch)}</span>
                  <span className="br-last">{last ? `${last.subject} · ${ago(now, last.at)}` : t("sd.noCommit")}</span>
                </span>
                <span className="br-bar" title={g.integration ? `${inInt}/${mine.length} ${t("dr.integrated")}` : t("kpi.noIntegration")}>
                  <i style={{ width: `${(mine.length / max) * 100}%` }} />
                  {g.integration && <i className="is-in" style={{ width: `${(inInt / max) * 100}%` }} />}
                </span>
                <span className="br-n mono">{g.integration ? `${inInt}/${mine.length}` : mine.length}</span>
                {b.stat ? (
                  <span className="br-diff mono">
                    <b className="add">+{compact(b.stat.insertions)}</b> <b className="del">−{compact(b.stat.deletions)}</b>
                  </span>
                ) : (
                  <span />
                )}
                <Icon name="chevron" size={14} className="br-chev" />
              </button>
              {isOpen && (
                <ul className="cm-list">
                  {b.commits.map((c) => (
                    <li key={c.sha} className={c.merge ? "is-merge" : c.integrated ? "is-in" : ""}>
                      <i aria-hidden="true" />
                      <span className="mono cm-sha">{c.sha}</span>
                      <span className="cm-subject">{c.subject}</span>
                      {ticketsOf(c.sha, c.subject, s).map((id) => (
                        <button key={id} type="button" className="tk-chip mono" onClick={() => onTicket(id)}>
                          {id}
                        </button>
                      ))}
                      <span className="cm-at mono">{ago(now, c.at)}</span>
                    </li>
                  ))}
                  {b.commits.length === 0 && <li className="fi-empty">{t("sd.noCommit")}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Whether a member's `owns` covers a package: `apps/api` covers `apps/api`, and `apps` covers it too. */
const covers = (agent: AgentDef, pkg: string) =>
  (agent.owns ?? []).some((raw) => {
    const p = raw.replaceAll("\\", "/").replace(/^\.\//, "").replace(/(\/\*\*?)+$/, "").replace(/\/+$/, "");
    return p === pkg || pkg.startsWith(`${p}/`) || p.startsWith(`${pkg}/`);
  });

const HOTSPOTS_SHOWN = 6;

export function Hotspots({ s, onAgent }: { s: FleetState; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const rows = new Map<string, { agent: string; files: number }[]>();
  for (const b of memberBranches(s)) {
    for (const [pkg, files] of Object.entries(b.packages ?? {})) {
      if (!rows.has(pkg)) rows.set(pkg, []);
      rows.get(pkg)!.push({ agent: b.agent, files });
    }
  }
  const list = [...rows.entries()]
    .map(([pkg, who]) => ({ pkg, who: who.sort((x, y) => y.files - x.files), owners: s.agents.filter((a) => covers(a, pkg)) }))
    .sort((a, b) => b.who.length - a.who.length || b.who.reduce((n, w) => n + w.files, 0) - a.who.reduce((n, w) => n + w.files, 0));
  const most = Math.max(1, ...list.flatMap((r) => r.who.map((w) => w.files)));
  return (
    <section className="panel" aria-label={t("cd.hotspots")}>
      <div className="sec-hd">
        <h2>{t("cd.hotspots")}</h2>
        <span className="sec-note">{t("cd.hotspotsNote")}</span>
      </div>
      {list.length === 0 && <p className="fi-empty">{t("cd.noChanges")}</p>}
      <ul className="hot-list">
        {(all ? list : list.slice(0, HOTSPOTS_SHOWN)).map((r) => {
          const outside = r.who.filter((w) => {
            const a = agentById(s, w.agent);
            return a && (a.owns ?? []).length > 0 && !covers(a, r.pkg);
          });
          return (
            <li key={r.pkg} className={`hot${r.who.length > 1 ? " is-shared" : ""}`}>
              <div className="hot-hd">
                <span className="mono hot-pkg">{r.pkg}</span>
                {r.who.length > 1 && <span className="pill is-warn">{t("cd.shared", { n: r.who.length })}</span>}
                <span className="hot-owner">{r.owners.length > 0 ? `${t("cd.owner")}: ${r.owners.map((a) => a.id).join(", ")}` : t("cd.noOwner")}</span>
              </div>
              <div className="hot-bars">
                {r.who.map((w) => {
                  const a = agentById(s, w.agent);
                  const off = outside.some((o) => o.agent === w.agent);
                  return (
                    <button key={w.agent} type="button" className={`hot-bar${off ? " is-off" : ""}`} onClick={() => a && onAgent(a.id)} title={off ? t("cd.outside", { who: w.agent }) : ""}>
                      {a && <Avatar agent={a} size="sm" />}
                      <span className="hot-who">{w.agent}</span>
                      <span className="hot-track">
                        <i style={{ width: `${(w.files / most) * 100}%` }} />
                      </span>
                      <span className="mono hot-n">{t("cd.files", { n: w.files })}</span>
                      {off && <Icon name="alert" size={13} className="hot-alert" />}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {list.length > HOTSPOTS_SHOWN && (
        <button type="button" className="chip more" onClick={() => setAll(!all)}>
          {all ? t("cd.showFewer") : t("cd.showAll", { n: list.length })}
        </button>
      )}
    </section>
  );
}
