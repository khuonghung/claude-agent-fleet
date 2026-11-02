import { useI18n } from "../i18n";
import { agentStatus, cheerOf, agentStatusLabel, ago, CLOSED, compact, endOf, launched, modelMismatch, statusLabel, waitingOn } from "../lib";
import type { FleetState } from "../types";
import { Mascot } from "./Mascot";
import { Fold } from "../ui/Controls";

/** A prefix every member name shares ("kt-"), left out on the stage where names are short. */
function sharedPrefix(names: string[]): string {
  const prefix = /^([a-z0-9]+-)/.exec(names[0] ?? "")?.[1];
  return prefix !== undefined && names.filter((n) => n.startsWith(prefix)).length >= Math.max(2, names.length - 1) ? prefix : "";
}

/** The whole fleet on one stage: who is moving, who is asleep. */
export function Lineup({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  const active = s.agents.filter((a) => agentStatus(s.telemetry[a.id], now).active).length;
  const prefix = sharedPrefix(s.agents.map((a) => a.name));
  return (
    <section className="stage" aria-label={t("tab.fleet")}>
      <div className="stage-title">
        <span className="stage-word">fleet</span>
        <span className="stage-sub">{t("sg.active", { a: active, n: s.agents.length })}</span>
        <span className="stage-goal" title={s.mission.goal}>
          {s.mission.goal}
        </span>
      </div>
      <div className="stage-row">
        {s.agents.map((a) => {
          const st = agentStatus(s.telemetry[a.id], now);
          const label = agentStatusLabel(t, st);
          return (
            <button key={a.id} type="button" className={`stage-agent is-${st.kind}`} onClick={() => onAgent(a.id)} title={`${a.name}: ${label}`}>
              <span className="stage-figure">
                <Mascot agent={a} kind={st.kind} size={76} label cheer={cheerOf(s, a.id)} />
                <span className="stage-reflect" aria-hidden="true">
                  <Mascot agent={a} kind={st.kind} size={76} />
                </span>
              </span>
              <span className="stage-name">{a.name.startsWith(prefix) ? a.name.slice(prefix.length) : a.name}</span>
              <span className={`stage-state st-${st.kind}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface Alert {
  level: "bad" | "warn" | "info";
  text: string;
  detail?: string;
  ticket?: string;
  agent?: string;
}

/** What a manager should look at now, worst first. */
export function Attention({ s, now, onTicket, onAgent }: { s: FleetState; now: number; onTicket: (id: string) => void; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  const tickets = s.board?.tickets ?? [];
  const running = now < endOf(s.mission);
  const alerts: Alert[] = [];
  if (!launched(s) && running) alerts.push({ level: "warn", text: t("at.notLaunched") });
  if (s.git && !s.git.baseUntouched) alerts.push({ level: "bad", text: t("at.baseMoved", { base: s.git.base }), detail: `${s.git.baseHead} ≠ ${s.git.baselineHead}` });
  const tokens = s.agents.reduce((n, a) => n + (s.telemetry[a.id]?.outputTokens ?? 0), 0);
  const limit = s.budget?.outputTokens;
  const limitNote = limit ? t(`lim.${s.budget.onLimit ?? "warn"}` as Parameters<typeof t>[0]) : "";
  if (limit && tokens >= limit) alerts.push({ level: "bad", text: t("at.budget", { used: compact(tokens), budget: compact(limit) }), detail: limitNote });
  else if (limit && tokens >= limit * (s.budget.warnAt ?? 0.8)) alerts.push({ level: "warn", text: t("at.budgetNear", { pct: Math.round((tokens / limit) * 100), used: compact(tokens), budget: compact(limit) }), detail: limitNote });
  for (const tk of tickets.filter((x) => x.status === "reopened")) alerts.push({ level: "bad", text: t("at.reopened", { id: tk.id }), detail: tk.title, ticket: tk.id });
  for (const tk of tickets.filter((x) => x.severity === "critical" && !CLOSED.includes(x.status)))
    alerts.push({ level: "bad", text: t("at.critical", { id: tk.id, status: statusLabel(t, tk.status) }), detail: tk.title, ticket: tk.id });
  for (const th of s.board?.threads ?? []) {
    if (th.status === "open" && th.decideAt && now > Date.parse(th.decideAt))
      alerts.push({ level: "warn", text: t("at.threadLate", { title: th.title, time: th.decideBy }), detail: waitingOn(th).length ? t("th.waiting", { names: waitingOn(th).join(", ") }) : undefined, agent: th.owner || undefined });
  }
  for (const a of s.agents) {
    const mismatch = modelMismatch(a, s.telemetry[a.id]);
    if (mismatch) alerts.push({ level: "warn", text: t("at.mismatch", { name: a.name, ...mismatch }), agent: a.id });
  }
  const waiting = tickets.filter((x) => ["fixed", "integrated"].includes(x.status));
  if (waiting.length) {
    const oldest = waiting.reduce((a, b) => (a.updated < b.updated ? a : b));
    alerts.push({ level: "warn", text: t("at.toVerify", { n: waiting.length }), detail: t("at.oldest", { id: oldest.id, ago: ago(now, oldest.updated) }), ticket: oldest.id });
  }
  const untriaged = tickets.filter((x) => x.status === "new" && now - Date.parse(x.created) > 15 * 60_000);
  if (untriaged.length) alerts.push({ level: "warn", text: t("at.untriaged", { n: untriaged.length }), detail: untriaged.map((x) => x.id).join(", "), ticket: untriaged[0]!.id });
  for (const p of s.probes.filter((x) => !x.up)) alerts.push({ level: "warn", text: t("at.probe", { name: p.name, port: p.port }) });
  if (running) {
    for (const a of s.agents) {
      const tele = s.telemetry[a.id];
      const st = agentStatus(tele, now);
      if ((st.kind === "silent" || st.kind === "waiting") && tele?.lastAt && now - Date.parse(tele.lastAt) > 10 * 60_000)
        alerts.push({ level: "info", text: t("at.quiet", { name: a.name, ago: ago(now, tele.lastAt) }), detail: t("at.quietNote"), agent: a.id });
    }
  }
  const hot = tickets.filter((x) => x.severity === "high" && !CLOSED.includes(x.status) && x.status !== "in-progress");
  if (hot.length) alerts.push({ level: "info", text: t("at.high", { n: hot.length }), detail: hot.slice(0, 6).map((x) => x.id).join(", "), ticket: hot[0]!.id });

  return (
    <Fold id="attention" open className="attention" title={t("at.title")} note={alerts.length ? t("at.count", { n: alerts.length }) : t("at.none")}>
      <ul>
        {alerts.slice(0, 12).map((a, i) => (
          <li key={i} className={`al al-${a.level}`}>
            <button type="button" onClick={() => (a.ticket ? onTicket(a.ticket) : a.agent ? onAgent(a.agent) : undefined)} disabled={!a.ticket && !a.agent}>
              <i />
              <span className="al-text">{a.text}</span>
              {a.detail && <span className="al-detail">{a.detail}</span>}
            </button>
          </li>
        ))}
        {alerts.length === 0 && <li className="al al-ok">{t("at.ok")}</li>}
      </ul>
    </Fold>
  );
}
