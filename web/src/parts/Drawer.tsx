import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { agentById, cheerOf, agentStatus, agentStatusLabel, ago, clock, compact, dateTime, DONE, modelLabel, ownerOf, statusLabel, toolName, verifierOf } from "../lib";
import type { FleetState } from "../types";
import { Icon } from "../ui/Icons";
import { Avatar, ModelChip, Sparkline } from "./Fleet";
import { TicketModal } from "./TicketModal";

export type Open = { kind: "agent"; id: string } | { kind: "doc"; doc: string; name: string } | null;

function AgentDetail({ s, id, now, onTicket, onDoc }: { s: FleetState; id: string; now: number; onTicket: (id: string) => void; onDoc: (kind: string, name: string) => void }) {
  const { t, locale } = useI18n();
  const a = agentById(s, id);
  if (!a) return null;
  const tele = s.telemetry[id];
  const st = agentStatus(tele, now);
  const roster = s.board?.roster[id];
  const branch = s.git?.branches.find((b) => b.agent === id);
  const tickets = (s.board?.tickets ?? []).filter((x) => ownerOf(x, id) || verifierOf(x, id));
  const mix = Object.entries(tele?.toolMix ?? {}).sort((x, y) => y[1] - x[1]);
  const mixMax = Math.max(1, ...mix.map(([, n]) => n));
  const report = s.board?.reports.find((r) => r.name === id);
  const boss = a.reportsTo ? agentById(s, a.reportsTo) : undefined;
  const window = a.window ?? { from: s.mission.startAt, to: s.mission.endAt };

  return (
    <div className="dt">
      <div className="dt-hd">
        <Avatar agent={a} kind={st.kind} size="xl" cheer={cheerOf(s, a.id)} />
        <div>
          <h2>{a.name}</h2>
          <p>
            {a.title ?? a.role} · {modelLabel(tele?.model ?? a.model)}
          </p>
        </div>
        <span className={`badge st-${st.kind}`}>
          <i />
          {agentStatusLabel(t, st)}
          {st.since && <em>{ago(now, st.since)}</em>}
        </span>
      </div>

      {tele?.pendingTool && (
        <div className="dt-now">
          <span className="card-k">{t("dr.running", { tool: toolName(tele.pendingTool.name) })}</span>
          <span className="mono">{tele.pendingTool.summary}</span>
        </div>
      )}
      {tele?.lastText && <blockquote className="dt-said">{tele.lastText}</blockquote>}

      <dl className="dt-stats">
        <div>
          <dt>{t("dr.calls")}</dt>
          <dd>{compact(tele?.toolCalls ?? 0)}</dd>
        </div>
        <div>
          <dt>{t("dr.prompts")}</dt>
          <dd>{tele?.prompts ?? 0}</dd>
        </div>
        <div>
          <dt>{t("dr.out")}</dt>
          <dd>{compact(tele?.outputTokens ?? 0)}</dd>
        </div>
        <div>
          <dt>{t("dr.ctx")}</dt>
          <dd>{compact(tele?.contextTokens ?? 0)}</dd>
        </div>
        <div>
          <dt>{t("dr.started")}</dt>
          <dd>{tele?.firstAt ? clock(tele.firstAt, locale) : "—"}</dd>
        </div>
        <div>
          <dt>{t("dr.last")}</dt>
          <dd>{tele?.lastAt ? t("dr.ago", { ago: ago(now, tele.lastAt) }) : "—"}</dd>
        </div>
      </dl>

      <Sparkline t={tele} mission={s.mission} now={now} />

      <div className="dt-sec">
        <h3>{t("dr.plan")}</h3>
        <dl className="plan plan-sm">
          <div>
            <dt>{t("org.model")}</dt>
            <dd>
              <ModelChip agent={a} t={tele} effort={s.efforts?.[a.id]} />
            </dd>
          </div>
          {boss && (
            <div>
              <dt>{t("dr.reportsTo")}</dt>
              <dd>{boss.name}</dd>
            </div>
          )}
          <div>
            <dt>{t("dr.window")}</dt>
            <dd>
              {dateTime(window.from, locale)} → {dateTime(window.to, locale)}
            </dd>
          </div>
          {tele?.kind && (
            <div>
              <dt>{t("dr.runsAs")}</dt>
              <dd>{t(tele.kind === "subagent" ? "card.subagent" : "card.session")}</dd>
            </div>
          )}
          {a.specialty ? (
            <div>
              <dt>{t("dr.specialty")}</dt>
              <dd>{a.specialty}</dd>
            </div>
          ) : null}
          {a.owns && a.owns.length > 0 ? (
            <div>
              <dt>{t("dr.owns")}</dt>
              <dd className="mono">{a.owns.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {roster && (roster.branch || roster.worktree) && (
        <p className="dt-meta mono">
          {roster.branch || "—"}
          <br />
          {roster.worktree}
        </p>
      )}

      {mix.length > 0 && (
        <div className="dt-sec">
          <h3>{t("dr.tools")}</h3>
          <ul className="mix">
            {mix.slice(0, 8).map(([name, n]) => (
              <li key={name}>
                <span className="mono">{toolName(name)}</span>
                <span className="mix-bar">
                  <i style={{ width: `${(n / mixMax) * 100}%` }} />
                </span>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(tele?.messagesTo ?? {}).length > 0 && (
        <div className="dt-sec">
          <h3>{t("dr.messaged")}</h3>
          <div className="dt-chips">
            {Object.entries(tele?.messagesTo ?? {}).map(([to, n]) => (
              <span key={to} className="chip">
                {to} · {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {tickets.length > 0 && (
        <div className="dt-sec">
          <h3>{t("dr.tickets", { d: tickets.filter((x) => DONE.includes(x.status)).length, n: tickets.length })}</h3>
          <ul className="dt-tickets">
            {tickets.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onTicket(x.id)}>
                  <span className={`sev sev-${x.severity || "none"}`}>{x.severity || "?"}</span>
                  <span className="mono">{x.id}</span>
                  <span className="dt-tk-title">{x.title}</span>
                  <span className={`stt stt-${x.status}`}>{statusLabel(t, x.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {branch && branch.commits.length > 0 && (
        <div className="dt-sec">
          <h3>{t("dr.commits")}</h3>
          <ul className="dt-commits">
            {branch.commits.map((c) => (
              <li key={c.sha}>
                <span className="mono">{c.sha.slice(0, 7)}</span>
                <span>{c.subject}</span>
                <em className={c.integrated ? "is-in" : ""}>{c.merge ? t("dr.merge") : c.integrated ? t("dr.integrated") : t("dr.notIntegrated")}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dt-sec">
        <h3>{t("dr.recent")}</h3>
        <ol className="dt-recent">
          {[...(tele?.recent ?? [])].reverse().map((r, i) => (
            <li key={i} className={`dr-${r.kind}`}>
              <time className="mono">{r.at ? clock(r.at, locale, true) : ""}</time>
              <span className="mono dr-tag">{r.kind === "tool" ? toolName(r.tool ?? "") : r.kind === "text" ? t("feed.said") : t("feed.got")}</span>
              <span>{r.summary}</span>
            </li>
          ))}
        </ol>
      </div>

      {report && (
        <button type="button" className="final is-ready" onClick={() => onDoc("report", id)}>
          <b>{t("dr.report", { name: a.name })}</b>
          <span>{t("sd.updated", { ago: ago(now, report.updated) })}</span>
        </button>
      )}
    </div>
  );
}

function DocView({ doc, name, rev }: { doc: string; name: string; rev: number }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null | false>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/doc/${doc}/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((x) => live && setText(x))
      .catch(() => live && setText(false));
    return () => {
      live = false;
    };
  }, [doc, name, rev]);
  return (
    <div className="md">
      {text === null ? <p className="fi-empty">{t("dr.loading")}</p> : text === false ? <p className="fi-empty">{t("dr.unreadable")}</p> : <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>}
    </div>
  );
}

export function Drawer({ s, open, now, onClose, onTicket, onAgent, onDoc }: { s: FleetState; open: Open; now: number; onClose: () => void; onTicket: (id: string) => void; onAgent: (id: string) => void; onDoc: (kind: string, name: string) => void }) {
  const { t } = useI18n();
  // The tickets opened from a ticket's references, to go back through.
  const [trail, setTrail] = useState<string[]>([]);
  const ticketId = open?.kind === "doc" && open.doc === "ticket" ? open.name : null;
  useEffect(() => {
    if (!ticketId) setTrail([]);
  }, [ticketId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!open) return null;
  const ticket = open.kind === "doc" && open.doc === "ticket" ? s.board?.tickets.find((x) => x.id === open.name) : undefined;
  if (ticketId && ticket)
    return (
      <TicketModal
        s={s}
        id={ticketId}
        now={now}
        canBack={trail.length > 0}
        onBack={() => {
          const prev = trail.at(-1);
          setTrail((x) => x.slice(0, -1));
          if (prev) onTicket(prev);
        }}
        onClose={onClose}
        onTicket={(next) => {
          if (next === ticketId) return;
          setTrail((x) => [...x, ticketId]);
          onTicket(next);
        }}
        onAgent={onAgent}
        onDoc={onDoc}
      />
    );
  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={open.kind === "agent" ? open.id : open.name} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="drawer-x" onClick={onClose} aria-label={t("dr.close")}>
          <Icon name="close" />
        </button>
        {open.kind === "agent" ? <AgentDetail s={s} id={open.id} now={now} onTicket={onTicket} onDoc={onDoc} /> : <DocView doc={open.doc} name={open.name} rev={ticket ? Date.parse(ticket.updated) : s.rev} />}
      </aside>
    </div>
  );
}
