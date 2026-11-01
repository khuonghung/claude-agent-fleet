import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { agentById, agentIn, clock, statusLabel } from "../lib";
import type { AgentDef, FleetState } from "../types";
import { Fold, Slider } from "../ui/Controls";
import { Icon } from "../ui/Icons";
import { Avatar } from "./Fleet";

type Kind = "agent" | "ticket" | "code";
interface Item {
  key: string;
  at: number;
  kind: Kind;
  agent?: AgentDef;
  tag: string;
  text: string;
  ticket?: string;
}

const FILTERS = [
  { id: "all", label: "feed.all" },
  { id: "ticket", label: "feed.tickets" },
  { id: "code", label: "feed.code" },
  { id: "agent", label: "feed.agents" },
] as const;

export function Feed({ s, onTicket, onAgent }: { s: FleetState; onTicket: (id: string) => void; onAgent: (id: string) => void }) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [who, setWho] = useState<string>("");

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const a of s.agents) {
      for (const [i, r] of (s.telemetry[a.id]?.recent ?? []).entries()) {
        if (!r.at) continue;
        out.push({ key: `a-${a.id}-${r.at}-${i}`, at: Date.parse(r.at), kind: "agent", agent: a, tag: r.kind === "tool" ? (r.tool ?? "tool").replace(/^mcp__.+__/, "") : r.kind === "text" ? t("feed.said") : t("feed.got"), text: r.summary });
      }
    }
    for (const tk of s.board?.tickets ?? []) {
      for (const [i, l] of tk.log.entries()) {
        out.push({ key: `l-${tk.id}-${i}`, at: Date.parse(l.at), kind: "ticket", agent: agentIn(s, l.who), tag: tk.id, text: l.note, ticket: tk.id });
      }
    }
    for (const th of s.board?.threads ?? []) {
      for (const [i, p] of th.posts.entries()) {
        out.push({ key: `p-${th.name}-${i}`, at: Date.parse(p.at), kind: "agent", agent: agentIn(s, p.who), tag: `#${th.name}`, text: `${t(`th.k.${p.kind}`)} · ${p.text.split("\n")[0]}` });
      }
    }
    for (const [i, p] of (s.board?.channel?.posts ?? []).entries()) {
      out.push({ key: `cn-${i}-${p.at}`, at: Date.parse(p.at), kind: "agent", agent: agentIn(s, p.who), tag: t("cn.tag"), text: `${t(`cn.k.${p.kind}`)} · ${p.text}` });
    }
    for (const [i, x] of s.transitions.entries()) {
      out.push({ key: `t-${x.id}-${i}`, at: Date.parse(x.at), kind: "ticket", tag: x.id, text: x.from ? `${statusLabel(t, x.from)} → ${statusLabel(t, x.to)}` : t("feed.newTicket", { status: statusLabel(t, x.to) }), ticket: x.id });
    }
    for (const b of s.git?.branches ?? []) {
      for (const c of b.commits) {
        out.push({ key: `c-${c.sha}-${b.branch}`, at: Date.parse(c.at), kind: "code", agent: agentById(s, b.agent), tag: c.sha.slice(0, 7), text: c.subject });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }, [s, t]);

  const shown = items.filter((i) => (filter === "all" || i.kind === filter) && (!who || i.agent?.id === who)).slice(0, 160);

  return (
    <Fold
      id="feed"
      open
      className="feed"
      title={t("feed.title")}
      actions={<Slider kind="seg" label={t("feed.title")} value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ id: f.id, label: t(f.label) }))} />}
    >
      <div className="feed-who">
        <button type="button" className={`chip${who === "" ? " is-on" : ""}`} onClick={() => setWho("")}>
          {t("feed.everyone")}
        </button>
        {s.agents.map((a) => (
          <button key={a.id} type="button" className={`chip chip-av${who === a.id ? " is-on" : ""}`} onClick={() => setWho(who === a.id ? "" : a.id)} title={a.name}>
            <Avatar agent={a} size="sm" />
          </button>
        ))}
      </div>
      <ol className="feed-list">
        {shown.map((i) => (
          <li key={i.key} className={`fi fi-${i.kind}`}>
            <time className="mono">{clock(i.at, locale, true)}</time>
            {i.agent ? (
              <button type="button" className="fi-av" onClick={() => onAgent(i.agent!.id)} aria-label={i.agent.name}>
                <Avatar agent={i.agent} size="sm" />
              </button>
            ) : (
              <span className="fi-av fi-sys">
                <Icon name={i.kind === "code" ? "branch" : "ticket"} size={13} />
              </span>
            )}
            <span className="fi-body">
              {i.ticket ? (
                <button type="button" className="fi-tag mono is-link" onClick={() => onTicket(i.ticket!)}>
                  {i.tag}
                </button>
              ) : (
                <span className="fi-tag mono">{i.tag}</span>
              )}
              <span className="fi-text">{i.text}</span>
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="fi-empty">{t("feed.none")}</li>}
      </ol>
    </Fold>
  );
}
