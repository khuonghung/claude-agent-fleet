# Agent Fleet

A Claude Code plugin to **plan, launch and watch a fleet of agents**: a team of Claude Code sessions (or subagents) that work in parallel toward one goal, coordinated through a shared board, and followed live on a multilingual dashboard.

```
/agent-fleet:new "Harden the API and fix what QA found, in 4 hours"
```

1. **Goal and scope**: what done means, the repository, the base branch, what is out of bounds.
2. **Org chart**: a team sized to the goal (lead, product owner, delivery lead, release manager, developers, testers, reviewers…), who reports to whom.
3. **Specialty**: what each member focuses on and the paths it owns (builders never overlap).
4. **Model and effort**: suggested per member (Opus + high for hard work, Sonnet + medium for coordination, Haiku + low for mechanical tasks), confirmed by you (or `auto`). The model stays fixed while a member runs; its effort follows each ticket — the ticket's `Effort:`, else its severity — and the lead switches desktop members at a ticket's start.
5. **Time and budget**: the window, its phases (start-up, build & verify, code freeze, reports), optional per-member windows and an output-token budget.
6. **Board, briefs and agents** are written to `.fleet/<mission>/` (kept out of git): the protocol and tickets, one brief per member, and **one specialised agent per member**, generated from the plan (its role's duties made specific by its specialty, area, model, effort, window and manager). The **dashboard** opens.

Then `/agent-fleet:launch` starts every member with its brief, model and effort — as desktop sessions, background subagents, or headless `claude -p` processes — and the dashboard follows them.

## Commands

| Command | What it does |
|---|---|
| `/agent-fleet:new [goal]` | Plans a fleet with you and writes its board, briefs and `fleet.json` |
| `/agent-fleet:launch [members]` | Starts the members (sessions, subagents or headless) and the dashboard |
| `/agent-fleet:add [who]` | Adds a member to the running fleet and launches it; everyone else keeps working |
| `/agent-fleet:extend [time]` | Moves the fleet's end later: phases, windows and briefs updated, the team told |
| `/agent-fleet:dashboard` | Starts or finds the dashboard and gives its URL |
| `/agent-fleet:status` | Time left, tickets, idle members, what needs you |
| `/agent-fleet:wrap-up` | Collects reports and writes the final report |

## Skills

Playbooks for the team's work, written for the fleet's board protocol. Each member's generated agent lists the skills of its role and when to load them; the lead uses them too.

| Skill | For | What it holds |
|---|---|---|
| `agent-fleet:decompose-goal` | lead, product owner, architect | goal → small, independent tickets with one area each; vertical slices; dependencies |
| `agent-fleet:write-ticket` | everyone who files | precise problem, repro and evidence; Given/When/Then acceptance criteria; severity scale |
| `agent-fleet:triage-tickets` | product owner, delivery lead | do now / defer / won't do; duplicates; ICE ranking; trimming to the time left |
| `agent-fleet:dispatch-work` | delivery lead, lead | one owner per area, one ticket in progress per builder, handoffs, waking idle members, freeze |
| `agent-fleet:plan-ticket` | builders, architect | root cause, files, the test that proves it, checks — recorded in the ticket |
| `agent-fleet:verify-before-done` | builders, testers, release manager | no status change without the command and its output; who may set which status |
| `agent-fleet:review-change` | reviewers, architect | correctness, tests, security, conventions, scope; each finding a ticket |
| `agent-fleet:integrate-branches` | release manager | one branch at a time, checks after each merge, backing out red merges, conflicts |
| `agent-fleet:status-report` | everyone | Progress · Plans · Problems; members' end reports; the final report for the owner |
| `agent-fleet:team-communication` | everyone | which channel for what; messages a busy agent can act on; when to speak up; waiting without stalling; deadlocks and escalation |
| `agent-fleet:discuss-and-decide` | lead, product owner, delivery lead, architect, researcher | a written discussion in a thread: options and a recommendation, structured answers by a deadline, one owner decides, disagree and commit |
| `agent-fleet:swarm-ticket` | delivery lead, architect, builders, testers, reviewers | one ticket, several members: split behind a contract, builder + tester, driver + navigator, parallel investigation, multi-reviewer; one owner accountable |
| `agent-fleet:investigate-bug` | builders, testers, researchers | root cause before fix; four phases; three failed fixes → rethink; competing hypotheses across members with evidence and arbitration |
| `agent-fleet:respond-to-review` | builders, writers | verify findings against the code, clarify first, push back with evidence, fix one at a time, answer per item |

### Working together

Members that must talk to get one piece of work done use a **thread** on the board: `threads/<topic>.md`, with an owner who decides, the members who must answer, a deadline, and posts typed as question, proposal, answer, concern, agree, decision, ready, blocked, handoff or status. A direct message is only the doorbell that points at it — a message to a busy session waits until its turn ends, so the thread holds the substance. A ticket worked by several members names them in `Crew:` and has a thread of its own. The dashboard shows every thread, its posts and its decision.

The role catalog maps roles to skills (`skills` per role); a plan can override a member's list. See `NOTICE.md` for the collections that inspired them.

## The dashboard

A live control room (Server-Sent Events, no polling) in **English, Tiếng Việt, 日本語, 한국어 and 中文**, light and dark:

- **Overview**: the mascot lineup — a plush animal per role (a chick for the lead, a cat, a bear, an owl, a frog, a bunny, a ghost…), each acting out its member's state: it hops while running a tool, looks around while thinking, sleeps when idle; members who share a role get their own colour and a hair clip — KPIs with the token budget, ticket burn-up, the team pulse heatmap, output tokens per squad, the ticket funnel, *Needs attention* and the live feed.
- **Org chart**: who reports to whom, the mission plan (goal, window, phases, budget, launch mode) and every member's planned model, effort and window beside what it runs — a member running another model than planned is flagged.
- **Team**: one card per member (now doing, last words, sparkline, commits, tickets, tokens, model) and the who-messages-whom matrix.
- **Tickets**, **Code & infra** (branches, integration, base-branch guard, service probes), **Reports**.
- Everywhere: a command palette (**Ctrl/⌘ K**) to jump to any tab, member or ticket; `/` to search tickets; toasts when a ticket is filed or changes status or a member starts; cards that glide when tickets move between columns. Models are named with their version (`Opus 5.5`). Motion follows the system's reduced-motion setting.

The server sends the whole state once per connection, then at most once a second only the parts that changed (each member's telemetry separately), and reads git and the port probes only while someone watches.

It reads only: each member's Claude Code transcript (sessions in `~/.claude/projects/<project>/*.jsonl` by their title or session id, subagents in `<session>/subagents/*.jsonl` by their description), the board's Markdown files, git and the ports you list. Set `"privacy": { "readText": false }` in `fleet.json` to keep counts, tools and states but none of the agents' words.

## How it fits together

| Part | Where |
|---|---|
| Plan schema, defaults, validation | `scripts/lib/plan.mjs`, `assets/role-catalog.json` |
| Board, protocol and briefs | `scripts/lib/board-init.mjs`, `assets/templates/` |
| CLI the commands and members run | `scripts/fleet.mjs` (`catalog`, `version`, `validate`, `estimate`, `init`, `clone`, `add`, `extend`, `doctor`, `launch-plan`, `brief`, `resume`, `roster`, `ticket`, `integrate`, `send`, `inbox`, `ack`, `say`, `dashboard`, `stop`, `status`, `spawn`); run it with no command for the usage |
| Dashboard server (Node, no dependencies) | `scripts/server/` |
| Dashboard (built) | `assets/dashboard/`; its source is `web/` (React + Vite) at the repository root, outside the plugin |
| Planner agent | `agents/fleet-planner.md` — proposes the org chart, areas, models and efforts |
| Member agents | generated per fleet by `fleet init` into `.fleet/<mission>/agents/` from `assets/templates/agent.md` and the role catalog; installed as project agents `.claude/agents/fleet-<mission>-<id>.md` for subagent launches |
| Skills | `skills/<name>/SKILL.md` — the team's playbooks, mapped to roles in the catalog |
| Token estimate | `scripts/lib/estimate.mjs`, `assets/token-rates.json` — measured output tokens per active hour by model and squad, scaled by effort |
| Hooks | `hooks/` — tells a member session where its board is; remembers the lead session; records each member's sessions; gives a compacted member its resume note |
| Sessions | `scripts/lib/sessions.mjs` — the `Fleet member:` marker, which session is which member, the resume note |
| Workflow | `workflows/launch-fleet.js` — members as parallel subagents |

## Install

From GitHub:

```bash
claude plugin marketplace add khuonghung/claude-agent-fleet
claude plugin install agent-fleet@agent-fleet
```

From a clone, pass the repository root instead: `claude plugin marketplace add ./claude-agent-fleet`. See the [repository README](https://github.com/khuonghung/claude-agent-fleet#install) for updating and removing.

Node 22 or later is needed (the CLI, the hooks and the dashboard server use only Node's standard library; the dashboard ships built).

## Develop

From the repository root (the marketplace: `.claude-plugin/marketplace.json`, this plugin in `plugins/agent-fleet/`, the dashboard source in `web/`):

```bash
pnpm --dir web install
pnpm test          # node:test: plan, board, agents, transcripts, hooks, every language complete
pnpm typecheck
pnpm build         # builds the dashboard into plugins/agent-fleet/assets/dashboard
pnpm validate      # claude plugin validate --strict, plugin and marketplace
node plugins/agent-fleet/scripts/server/index.mjs examples/kintsugi-night-team/fleet.json   # the dashboard on a recorded fleet
```

## Notes

- Many parallel Opus members use a lot of usage; a usage limit pauses the whole fleet. The planner says so when it suggests models.
- Context is kept lean to save tokens: every model call re-reads a member's whole context, so members are kept under `context.compactAt` (100k tokens by default). Subagents and headless members compact there on their own; the lead clears an idle desktop member past it and wakes it with `fleet resume <id>`, a note that starts it again from its brief and open tickets. The board is the members' memory, so a clear loses nothing, and the dashboard follows a member into its new transcript.
- Members never commit to the base branch or push: the owner reviews and merges. The dashboard warns if the base branch moves.
- The board protocol is plain Markdown so any member — and you — can read and edit it.
