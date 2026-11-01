import type { T } from "./i18n";
import type { AgentDef, FleetState, Mission, Telemetry, Ticket } from "./types";

export const DONE = ["fixed", "integrated", "verified"];
export const CLOSED = [...DONE, "deferred", "wont-fix", "duplicate"];
export const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const startOf = (m: Mission): number => Date.parse(m.startAt);
export const endOf = (m: Mission): number => Date.parse(m.endAt);

/** A status in the reader's language; an unknown status as it is. */
export const statusLabel = (t: T, status: string): string => {
  const key = `st.${status}` as Parameters<T>[0];
  const text = t(key);
  return text === key ? status : text;
};

export const clock = (at: number | string, locale: string, seconds = false) =>
  new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });

export const dateTime = (at: number | string, locale: string) => new Date(at).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function ago(now: number, at: string | number | null | undefined): string {
  if (!at) return "—";
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}′`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** The family of a model id or alias ("claude-opus-5-5" → "Opus"); "" when unknown or inherited. */
export function modelFamily(model: string | undefined): string {
  const m = (model ?? "").toLowerCase();
  return m.includes("opus") ? "Opus" : m.includes("sonnet") ? "Sonnet" : m.includes("haiku") ? "Haiku" : m.includes("fable") ? "Fable" : "";
}

/** The versions the aliases of the role catalog stand for (assets/role-catalog.json). */
const ALIAS_VERSION: Record<string, string> = { opus: "5.5", sonnet: "5.5", haiku: "5.5" };

/** A model as people name it, with its version: "claude-opus-5-5" or "opus" → "Opus 5.5"; "inherit" → "Inherit". */
export function modelLabel(model: string | undefined): string {
  const m = (model ?? "").toLowerCase();
  if (m === "inherit") return "Inherit";
  const id = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(m);
  if (id) return `${id[1]![0]!.toUpperCase()}${id[1]!.slice(1)} ${id[2]}${id[3] ? `.${id[3]}` : ""}`;
  const family = modelFamily(m);
  return family ? `${family} ${ALIAS_VERSION[family.toLowerCase()] ?? ""}`.trim() : model ?? "—";
}

/** The model a member runs when it differs from the plan's (not for "inherit" or before it started). */
export function modelMismatch(agent: AgentDef, t: Telemetry | null | undefined): { actual: string; planned: string } | undefined {
  const planned = modelFamily(agent.model);
  const actual = modelFamily(t?.model);
  return planned && actual && planned !== actual ? { actual, planned } : undefined;
}

export type Activity = "running" | "thinking" | "replied" | "waiting" | "silent" | "offline";

export interface AgentStatus {
  kind: Activity;
  tool?: string;
  since: string | null;
  active: boolean;
}

export const toolName = (name: string) => name.replace(/^mcp__.+__/, "");

export function agentStatus(t: Telemetry | null | undefined, now: number): AgentStatus {
  if (!t || !t.lastAt) return { kind: "offline", since: null, active: false };
  const age = now - Date.parse(t.lastAt);
  if (t.phase === "tool" && t.pendingTool && age < 20 * 60_000) return { kind: "running", tool: toolName(t.pendingTool.name), since: t.pendingTool.at, active: true };
  if ((t.phase === "thinking" || t.phase === "prompt") && age < 4 * 60_000) return { kind: "thinking", since: t.lastAt, active: true };
  if (t.phase === "replied") return { kind: age < 3 * 60_000 ? "replied" : "waiting", since: t.lastAt, active: age < 90_000 };
  return { kind: "silent", since: t.lastAt, active: false };
}

export function agentStatusLabel(tr: T, st: AgentStatus): string {
  return st.kind === "running" ? tr("ag.running", { tool: st.tool ?? "" }) : tr(`ag.${st.kind}` as Parameters<T>[0]);
}

/** Whether a free-text "who" (a ticket's Owner, Verifier or Crew) names this member by its whole id: "qa2" is not "qa". */
export const names = (text: string | undefined, agentId: string) => String(text ?? "").toLowerCase().split(/[^a-z0-9-]+/).includes(agentId);

export function ownerOf(t: Ticket, agentId: string) {
  return names(t.owner, agentId);
}

export function verifierOf(t: Ticket, agentId: string) {
  return names(t.verifier, agentId);
}

export function sortTickets(list: Ticket[]) {
  return [...list].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.updated.localeCompare(a.updated));
}

export function agentById(s: FleetState, id: string) {
  return s.agents.find((a) => a.id === id);
}

/**
 * The members a free-text "who" names (a ticket's Owner or Crew, a log author), in the order written: whole ids or
 * names only, so "dev" never matches "dev-api"; "lead" or "orchestrator" means the lead.
 */
export function agentsIn(s: FleetState, text: string | undefined): AgentDef[] {
  const out: AgentDef[] = [];
  for (const word of String(text ?? "").toLowerCase().split(/[^a-z0-9-]+/)) {
    const hit = s.agents.find((a) => a.id === word || a.name.toLowerCase() === word) ?? (/^(lead|orchestrator)$/.test(word) ? s.agents.find((a) => a.launch === "self") : undefined);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** The first member a free-text "who" names. */
export const agentIn = (s: FleetState, text: string | undefined) => agentsIn(s, text)[0];

/** Since when a ticket has been in its current status: the transition the server saw, else its last log line, else its last edit. */
export function statusSince(s: FleetState, tk: Ticket): number {
  const moved = s.transitions.findLast((x) => x.id === tk.id && x.to === tk.status);
  if (moved) return Date.parse(moved.at);
  const logged = tk.log.at(-1)?.at;
  return Math.max(logged ? Date.parse(logged) : 0, 0) || Date.parse(tk.updated);
}

/** When the ticket was last touched: its file or its last log line, whichever is later. */
export const touchedAt = (tk: Ticket) => Math.max(Date.parse(tk.updated), ...tk.log.map((l) => Date.parse(l.at)));

/** How long a ticket may sit in a status before it needs someone's attention. */
const STALE_AFTER: Record<string, number> = { new: 20 * 60_000, triaged: 30 * 60_000, assigned: 30 * 60_000, "in-progress": 45 * 60_000, fixed: 40 * 60_000, integrated: 40 * 60_000, reopened: 15 * 60_000 };

/** "stale" when nobody touched a ticket for longer than its status allows; only while the mission runs. */
export function staleness(s: FleetState, tk: Ticket, now: number): { stale: boolean; idle: number } {
  const idle = now - touchedAt(tk);
  const limit = STALE_AFTER[tk.status];
  return { stale: limit !== undefined && now < endOf(s.mission) && idle > limit, idle };
}

/** Created → verified (or done), in ms; undefined until then. */
export const cycleTime = (tk: Ticket) => {
  const end = tk.verifiedAt ?? tk.doneAt;
  return end ? Math.max(0, Date.parse(end) - Date.parse(tk.created)) : undefined;
};

export const median = (values: number[]) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** "1h05", "12′", "40s" — a span of time in a few characters. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}′`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h${String(m % 60).padStart(2, "0")}` : `${Math.floor(h / 24)}d`;
}

/** Tickets verified that the agent owned or verified: a mascot cheers each time this rises. */
export const cheerOf = (s: FleetState, id: string) => (s.board?.tickets ?? []).filter((x) => x.status === "verified" && (ownerOf(x, id) || verifierOf(x, id))).length;

export const launched = (s: FleetState) => s.agents.some((a) => s.telemetry[a.id]?.lastAt);
