// The git collector: commits of each agent's branch over the base, and which reached integration.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The package a file belongs to: `apps/api/src/x.ts` → `apps/api`; a file at the root → "(root)". */
const PACKAGE_ROOTS = new Set(["apps", "packages", "libs", "services", "modules", "crates", "plugins"]);
export function packageOf(file) {
  const parts = file.split("/");
  if (parts.length === 1) return "(root)";
  return PACKAGE_ROOTS.has(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

async function git(dir, ...args) {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], { timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * The branch the builders' work is merged into: the plan's `repo.integration`, else the branch the release manager
 * recorded in the roster (their worktree branch is the integration branch). None when neither is known yet.
 */
export function integrationOf(cfg, roster) {
  if (cfg.repo.integration) return cfg.repo.integration;
  const manager = cfg.agents.find((agent) => agent.role === "release-manager");
  return (manager && roster[manager.id]?.branch) || undefined;
}

export async function readGit(cfg, roster) {
  const { dir, base, baseline } = cfg.repo;
  const integration = integrationOf(cfg, roster);
  const own = cfg.agents.map((agent) => ({ agent: agent.id, branch: roster[agent.id]?.branch })).filter(({ branch }) => branch && branch !== base && branch.includes("/"));
  // A named integration branch (often without a slash, made by the lead) is read too, as the integrator's.
  if (integration && !own.some(({ branch }) => branch === integration)) {
    const integrator = cfg.agents.find((agent) => agent.role === "release-manager") ?? cfg.agents.find((agent) => agent.launch === "self");
    own.push({ agent: integrator?.id ?? "lead", branch: integration });
  }
  // All git reads at once: a dozen members cost one round trip, not a dozen.
  const [reached, baseHead, ...reads] = await Promise.all([
    integration ? git(dir, "rev-list", `${base}..${integration}`) : "",
    git(dir, "rev-parse", "--short=8", base),
    ...own.flatMap(({ branch }) => [
      git(dir, "log", "-n", "60", "--format=%H%x1f%h%x1f%cI%x1f%s%x1f%P", `${base}..${branch}`),
      // What the branch changes over the base, as a merge would bring it: lines, and files by package.
      git(dir, "diff", "--numstat", `${base}...${branch}`),
    ]),
  ]);
  const integrated = new Set(reached.split("\n").filter(Boolean));
  const branches = own.map(({ agent, branch }, i) => {
    const log = reads[i * 2];
    const numstat = reads[i * 2 + 1];
    const stat = { files: 0, insertions: 0, deletions: 0 };
    const packages = {};
    for (const line of numstat ? numstat.split("\n") : []) {
      const [add, del, file] = line.split("\t");
      if (!file) continue;
      stat.files += 1;
      stat.insertions += Number(add) || 0;
      stat.deletions += Number(del) || 0;
      const name = packageOf(file.includes(" => ") ? file.replace(/\{([^}]*) => ([^}]*)\}/, "$2").split(" => ").at(-1) : file);
      packages[name] = (packages[name] ?? 0) + 1;
    }
    return {
      agent,
      branch,
      stat,
      packages,
      commits: log
        ? log.split("\n").map((line) => {
            const [hash, sha, at, subject, parents] = line.split("\x1f");
            return { sha, at, subject, merge: (parents ?? "").split(" ").length > 1, integrated: branch === integration || integrated.has(hash) };
          })
        : [],
    };
  });
  return { base, baseHead, baselineHead: baseline, baseUntouched: !baseline || baseHead.startsWith(baseline) || baseline.startsWith(baseHead), integration: integration ?? null, branches };
}
