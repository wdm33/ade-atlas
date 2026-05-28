import { z } from "zod";

// Bump when the JSON shape changes in a way the site must be aware of.
export const SCHEMA_VERSION = "0.1.0";
export const PARSER_VERSION = "0.1.0";

export const TCB_COLORS = ["BLUE", "GREEN", "RED"] as const;
export const RULE_STATUSES = ["enforced", "partial", "declared", "deprecated"] as const;
export const RULE_TIERS = ["true", "derived", "release", "operational"] as const;
export const RULE_FAMILIES = ["T", "DC", "CN", "RO", "OP"] as const;

const Color = z.enum(TCB_COLORS);

// ----------------------------------------------------------------------------
// invariants.json — driven by the TOML registry (the structured source of truth)
// ----------------------------------------------------------------------------
export const InvariantRule = z.object({
  id: z.string(),
  family: z.enum(RULE_FAMILIES),
  tier: z.enum(RULE_TIERS),
  status: z.enum(RULE_STATUSES),
  statement: z.string(),
  source: z.string(),
  cross_ref: z.array(z.string()),
  code_locus_raw: z.string(),
  code_loci: z.array(z.string()), // path-like tokens extracted from code_locus_raw
  tests: z.array(z.string()),
  ci_scripts: z.array(z.string()),
  strengthened_in: z.array(z.string()),
  strengthens: z.array(z.string()),
  introduced_in: z.string().nullable(),
  cluster: z.string().nullable(),
  authority_surface: z.string().nullable(),
  attack_rationale: z.string().nullable(),
  evidence_notes: z.string().nullable(),
  evidence: z.array(z.string()),
  open_obligation: z.string().nullable(),
  notes: z.string().nullable(),
});
export type InvariantRule = z.infer<typeof InvariantRule>;

export const CountMap = z.record(z.string(), z.number());

export const InvariantsFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  repo_head: z.string(),
  count: z.number(),
  by_status: CountMap,
  by_tier: CountMap,
  by_family: CountMap,
  rules: z.array(InvariantRule),
});
export type InvariantsFile = z.infer<typeof InvariantsFile>;

// ----------------------------------------------------------------------------
// traceability.json — the invariant<->enforcement audit (Markdown join + drift)
// ----------------------------------------------------------------------------
export const TraceabilityRule = z.object({
  id: z.string(),
  statement: z.string(),
  tier: z.string().nullable(),
  status: z.string().nullable(),
  strengthened: z.array(z.string()),
  source: z.string(),
  requirement: z.string(),
  code: z.string(),
  code_gap: z.boolean(),
  tests_text: z.string(),
  tests_gap: z.boolean(),
  tests_drift: z.array(z.string()), // registry-named tests not found on disk
  ci_text: z.string(),
  ci_gap: z.boolean(),
  ci_drift: z.array(z.string()),
});
export type TraceabilityRule = z.infer<typeof TraceabilityRule>;

export const TraceabilityFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  repo_head: z.string(),
  summary: z.object({
    total: z.number(),
    enforced: z.number(),
    partial: z.number(),
    declared: z.number(),
    deprecated: z.number(),
    by_tier: CountMap,
    by_family: CountMap,
  }),
  rules: z.array(TraceabilityRule),
});
export type TraceabilityFile = z.infer<typeof TraceabilityFile>;

// ----------------------------------------------------------------------------
// codemap.json
// ----------------------------------------------------------------------------
export const CodemapModule = z.object({
  name: z.string(),
  color: Color,
  kind: z.enum(["crate", "submodule", "subtree"]),
  parent: z.string().nullable(),
  note: z.string().nullable(),
  attributes: z.record(z.string(), z.string()), // Purpose, Creates, Interprets, MUST NOT, ...
});
export type CodemapModule = z.infer<typeof CodemapModule>;

export const DepEdge = z.object({ from: z.string(), to: z.string() });

export const CodemapFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  repo_head: z.string(),
  counts: z.object({
    crates: z.number().nullable(),
    canonical_types: z.number().nullable(),
    tests: z.number().nullable(),
    ci_checks: z.number().nullable(),
    registry_rules: z.number().nullable(),
  }),
  modules: z.array(CodemapModule),
  dep_edges: z.array(DepEdge),
  external_deps: z.record(z.string(), z.array(z.string())),
  closed_surfaces: z.array(z.object({ name: z.string(), location: z.string() })),
  ci_table: z.array(z.object({ script: z.string(), enforces: z.string(), cluster: z.string() })),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
});
export type CodemapFile = z.infer<typeof CodemapFile>;

// ----------------------------------------------------------------------------
// seams.json
// ----------------------------------------------------------------------------
export const SeamPipeline = z.object({
  surface: z.string(),
  body: z.string(), // raw fenced-block text (steps + reduces-to + cross-surface notes)
});

export const RegistryRow = z.object({
  registry: z.string(),
  location: z.string(),
  detail: z.string(),
});

export const SeamsFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  repo_head: z.string(),
  pipelines: z.array(SeamPipeline),
  closed_registries: z.array(RegistryRow),
  extensible_registries: z.array(RegistryRow),
  frozen_contracts: z.array(z.string()),
  version_gated: z.array(z.string()),
  candidate_seams: z.array(z.object({ title: z.string(), body: z.string() })),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
});
export type SeamsFile = z.infer<typeof SeamsFile>;

// ----------------------------------------------------------------------------
// head_deltas.json
// ----------------------------------------------------------------------------
export const Commit = z.object({ hash: z.string(), type: z.string(), summary: z.string() });
export const ModuleDelta = z.object({ module: z.string(), detail: z.string() });
export const RuleDelta = z.object({
  id: z.string(),
  status: z.string(),
  cluster: z.string(),
  summary: z.string(),
});

export const HeadDeltasFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  baseline: z.string(),
  head: z.string(),
  baseline_date: z.string().nullable(),
  head_date: z.string().nullable(),
  commit_count: z.number().nullable(),
  files_changed: z.number().nullable(),
  lines_added: z.number().nullable(),
  lines_removed: z.number().nullable(),
  commits: z.array(Commit),
  new_modules: z.array(ModuleDelta),
  modified_modules: z.array(ModuleDelta),
  new_rules: z.array(RuleDelta),
  strengthenings: z.array(z.string()),
  new_ci_checks: z.array(z.object({ check: z.string(), status: z.string(), detail: z.string() })),
  rules_at_baseline: z.number().nullable(),
  rules_at_head: z.number().nullable(),
  residual: z.string(),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
});
export type HeadDeltasFile = z.infer<typeof HeadDeltasFile>;

// ----------------------------------------------------------------------------
// Derived artifacts
// ----------------------------------------------------------------------------
export const Cluster = z.object({
  id: z.string(),
  status: z.enum(["active", "closed", "declared", "unknown"]),
  rules_introduced: z.array(z.string()),
  rules_strengthened: z.array(z.string()),
  ci_checks: z.array(z.string()),
  commits: z.array(Commit),
  follow_ons: z.array(z.string()),
});
export type Cluster = z.infer<typeof Cluster>;

export const ClustersFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  clusters: z.array(Cluster),
});

export const CiCheck = z.object({
  name: z.string(),
  enforces: z.array(z.string()), // rule ids
  clusters: z.array(z.string()),
  scope: z.string().nullable(),
  on_disk: z.boolean().nullable(), // null in mock mode (no repo tree)
});
export type CiCheck = z.infer<typeof CiCheck>;

export const CiChecksFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  referenced_count: z.number(),
  declared_total: z.number().nullable(), // 97 from CODEMAP header
  checks: z.array(CiCheck),
});

export const TestEntry = z.object({
  name: z.string(),
  proves: z.array(z.string()), // rule ids
  drift: z.boolean(),
});
export type TestEntry = z.infer<typeof TestEntry>;

export const TestsFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  count: z.number(),
  tests: z.array(TestEntry),
});

export const RepoFile = z.object({
  path: z.string(),
  color: Color.nullable(),
  referenced_by: z.array(z.string()), // rule ids
  github_url: z.string().nullable(),
  on_disk: z.boolean().nullable(),
});
export type RepoFile = z.infer<typeof RepoFile>;

export const RepoIndexFile = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  repo_head: z.string(),
  github_repo: z.string().nullable(),
  count: z.number(),
  files: z.array(RepoFile),
});

export const DriftFinding = z.object({
  severity: z.enum(["hard", "soft"]),
  kind: z.string(),
  detail: z.string(),
});
export type DriftFinding = z.infer<typeof DriftFinding>;

export const Manifest = z.object({
  schema_version: z.string(),
  parser_version: z.string(),
  repo_head: z.string(),
  docs_generated_at: z.string(),
  mode: z.enum(["mock", "repo"]),
  github_repo: z.string().nullable(),
  source_docs: z.record(z.string(), z.string()),
  counts: z.object({
    crates: z.number().nullable(),
    canonical_types: z.number().nullable(),
    ci_checks: z.number().nullable(),
    invariant_rules: z.number(),
  }),
  drift: z.object({
    hard: z.number(),
    soft: z.number(),
    findings: z.array(DriftFinding),
  }),
});
export type Manifest = z.infer<typeof Manifest>;

export function familyOf(id: string): z.infer<typeof InvariantRule>["family"] {
  const prefix = id.split("-")[0];
  if ((RULE_FAMILIES as readonly string[]).includes(prefix)) {
    return prefix as InvariantRule["family"];
  }
  // Defensive: registry IDs are constrained to the five families.
  throw new Error(`Unknown rule family for id "${id}"`);
}
