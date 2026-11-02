import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { agentById, ago, clock, waitingOn } from "../lib";
import type { ChannelPost, FleetState, Thread } from "../types";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

/** Posts by the same member within this long read as one message group, as in a chat. */
const GROUP_MS = 5 * 60_000;
/** A quiet stretch this long gets a time divider. */
const DIVIDER_MS = 20 * 60_000;
const OWNER = "owner";
const COMMAND = "fleet say owner fyi '…'";

/** One row of the channel: a member's run of posts, or a discussion shown as a conversation with its replies. */
type Entry =
  | { type: "posts"; key: string; who: string; at: number; divider: boolean; posts: (ChannelPost & { i: number })[] }
  | { type: "thread"; key: string; at: number; divider: boolean; thread: Thread };

type Event = { at: number; post: ChannelPost & { i: number }; thread?: undefined } | { at: number; thread: Thread; post?: undefined };

/** The channel's posts and the board's discussions on one timeline; a discussion sits where it last moved, as a conversation does in a Teams channel. */
function entriesOf(posts: ChannelPost[], threads: Thread[]): Entry[] {
  const events: Event[] = [...posts.map((p, i) => ({ at: Date.parse(p.at), post: { ...p, i } })), ...threads.map((th) => ({ at: Date.parse(th.updated), thread: th }))];
  events.sort((a, b) => a.at - b.at);
  const out: Entry[] = [];
  let prevAt = 0;
  for (const e of events) {
    const last = out.at(-1);
    const divider = !last || e.at - prevAt >= DIVIDER_MS;
    if (e.thread) out.push({ type: "thread", key: `th-${e.thread.name}`, at: e.at, divider, thread: e.thread });
    else if (last?.type === "posts" && last.who === e.post.who && e.at - prevAt < GROUP_MS) last.posts.push(e.post);
    else out.push({ type: "posts", key: `${e.post.i}-${e.post.who}`, who: e.post.who, at: e.at, divider, posts: [e.post] });
    prevAt = e.at;
  }
  return out;
}

/** A post without its author's own id in front ("po: …" by po): the channel already shows who posted. */
const unsigned = (text: string, who: string) => text.replace(new RegExp(`^@?${who.replace(/[-]/g, "\\-")}\\s*:\\s*`), "") || text;

/**
 * A post's text with `code`, **bold**, the board's ticket ids (opened on click) and members' ids (as mentions) brought out,
 * and commit hashes set back. A member's id inside a path or a branch name (`reports/po.md`) is not a mention.
 */
function RichText({ text, tickets, members, onTicket }: { text: string; tickets: Set<string>; members: string[]; onTicket: (id: string) => void }) {
  const parts = useMemo(() => {
    const ids = members.map((m) => m.replace(/[-]/g, "\\-")).join("|");
    const code = "(`[^`]+`)";
    const bold = "\\*\\*([^*]+)\\*\\*";
    const ticket = "\\b([A-Z][A-Z0-9]{0,5}-\\d{1,5})\\b";
    const mention = `((?<![\\w/.-])@?\\b(?:${ids || "(?!)"})\\b(?![\\w-]|\\.\\w))`;
    const sha = "((?<![\\w/.-])(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![\\w-]))";
    const re = new RegExp([code, bold, ticket, mention, sha].join("|"), "g");
    const out: ReactNode[] = [];
    let at = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > at) out.push(text.slice(at, m.index));
      const key = `${m.index}`;
      if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
      else if (m[2]) out.push(<b key={key}>{m[2]}</b>);
      else if (m[3] && tickets.has(m[3])) {
        const id = m[3];
        out.push(
          <button key={key} type="button" className="cn-ticket mono" onClick={() => onTicket(id)}>
            {id}
          </button>,
        );
      } else if (m[4])
        out.push(
          <span key={key} className="cn-mention">
            @{m[4].replace(/^@/, "")}
          </span>,
        );
      else if (m[5])
        out.push(
          <span key={key} className="cn-sha mono" title={m[5]}>
            {m[5].slice(0, 8)}
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

/** The team channel: the short news everyone posts with `fleet say` and the board's discussions, in one chat channel; it opens large too. */
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
  const threads = s.board?.threads ?? [];
  const entries = useMemo(() => entriesOf(posts, threads), [posts, threads]);
  const tickets = useMemo(() => new Set((s.board?.tickets ?? []).map((x) => x.id)), [s.board?.tickets]);
  const members = useMemo(() => [...s.agents.map((a) => a.id), OWNER], [s.agents]);
  const pinned = useMemo(() => threads.filter((th) => th.status === "open").sort((a, b) => (a.decideAt ?? "~").localeCompare(b.decideAt ?? "~")), [threads]);
  // Every post and reply counts: a new reply in a discussion moves the channel as a new post does.
  const size = posts.length + threads.reduce((n, th) => n + 1 + th.posts.length, 0);
  const lastAt = entries.length ? Math.max(...entries.map((e) => e.at)) : null;
  // Who spoke in the last half hour, newest first: the channel's "here now".
  const here = useMemo(() => {
    const said = [...posts.map((p) => ({ who: p.who, at: Date.parse(p.at) })), ...threads.flatMap((th) => th.posts.map((p) => ({ who: p.who, at: Date.parse(p.at) })))];
    said.sort((a, b) => b.at - a.at);
    const seen: string[] = [];
    for (const p of said) if (now - p.at < 30 * 60_000 && !seen.includes(p.who)) seen.push(p.who);
    return seen;
  }, [posts, threads, now]);

  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(size);
  const [fresh, setFresh] = useState(0);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  // A pinned discussion opens its conversation and brings it into view.
  const jump = (name: string) => {
    // Opening it grows the list: without this, following the bottom would pull the reader away again.
    atBottom.current = false;
    setOpened((was) => new Set(was).add(name));
    requestAnimationFrame(() => {
      const el = list.current;
      const card = el?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(name)}"]`);
      // At once: a smooth scroll reports the bottom on its first frame, and following the bottom would take over again.
      if (el && card) el.scrollTop = card.offsetTop - 8;
    });
  };

  // Follow the newest post while the reader is at the bottom; otherwise count what arrived below.
  useLayoutEffect(() => {
    const el = list.current;
    const added = size - seen.current;
    seen.current = size;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setFresh((n) => n + added);
  }, [size]);
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
  }, [size > 0]);
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
  const rich = (text: string) => <RichText text={text} tickets={tickets} members={members} onTicket={onTicket} />;
  const face = (id: string, sm = true) => {
    const a = agentById(s, id);
    return a ? (
      <button type="button" className="cn-av" onClick={() => onAgent(a.id)} aria-label={a.name}>
        <Avatar agent={a} size="sm" />
      </button>
    ) : (
      <span className={`cn-av cn-owner-av${sm ? " is-sm" : ""}`}>
        <Icon name="user" size={14} />
      </span>
    );
  };
  const nameOf = (id: string) => (id === OWNER ? t("cn.owner") : (agentById(s, id)?.name ?? id));

  return (
    <section className={`panel channel${big ? " is-big" : ""}`} aria-label={t("cn.title")}>
      <header className="cn-hd">
        <span className="cn-hash" aria-hidden="true">
          #
        </span>
        <span className="cn-name">
          <b>{t("cn.title")}</b>
          <small>{lastAt ? t("cn.note", { n: posts.length, open: pinned.length, ago: ago(now, lastAt) }) : t("cn.empty")}</small>
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

      {pinned.length > 0 && (
        <nav className="cn-pins" aria-label={t("cn.pinned")}>
          {pinned.map((th) => (
            <button key={th.name} type="button" className="cn-pin" onClick={() => jump(th.name)} title={th.title}>
              <span className="cn-pin-dot" aria-hidden="true" />
              <span className="cn-pin-title">{th.title}</span>
              {th.decideBy && <small className="mono">{th.decideBy}</small>}
            </button>
          ))}
        </nav>
      )}

      <div className="cn-scroll" ref={list} onScroll={onScroll}>
        {entries.length === 0 ? (
          <div className="cn-empty">
            <Icon name="chat" size={22} />
            <p>{t("cn.none")}</p>
          </div>
        ) : (
          <ol className="cn-list">
            {entries.map((g) => (
              <li key={g.key} className="cn-group-wrap">
                {g.divider && (
                  <div className="cn-divider" role="separator">
                    <span>{clock(g.at, locale)}</span>
                  </div>
                )}
                {g.type === "thread" ? (
                  <Conversation th={g.thread} open={opened.has(g.thread.name)} onToggle={() => toggle(g.thread.name)} onDoc={onDoc} face={face} nameOf={nameOf} rich={rich} />
                ) : (
                  <div className={`cn-group${g.who === OWNER ? " is-owner" : ""}`}>
                    {face(g.who, false)}
                    <div className="cn-msgs">
                      <div className="cn-meta">
                        <b>{nameOf(g.who)}</b>
                        {agentById(s, g.who)?.title && <span className="cn-role">{agentById(s, g.who)!.title}</span>}
                        {g.who === OWNER && <span className="cn-badge">{t("cn.owner")}</span>}
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
                          <span className="cn-text">{rich(unsigned(p.text, p.who))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
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

/** A discussion in the channel: its question and state as the opening post, then its replies — the last one until opened, as in a Teams conversation. */
function Conversation({
  th,
  open,
  onToggle,
  onDoc,
  face,
  nameOf,
  rich,
}: {
  th: Thread;
  open: boolean;
  onToggle: () => void;
  onDoc: (doc: string, name: string) => void;
  face: (id: string, sm?: boolean) => ReactNode;
  nameOf: (id: string) => string;
  rich: (text: string) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const waiting = waitingOn(th);
  const replies = open ? th.posts : th.posts.slice(-1);
  const hidden = th.posts.length - replies.length;
  const voices = [...new Set(th.posts.map((p) => p.who))];
  return (
    <div className={`cn-group cn-conv is-${th.status}`} data-thread={th.name}>
      {face(th.owner || (th.posts[0]?.who ?? OWNER), false)}
      <div className="cn-msgs">
        <div className="cn-meta">
          <b>{nameOf(th.owner || (th.posts[0]?.who ?? OWNER))}</b>
          <span className="cn-role">{t("cn.leads")}</span>
          <time className="mono" dateTime={th.updated}>
            {clock(th.updated, locale)}
          </time>
        </div>
        <article className="cn-card">
          <div className="cn-card-hd">
            <span className={`th-st st-${th.status}`}>{t(`th.st.${th.status}`)}</span>
            {th.status === "open" && th.decideBy && (
              <span className="cn-card-by">
                <Icon name="clock" size={12} />
                {t("th.by", { time: th.decideBy })}
              </span>
            )}
            {th.ticket && <span className="cn-card-ticket">{rich(th.ticket)}</span>}
          </div>
          <b className="cn-card-title">{th.title}</b>
          {th.context && <p className={`cn-card-ctx${open ? " is-open" : ""}`}>{rich(th.context)}</p>}
          {th.decision && (
            <p className="th-decision">
              <Icon name="check" size={14} />
              <span>
                <b>{t("th.decision")}</b> {rich(th.decision)}
              </span>
            </p>
          )}
          {waiting.length > 0 && (
            <p className="th-waiting">
              <Icon name="clock" size={14} />
              <span>{rich(t("th.waiting", { names: waiting.join(", ") }))}</span>
            </p>
          )}
          {th.posts.length > 0 && (
            <div className="cn-replies">
              {hidden > 0 && (
                <button type="button" className="cn-more" onClick={onToggle} aria-expanded={false}>
                  <span className="cn-faces" aria-hidden="true">
                    {voices.slice(0, 3).map((id) => (
                      <span key={id}>{face(id)}</span>
                    ))}
                  </span>
                  {t("cn.replies", { n: hidden })}
                </button>
              )}
              {replies.map((p, i) => (
                <div key={`${p.time}-${p.who}-${i}`} className={`cn-reply k-${p.kind}`}>
                  {face(p.who)}
                  <div className="cn-reply-body">
                    <div className="cn-meta">
                      <b>{nameOf(p.who)}</b>
                      {p.kind !== "post" && <span className={`po-kind k-${p.kind}`}>{t(`th.k.${p.kind}`)}</span>}
                      <time className="mono" dateTime={p.at}>
                        {p.time}
                      </time>
                    </div>
                    <span className={`cn-text cn-reply-text${open ? "" : " is-clamped"}`}>{rich(p.text)}</span>
                  </div>
                </div>
              ))}
              {open && th.posts.length > 1 && (
                <button type="button" className="cn-more" onClick={onToggle} aria-expanded>
                  {t("cn.fewer")}
                </button>
              )}
            </div>
          )}
          <button type="button" className="cn-card-doc" onClick={() => onDoc("thread", th.name)}>
            <Icon name="board" size={13} />
            {t("th.openDoc")}
          </button>
        </article>
      </div>
    </div>
  );
}
