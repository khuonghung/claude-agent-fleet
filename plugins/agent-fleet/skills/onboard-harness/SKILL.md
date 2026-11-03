---
name: onboard-harness
description: Make another agent CLI usable by fleet members — Codex CLI, Copilot CLI, Gemini CLI, opencode, Cursor's agent, Aider, or any harness besides Claude Code. Learn from the user what they have, research how it runs unattended, write its harness profile `.fleet/harnesses/<id>.json`, and prove it with a live check. Use when planning a fleet and the user has a harness other than Claude Code, when a member should run in one, or when a harness profile's check fails.
---

# Onboard a harness

A fleet member can run in another agent CLI than Claude Code: a reviewer on another vendor's model for a second opinion, high-volume test writing on a plan the user already pays for. No CLI is built in. Each one is described by a **profile**: a small JSON file that says how to run one turn of it unattended and how to read what came out. The fleet's runner (`fleet run <member>`, started by `fleet spawn`) drives the member from the profile, turn by turn. There are many CLIs and they change every month, so the profile is researched with the user and proven on their machine, never assumed.

## What a fleet needs from a harness

| Need | Why | Look for |
|---|---|---|
| One turn, unattended | the runner starts it and waits for it to exit | a print / exec / headless / `-p` mode |
| Prompt on stdin | a multi-line brief does not survive the Windows shell as an argument | "reads the prompt from stdin", `-` as the prompt |
| Resume the same session with a new prompt | the member keeps its context between wakes | `resume <id>`, `--resume`, `--session-id` |
| The session id | to resume it | a flag that sets it up front, or a field in the JSON output |
| Model and effort | the plan chooses them per member | `--model`, a reasoning-effort flag or config key |
| No permission prompts | nobody is there to answer | auto-approve, yolo or full-auto modes, allow-lists |
| Writing to the board | the board sits outside the worktree | `--add-dir`, writable roots, include-directories |
| No `git push` | rule 1 of the protocol | a deny-list, a sandbox without network |
| Output tokens | the fleet's token limit and the dashboard count them | usage in the JSON output, or in the CLI's own session files |
| Project instructions | the CLI should read the repository's rules | AGENTS.md, CLAUDE.md or its own file |

## 1. Ask the user

In one round (AskUserQuestion when available):

- **Which CLIs** they have besides Claude Code: the name and the command (`codex`, `copilot`, `gemini`, …). Is each installed and signed in here?
- **Their account**: which models it gives them, and its limits or cost. Fleet members run for hours.
- **What for**: which members should run there (a reviewer, testers, a researcher), and why. Leave the lead, the product owner and the delivery lead in Claude Code. The lead is this session, and coordination leans on Claude Code's tools.
- **Rules**: what they will let it do unattended (write files, run shell commands, use the network), and anything their company forbids.
- A **docs link** if the CLI is not a well-known one.

## 2. Start from what exists

Run `fleet harness list`. It shows the project's profiles (`.fleet/harnesses/`, researched here before) and the plugin's starting points (`assets/harnesses/`: Codex CLI, Copilot CLI, Gemini CLI).

- A project profile marked **checked**: it is ready. Run `fleet harness check <id>`: if the installed version differs from the one it was checked with, prove it again (step 4).
- A plugin starting point: copy it to `.fleet/harnesses/<id>.json`, read its `notes` (what was not verified yet), then go to step 4.
- None: research it (step 3).

## 3. Research it

Answer every row of the table above, with evidence:

1. **The CLI's own help**: `<cmd> --help`, the help of its run or exec subcommand, `<cmd> help <topic>` for permissions, environment, config. The installed version is the truth; the docs may be newer or older.
2. **The official docs** (WebFetch, or the `web-fetch` agent): the non-interactive or headless page, the CLI reference, sessions and resume, permissions or sandbox, the output format.
3. **Its files on disk** (`~/.<cli>/`, its sessions folder): where a session is written, and which event carries the token counts. Open one session file from an earlier run and find the field.

Write the profile to `.fleet/harnesses/<id>.json`, with the doc URLs in `docs` and what you could not settle in `notes`.

## The profile

```json
{
  "id": "copilot",
  "title": "GitHub Copilot CLI",
  "command": "copilot",
  "check": ["--version"],
  "docs": ["https://docs.github.com/…"],
  "notes": "what was verified, what was not, and why each flag is there",
  "prompt": "stdin",
  "sessionId": "set",
  "run": ["--session-id", "{sessionId}", ["--model", "{model}"], ["--effort", "{effort}"], "--allow-all-tools", "--no-ask-user", "--add-dir", "{boardDir}", "--deny-tool", "shell(git push)", "--output-format", "json"],
  "resume": ["--resume={sessionId}", ["--model", "{model}"], "--allow-all-tools", "--no-ask-user", "--add-dir", "{boardDir}", "--output-format", "json"],
  "output": "jsonl",
  "efforts": { "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" },
  "usage": { "file": "~/.copilot/session-state/{sessionId}/events.jsonl", "match": { "type": "session.shutdown" }, "output": "data.tokenDetails.output.tokenCount", "cumulative": true },
  "reply": { "match": { "type": "assistant.message" }, "text": "data.content" }
}
```

- `run` and `resume` are the arguments of the first turn and of every later one. The runner fills in `{model}`, `{effort}`, `{sessionId}`, `{boardDir}`, `{cwd}`, `{name}` (the member's session title) and `{prompt}`. An inner array is a **group**, a flag and its value, dropped whole when one of its values is empty. So a member without a model gets the CLI's default.
- `prompt`: `"stdin"` (prefer it) or `"arg"` (then `{prompt}` goes in `run` and `resume`).
- `sessionId`: `"set"` when the CLI takes a session id up front (the runner makes a UUID and passes `{sessionId}` to `run`). Otherwise `{ "key": "<field>" }`: the first field of that name anywhere in the JSON output, such as `thread_id` or `session_id`.
- `output`: `"jsonl"` (one event a line), `"json"` (one object at the end) or `"text"`. Reading a session id or usage needs JSON.
- `usage`: the lines whose fields equal `match` (dotted paths), and the dotted path of the output tokens in them. Per-turn counts are summed. `"cumulative": true` when the number is the session's running total: the runner counts the growth from one turn to the next. `file` reads usage from a session file the CLI writes, instead of its output.
- `reply` (optional): where the member's last message is, for the dashboard's feed.
- `efforts`: the fleet's efforts (`low` … `max`) as the CLI's own words. A missing entry, or `{}` for a CLI without one, passes no effort.
- `model` (optional): the model a member gets when the plan names none. `env` (optional): settings the CLI reads from the environment. Never a secret: the CLI signs in with its own login.

## 4. Prove it

1. `fleet harness check <id>`: the profile is complete, and the command runs here (it prints the version).
2. Ask the user before the live check: it runs two short turns on their account. Then run `fleet harness check <id> --live [--model <m>] [--effort <e>]`. It starts one turn and resumes it, in a scratch board.
3. Read the result:
   - `problems`: what failed.
   - Per turn: the exact command, the exit code, the seconds, the session id, the output tokens, the reply, the event `types` and one `samples` line per type.
   - Fix the profile from the samples: the session id field, the usage path and match (a number that grows across turns is `cumulative`), the reply path. A failed exit shows its stderr: often a flag this version lacks, or a sign-in.
   - Run it again until `ok` is true.
4. A passing check saves the profile with `verified` (the time and the CLI's version) to `.fleet/harnesses/<id>.json`. The plan and `fleet doctor` read that stamp.

## 5. Keep it safe

- Show the user the arguments members will run with, especially auto-approve, the sandbox and writable folders. Never go further than they accept. Prefer a sandbox that keeps writes inside the work folder and the board.
- Deny `git push` (and pull requests) wherever the CLI can: the owner merges.
- No secrets in a profile, a brief or a ticket.

## 6. Use it in the plan

A member that runs there gets `"harness": "<id>"`. Its `"model"` is the CLI's own name for the model (empty means the CLI's default), and its effort is mapped through `efforts`. The plan copies the profile into `fleet.json`. `fleet init` writes a brief that tells the member it has no Skill tool or SendMessage: it reads skills as files and rings teammates with `fleet send`. The member's launch is `runner`.

- `fleet estimate` has no measured rate for other models and counts such a member as Claude Opus, the safe ceiling. Its tokens are measured only when `usage` works.
- The runner works turn by turn:
  - it wakes the member when its inbox, one of its tickets, a thread or a channel post that names it changes;
  - with no news for 15 minutes, it wakes the member to check the board;
  - when the member's window ends, it runs one last turn for the handover and the report;
  - after three failed turns in a row it stops and writes to the lead's inbox.
- Its state and turns are in `.fleet/<slug>/runner/`, and its log in `.fleet/<slug>/logs/<id>.log`.
- `fleet halt <id>` stops it after the current turn; `--now` stops it at once.

## When it goes wrong

| Symptom | Likely cause |
|---|---|
| The turn waits forever | a permission prompt or a question: add the CLI's auto-approve or no-ask flag; check that it reads stdin when it is not a terminal |
| `no session id` | the field is named otherwise: look at the `samples` of the first event |
| The resume starts a fresh session | the resume arguments or the id format: try the CLI's resume subcommand rather than a flag |
| Tokens always 0 | `usage.match` or the path is off, or the CLI only writes usage to its session files: use `usage.file` |
| Tokens jump up on every turn | the number is the session's running total: set `cumulative: true` |
| Writes to the board are refused | add the board with the CLI's extra-folder flag (`{boardDir}`) |
| Works in the check, fails in the fleet | the worktree is not trusted by the CLI, or the network is off: read `.fleet/<slug>/logs/<id>.log` |
