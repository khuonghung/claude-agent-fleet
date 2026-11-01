import { useI18n } from "../i18n";
import { Mascot } from "./Mascot";
import type { FleetState } from "../types";

/** Who messages whom: senders down the side, receivers across the top, darker = more messages. */
export function Comms({ s }: { s: FleetState }) {
  const { t } = useI18n();
  const agents = s.agents;
  const count = (from: string, to: string) => s.telemetry[from]?.messagesTo[to] ?? 0;
  const max = Math.max(1, ...agents.flatMap((a) => agents.map((b) => count(a.id, b.id))));
  const total = agents.reduce((n, a) => n + Object.values(s.telemetry[a.id]?.messagesTo ?? {}).reduce((x, y) => x + y, 0), 0);
  const hub = [...agents].sort((a, b) => agents.reduce((n, x) => n + count(x.id, b.id), 0) - agents.reduce((n, x) => n + count(x.id, a.id), 0))[0];

  return (
    <section className="panel" aria-label={t("cm.title")}>
      <div className="sec-hd">
        <h2>{t("cm.title")}</h2>
        <span className="sec-note">
          {t("cm.note", { n: total, name: hub?.name ?? "—" })}
        </span>
      </div>
      <div className="comms" style={{ gridTemplateColumns: `28px repeat(${agents.length}, minmax(0, 1fr))` }}>
        <span className="cm-corner" aria-hidden="true">
          {t("cm.axis")}
        </span>
        {agents.map((b) => (
          <span key={`h-${b.id}`} className="cm-h" title={b.name}>
            <Mascot agent={b} size={20} fuzzy={false} />
          </span>
        ))}
        {agents.map((a) => (
          <div key={`r-${a.id}`} className="cm-row">
            <span className="cm-h" title={a.name}>
              <Mascot agent={a} size={20} fuzzy={false} />
            </span>
            {agents.map((b) => {
              const n = count(a.id, b.id);
              return (
                <span key={b.id} className={`cm-cell${a.id === b.id ? " is-self" : ""}`} style={n ? { background: `color-mix(in srgb, var(--gold-2) ${Math.round(18 + (n / max) * 72)}%, transparent)` } : undefined} title={`${a.name} → ${b.name}: ${n}`}>
                  {n || ""}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
