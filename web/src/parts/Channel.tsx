import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { agentById, ago, clock } from "../lib";
import type { ChannelPost, FleetState } from "../types";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

/** Posts by the same member within this long read as one message group, as in a chat. */
const GROUP_MS = 5 * 60_000;
/** A quiet stretch this long gets a time divider. */
const DIVIDER_MS = 20 * 60_000;
const OWNER = "owner";
const COMMAND = "fleet say owner fyi '…'";

interface Group {
  key: string;
  who: string;
  at: number;
  divider: boolean;
  posts: (ChannelPost & { i: number })[];
}

function groupsOf(posts: ChannelPost[]): Group[] {
  const out: Group[] = [];
  posts.forEach((p, i) => {
    const at = Date.parse(p.at);
    const last = out.at(-1);
    const prevAt = last ? Date.parse(last.posts.at(-1)!.at) : 0;
    if (last && last.who === p.who && at - prevAt < GROUP_MS) last.posts.push({ ...p, i });
    else
      out.push({
        key: `${i}-${p.who}`,
        who: p.who,
        at,
        divider: !last || at - prevAt >= DIVIDER_MS,
        posts: [{ ...p, i }],
      });
  });
  return out;
}

/** A post's text with `code`, the board's ticket ids (opened on click) and members' ids (as mentions) brought out. */
function RichText({ text, tickets, members, onTicket }: { text: string; tickets: Set<string>; members: string[]; onTicket: (id: string) => void }) {
  const parts = useMemo(() => {
    const ids = members.map((m) => m.replace(/[-]/g, "\\-")).join("|");
    const re = new RegExp(`(\`[^\`]+\`)|\\b([A-Z][A-Z0-9]{0,5}-\\d{1,5})\\b|(@?\\b(?:${ids || "(?!)"})\\b)`, "g");
    const out: ReactNode[] = [];
    let at = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > at) out.push(text.slice(at, m.index));
      const key = `${m.index}`;
      if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
      else if (m[2] && tickets.has(m[2])) {
        const id = m[2];
        out.push(
          <button key={key} type="button" className="cn-ticket mono" onClick={() => onTicket(id)}>
            {id}
          </button>,
        );
      } else if (m[3])
        out.push(
          <span key={key} className="cn-mention">
            @{m[3].replace(/^@/, "")}
          </span>,
        );
      else out.push(m[0]);
      at = m.index + m[0].length;
    }
    out.push(text.slice(at));
    return out;
  }, [text, tickets, members, onTicket]);
  return <>{parts}</>;
}

interface Props {
  s: FleetState;
  now: number;
  onAgent: (id: string) => void;
  onTicket: (id: string) => void;
  onDoc: (doc: string, name: string) => void;
}

/** The team channel: the short news everyone posts with `fleet say`, laid out as a chat channel; it opens large too. */
export function Channel(props: Props) {
  const { t } = useI18n();
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);
  // Leaving the large view for a ticket, a member or a document closes it, so what opens is not hidden behind it.
  const leave =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      setBig(false);
      fn(...args);
    };
  return (
    <>
      <ChannelView {...props} big={false} onSize={() => setBig(true)} />
      {big &&
        createPortal(
          <div className="cn-wrap" onMouseDown={() => setBig(false)}>
            <div className="cn-dialog" role="dialog" aria-modal="true" aria-label={t("cn.title")} onMouseDown={(e) => e.stopPropagation()}>
              <ChannelView {...props} onAgent={leave(props.onAgent)} onTicket={leave(props.onTicket)} onDoc={leave(props.onDoc)} big onSize={() => setBig(false)} />
            </div>
          </div>,
          // Outside <main>, whose entry animation transforms it: a fixed dialog inside would be placed relative to it.
          document.body,
        )}
    </>
  );
}

function ChannelView({ s, now, onAgent, onTicket, onDoc, big, onSize }: Props & { big: boolean; onSize: () => void }) {
  const { t, locale } = useI18n();
  const posts = s.board?.channel?.posts ?? [];
  const groups = useMemo(() => groupsOf(posts), [posts]);
  const tickets = useMemo(() => new Set((s.board?.tickets ?? []).map((x) => x.id)), [s.board?.tickets]);
  const members = useMemo(() => [...s.agents.map((a) => a.id), OWNER], [s.agents]);
  // Who spoke in the last half hour, newest first: the channel's "here now".
  const here = useMemo(() => {
    const seen: string[] = [];
    for (const p of [...posts].reverse()) if (now - Date.parse(p.at) < 30 * 60_000 && !seen.includes(p.who)) seen.push(p.who);
    return seen;
  }, [posts, now]);

  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(posts.length);
  const [fresh, setFresh] = useState(0);
  const [copied, setCopied] = useState(false);

  // Follow the newest post while the reader is at the bottom; otherwise count what arrived below.
  useLayoutEffect(() => {
    const el = list.current;
    const added = posts.length - seen.current;
    seen.current = posts.length;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setFresh((n) => n + added);
  }, [posts.length]);
  // Fonts and mascots settle after the first paint and grow the list: stay pinned to the bottom while they do.
  useEffect(() => {
    const el = list.current;
    const content = el?.firstElementChild;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    watch.observe(content);
    return () => watch.disconnect();
  }, [posts.length > 0]);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom.current) setFresh(0);
  };
  const toBottom = () => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setFresh(0);
  };
  const copy = () => {
    navigator.clipboard?.writeText(COMMAND).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <section className={`panel channel${big ? " is-big" : ""}`} aria-label={t("cn.title")}>
      <header className="cn-hd">
        <span className="cn-hash" aria-hidden="true">
          #
        </span>
        <span className="cn-name">
          <b>{t("cn.title")}</b>
          <small>
            {posts.length
              ? t("cn.note", {
                  n: posts.length,
                  ago: ago(now, posts.at(-1)!.at),
                })
              : t("cn.empty")}
          </small>
        </span>
        <span className="cn-here" title={t("cn.here", { n: here.length })}>
          {here.slice(0, 4).map((id) => {
            const a = agentById(s, id);
            return a ? (
              <Avatar key={id} agent={a} size="sm" />
            ) : (
              <span key={id} className="cn-owner-av is-sm">
                <Icon name="user" size={12} />
              </span>
            );
          })}
          {here.length > 4 && <em>+{here.length - 4}</em>}
        </span>
        <button type="button" className="cn-doc" onClick={() => onDoc("board", "CHANNEL")} title={t("cn.openDoc")} aria-label={t("cn.openDoc")}>
          <Icon name="board" size={15} />
        </button>
        <button type="button" className="cn-doc" onClick={onSize} title={big ? t("cn.collapse") : t("cn.expand")} aria-label={big ? t("cn.collapse") : t("cn.expand")} autoFocus={big}>
          <Icon name={big ? "close" : "expand"} size={15} />
        </button>
      </header>

      <div className="cn-scroll" ref={list} onScroll={onScroll}>
        {posts.length === 0 ? (
          <div className="cn-empty">
            <Icon name="chat" size={22} />
            <p>{t("cn.none")}</p>
          </div>
        ) : (
          <ol className="cn-list">
            {groups.map((g) => {
              const agent = agentById(s, g.who);
              const owner = g.who === OWNER;
              return (
                <li key={g.key} className="cn-group-wrap">
                  {g.divider && (
                    <div className="cn-divider" role="separator">
                      <span>{clock(g.at, locale)}</span>
                    </div>
                  )}
                  <div className={`cn-group${owner ? " is-owner" : ""}`}>
                    {agent ? (
                      <button type="button" className="cn-av" onClick={() => onAgent(agent.id)} aria-label={agent.name}>
                        <Avatar agent={agent} size="sm" />
                      </button>
                    ) : (
                      <span className="cn-av cn-owner-av">
                        <Icon name="user" size={14} />
                      </span>
                    )}
                    <div className="cn-msgs">
                      <div className="cn-meta">
                        <b>{owner ? t("cn.owner") : (agent?.name ?? g.who)}</b>
                        {agent?.title && <span className="cn-role">{agent.title}</span>}
                        {owner && <span className="cn-badge">{t("cn.owner")}</span>}
                        <time className="mono" dateTime={g.posts[0]!.at}>
                          {g.posts[0]!.time}
                        </time>
                      </div>
                      {g.posts.map((p) => (
                        <div key={p.i} className={`cn-msg k-${p.kind}`}>
                          <time className="cn-gutter mono" dateTime={p.at}>
                            {p.time}
                          </time>
                          {p.kind !== "fyi" && p.kind !== "post" && <span className={`cn-kind k-${p.kind}`}>{t(`cn.k.${p.kind}`)}</span>}
                          <span className="cn-text">
                            <RichText text={p.text} tickets={tickets} members={members} onTicket={onTicket} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {fresh > 0 && (
        <button type="button" className="cn-fresh" onClick={toBottom}>
          {t("cn.fresh", { n: fresh })}
          <Icon name="chevron" size={13} />
        </button>
      )}

      <button type="button" className="cn-compose" onClick={copy} title={t("cn.composeHint")}>
        <Icon name="chat" size={15} />
        <code>{COMMAND}</code>
        <span className={`cn-copy${copied ? " is-done" : ""}`}>{copied ? t("cn.copied") : t("cn.copy")}</span>
      </button>
    </section>
  );
}
