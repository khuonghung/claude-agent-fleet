import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentStatus, agentStatusLabel, clock, compact, dateTime } from "../lib";
import type { AgentDef, FleetState } from "../types";
import { Icon } from "../ui/Icons";
import { spotlight } from "../ui/motion";
import { Fold, Slider } from "../ui/Controls";
import { Fleet, ModelChip } from "./Fleet";
import { Mascot } from "./Mascot";

/** The ids from a member up to the top of the chart, so hovering a member lights its reporting line. */
function chainOf(s: FleetState, id: string | null): Set<string> {
  const out = new Set<string>();
  for (let at = id ? s.agents.find((a) => a.id === id) : undefined; at && !out.has(at.id); at = s.agents.find((a) => a.id === at!.reportsTo)) out.add(at.id);
  return out;
}

function Node({ s, agent, now, onAgent, chain, onHover }: { s: FleetState; agent: AgentDef; now: number; onAgent: (id: string) => void; chain: Set<string>; onHover: (id: string | null) => void }) {
  const { t } = useI18n();
  const reports = s.agents.filter((a) => a.reportsTo === agent.id);
  const leaves = reports.length >= 3 && reports.every((r) => !s.agents.some((a) => a.reportsTo === r.id));
  const tele = s.telemetry[agent.id];
  const st = agentStatus(tele, now);
  return (
    <li className={chain.has(agent.id) ? "is-chain" : ""}>
      <button
        type="button"
        className={`org-node sq-${agent.squad} is-${st.kind}`}
        onClick={() => onAgent(agent.id)}
        onPointerEnter={() => onHover(agent.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(agent.id)}
        onBlur={() => onHover(null)}
        onPointerMove={spotlight}
      >
        <Mascot agent={agent} kind={st.kind} size={46} />
        <span className="org-id">
          <b>{agent.name}</b>
          <span>{agent.title ?? agent.role}</span>
          <span className="org-meta">
            <ModelChip agent={agent} t={tele} />
            <span className={`org-state st-${st.kind}`}>
              <i />
              {agentStatusLabel(t, st)}
            </span>
          </span>
        </span>
      </button>
      {reports.length > 0 && (
        // Many members with no reports of their own sit in a compact grid instead of one wide row.
        <ul
          className={leaves ? "org-leaves" : undefined}
          style={leaves ? { gridTemplateColumns: `repeat(${Math.min(3, Math.ceil(reports.length / 2))}, max-content)` } : undefined}
        >
          {reports.map((r) => (
            <Node key={r.id} s={s} agent={r} now={now} onAgent={onAgent} chain={chain} onHover={onHover} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Who reports to whom; members with no manager in the plan are roots. */
export function OrgChart({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  // A chart wider than its card opens centred on its root, not at its left edge.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [s.agents.length]);
  const ids = new Set(s.agents.map((a) => a.id));
  const roots = s.agents.filter((a) => a.reportsTo === undefined || !ids.has(a.reportsTo));
  const chain = chainOf(s, hover);
  return (
    <section className="chart-card org-card">
      <div className="chart-hd">
        <h2>{t("org.title")}</h2>
        <p>{t("org.note")}</p>
      </div>
      <div className={`org-scroll${hover ? " has-hover" : ""}`} ref={scroll}>
        <ul className="org-tree">
          {roots.map((r) => (
            <Node key={r.id} s={s} agent={r} now={now} onAgent={onAgent} chain={chain} onHover={setHover} />
          ))}
        </ul>
      </div>
    </section>
  );
}

export function MissionPlan({ s, now }: { s: FleetState; now: number }) {
  const { t, locale } = useI18n();
  const launchKey = `org.launch.${s.launch}` as Parameters<typeof t>[0];
  const facts = [
    { icon: "clock", label: t("org.window"), value: `${dateTime(s.mission.startAt, locale)} → ${dateTime(s.mission.endAt, locale)}` },
    { icon: "coin", label: t("org.budget"), value: s.budget?.outputTokens ? `${compact(s.budget.outputTokens)} · ${t(`lim.${s.budget.onLimit ?? "warn"}` as Parameters<typeof t>[0])}` : t("org.noBudget") },
    { icon: "bolt", label: t("org.launch"), value: t(launchKey) === launchKey ? s.launch : t(launchKey) },
  ] as const;
  const current = s.mission.phases.find((p) => now >= Date.parse(p.from) && now < Date.parse(p.to));
  const note = `${clock(s.mission.startAt, locale)}–${clock(s.mission.endAt, locale)} · ${current?.name ?? (now >= Date.parse(s.mission.endAt) ? t("hd.over") : s.mission.phases[0]?.name ?? "")}`;
  return (
    <Fold id="plan" title={t("org.plan")} note={note} className="chart-card plan-card">
      <div className="plan-goal">
        <Icon name="spark" />
        <p title={s.mission.goal}>{s.mission.goal}</p>
      </div>
      <div className="plan-facts">
        {facts.map((f) => (
          <div key={f.label} className="plan-fact">
            <Icon name={f.icon} size={15} />
            <span>{f.label}</span>
            <b>{f.value}</b>
          </div>
        ))}
      </div>
      <ol className="plan-steps" aria-label={t("org.phases")}>
        {s.mission.phases.map((p, i) => {
          const from = Date.parse(p.from);
          const to = Date.parse(p.to);
          const state = now >= to ? "is-past" : now >= from ? "is-current" : "";
          return (
            <li key={p.name + p.from} className={state} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="plan-dot">{now >= to ? <Icon name="check" size={12} /> : i + 1}</span>
              <span className="plan-step">
                <b>{p.name}</b>
                <small>
                  {dateTime(p.from, locale)} → {dateTime(p.to, locale)}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
    </Fold>
  );
}

/**
 * The team, one tab: its members as cards (what each is doing now) or as the org chart (who reports to whom), one at
 * a time so neither pushes the other down the page; the choice is kept per viewer.
 */
export function Team({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<TeamView>(readView);
  const active = s.agents.filter((a) => agentStatus(s.telemetry[a.id], now).active).length;
  const choose = (next: TeamView) => {
    setView(next);
    try {
      localStorage.setItem("fleet-team-view", next);
    } catch {
      // No storage (a private window): the choice lasts for this visit.
    }
  };
  return (
    <>
      <div className="team-bar">
        <h2>{t("tab.fleet")}</h2>
        <span>{t("squad.active", { a: active, n: s.agents.length })}</span>
        <Slider kind="seg" label={t("team.view")} value={view} onChange={choose} items={[{ id: "cards", label: t("team.cards") }, { id: "chart", label: t("org.title") }]} />
      </div>
      {view === "chart" ? <OrgChart s={s} now={now} onAgent={onAgent} /> : <Fleet s={s} now={now} onAgent={onAgent} />}
    </>
  );
}

type TeamView = "cards" | "chart";
const readView = (): TeamView => {
  try {
    return localStorage.getItem("fleet-team-view") === "chart" ? "chart" : "cards";
  } catch {
    return "cards";
  }
};
