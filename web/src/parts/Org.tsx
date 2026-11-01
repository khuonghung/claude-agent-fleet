import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentStatus, agentStatusLabel, compact, dateTime, modelLabel } from "../lib";
import type { AgentDef, FleetState } from "../types";
import { Icon } from "../ui/Icons";
import { spotlight } from "../ui/motion";
import { ModelChip } from "./Fleet";
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
  return (
    <section className="chart-card plan-card">
      <div className="chart-hd">
        <h2>{t("org.plan")}</h2>
      </div>
      <div className="plan-goal">
        <Icon name="spark" />
        <p>{s.mission.goal}</p>
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
    </section>
  );
}

/** Every member's plan beside what it runs now, one card each. */
export function Members({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t, locale } = useI18n();
  return (
    <section className="chart-card">
      <div className="chart-hd">
        <h2>{t("org.members")}</h2>
        <p>{s.agents.length}</p>
      </div>
      <div className="mem-grid">
        {s.agents.map((a, i) => {
          const tele = s.telemetry[a.id];
          const st = agentStatus(tele, now);
          const w = a.window ?? { from: s.mission.startAt, to: s.mission.endAt };
          const runsAs = a.launch === "self" ? t("org.launch.self") : tele?.kind ? t(tele.kind === "subagent" ? "card.subagent" : "card.session") : "";
          return (
            <button key={a.id} type="button" className={`mem sq-${a.squad} is-${st.kind}`} style={{ animationDelay: `${i * 35}ms` }} onClick={() => onAgent(a.id)} onPointerMove={spotlight}>
              <span className="mem-hd">
                <Mascot agent={a} kind={st.kind} size={36} fuzzy={false} />
                <span className="mem-id">
                  <b>{a.name}</b>
                  <small>{a.title ?? a.role}</small>
                </span>
                <span className={`org-state st-${st.kind}`}>
                  <i />
                  {agentStatusLabel(t, st)}
                </span>
              </span>
              <span className="mem-tags">
                <span className="model-chip" title={a.model}>
                  {modelLabel(a.model)}
                  {a.effort ? <em>{a.effort}</em> : null}
                </span>
                {tele?.model && modelLabel(tele.model) !== modelLabel(a.model) ? <span className="tag is-off">{t("org.actual")}: {modelLabel(tele.model)}</span> : null}
                {runsAs ? <span className="tag">{runsAs}</span> : null}
                {a.readOnly ? <span className="tag">{t("org.readOnly")}</span> : null}
                {a.worktree ? <span className="tag">{t("org.worktree")}</span> : null}
              </span>
              {a.specialty ? <span className="mem-spec">{a.specialty}</span> : null}
              <span className="mem-foot">
                <span>
                  <Icon name="clock" size={13} />
                  {dateTime(w.from, locale)} → {dateTime(w.to, locale)}
                </span>
                {(a.owns ?? []).length > 0 && (
                  <span className="mono" title={(a.owns ?? []).join(", ")}>
                    <Icon name="layers" size={13} />
                    {(a.owns ?? []).join(", ")}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
