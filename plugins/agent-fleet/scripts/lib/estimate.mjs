// How many output tokens a fleet will write: per member, the measured rate of its model and squad (assets/token-rates.json)
// scaled by its effort relative to the effort the rate was measured at, times the hours of its window it is likely to
// be active. A range of ± `spread` around the expectation, since members differ (measured: 81k to 132k an hour for the
// same model and effort).

import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT } from "./plan.mjs";

export const rates = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "assets", "token-rates.json"), "utf8"));

/** The family a model alias or id belongs to; the lead's "inherit" counts as Opus (the strongest, the safe ceiling). */
export const familyOf = (model) => {
  const m = String(model ?? "").toLowerCase();
  return m.includes("haiku") ? "haiku" : m.includes("sonnet") ? "sonnet" : "opus";
};

export function memberEstimate(fleet, agent) {
  const family = familyOf(agent.model);
  const squad = rates.perActiveHour[family][agent.squad] !== undefined ? agent.squad : "build";
  const base = rates.perActiveHour[family][squad];
  const effort = (rates.effortFactor[agent.effort] ?? 1) / (rates.effortFactor[rates.measuredEffort[family]] ?? 1);
  const from = Date.parse(agent.window?.from ?? fleet.mission.startAt);
  const to = Date.parse(agent.window?.to ?? fleet.mission.endAt);
  const hours = Math.max(0, (to - from) / 3_600_000);
  const active = hours * (rates.activeShare[squad] ?? 0.8);
  const expected = Math.round(base * effort * active);
  return { id: agent.id, family, squad, effort: agent.effort, hours: Math.round(hours * 100) / 100, perHour: Math.round(base * effort), expected, low: Math.round(expected * (1 - rates.spread)), high: Math.round(expected * (1 + rates.spread)) };
}

/** The fleet's members (the lead included: it coordinates the whole time) and the total, with a suggested budget. */
export function estimateFleet(fleet) {
  const members = fleet.agents.map((a) => memberEstimate(fleet, a));
  const sum = (key) => members.reduce((n, m) => n + m[key], 0);
  const total = { expected: sum("expected"), low: sum("low"), high: sum("high") };
  // A budget at the top of the range: crossing it means the fleet works harder than measured fleets do.
  const suggestedBudget = Math.ceil(total.high / 100_000) * 100_000;
  return { members, total, suggestedBudget, basis: rates.measuredOn };
}
