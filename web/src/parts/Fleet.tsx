import { useI18n } from "../i18n";
import { agentStatus, cheerOf, agentStatusLabel, ago, compact, DONE, endOf, modelLabel, modelMismatch, ownerOf, startOf, verifierOf } from "../lib";
import type { AgentDef, FleetState, Mission, Telemetry } from "../types";
import { spotlight } from "../ui/motion";
import { Mascot } from "./Mascot";

/** Tool calls per 5-minute bucket across the mission, as small bars. */
export function Sparkline({ t, mission, now }: { t: Telemetry | null | undefined; mission: Mission; now: number }) {
  const start = startOf(mission);
  const n = Math.max(1, Math.ceil((endOf(mission) - start) / 300_000));
  const current = Math.floor((now - start) / 300_000);
  const values = Array.from({ length: n }, (_, i) => t?.buckets[String(i)] ?? 0);
  const max = Math.max(4, ...values);
  const w = 100 / n;
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="23.5" x2="100" y2="23.5" className="spark-base" />
      {values.map((v, i) => (
        <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={24 - (v / max) * 22} height={(v / max) * 22} rx="0.4" className={i === current ? "spark-now" : i > current ? "spark-future" : "spark-bar"} />
      ))}
      {current >= 0 && current < n && <line x1={(current + 0.5) * w} x2={(current + 0.5) * w} y1="0" y2="24" className="spark-needle" />}
    </svg>
  );
}

const PX = { sm: 24, md: 34, lg: 54, xl: 88 } as const;

/** The agent's mascot; the large ones are fuzzy and act out the agent's state. */
export function Avatar({ agent, kind, size = "md", cheer }: { agent: AgentDef; kind?: string; size?: keyof typeof PX; cheer?: number }) {
  return (
    <span className={`av av-${size}`} title={agent.name}>
      <Mascot agent={agent} kind={size === "sm" ? undefined : kind} size={PX[size]} fuzzy={size === "lg" || size === "xl"} cheer={cheer} />
    </span>
  );
}

/** "Opus 5.5 · high" as planned; the running model when it differs. */
export function ModelChip({ agent, t: tele }: { agent: AgentDef; t: Telemetry | null | undefined }) {
  const { t } = useI18n();
  const mismatch = modelMismatch(agent, tele);
  const planned = modelLabel(agent.model);
  return (
    <span className={`model-chip${mismatch ? " is-off" : ""}`} title={mismatch ? t("card.mismatch", mismatch) : agent.model}>
      {mismatch ? `${modelLabel(tele?.model)} ≠ ${planned}` : planned}
      {agent.effort ? <em>{agent.effort}</em> : null}
    </span>
  );
}

function AgentCard({ s, agent, now, onOpen }: { s: FleetState; agent: AgentDef; now: number; onOpen: () => void }) {
  const { t } = useI18n();
  const tele = s.telemetry[agent.id];
  const st = agentStatus(tele, now);
  const tickets = s.board?.tickets ?? [];
  const owned = tickets.filter((x) => ownerOf(x, agent.id));
  const verifying = tickets.filter((x) => verifierOf(x, agent.id) && ["fixed", "integrated"].includes(x.status));
  const branch = s.git?.branches.find((b) => b.agent === agent.id);
  const commits = branch?.commits.filter((c) => !c.merge) ?? [];
  const isIntegration = branch !== undefined && branch.branch === s.git?.integration;
  const doing = tele?.pendingTool?.summary ?? tele?.recent.filter((r) => r.kind === "tool").at(-1)?.summary;
  const checks = agent.squad === "quality";

  return (
    <button type="button" className={`card is-${st.kind}`} onClick={onOpen} onPointerMove={spotlight} aria-label={`${agent.name}: ${agentStatusLabel(t, st)}`}>
      <div className="card-top">
        <Avatar agent={agent} kind={st.kind} size="lg" cheer={cheerOf(s, agent.id)} />
        <div className="card-id">
          <span className="card-name">{agent.name}</span>
          <span className="card-role">
            {agent.title ?? agent.role}
            {tele?.kind ? <b className="kind-tag">{t(tele.kind === "subagent" ? "card.subagent" : "card.session")}</b> : null}
          </span>
        </div>
        <span className={`badge st-${st.kind}`}>
          <i />
          {agentStatusLabel(t, st)}
          {st.since && <em>{ago(now, st.since)}</em>}
        </span>
      </div>

      <div className="card-now">
        <span className="card-k">{st.kind === "running" ? t("card.doing") : t("card.last")}</span>
        <span className="card-v mono">{doing ?? "—"}</span>
      </div>
      <p className="card-said">{tele?.lastText ? `“${tele.lastText}”` : t("card.silent")}</p>

      <Sparkline t={tele} mission={s.mission} now={now} />

      <dl className="card-stats">
        {isIntegration ? (
          <div>
            <dt>{t("card.merges")}</dt>
            <dd>{branch.commits.filter((c) => c.merge).length}</dd>
          </div>
        ) : (
          <div>
            <dt>{t("card.commits")}</dt>
            <dd>
              {commits.length}
              {commits.length > 0 && <small> · {t("card.inInt", { n: commits.filter((c) => c.integrated).length })}</small>}
            </dd>
          </div>
        )}
        <div>
          <dt>{checks ? t("card.verified") : t("card.tickets")}</dt>
          <dd>
            {checks
              ? `${tickets.filter((x) => verifierOf(x, agent.id) && x.status === "verified").length}/${tickets.filter((x) => verifierOf(x, agent.id)).length}`
              : `${owned.filter((x) => DONE.includes(x.status)).length}/${owned.length}`}
          </dd>
        </div>
        <div>
          <dt>{t("card.tools")}</dt>
          <dd>{compact(tele?.toolCalls ?? 0)}</dd>
        </div>
        <div>
          <dt>{t("card.outCtx")}</dt>
          <dd>
            {compact(tele?.outputTokens ?? 0)} · {compact(tele?.contextTokens ?? 0)}
          </dd>
        </div>
        <div>
          <dt>{t("card.model")}</dt>
          <dd>
            <ModelChip agent={agent} t={tele} />
          </dd>
        </div>
      </dl>
      {verifying.length > 0 && <span className="card-queue">{t("card.toVerify", { n: verifying.length })}</span>}
    </button>
  );
}

export function Fleet({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="fleet" aria-label={t("tab.fleet")}>
      {s.squads.map((sq) => {
        const members = s.agents.filter((a) => a.squad === sq.id);
        if (members.length === 0) return null;
        const active = members.filter((a) => agentStatus(s.telemetry[a.id], now).active).length;
        return (
          <div key={sq.id} className={`squad sq-${sq.id}`}>
            <div className="squad-hd">
              <h2>{sq.name}</h2>
              <span>{sq.note}</span>
              <span className="squad-count">{t("squad.active", { a: active, n: members.length })}</span>
            </div>
            <div className="squad-grid">
              {members.map((a) => (
                <AgentCard key={a.id} s={s} agent={a} now={now} onOpen={() => onAgent(a.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
