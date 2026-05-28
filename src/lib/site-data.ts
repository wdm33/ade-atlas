import manifestJson from "../../site-data/manifest.json";
import invariantsJson from "../../site-data/invariants.json";
import traceabilityJson from "../../site-data/traceability.json";
import codemapJson from "../../site-data/codemap.json";
import seamsJson from "../../site-data/seams.json";
import headDeltasJson from "../../site-data/head_deltas.json";
import clustersJson from "../../site-data/clusters.json";
import ciChecksJson from "../../site-data/ci_checks.json";
import testsJson from "../../site-data/tests.json";
import repoIndexJson from "../../site-data/repo_index.json";

import type {
  Manifest,
  InvariantsFile,
  TraceabilityFile,
  CodemapFile,
  SeamsFile,
  HeadDeltasFile,
  ClustersFile,
  CiChecksFile,
  TestsFile,
  RepoIndexFile,
  InvariantRule,
  TraceabilityRule,
  CodemapModule,
  CiCheck,
  TestEntry,
  RepoFile,
  TcbColor,
} from "../../tools/parser/src/schema.ts";

export const manifest = manifestJson as Manifest;
export const invariants = invariantsJson as InvariantsFile;
export const traceability = traceabilityJson as TraceabilityFile;
export const codemap = codemapJson as CodemapFile;
export const seams = seamsJson as SeamsFile;
export const headDeltas = headDeltasJson as HeadDeltasFile;
export const clusters = clustersJson as ClustersFile;
export const ciChecks = ciChecksJson as CiChecksFile;
export const tests = testsJson as TestsFile;
export const repoIndex = repoIndexJson as RepoIndexFile;

export type { InvariantRule, TraceabilityRule, CodemapModule, CiCheck, TestEntry, RepoFile, TcbColor };

// --- lookups ---------------------------------------------------------------
const ruleMap = new Map(invariants.rules.map((r) => [r.id, r] as const));
const traceMap = new Map(traceability.rules.map((r) => [r.id, r] as const));
const ciMap = new Map(ciChecks.checks.map((c) => [c.name, c] as const));
const testMap = new Map(tests.tests.map((t) => [t.name, t] as const));
const repoMap = new Map(repoIndex.files.map((f) => [f.path, f] as const));

export const ruleById = (id: string): InvariantRule | undefined => ruleMap.get(id);
export const traceById = (id: string): TraceabilityRule | undefined => traceMap.get(id);
export const ciByName = (name: string): CiCheck | undefined => ciMap.get(name);
export const testByName = (name: string): TestEntry | undefined => testMap.get(name);
export const repoByPath = (path: string): RepoFile | undefined => repoMap.get(path);

export interface MergedRule extends InvariantRule {
  trace?: TraceabilityRule;
}
export function mergedRule(id: string): MergedRule | undefined {
  const r = ruleMap.get(id);
  if (!r) return undefined;
  return { ...r, trace: traceMap.get(id) };
}

// --- modules ---------------------------------------------------------------
export const COLOR_ORDER: TcbColor[] = ["BLUE", "GREEN", "RED"];

export function modulesByColor(): Record<TcbColor, CodemapModule[]> {
  const out: Record<TcbColor, CodemapModule[]> = { BLUE: [], GREEN: [], RED: [] };
  for (const m of codemap.modules) out[m.color].push(m);
  return out;
}

export function uniqueModuleNames(): string[] {
  return [...new Set(codemap.modules.map((m) => m.name))].sort((a, b) => a.localeCompare(b));
}

/** URL/filesystem-safe slug for a module name (handles `::`, spaces, braces). */
export function moduleSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Routable modules: crates + named submodules (subtrees are shown on the parent). */
export function routableModules(): { name: string; slug: string }[] {
  const names = [
    ...new Set(codemap.modules.filter((m) => m.kind !== "subtree").map((m) => m.name)),
  ].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ name, slug: moduleSlug(name) }));
}

export function subtreesOf(parent: string): CodemapModule[] {
  return codemap.modules.filter((m) => m.kind === "subtree" && m.parent === parent);
}

export function moduleEntries(name: string): CodemapModule[] {
  return codemap.modules.filter((m) => m.name === name);
}

/** Crate -> color, with `null` where a crate spans multiple colors (ade_network). */
export function crateColor(name: string): TcbColor | null {
  const colors = new Set(codemap.modules.filter((m) => m.name === name).map((m) => m.color));
  return colors.size === 1 ? [...colors][0] : null;
}

/** Rules whose code_loci point into a crate (by path prefix). */
export function rulesForCrate(crate: string): InvariantRule[] {
  const prefix = `crates/${crate}/`;
  return invariants.rules.filter((r) => r.code_loci.some((p) => p.startsWith(prefix)));
}

// --- dependency graph ------------------------------------------------------
export interface GraphNode {
  id: string;
  color: TcbColor | null;
  depth: number;
}
export function graphData(): { nodes: GraphNode[]; edges: { from: string; to: string }[] } {
  const edges = codemap.dep_edges;
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  // Longest-path depth over the DAG (leaves = depth 0; "to" is depended-upon).
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  for (const e of edges) out.get(e.from)!.push(e.to);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const compute = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard (DAG expected)
    visiting.add(id);
    let d = 0;
    for (const t of out.get(id) ?? []) d = Math.max(d, compute(t) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) compute(id);

  const nodes: GraphNode[] = [...ids]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, color: crateColor(id), depth: depth.get(id) ?? 0 }));
  return { nodes, edges };
}

// --- base-path-aware links -------------------------------------------------
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export function withBase(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${p}`;
}
