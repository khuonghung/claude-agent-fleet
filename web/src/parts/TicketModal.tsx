// A ticket, centred: where it is in the flow, who is on it, what it says, and everything it connects to — its
// discussion, its commits, the tickets it names and that name it, the files it points at — plus one timeline of its
// activity. Related tickets open in place, with a way back.

import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { agentsIn, CLOSED, cycleTime, dateTime, span, statusLabel, statusSince } from "../lib";
import type { AgentDef, FleetState, Ticket } from "../types";
import { Slider } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

type Tab = "details" | "activity" | "source";

/** The ticket's Markdown split at its `##` headings (the header bullets and the Log are shown elsewhere). */
function sectionsOf(text: string): { title: string; body: string }[] {
  return text
    .split(/^##\s+/m)
    .slice(1)
    .map((chunk) => {
      const [title = "", ...rest] = chunk.split(/\r?\n/);
      return { title: title.trim(), body: rest.join("\n").trim() };
    })
    .filter((x) => x.body && !/^log$/i.test(x.title));
}

/** The acceptance criteria as items, when the section is a list. */
const criteriaOf = (body: string) =>
  body
    .split(/\r?\n/)
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));

function useDoc(name: string, rev: string) {
  const [text, setText] = useState<string | null | false>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    fetch(`/api/doc/ticket/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((x) => live && setText(x))
      .catch(() => live && setText(false));
    return () => {
      live = false;
    };
  }, [name, rev]);
  return text;
}

function Person({ agent, role, onAgent }: { agent: AgentDef; role: string; onAgent: (id: string) => void }) {
  return (
    <button type="button" className="tm-person" onClick={() => onAgent(agent.id)}>
      <Avatar agent={agent} size="md" />
      <span>
        <b>{agent.name}</b>
        <small>{role}</small>
      </span>
    </button>
  );
}

/** Where the ticket is in the flow, with when it reached each stage it passed (as far as the board and the server saw). */
function Steps({ s, tk }: { s: FleetState; tk: Ticket }) {
  const { t, locale } = useI18n();
  const flow = s.flow.flow;
  const at = flow.indexOf(tk.status);
  const reached = (status: string) =>
    s.transitions.findLast((x) => x.id === tk.id && x.to === status)?.at ?? (status === flow[0] ? tk.created : status === "verified" ? tk.verifiedAt : status === "fixed" ? tk.doneAt : null);
  const off = at < 0;
  return (
    <ol className={`tm-steps${off ? " is-off" : ""}`} aria-label={statusLabel(t, tk.status)}>
      {flow.map((st, i) => {
        const when = reached(st);
        const state = off ? "" : i < at ? "is-past" : i === at ? "is-current" : "";
        return (
          <li key={st} className={state} title={when ? dateTime(when, locale) : undefined}>
            <span className="tm-dot">{i < at && !off ? <Icon name="check" size={11} /> : null}</span>
            <span className="tm-step">{statusLabel(t, st)}</span>
          </li>
        );
      })}
      {off && <li className={`tm-off st-${tk.status}`}>{statusLabel(t, tk.status)}</li>}
    </ol>
  );
}

export function TicketModal({ s, id, now, canBack, onBack, onClose, onTicket, onAgent, onDoc }: { s: FleetState; id: string; now: number; canBack: boolean; onBack: () => void; onClose: () => void; onTicket: (id: string) => void; onAgent: (id: string) => void; onDoc: (doc: string, name: string) => void }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("details");
  const [copied, setCopied] = useState("");
  const tickets = s.board?.tickets ?? [];
  const tk = tickets.find((x) => x.id === id);
  const text = useDoc(id, tk?.updated ?? "");
  useEffect(() => setTab("details"), [id]);

  // ↑ ↓ (or j k) walk the board's tickets without closing.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (!step) return;
      const i = tickets.findIndex((x) => x.id === id);
      const next = tickets[i + step];
      if (next) (e.preventDefault(), onTicket(next.id));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tickets, id, onTicket]);

  const refs = useMemo(() => {
    if (!tk) return null;
    const sha = /\b([0-9a-f]{7,40})\b/.exec(tk.fix)?.[1];
    const commits = (s.git?.branches ?? []).flatMap((b) => b.commits.filter((c) => !c.merge && ((sha && c.sha.startsWith(sha.slice(0, 7))) || new RegExp(`\\b${tk.id}\\b`).test(c.subject))).map((c) => ({ ...c, branch: b.branch })));
    const seen = new Set<string>();
    const uniq = commits.filter((c) => !seen.has(c.sha) && seen.add(c.sha));
    return {
      thread: (s.board?.threads ?? []).find((th) => th.ticket === tk.id || th.name === tk.id),
      commits: uniq,
      mentions: (tk.mentions ?? []).map((m) => tickets.find((x) => x.id === m)).filter((x): x is Ticket => Boolean(x)),
      mentionedBy: tickets.filter((x) => x.id !== tk.id && (x.mentions ?? []).includes(tk.id)),
      files: tk.files ?? [],
    };
  }, [s, tk, tickets]);

  if (!tk || !refs) return null;
  const owners = agentsIn(s, tk.owner);
  const crew = agentsIn(s, tk.crew).filter((a) => !owners.includes(a));
  const verifier = agentsIn(s, tk.verifier)[0];
  const since = statusSince(s, tk);
  const cycle = cycleTime(tk);
  const sections = text ? sectionsOf(text) : [];
  const criteria = sections.find((x) => /acceptance/i.test(x.title));
  const items = criteria ? criteriaOf(criteria.body) : [];
  const verified = tk.status === "verified";

  const activity = [
    ...tk.log.map((l) => ({ at: Date.parse(l.at), who: l.who, kind: "log" as const, text: l.note })),
    ...s.transitions.filter((x) => x.id === tk.id).map((x) => ({ at: Date.parse(x.at), who: "", kind: "move" as const, text: x.from ? t("tm.moved", { from: statusLabel(t, x.from), to: statusLabel(t, x.to) }) : statusLabel(t, x.to) })),
    ...(refs.thread?.posts ?? []).map((p) => ({ at: Date.parse(p.at), who: p.who, kind: "post" as const, text: `${t(`th.k.${p.kind}`)} · ${p.text}` })),
    ...refs.commits.map((c) => ({ at: Date.parse(c.at), who: "", kind: "commit" as const, text: `${c.sha.slice(0, 7)} ${c.subject}` })),
  ].sort((a, b) => b.at - a.at);

  const copy = (f: string) => {
    navigator.clipboard?.writeText(f).then(
      () => (setCopied(f), setTimeout(() => setCopied(""), 1400)),
      () => undefined,
    );
  };
  const related = (list: Ticket[], label: string) =>
    list.length > 0 && (
      <div className="tm-ref">
        <h4>
          {label} <small>{list.length}</small>
        </h4>
        <div className="tm-chips">
          {list.map((x) => (
            <button key={x.id} type="button" className={`tm-tk sev-${x.severity || "none"}`} onClick={() => onTicket(x.id)} title={x.title}>
              <span className="mono">{x.id}</span>
              <span className={`tl-status st-${x.status}`}>{statusLabel(t, x.status)}</span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="tm-wrap" onMouseDown={onClose}>
      <div className={`tm sev-${tk.severity || "none"}`} role="dialog" aria-modal="true" aria-label={`${tk.id}: ${tk.title}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="tm-hd">
          <div className="tm-bar">
            {canBack && (
              <button type="button" className="tm-icon" onClick={onBack} aria-label={t("tm.back")} title={t("tm.back")}>
                <Icon name="arrow" className="is-back" />
              </button>
            )}
            <span className="tm-id mono">{tk.id}</span>
            <span className={`sev sev-${tk.severity || "none"}`}>{tk.severity || "?"}</span>
            <span className={`tl-status st-${tk.status}`}>{statusLabel(t, tk.status)}</span>
            <span className="tm-since">{t("tm.inStage", { t: span(now - since), status: statusLabel(t, tk.status) })}</span>
            <span className="tm-nav">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
            </span>
            <button type="button" className="tm-icon" onClick={onClose} aria-label={t("tm.close")}>
              <Icon name="close" />
            </button>
          </div>
          <h2>{tk.title}</h2>
          <Steps s={s} tk={tk} />
        </header>

        <div className="tm-body">
          <main className="tm-main">
            <Slider
              kind="seg"
              label={tk.id}
              value={tab}
              onChange={setTab}
              items={[
                { id: "details", label: t("tm.details") },
                { id: "activity", label: t("tm.activity"), badge: <small className="tm-count">{activity.length}</small> },
                { id: "source", label: t("tm.source") },
              ]}
            />
            <div className="tm-pane" key={tab}>
              {text === null && <p className="fi-empty">{t("dr.loading")}</p>}
              {text === false && <p className="fi-empty">{t("dr.unreadable")}</p>}
              {text && tab === "details" && (
                <>
                  {items.length > 0 && (
                    <section className="tm-sec">
                      <h3>{t("tm.criteria")}</h3>
                      <ul className="tm-ac">
                        {items.map((item, i) => (
                          <li key={i} className={verified ? "is-met" : ""}>
                            <span className="tm-box">{verified ? <Icon name="check" size={12} /> : null}</span>
                            <span className="md">
                              <Markdown remarkPlugins={[remarkGfm]}>{item}</Markdown>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {sections
                    .filter((x) => x !== criteria || items.length === 0)
                    .map((x) => (
                      <section key={x.title} className="tm-sec">
                        <h3>{x.title}</h3>
                        <div className="md">
                          <Markdown remarkPlugins={[remarkGfm]}>{x.body}</Markdown>
                        </div>
                      </section>
                    ))}
                  {sections.length === 0 && <p className="fi-empty">{t("tm.none")}</p>}
                </>
              )}
              {text && tab === "activity" && (
                <ol className="tm-act">
                  {activity.map((a, i) => {
                    const who = agentsIn(s, a.who)[0];
                    return (
                      <li key={i} className={`act-${a.kind}`}>
                        <span className="tm-act-dot">{who ? <Avatar agent={who} size="sm" /> : <Icon name={a.kind === "commit" ? "branch" : a.kind === "move" ? "arrow" : "ticket"} size={12} />}</span>
                        <span className="tm-act-body">
                          <span className="tm-act-hd">
                            <b>{who?.name ?? a.who}</b>
                            <time className="mono">{dateTime(a.at, locale)}</time>
                          </span>
                          <span className={a.kind === "commit" ? "mono" : ""}>{a.text}</span>
                        </span>
                      </li>
                    );
                  })}
                  {activity.length === 0 && <li className="fi-empty">{t("tm.none")}</li>}
                </ol>
              )}
              {text && tab === "source" && (
                <div className="md tm-source">
                  <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
                </div>
              )}
            </div>
          </main>

          <aside className="tm-side">
            <section className="tm-card">
              <h3>{t("tm.people")}</h3>
              <div className="tm-people">
                {owners.map((a) => (
                  <Person key={a.id} agent={a} role={t("tm.owner")} onAgent={onAgent} />
                ))}
                {crew.map((a) => (
                  <Person key={a.id} agent={a} role={t("tm.crew")} onAgent={onAgent} />
                ))}
                {verifier && <Person agent={verifier} role={t("tm.verifier")} onAgent={onAgent} />}
                {owners.length === 0 && !verifier && <p className="fi-empty">{tk.owner || t("tm.none")}</p>}
              </div>
            </section>

            <section className="tm-card">
              <h3>{t("tm.facts")}</h3>
              <dl className="tm-facts">
                {tk.area && (
                  <>
                    <dt>{t("tm.area")}</dt>
                    <dd className="mono">{tk.area}</dd>
                  </>
                )}
                {tk.decision && (
                  <>
                    <dt>{t("tm.decision")}</dt>
                    <dd>{tk.decision}</dd>
                  </>
                )}
                {tk.fix && (
                  <>
                    <dt>{t("tm.fix")}</dt>
                    <dd className="mono">{tk.fix}</dd>
                  </>
                )}
                <dt>{t("tm.created")}</dt>
                <dd>{dateTime(tk.created, locale)}</dd>
                <dt>{t("tm.updated")}</dt>
                <dd>{dateTime(tk.updated, locale)}</dd>
                {cycle !== undefined && (
                  <>
                    <dt>{t("tm.cycle")}</dt>
                    <dd>{span(cycle)}</dd>
                  </>
                )}
              </dl>
            </section>

            <section className="tm-card">
              <h3>{t("tm.refs")}</h3>
              {refs.thread && (
                <button type="button" className={`tm-thread th-${refs.thread.status}`} onClick={() => onDoc("thread", refs.thread!.name)}>
                  <Icon name="chat" size={14} />
                  <span>
                    <b>{refs.thread.title}</b>
                    <small>
                      {t(`th.st.${refs.thread.status}`)} · {t("th.posts", { n: refs.thread.posts.length })}
                      {refs.thread.decision ? ` · ${refs.thread.decision}` : ""}
                    </small>
                  </span>
                </button>
              )}
              {refs.commits.length > 0 && (
                <div className="tm-ref">
                  <h4>
                    {t("tm.commits")} <small>{refs.commits.length}</small>
                  </h4>
                  <ul className="tm-commits">
                    {refs.commits.map((c) => (
                      <li key={c.sha} title={c.branch}>
                        <span className="mono">{c.sha.slice(0, 7)}</span>
                        <span className="tm-commit">{c.subject}</span>
                        <em className={c.integrated ? "is-in" : ""}>{c.integrated ? t("dr.integrated") : t("dr.notIntegrated")}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {related(refs.mentions, t("tm.mentions"))}
              {related(refs.mentionedBy, t("tm.mentionedBy"))}
              {refs.files.length > 0 && (
                <div className="tm-ref">
                  <h4>
                    {t("tm.files")} <small>{refs.files.length}</small>
                  </h4>
                  <div className="tm-chips">
                    {refs.files.map((f) => (
                      <button key={f} type="button" className="tm-file mono" onClick={() => copy(f)} title={t("tm.copy")}>
                        {copied === f ? <Icon name="check" size={12} /> : null}
                        {copied === f ? t("tm.copied") : f}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!refs.thread && refs.commits.length === 0 && refs.mentions.length === 0 && refs.mentionedBy.length === 0 && refs.files.length === 0 && <p className="fi-empty">{t("tm.none")}</p>}
            </section>
            {CLOSED.includes(tk.status) ? null : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
