import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { agentById, ago } from "../lib";
import type { FleetState } from "../types";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";
import { Fold } from "../ui/Controls";

export function Notices({ s }: { s: FleetState }) {
  const { t } = useI18n();
  if (!s.board?.notices) return null;
  return (
    <Fold id="notices" className="panel notices" title={t("sd.notices")} note="NOTICES.md">
      <div className="md md-sm">
        <Markdown remarkPlugins={[remarkGfm]}>{s.board.notices}</Markdown>
      </div>
    </Fold>
  );
}

export function Reports({ s, now, onDoc }: { s: FleetState; now: number; onDoc: (kind: string, name: string) => void }) {
  const { t } = useI18n();
  const reports = s.board?.reports ?? [];
  return (
    <Fold id="reports" open className="panel" title={t("sd.reports")}>
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
    </Fold>
  );
}
