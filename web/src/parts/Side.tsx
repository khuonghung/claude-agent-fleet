import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { agentById, ago } from "../lib";
import type { FleetState } from "../types";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

export function Branches({ s, now }: { s: FleetState; now: number }) {
  const { t } = useI18n();
  const g = s.git;
  if (!g) return null;
  const integration = g.branches.find((b) => b.branch === g.integration);
  const rows = g.branches.filter((b) => b.branch !== g.integration);
  const max = Math.max(1, ...rows.map((b) => b.commits.length));
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
          <span className="mono int-v">{g.integration.replace(/^claude\//, "")}</span>
          <span className="int-n">{t("sd.merges", { m: integration?.commits.filter((c) => c.merge).length ?? 0, c: integration?.commits.filter((c) => !c.merge).length ?? 0 })}</span>
        </div>
      ) : null}
      <ul className="br-list">
        {rows.map((b) => {
          const a = agentById(s, b.agent);
          const own = b.commits.filter((c) => !c.merge);
          const inInt = own.filter((c) => c.integrated).length;
          const last = own[0];
          return (
            <li key={b.branch} className="br">
              {a && <Avatar agent={a} size="sm" />}
              <span className="br-main">
                <span className="br-name mono">{b.branch.replace(/^claude\//, "")}</span>
                <span className="br-last">{last ? `${last.subject} · ${ago(now, last.at)}` : t("sd.noCommit")}</span>
              </span>
              <span className="br-bar" title={`${inInt}/${own.length} ${t("dr.integrated")}`}>
                <i style={{ width: `${(own.length / max) * 100}%` }} />
                <i className="is-in" style={{ width: `${(inInt / max) * 100}%` }} />
              </span>
              <span className="br-n mono">
                {inInt}/{own.length}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Infra({ s }: { s: FleetState }) {
  const { t } = useI18n();
  return (
    <section className="panel" aria-label={t("sd.infra")}>
      <div className="sec-hd">
        <h2>{t("sd.infra")}</h2>
        {s.board?.stack && <span className="sec-note">{s.board.stack}</span>}
      </div>
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

export function Notices({ s }: { s: FleetState }) {
  const { t } = useI18n();
  if (!s.board?.notices) return null;
  return (
    <section className="panel notices" aria-label={t("sd.notices")}>
      <div className="sec-hd">
        <h2>{t("sd.notices")}</h2>
        <span className="sec-note">NOTICES.md</span>
      </div>
      <div className="md md-sm">
        <Markdown remarkPlugins={[remarkGfm]}>{s.board.notices}</Markdown>
      </div>
    </section>
  );
}

export function Reports({ s, now, onDoc }: { s: FleetState; now: number; onDoc: (kind: string, name: string) => void }) {
  const { t } = useI18n();
  const reports = s.board?.reports ?? [];
  const final = s.board?.finalReport;
  return (
    <section className="panel" aria-label={t("sd.reports")}>
      <div className="sec-hd">
        <h2>{t("sd.reports")}</h2>
      </div>
      <button type="button" className={`final${final ? " is-ready" : ""}`} onClick={() => final && onDoc("board", "FINAL-REPORT")} disabled={!final}>
        <b>{t("sd.final")}</b>
        <span>{final ? t("sd.updated", { ago: ago(now, final.updated) }) : t("sd.notYet")}</span>
      </button>
      <ul className="rp-list">
        {reports.map((r) => {
          const a = agentById(s, r.name);
          return (
            <li key={r.name}>
              <button type="button" onClick={() => onDoc("report", r.name)}>
                {a ? <Avatar agent={a} size="sm" /> : <span className="fi-sys">
                    <Icon name="branch" size={13} />
                  </span>}
                <span className="rp-name">{r.name}</span>
                <span className="rp-meta mono">
                  {(r.size / 1024).toFixed(1)} KB · {ago(now, r.updated)}
                </span>
              </button>
            </li>
          );
        })}
        {reports.length === 0 && <li className="fi-empty">{t("sd.noReports")}</li>}
      </ul>
      <div className="rp-more">
        <button type="button" className="chip" onClick={() => onDoc("board", "BOARD")}>
          {t("sd.board")}
        </button>
        <button type="button" className="chip" onClick={() => onDoc("board", "README")}>
          {t("sd.protocol")}
        </button>
        <button type="button" className="chip" onClick={() => onDoc("board", "ROSTER")}>
          {t("sd.roster")}
        </button>
      </div>
    </section>
  );
}
