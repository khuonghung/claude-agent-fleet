---
description: Plan a new agent fleet with the user — goal, org chart, each member's specialty, model, effort and time — then write its board and open the dashboard
argument-hint: "[goal in a sentence]"
---

You are planning an **agent fleet**: a team of Claude Code agents that work in parallel toward one goal, coordinated through a shared board and watched on a live dashboard. Plan it *with* the user: propose, let them confirm or change, then write it. Speak the user's language.

The fleet CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs"` (call it `fleet` below). Run commands from the root of the project the fleet works on.

**Another round of a fleet that ran here before?** When `.fleet/` holds a fleet and the user wants the same team again ("sweep 4", "same team, next batch"), offer to clone it instead of planning from scratch: `fleet clone --name "<new name>" [--hours N] [--goal "<text>"] --dry-run` shows the new fleet; on a yes, run it without `--dry-run`. It keeps the members (roles, specialties, areas, models, efforts, reporting lines) and the budget, starts a fresh board from now, scales the phases to the new length, renames a named integration branch, and carries the last round's open tickets over as `new` under `CO-…` ids (`--carry` picks the statuses; by default new, triaged, assigned, in-progress, reopened, deferred). Then go to step 8 (dashboard) and offer `/agent-fleet:launch`. Change members afterwards with `/agent-fleet:add` or by editing the plan and running `fleet init --force` before launch.

## 1. Read what you can choose from

Run `fleet catalog`: the roles (each with a default squad, model, effort, worktree and duties), the models — each alias with its exact model (`opus` = Claude Opus 5.5, `claude-opus-5-5`; `sonnet` = Claude Sonnet 5.5; `haiku` = Claude Haiku 5.5; `inherit` = the lead's own model) — the efforts (`low` … `max`) and team templates (`small`, `standard`, `review`). Always name models by their full name and id when you talk to the user, never by a bare alias.

## 2. Goal and scope

Start from `$ARGUMENTS` if given. Ask, in one round (AskUserQuestion when available, else plain questions):

- **Goal**: what done means, in one or two sentences, and how success is checked (tests green, a report, tickets verified…).
- **Scope**: the repository (default: the current folder), its base branch (read it with `git symbolic-ref --short HEAD`), what is in and out of bounds (paths, "no pushes", "no paid API calls"…).
- **Other agent CLIs**: besides Claude Code, do they have another harness that some members could run in — Codex CLI, Copilot CLI, Gemini CLI, or any other? (`fleet harness list` shows the profiles already researched here and the plugin's starting points; name those in the question.)

When they name one, follow the `onboard-harness` skill of this plugin for each, before step 5. Ask what they have and what it is for, research how it runs unattended, write `.fleet/harnesses/<id>.json`, and prove it with `fleet harness check <id> --live` (with their go-ahead: it runs two short turns on their account). A harness whose live check does not pass is not used. Say so, and keep those members in Claude Code.

Then look at the repository yourself (top-level layout, packages/apps, test commands, CLAUDE.md / AGENTS.md) so you can propose real ownership areas. Do not ask what you can read.

## 3. Org chart

For a large or unfamiliar goal, ask the `fleet-planner` agent of this plugin for a first proposal (it reads the repository and returns the org chart, areas, models and efforts), then refine it with the user.

Propose a team sized to the goal and the time: start from a template (`small` for a few hours on one area, `standard` for a broad push, `review` for an audit), then adapt. Show it as a table — `id` (kebab-case, e.g. `dev-api`), role, reports to, one-line specialty — and a tree of who reports to whom. Exactly one member has role `lead` (that is this session; it is not launched again). Builders' areas (`owns`, paths) must not overlap; testers and reviewers may read anything.

Ask the user to confirm or edit (add, remove, rename, re-parent). Repeat until they confirm.

## 4. Each member's specialty

For each member write `specialty` (what they focus on, in this project's words) and `owns` (the paths they change, or what they check). Builders get concrete paths from step 2. Show the result compactly and let the user adjust.

Each member also gets the **skills** of its role (`skills` in the catalog): the plugin's playbooks for the team's work — `decompose-goal`, `write-ticket`, `triage-tickets`, `dispatch-work`, `plan-ticket`, `verify-before-done`, `review-change`, `integrate-branches`, `status-report`, and for working together `team-communication`, `discuss-and-decide`, `swarm-ticket`, `investigate-bug`, `respond-to-review`. Its agent file lists them and tells it when to load each. Members talk through threads on the board (`threads/<topic>.md`, see the protocol's "Working together"); if the goal has pieces that need several members at once — a cross-area feature, a hard bug — say which tickets you expect to swarm and who would be in the crew. Change a member's list only when its work differs from its role's (for example a tester who also reviews gets `review-change`). As the lead, use `decompose-goal` now to turn the goal into the first tickets, and `dispatch-work` once the fleet runs.

## 5. Model and effort — suggest, then confirm

Suggest a model and effort per member as a table — member, model by full name and id (e.g. "Claude Opus 5.5 · `claude-opus-5-5`"), effort, one line of why — starting from the catalog defaults and the work:

- Claude Opus 5.5 + `high`/`xhigh`: design, hard code changes, security, careful testing.
- Claude Sonnet 5.5 + `medium`: coordination, integration, documentation, broad but routine testing.
- Claude Haiku 5.5 + `low`: mechanical, well-specified, high-volume tasks.
- Inherit (the lead's own model) for the lead.
- **Another harness** the user onboarded in step 2 (`"harness": "<id>"`, with that CLI's own model name, or empty for its default): suggest it only where it brings something. For example, a reviewer on another vendor's model as a second opinion, or high-volume, well-specified work on a plan the user already pays for. The lead, the product owner and the delivery lead stay in Claude Code. Such a member has no Skill tool or SendMessage, and its runner wakes it from the board, so it suits work that lives in tickets more than fast back-and-forth. `fleet estimate` counts it as Claude Opus (no measured rate); say so.

Write the candidate plan to `.fleet/plan.json` and run `fleet estimate .fleet/plan.json`: it gives each member's expected output tokens from rates measured on real fleets (Opus at high effort about 100k per active hour, Sonnet coordinating about 25k) and the total range. Show those numbers beside each option, so the choice is concrete.

Offer the user, in one question: **use the suggestion**, **all Opus** (strongest), **economy** (Sonnet everywhere but builders), or **edit per member** — each with its estimated total. Say that parallel members share one usage limit, and that reaching it pauses the whole fleet.

## 6. Time and budget

Ask:

- **How long** (hours) and **when to start** (now by default). The plan gets four phases by default — start-up 10%, build & verify 65%, code freeze 10%, reports 15%; offer to rename or move them.
- Optional **per-member windows** (e.g. testers start after the first hour).
- **Whether to limit output tokens** — always ask; never set a limit, or leave one out, without the user's answer. Rerun `fleet estimate` for the plan as it now stands and give the numbers in the question: the expected total, the range, and the `suggestedBudget` (the top of the range, rounded up). Ask in one question (AskUserQuestion when available) with these options:
  - **Limit at the suggested budget** (recommended) — e.g. "Limit at 1.3M (expected 966k, range 676k–1.26M)";
  - **Limit at another amount** — the user gives the number;
  - **No limit** — tokens are still counted and shown, nothing happens at any amount.

  With a limit, ask in the same round **what happens when it is reached** (`budget.onLimit`):
  - `warn` (default) — the lead tells the user and the fleet keeps going until the user decides;
  - `wrap-up` — the lead runs `/agent-fleet:wrap-up`: members finish what they hold, write their reports, and stop;
  - `stop` — the lead tells every member to stop at once and end its turn, then reports where things stand.

  In every case the lead warns the user once when use passes 80% of the limit (`budget.warnAt`, a share between 0 and 1, if they want another threshold). Say plainly that the limit is kept by the lead checking `fleet status`, not by Claude Code: members can go a little past it between two checks, and a usage limit of the account can still pause the fleet earlier.
- **How members run** (`launch`): `session` (separate Claude desktop sessions — best, needs the desktop app's session tools), `subagent` (background subagents of this session), or `headless` (`claude -p` processes). Members with a `harness` always run through their runner (`launch: runner`), whatever this says.
- The **dashboard language** (`en`, `vi`, `ja`, `ko`, `zh`; default: the user's language).

## 7. Write the plan

Write the plan to `.fleet/plan.json` in this shape (fields you leave out get the catalog defaults):

```json
{
  "mission": { "name": "…", "goal": "…", "hours": 4, "language": "en", "phases": [] },
  "repo": { "dir": ".", "base": "main", "integration": "nt-integration" },
  "launch": "session",
  "budget": { "outputTokens": 1300000, "onLimit": "warn", "warnAt": 0.8 },
  "probes": [{ "name": "API", "port": 3000 }],
  "agents": [
    { "id": "lead", "role": "lead", "name": "lead" },
    { "id": "po", "role": "product-owner", "reportsTo": "lead", "specialty": "…", "model": "opus", "effort": "high" },
    { "id": "dev-api", "role": "developer", "reportsTo": "po", "specialty": "…", "owns": ["apps/api"], "model": "opus", "effort": "high", "skills": ["plan-ticket", "verify-before-done", "write-ticket", "status-report"] },
    { "id": "rev-2", "role": "reviewer", "reportsTo": "po", "specialty": "a second opinion on every integrated change", "harness": "codex", "model": "", "effort": "high" }
  ]
}
```

A member with `harness` runs in that CLI, from the profile in `.fleet/harnesses/<id>.json`. The plan copies the profile into `fleet.json`; leave the member out if the user has no other harness.

`repo.integration` is the branch the builders' work is merged into, which the dashboard counts integrated commits against. Leave it out when the plan has a `release-manager`: their worktree branch is the integration branch and the dashboard reads it from the roster. A plan with more than one builder and no release manager leaves integration to the lead, which stalls the team (each round takes the lead 10–20 minutes): propose a `release-manager` on Claude Sonnet 5.5 + `medium` instead, and only without one name the branch the lead will create (e.g. `<code>-integration`) and use that name when you create it; if the lead later picks another, write it into `fleet.json` (the dashboard re-reads it).

Leave `budget` out (or `{}`) when the user chose no limit. `context.compactAt` (default 100000; 100000 to 1000000, or 0 for off) is the context size members are kept under to save tokens: subagents and headless members compact there, the lead clears idle desktop members past it. Leave it out unless the user asks. Leave `phases` out to get the defaults, or give `{ "name", "from", "to" }` with ISO times. A custom role needs `title`, `squad` and `duties`.

Run `fleet validate .fleet/plan.json`; fix every problem it lists. Then run `fleet init .fleet/plan.json`: it writes `.fleet/<slug>/` — the completed `fleet.json`, the board with its protocol, roster and tickets, one brief per member, and **one specialised agent per member** in `.fleet/<slug>/agents/<id>.md` (the role's duties made specific: its specialty, area, model, effort, window and manager; for `subagent` launches it also installs them as project agents `.claude/agents/fleet-<slug>-<id>.md`) — and keeps all of it out of git. Show the user one generated agent so they see what a member is told. If init refuses because a fleet of the same slug has started or another fleet is still running, read its message to the user and let them choose: a new slug, `/agent-fleet:wrap-up` of the running fleet first, or `--force` (the other fleet's board stays in `.fleet/<its slug>/`, but it stops being the current fleet). Never pass `--force` on your own.

## 8. Open the dashboard

Run `fleet dashboard` and give the user the URL as a link they can click, on a line of its own — `Dashboard: [http://localhost:4600](http://localhost:4600)` with the port it printed — never only the port number (open it in the browser pane when you have one). Then show a short summary — goal, members with model · effort, window, the token limit and what happens at it (or "no limit") — and ask whether to launch now with `/agent-fleet:launch`.
