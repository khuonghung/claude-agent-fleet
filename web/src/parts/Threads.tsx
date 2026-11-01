import { useState } from "react";
import { useI18n } from "../i18n";
import { agentById, ago } from "../lib";
import type { FleetState, Thread } from "../types";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

/** Members named in an open thread who have not posted in it yet. */
export const waitingOn = (th: Thread) => {
  if (th.status !== "open") return [];
  const posted = new Set(th.posts.map((p) => p.who));
  return th.members.filter((m) => m !== th.owner && !posted.has(m));
};

/** The board's discussions: who decides, who still has to answer, the posts and the decision. */
export function Threads({ s, now, onAgent, onDoc }: { s: FleetState; now: number; onAgent: (id: string) => void; onDoc: (doc: string, name: string) => void }) {
  const { t } = useI18n();
  const threads = s.board?.threads ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ?? threads.find((x) => x.status === "open")?.name ?? null;
  const count = (status: Thread["status"]) => threads.filter((x) => x.status === status).length;

  return (
    <section className="panel threads" aria-label={t("th.title")}>
      <div className="sec-hd">
        <h2>{t("th.title")}</h2>
        <span className="sec-note">{t("th.note", { open: count("open"), decided: count("decided") + count("closed") })}</span>
      </div>
      {threads.length === 0 && <p className="fi-empty">{t("th.none")}</p>}
      <ul className="th-list">
        {threads.map((th) => {
          const owner = agentById(s, th.owner);
          const waiting = waitingOn(th);
          const isOpen = shown === th.name;
          return (
            <li key={th.name} className={`th is-${th.status}${isOpen ? " is-open" : ""}`}>
              <button type="button" className="th-hd" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : th.name)}>
                <span className={`th-st st-${th.status}`}>{t(`th.st.${th.status}`)}</span>
                <span className="th-title">{th.title}</span>
                <span className="th-meta">
                  {owner && <Avatar agent={owner} size="sm" />}
                  <span>{t("th.posts", { n: th.posts.length })}</span>
                  {th.status === "open" && th.decideBy ? <span>{t("th.by", { time: th.decideBy })}</span> : <span>{ago(now, th.updated)}</span>}
                </span>
                <Icon name="chevron" className="th-chev" />
              </button>
              {isOpen && (
                <div className="th-body">
                  {th.ticket && <span className="th-ticket mono">{th.ticket}</span>}
                  {th.decision && (
                    <p className="th-decision">
                      <Icon name="check" size={14} />
                      <b>{t("th.decision")}</b> {th.decision}
                    </p>
                  )}
                  {waiting.length > 0 && (
                    <p className="th-waiting">
                      <Icon name="clock" size={14} />
                      {t("th.waiting", { names: waiting.join(", ") })}
                    </p>
                  )}
                  <ol className="th-posts">
                    {th.posts.map((p, i) => {
                      const who = agentById(s, p.who);
                      return (
                        <li key={`${p.time}-${p.who}-${i}`} className={`po po-${p.kind}`}>
                          {who ? (
                            <button type="button" className="po-av" onClick={() => onAgent(who.id)} aria-label={who.name}>
                              <Avatar agent={who} size="sm" />
                            </button>
                          ) : (
                            <span className="po-av fi-sys">
                              <Icon name="user" size={13} />
                            </span>
                          )}
                          <span className="po-body">
                            <span className="po-hd">
                              <b>{who?.name ?? p.who}</b>
                              <span className={`po-kind k-${p.kind}`}>{t(`th.k.${p.kind}`)}</span>
                              <time className="mono">{p.time}</time>
                            </span>
                            <span className="po-text">{p.text}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  <button type="button" className="chip" onClick={() => onDoc("thread", th.name)}>
                    {t("th.openDoc")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
