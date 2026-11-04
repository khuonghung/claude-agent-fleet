export interface Phase {
  name: string;
  from: string;
  to: string;
}

export interface Mission {
  name: string;
  goal: string;
  slug: string;
  code?: string;
  language?: string;
  startAt: string;
  endAt: string;
  phases: Phase[];
}

export interface Squad {
  id: string;
  name: string;
  note: string;
}

export interface MascotSpec {
  shape?: "cloud" | "frog" | "gumdrop" | "bean" | "dome" | "cat" | "bunny" | "bear" | "chick" | "owl" | "ghost" | "mochi" | string;
  color?: string;
  eyes?: "dots" | "googly" | "smile" | string;
  accessory?: "none" | "beret" | "crown" | "headset" | "hardhat" | "glasses" | "sunglasses" | "goggles" | "magnifier" | "bowtie" | "bow" | "antenna" | string;
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  title?: string;
  squad: string;
  reportsTo?: string;
  specialty?: string;
  duties?: string;
  owns?: string[];
  model?: string;
  effort?: string;
  launch?: string;
  worktree?: boolean;
  readOnly?: boolean;
  window?: { from: string; to: string };
  mascot?: MascotSpec;
}

export interface LogLine {
  time: string;
  at: string;
  who: string;
  note: string;
}

export interface Ticket {
  id: string;
  title: string;
  severity: string;
  status: string;
  doneAt: string | null;
  verifiedAt: string | null;
  owner: string;
  /** Other members working on a shared ticket (free text, as written in the ticket). */
  crew?: string;
  verifier: string;
  decision: string;
  fix: string;
  area: string;
  created: string;
  updated: string;
  log: LogLine[];
  /** Other tickets this one names, and the code locations it points at. */
  mentions?: string[];
  files?: string[];
}

export interface RosterRow {
  sessionId: string;
  worktree: string;
  branch: string;
}

export interface Report {
  name: string;
  updated: string;
  size: number;
  title: string;
}

export type PostKind = "question" | "proposal" | "answer" | "concern" | "agree" | "decision" | "ready" | "blocked" | "handoff" | "status" | "post";

export interface Post {
  time: string;
  at: string;
  who: string;
  kind: PostKind;
  text: string;
}

/** A discussion on the board (`threads/<name>.md`): who decides, who must answer, by when, and its posts. */
export interface Thread {
  name: string;
  title: string;
  status: "open" | "decided" | "closed";
  ticket: string;
  owner: string;
  members: string[];
  decideBy: string;
  /** `decideBy` as a time on the mission's clock, when it is written as HH:MM. */
  decideAt: string | null;
  decision: string;
  /** What the thread is about: the text under its `## Context`. */
  context: string;
  updated: string;
  posts: Post[];
}

export type ChannelKind = "heads-up" | "ask" | "answer" | "fyi" | "post";

/** One line of the team channel (`CHANNEL.md`). */
export interface ChannelPost {
  time: string;
  at: string;
  who: string;
  kind: ChannelKind;
  text: string;
}

export interface Board {
  tickets: Ticket[];
  threads?: Thread[];
  /** The team channel's last posts, oldest first; null on a board from before the channel. */
  channel?: { updated: string; posts: ChannelPost[] } | null;
  roster: Record<string, RosterRow>;
  reports: Report[];
  notices: string;
  stack: string;
  finalReport: { updated: string; size: number } | null;
}

export interface Commit {
  sha: string;
  at: string;
  subject: string;
  merge: boolean;
  integrated: boolean;
}

export interface Branch {
  agent: string;
  branch: string;
  commits: Commit[];
  /** What the branch changes over the base (as a merge would bring it); absent from servers before 0.7. */
  stat?: { files: number; insertions: number; deletions: number };
  /** Files changed, by package (`apps/api`, `(root)`). */
  packages?: Record<string, number>;
}

export interface GitState {
  base: string;
  baseHead: string;
  baselineHead: string;
  baseUntouched: boolean;
  /** null until the plan names it (`repo.integration`) or the release manager records their branch. */
  integration: string | null;
  branches: Branch[];
}

export interface Action {
  at: string | null;
  kind: "tool" | "text" | "prompt";
  tool?: string;
  summary: string;
}

export interface Telemetry {
  sessionId: string;
  kind?: "session" | "subagent";
  model: string;
  firstAt: string | null;
  lastAt: string | null;
  phase: "unknown" | "tool" | "thinking" | "replied" | "prompt";
  pendingTool: { name: string; summary: string; at: string | null } | null;
  toolCalls: number;
  toolMix: Record<string, number>;
  prompts: number;
  outputTokens: number;
  processedTokens: number;
  contextTokens: number;
  lastText: string;
  lastTextAt: string | null;
  recent: Action[];
  buckets: Record<string, number>;
  tokenBuckets: Record<string, number>;
  messagesTo: Record<string, number>;
}

/** One merge of an integration round, as `fleet integrate` plans it. */
export interface PlannedMerge {
  tickets: string[];
  sha: string;
  commits: number;
  packages: string[];
  message: string;
  command: string;
}

/** The round's merge plan (`fleet integrate --json`), or why there is none (`error`). */
export interface IntegrationPlan {
  at: string;
  error?: string;
  into?: string;
  head?: string;
  merges?: PlannedMerge[];
  blocked?: { id: string; owner: string; below: { sha: string; ticket: string; status: string }[] }[];
  merged?: { id: string; sha: string }[];
  missing?: { id: string; fix: string }[];
  unticketed?: { with: string; sha: string; subject: string }[];
  fullSuite?: { needed: boolean; because: string[] };
}

export interface DoctorCheck {
  name: string;
  state: "ok" | "warn" | "fail";
  detail: string;
}

/** The pre-flight checks (`fleet doctor --json`). */
export interface Doctor {
  at: string;
  ok?: boolean;
  checks?: DoctorCheck[];
  error?: string;
}

export interface Probe {
  name: string;
  port: number;
  up: boolean;
}

export interface Transition {
  id: string;
  from: string | null;
  to: string;
  at: string;
}

export interface HistoryPoint {
  at: string;
  created: number;
  done: number;
  verified: number;
  open: number;
  byStatus: Record<string, number>;
  activeAgents: number;
  toolCalls: number;
  outputTokens: number;
}

export interface FleetState {
  rev: number;
  budget: { outputTokens?: number; onLimit?: "warn" | "wrap-up" | "stop"; warnAt?: number; usd?: number };
  launch: string;
  startedAt: string;
  serverTime: string;
  mission: Mission;
  squads: Squad[];
  agents: AgentDef[];
  flow: { flow: string[]; parked: string[]; attention: string[] };
  board: Board | null;
  git: GitState | null;
  telemetry: Record<string, Telemetry | null>;
  /** The effort each member runs at now; with auto effort it follows its ticket. */
  efforts?: Record<string, string>;
  autoEffort?: boolean;
  probes: Probe[];
  integration?: IntegrationPlan | null;
  doctor?: Doctor | null;
  transitions: Transition[];
  history: HistoryPoint[];
}
