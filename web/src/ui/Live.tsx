// Live layer: toasts for what just happened (from one state to the next) and the command palette (Ctrl/⌘ + K).

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { agentStatus, statusLabel } from "../lib";
import { Mascot } from "../parts/Mascot";
import type { AgentDef, FleetState } from "../types";
import { Icon } from "./Icons";

interface Toast {
  id: number;
  tone: "ok" | "bad" | "info";
  text: string;
  agent?: AgentDef;
  ticket?: string;
}

/** What changed between two states that a watcher wants to know at once. */
function diff(prev: FleetState, next: FleetState, t: ReturnType<typeof useI18n>["t"], now: number): Omit<Toast, "id">[] {
  const out: Omit<Toast, "id">[] = [];
  const before = new Map((prev.board?.tickets ?? []).map((x) => [x.id, x.status]));
  for (const tk of next.board?.tickets ?? []) {
    const was = before.get(tk.id);
    if (was === undefined && prev.board) out.push({ tone: "info", text: t("toast.filed", { id: tk.id }), ticket: tk.id });
    else if (was !== undefined && was !== tk.status) {
      const tone = tk.status === "verified" ? "ok" : tk.status === "reopened" ? "bad" : "info";
      out.push({ tone, text: t("toast.moved", { id: tk.id, status: statusLabel(t, tk.status) }), ticket: tk.id });
    }
  }
  for (const a of next.agents) {
    const p = agentStatus(prev.telemetry[a.id], now);
    const n = agentStatus(next.telemetry[a.id], now);
    if (p.kind === "offline" && n.kind !== "offline") out.push({ tone: "ok", text: t("toast.started", { name: a.name }), agent: a });
  }
  return out.slice(0, 4);
}

export function Toasts({ s, now, onTicket, onAgent }: { s: FleetState; now: number; onTicket: (id: string) => void; onAgent: (id: string) => void }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prev = useRef<FleetState | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (prev.current && prev.current.rev !== s.rev) {
      const fresh = diff(prev.current, s, t, now).map((x) => ({ ...x, id: ++seq.current }));
      if (fresh.length) {
        setToasts((list) => [...fresh, ...list].slice(0, 5));
        for (const x of fresh) setTimeout(() => setToasts((list) => list.filter((y) => y.id !== x.id)), 6500);
      }
    }
    prev.current = s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.rev]);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <button key={x.id} type="button" className={`toast is-${x.tone}`} onClick={() => (x.ticket ? onTicket(x.ticket) : x.agent ? onAgent(x.agent.id) : undefined)}>
          {x.agent ? <Mascot agent={x.agent} size={26} fuzzy={false} /> : <Icon name={x.tone === "bad" ? "alert" : x.tone === "ok" ? "check" : "ticket"} />}
          <span>{x.text}</span>
          <i className="toast-timer" />
        </button>
      ))}
    </div>
  );
}

interface Entry {
  key: string;
  kind: "tab" | "agent" | "ticket";
  label: string;
  hint: string;
  run: () => void;
  agent?: AgentDef;
}

export function Palette({ s, open, onOpen: setOpen, tabs, onTab, onAgent, onTicket }: { s: FleetState; open: boolean; onOpen: (open: boolean) => void; tabs: { id: string; label: string }[]; onTab: (id: string) => void; onAgent: (id: string) => void; onTicket: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, setOpen]);
  useEffect(() => {
    if (open) (setQ(""), setActive(0));
  }, [open]);
  const entries = useMemo<Entry[]>(
    () => [
      ...tabs.map((x) => ({ key: `tab-${x.id}`, kind: "tab" as const, label: x.label, hint: t("pal.tab"), run: () => onTab(x.id) })),
      ...s.agents.map((a) => ({ key: `ag-${a.id}`, kind: "agent" as const, label: a.name, hint: a.title ?? a.role, run: () => onAgent(a.id), agent: a })),
      ...(s.board?.tickets ?? []).map((x) => ({ key: `tk-${x.id}`, kind: "ticket" as const, label: `${x.id} · ${x.title}`, hint: statusLabel(t, x.status), run: () => onTicket(x.id) })),
    ],
    [s, tabs, t, onTab, onAgent, onTicket],
  );
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = entries.filter((e) => words.every((w) => `${e.label} ${e.hint}`.toLowerCase().includes(w))).slice(0, 12);
  if (!open) return null;
  const run = (e: Entry | undefined) => {
    if (!e) return;
    setOpen(false);
    e.run();
  };
  return (
    <div className="pal-wrap" onMouseDown={() => setOpen(false)}>
      <div className="pal" role="dialog" aria-modal="true" aria-label={t("pal.title")} onMouseDown={(e) => e.stopPropagation()}>
        <label className="pal-in">
          <Icon name="search" />
          <input
            autoFocus
            value={q}
            placeholder={t("pal.placeholder")}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, shown.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
              else if (e.key === "Enter") run(shown[active]);
            }}
          />
          <kbd>esc</kbd>
        </label>
        <ul className="pal-list" role="listbox">
          {shown.map((e, i) => (
            <li key={e.key} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""} onMouseEnter={() => setActive(i)} onMouseDown={() => run(e)}>
              {e.agent ? <Mascot agent={e.agent} size={22} fuzzy={false} /> : <Icon name={e.kind === "tab" ? "layers" : "ticket"} />}
              <span className="pal-label">{e.label}</span>
              <small>{e.hint}</small>
              <Icon name="arrow" size={14} className="pal-go" />
            </li>
          ))}
          {shown.length === 0 && <li className="pal-empty">{t("feed.none")}</li>}
        </ul>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("pal.move")}
          </span>
          <span>
            <kbd>↵</kbd> {t("pal.open")}
          </span>
        </div>
      </div>
    </div>
  );
}

