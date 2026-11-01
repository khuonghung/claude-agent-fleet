// Each member's inbox on the board: direct messages that wait to be read and say when they were. A SendMessage to a
// busy session is held until its turn ends, and a compaction can lose it; an inbox line stays until it is acknowledged,
// the hook shows a member its unread lines on every prompt, and the lead's check rings again for old ones.
//
//   inbox/<id>.md    one line per message, appended: `- #<n> HH:MM <from>: <text>`
//   inbox/<id>.read  one line per acknowledgement, appended: `<n> HH:MM`
// Both only ever grow, so senders and the reader never overwrite each other.

import fs from "node:fs";
import path from "node:path";
import { clockToIso } from "../server/board.mjs";

// Not board-init's: that module reaches sessions.mjs, which reads the inbox for resume notes.
const hhmm = (at) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

const MESSAGE = /^-\s+#(\d+)\s+(\d{1,2}:\d{2})\s+([a-z][a-z0-9-]*):\s*(.*)$/;
const files = (boardDir, id) => ({ messages: path.join(boardDir, "inbox", `${id}.md`), read: path.join(boardDir, "inbox", `${id}.read`) });
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : []);

/** Every message of a member's inbox, oldest first, each with whether (and when) it was read. */
export function messagesOf(boardDir, id, { startAt } = {}) {
  const f = files(boardDir, id);
  const read = new Map(lines(f.read).flatMap((line) => (/^(\d+)\s+(\d{1,2}:\d{2})/.test(line) ? [[Number(line.split(/\s+/)[0]), line.split(/\s+/)[1]]] : [])));
  return lines(f.messages).flatMap((line) => {
    const m = MESSAGE.exec(line);
    if (!m) return [];
    const n = Number(m[1]);
    return [{ n, time: m[2], from: m[3], text: m[4], read: read.get(n) ?? null, at: startAt ? clockToIso(startAt, m[2]) : null }];
  });
}

/** Appends one message to a member's inbox and returns it; the number is the next one in that inbox. */
export function send(boardDir, { from, to, text, now = new Date() }) {
  const f = files(boardDir, to);
  fs.mkdirSync(path.dirname(f.messages), { recursive: true });
  if (!fs.existsSync(f.messages)) fs.writeFileSync(f.messages, `# Inbox of ${to}\n\nDirect messages, oldest first. Read them with \`fleet inbox ${to}\`, acknowledge with \`fleet ack ${to} <n>\` once acted on.\n\n`);
  const n = lines(f.messages).filter((l) => MESSAGE.test(l)).length + 1;
  const line = `- #${n} ${hhmm(now)} ${from}: ${String(text).replace(/\s+/g, " ").trim().slice(0, 1000)}`;
  fs.appendFileSync(f.messages, `${line}\n`);
  return { to, n, line };
}

/** Marks messages read: the numbers given, or every unread one ("all"). Returns the numbers acknowledged. */
export function ack(boardDir, id, which, { now = new Date() } = {}) {
  const unread = messagesOf(boardDir, id).filter((m) => !m.read).map((m) => m.n);
  const picked = which.includes("all") ? unread : which.map(Number).filter((n) => unread.includes(n));
  if (picked.length > 0) {
    const f = files(boardDir, id);
    fs.mkdirSync(path.dirname(f.read), { recursive: true });
    fs.appendFileSync(f.read, picked.map((n) => `${n} ${hhmm(now)}\n`).join(""));
  }
  return picked;
}

/** Unread messages per member, with the age of the oldest in minutes: what `fleet status` and the lead's check read. */
export function unreadState(fleet, { now = new Date() } = {}) {
  const out = {};
  for (const agent of fleet.agents) {
    const unread = messagesOf(fleet.board.dir, agent.id, { startAt: fleet.mission.startAt }).filter((m) => !m.read);
    if (unread.length === 0) continue;
    const oldest = Math.min(...unread.map((m) => Date.parse(m.at)));
    out[agent.id] = { unread: unread.length, oldestMinutes: Math.max(0, Math.round((now.getTime() - oldest) / 60_000)) };
  }
  return out;
}

/**
 * What a member is shown of its unread messages (by the prompt hook, in a resume note); "" when there are none.
 * `ackCmd(numbers)` is the command that acknowledges them.
 */
export function unreadNote(fleet, id, ackCmd) {
  const unread = messagesOf(fleet.board.dir, id).filter((m) => !m.read);
  if (unread.length === 0) return "";
  return [
    `You have ${unread.length} unread message(s) in your fleet inbox:`,
    ...unread.slice(-10).map((m) => `- #${m.n} ${m.time} ${m.from}: ${m.text}`),
    `Act on them, then acknowledge: ${ackCmd(unread.map((m) => m.n).join(" "))}`,
    "",
  ].join("\n");
}
