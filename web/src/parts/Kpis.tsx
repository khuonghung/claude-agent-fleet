import { useI18n } from "../i18n";
import { agentStatus, CLOSED, compact, DONE, endOf, startOf } from "../lib";
import type { FleetState } from "../types";
import { Num } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { spotlight } from "../ui/motion";

/** Output tokens at the end if the fleet keeps the pace of its last 30 minutes (from the 5-minute token buckets). */
function projectedTokens(s: FleetState, now: number, total: number): number | undefined {
  const start = startOf(s.mission);
  const end = endOf(s.mission);
  if (now >= end || now <= start) return undefined;
  const current = Math.floor((now - start) / 300_000);
  let recent = 0;
  for (const a of s.agents) for (let b = current - 6; b < current; b++) recent += s.telemetry[a.id]?.tokenBuckets?.[String(b)] ?? 0;
  const minutes = Math.min(30, Math.max(5, (now - start) / 60_000));
  return Math.round(total + (recent / minutes) * ((end - now) / 60_000));
}

export function Kpis({ s, now }: { s: FleetState; now: number }) {
  const { t } = useI18n();
  const tickets = s.board?.tickets ?? [];
  const active = s.agents.filter((a) => agentStatus(s.telemetry[a.id], now).active).length;
  const recentTools = s.agents.reduce((n, a) => n + (s.telemetry[a.id]?.recent ?? []).filter((r) => r.kind === "tool" && r.at && now - Date.parse(r.at) < 15 * 60_000).length, 0);
  const done = tickets.filter((x) => DONE.includes(x.status)).length;
  const verified = tickets.filter((x) => x.status === "verified").length;
  const hot = tickets.filter((x) => (x.severity === "critical" || x.severity === "high") && !CLOSED.includes(x.status)).length;
  const branches = (s.git?.branches ?? []).filter((b) => b.branch !== s.git?.integration);
  const commits = branches.reduce((n, b) => n + b.commits.filter((c) => !c.merge).length, 0);
  const integrated = branches.reduce((n, b) => n + b.commits.filter((c) => !c.merge && c.integrated).length, 0);
  const tokens = s.agents.reduce((n, a) => n + (s.telemetry[a.id]?.outputTokens ?? 0), 0);
  const budget = s.budget?.outputTokens;
  const found = tickets.filter((x) => Date.parse(x.created) >= Date.parse(s.mission.startAt)).length;
  const share = budget ? Math.min(1, tokens / budget) : undefined;
  const projected = projectedTokens(s, now, tokens);
  const projectedShare = budget && projected ? Math.min(1, projected / budget) : undefined;

  const tiles = [
    { key: "active", icon: "user", label: t("kpi.active"), value: active, unit: `/ ${s.agents.length}`, tone: active ? "ok" : "" },
    { key: "tools", icon: "bolt", label: t("kpi.tools"), value: recentTools, unit: "" },
    { key: "done", icon: "check", label: t("kpi.done"), value: done, unit: `/ ${tickets.length}`, note: t("kpi.found", { n: found }) },
    { key: "verified", icon: "spark", label: t("kpi.verified"), value: verified, unit: "", tone: verified ? "ok" : "" },
    { key: "hot", icon: "alert", label: t("kpi.hot"), value: hot, unit: "", tone: hot ? "bad" : "ok" },
    { key: "int", icon: "branch", label: t("kpi.integrated"), value: integrated, unit: `/ ${commits}` },
  ] as const;

  return (
    <section className="kpis" aria-label={t("tab.overview")}>
      {tiles.map((x, i) => (
        <div key={x.key} className={`kpi${"tone" in x && x.tone ? ` is-${x.tone}` : ""}`} style={{ animationDelay: `${i * 40}ms` }} onPointerMove={spotlight}>
          <span className="kpi-label">
            <Icon name={x.icon} size={14} />
            {x.label}
          </span>
          <span className="kpi-value">
            <Num value={x.value} />
            {x.unit && <small>{x.unit}</small>}
          </span>
          {"note" in x && x.note && <span className="kpi-note">{x.note}</span>}
        </div>
      ))}
      <div className={`kpi kpi-wide${share !== undefined && share >= 1 ? " is-bad" : ""}`} style={{ animationDelay: `${tiles.length * 40}ms` }} onPointerMove={spotlight}>
        <span className="kpi-label">
          <Icon name="coin" size={14} />
          {t("kpi.tokens")}
        </span>
        <span className="kpi-value">
          <Num value={tokens} format={(n) => compact(n)} />
          {budget ? <small>/ {compact(budget)}</small> : null}
        </span>
        {budget ? (
          <span className="kpi-meter" aria-hidden="true">
            {projectedShare !== undefined && <b className={projectedShare >= 1 ? "is-over" : ""} style={{ width: `${projectedShare * 100}%` }} />}
            <i style={{ width: `${(share ?? 0) * 100}%` }} className={(share ?? 0) >= 1 ? "is-over" : (share ?? 0) >= (s.budget?.warnAt ?? 0.8) ? "is-near" : ""} />
          </span>
        ) : null}
        <span className="kpi-note">
          {budget ? `${t("kpi.budget", { pct: Math.round((tokens / budget) * 100), budget: compact(budget) })} · ${t(`lim.${s.budget?.onLimit ?? "warn"}` as Parameters<typeof t>[0])}` : t("org.noBudget")}
          {projected !== undefined ? ` · ${t("kpi.projected", { n: compact(projected) })}` : ""}
        </span>
      </div>
    </section>
  );
}
