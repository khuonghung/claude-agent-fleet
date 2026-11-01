// The git collector: commits of each agent's branch over the base, and which reached integration.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(dir, ...args) {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], { timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function readGit(cfg, roster) {
  const { dir, base, integration, baseline } = cfg.repo;
  const own = cfg.agents.map((agent) => ({ agent: agent.id, branch: roster[agent.id]?.branch })).filter(({ branch }) => branch && branch !== base && branch.includes("/"));
  // All git reads at once: a dozen members cost one round trip, not a dozen.
  const [reached, baseHead, ...logs] = await Promise.all([
    git(dir, "rev-list", `${base}..${integration}`),
    git(dir, "rev-parse", "--short=8", base),
    ...own.map(({ branch }) => git(dir, "log", "-n", "60", "--format=%H%x1f%h%x1f%cI%x1f%s%x1f%P", `${base}..${branch}`)),
  ]);
  const integrated = new Set(reached.split("\n").filter(Boolean));
  const branches = own.map(({ agent, branch }, i) => ({
    agent,
    branch,
    commits: logs[i]
      ? logs[i].split("\n").map((line) => {
          const [hash, sha, at, subject, parents] = line.split("\x1f");
          return { sha, at, subject, merge: (parents ?? "").split(" ").length > 1, integrated: branch === integration || integrated.has(hash) };
        })
      : [],
  }));
  return { base, baseHead, baselineHead: baseline, baseUntouched: !baseline || baseHead.startsWith(baseline) || baseline.startsWith(baseHead), integration, branches };
}
