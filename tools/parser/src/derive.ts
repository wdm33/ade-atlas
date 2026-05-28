import type { InvariantRule, TcbColor, Cluster, CiCheck, TestEntry, RepoFile } from "./schema.ts";
import type { TraceabilityParsed } from "./traceability.ts";

type Codemap = ReturnType<typeof import("./codemap.ts").parseCodemap>;
type HeadDeltas = ReturnType<typeof import("./head-deltas.ts").parseHeadDeltas>;

function sortedUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

/** Normalize a CI script reference to a bare "ci_check_*.sh" key. */
function ciKey(ref: string): string {
  return ref.replace(/^ci\//, "").trim();
}

/** Map a code_locus path to a crate name. */
function crateOfPath(path: string): string | null {
  return /^crates\/([a-z_]+)\//.exec(path)?.[1] ?? null;
}

// ---------------------------------------------------------------------------

export function deriveClusters(
  rules: InvariantRule[],
  head: HeadDeltas,
  codemap: Codemap,
): Cluster[] {
  const byId = new Map(rules.map((r) => [r.id, r] as const));
  const ids = new Set<string>();
  const introduced = new Map<string, Set<string>>();
  const strengthened = new Map<string, Set<string>>();
  const followOns = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, k: string, v: string) => {
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(v);
  };

  for (const r of rules) {
    const intro = r.introduced_in ?? r.cluster;
    if (intro) {
      ids.add(intro);
      add(introduced, intro, r.id);
    }
    for (const c of r.strengthened_in) {
      ids.add(c);
      add(strengthened, c, r.id);
    }
    // A declared rule with an open obligation names a future cluster.
    if (r.status === "declared" && r.open_obligation) {
      const m = /PHASE4-[A-Z0-9-]+|N-[A-Z]+/.exec(r.open_obligation);
      if (m) {
        ids.add(m[0]);
        add(followOns, m[0], `${r.id}: ${r.open_obligation}`);
      }
    }
  }

  // Cluster -> commits whose subject names it.
  const commitsFor = (id: string) => {
    const tok = id.replace(/^PHASE4-/, "");
    return head.commits.filter((c) => c.summary.includes(id) || c.summary.includes(tok));
  };
  // Cluster -> CI checks: the ci_scripts of the rules it touched, plus any
  // CODEMAP CI-table row whose cluster column matches.
  const ciFor = (id: string) => {
    const tok = id.replace(/^PHASE4-/, "");
    const fromRules = [...(introduced.get(id) ?? []), ...(strengthened.get(id) ?? [])].flatMap(
      (rid) => byId.get(rid)?.ci_scripts.map(ciKey) ?? [],
    );
    const fromCodemap = codemap.ci_table
      .filter((row) => row.cluster === tok || row.cluster === id)
      .map((row) => ciKey(row.script));
    return sortedUnique([...fromRules, ...fromCodemap]);
  };

  // A cluster is still "declared" when every rule it touches is declared (nothing
  // enforced/partial has landed yet); "closed" once at least one rule is live.
  const statusFor = (id: string): Cluster["status"] => {
    const touched = [...(introduced.get(id) ?? []), ...(strengthened.get(id) ?? [])];
    if (touched.length === 0) return "declared"; // known only via a follow-on mention
    const anyLive = touched.some((rid) => {
      const s = byId.get(rid)?.status;
      return s === "enforced" || s === "partial";
    });
    return anyLive ? "closed" : "declared";
  };

  const clusters: Cluster[] = [...ids].sort((a, b) => a.localeCompare(b)).map((id) => ({
    id,
    status: statusFor(id),
    rules_introduced: sortedUnique([...(introduced.get(id) ?? [])]),
    rules_strengthened: sortedUnique([...(strengthened.get(id) ?? [])]),
    ci_checks: ciFor(id),
    commits: commitsFor(id),
    follow_ons: sortedUnique([...(followOns.get(id) ?? [])]),
  }));

  return clusters;
}

// ---------------------------------------------------------------------------

export function deriveCiChecks(
  rules: InvariantRule[],
  codemap: Codemap,
  head: HeadDeltas,
): { checks: CiCheck[]; referenced_count: number } {
  const map = new Map<string, CiCheck>();
  const get = (name: string): CiCheck => {
    if (!map.has(name)) {
      map.set(name, { name, enforces: [], clusters: [], scope: null, on_disk: null });
    }
    return map.get(name)!;
  };

  for (const r of rules) {
    for (const ref of r.ci_scripts) {
      const c = get(ciKey(ref));
      c.enforces.push(r.id);
    }
  }
  for (const row of codemap.ci_table) {
    const c = get(ciKey(row.script));
    if (!c.scope && row.enforces) c.scope = row.enforces;
    if (row.cluster) c.clusters.push(row.cluster);
  }
  for (const row of head.new_ci_checks) {
    const c = get(ciKey(row.check));
    if (!c.scope && row.detail) c.scope = row.detail;
  }

  const checks = [...map.values()].map((c) => ({
    ...c,
    enforces: sortedUnique(c.enforces),
    clusters: sortedUnique(c.clusters),
  }));
  checks.sort((a, b) => a.name.localeCompare(b.name));
  return { checks, referenced_count: checks.length };
}

// ---------------------------------------------------------------------------

export function deriveTests(rules: InvariantRule[], trace: TraceabilityParsed): TestEntry[] {
  const proves = new Map<string, Set<string>>();
  const drift = new Set<string>();

  for (const r of rules) {
    for (const t of r.tests) {
      if (!proves.has(t)) proves.set(t, new Set());
      proves.get(t)!.add(r.id);
    }
  }
  for (const tr of trace.rules) {
    for (const d of tr.tests_drift) drift.add(d);
  }

  const tests = [...proves.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({
    name,
    proves: sortedUnique([...proves.get(name)!]),
    drift: drift.has(name),
  }));
  return tests;
}

// ---------------------------------------------------------------------------

export function deriveRepoIndex(
  rules: InvariantRule[],
  codemap: Codemap,
  githubRepo: string | null,
  repoHead: string,
): RepoFile[] {
  // crate -> color (prefer the crate-level entry; null if ambiguous).
  const crateColor = new Map<string, TcbColor | null>();
  for (const m of codemap.modules) {
    if (m.kind !== "crate") continue;
    if (crateColor.has(m.name) && crateColor.get(m.name) !== m.color) {
      crateColor.set(m.name, null); // mixed (e.g. ade_network)
    } else if (!crateColor.has(m.name)) {
      crateColor.set(m.name, m.color);
    }
  }

  const refs = new Map<string, Set<string>>();
  for (const r of rules) {
    for (const p of r.code_loci) {
      if (!refs.has(p)) refs.set(p, new Set());
      refs.get(p)!.add(r.id);
    }
  }

  const files = [...refs.keys()].sort((a, b) => a.localeCompare(b)).map((path) => {
    const crate = crateOfPath(path);
    const color = crate ? crateColor.get(crate) ?? null : null;
    const github_url =
      githubRepo && repoHead && !path.endsWith("/")
        ? `https://github.com/${githubRepo}/blob/${repoHead}/${path}`
        : githubRepo && repoHead
          ? `https://github.com/${githubRepo}/tree/${repoHead}/${path}`
          : null;
    return {
      path,
      color,
      referenced_by: sortedUnique([...refs.get(path)!]),
      github_url,
      on_disk: null,
    };
  });
  return files;
}
