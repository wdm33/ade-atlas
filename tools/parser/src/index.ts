import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSources } from "./sources.ts";
import { parseRegistry } from "./toml-registry.ts";
import { parseTraceability } from "./traceability.ts";
import { parseCodemap } from "./codemap.ts";
import { parseHeadDeltas } from "./head-deltas.ts";
import { parseSeams } from "./seams.ts";
import { deriveClusters, deriveCiChecks, deriveTests, deriveRepoIndex } from "./derive.ts";
import { computeDrift } from "./drift.ts";
import {
  SCHEMA_VERSION,
  PARSER_VERSION,
  InvariantsFile,
  TraceabilityFile,
  CodemapFile,
  SeamsFile,
  HeadDeltasFile,
  ClustersFile,
  CiChecksFile,
  TestsFile,
  RepoIndexFile,
  Manifest,
} from "./schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = key(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function writeJson(dir: string, name: string, data: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function main(): void {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const outDir = resolve(flag(argv, "--out") ?? join(REPO_ROOT, "site-data"));
  const repoDir = flag(argv, "--repo-dir") ?? process.env.ADE_REPO_DIR ?? null;
  const githubRepo =
    flag(argv, "--github-repo") ?? process.env.ADE_GITHUB_REPO ?? null;

  const src = resolveSources(argv, REPO_ROOT);

  // Parse.
  const rules = parseRegistry(src.registry);
  const trace = parseTraceability(src.traceability);
  const codemap = parseCodemap(src.codemap);
  const head = parseHeadDeltas(src.headDeltas);
  const seams = parseSeams(src.seams);

  const repo_head = src.meta.repo_head ?? codemap.repo_head ?? head.head ?? "";
  const generated_at =
    src.meta.generated_at ??
    /\*\*Generated:\*\*\s*([0-9-]+)/.exec(src.traceability)?.[1] ??
    head.head_date?.slice(0, 10) ??
    "unknown";
  const github_repo = githubRepo ?? src.meta.github_repo ?? null;

  // Derive.
  const clusters = deriveClusters(rules, head, codemap);
  const { checks, referenced_count } = deriveCiChecks(rules, codemap, head);
  const tests = deriveTests(rules, trace);
  const repoFiles = deriveRepoIndex(rules, codemap, github_repo, repo_head);
  const findings = computeDrift({ rules, trace, codemap, head, repoDir });
  const hardCount = findings.filter((f) => f.severity === "hard").length;
  const softCount = findings.filter((f) => f.severity === "soft").length;

  // Assemble + validate (zod throws on malformed shapes).
  const invariants = InvariantsFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    repo_head,
    count: rules.length,
    by_status: countBy(rules, (r) => r.status),
    by_tier: countBy(rules, (r) => r.tier),
    by_family: countBy(rules, (r) => r.family),
    rules,
  });

  const traceability = TraceabilityFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    repo_head,
    summary: trace.summary,
    rules: trace.rules,
  });

  const codemapFile = CodemapFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    repo_head,
    counts: {
      crates: codemap.counts.crates,
      canonical_types: codemap.counts.canonical_types,
      tests: codemap.counts.tests,
      ci_checks: codemap.counts.ci_checks,
      registry_rules: codemap.counts.registry_rules,
    },
    modules: codemap.modules,
    dep_edges: codemap.dep_edges,
    external_deps: codemap.external_deps,
    closed_surfaces: codemap.closed_surfaces,
    ci_table: codemap.ci_table,
    sections: codemap.sections,
  });

  const seamsFile = SeamsFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    repo_head,
    ...seams,
  });

  const headDeltasFile = HeadDeltasFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    ...head,
  });

  const clustersFile = ClustersFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    clusters,
  });

  const ciChecksFile = CiChecksFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    referenced_count,
    declared_total: codemap.counts.ci_checks,
    checks,
  });

  const testsFile = TestsFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    count: tests.length,
    tests,
  });

  const repoIndexFile = RepoIndexFile.parse({
    schema_version: SCHEMA_VERSION,
    generated_at,
    repo_head,
    github_repo,
    count: repoFiles.length,
    files: repoFiles,
  });

  const manifest = Manifest.parse({
    schema_version: SCHEMA_VERSION,
    parser_version: PARSER_VERSION,
    repo_head,
    docs_generated_at: generated_at,
    mode: src.mode,
    github_repo,
    source_docs: src.paths,
    counts: {
      crates: codemap.counts.crates,
      canonical_types: codemap.counts.canonical_types,
      ci_checks: codemap.counts.ci_checks,
      invariant_rules: rules.length,
    },
    drift: { hard: hardCount, soft: softCount, findings },
  });

  // Write.
  mkdirSync(outDir, { recursive: true });
  writeJson(outDir, "manifest.json", manifest);
  writeJson(outDir, "invariants.json", invariants);
  writeJson(outDir, "traceability.json", traceability);
  writeJson(outDir, "codemap.json", codemapFile);
  writeJson(outDir, "seams.json", seamsFile);
  writeJson(outDir, "head_deltas.json", headDeltasFile);
  writeJson(outDir, "clusters.json", clustersFile);
  writeJson(outDir, "ci_checks.json", ciChecksFile);
  writeJson(outDir, "tests.json", testsFile);
  writeJson(outDir, "repo_index.json", repoIndexFile);

  // Report.
  console.log(`ade-atlas parser ${PARSER_VERSION} (schema ${SCHEMA_VERSION})`);
  console.log(`  mode=${src.mode}  head=${repo_head}  generated=${generated_at}`);
  console.log(
    `  rules=${rules.length}  modules=${codemap.modules.length}  ci_checks(ref)=${referenced_count}/${codemap.counts.ci_checks ?? "?"}  tests=${tests.length}  clusters=${clusters.length}  code_paths=${repoFiles.length}`,
  );
  console.log(`  drift: ${hardCount} hard, ${softCount} soft`);
  if (findings.length > 0) {
    const shown = findings.slice(0, 12);
    for (const f of shown) console.log(`    [${f.severity}] ${f.kind}: ${f.detail}`);
    if (findings.length > shown.length) console.log(`    … and ${findings.length - shown.length} more`);
  }
  console.log(`  wrote ${outDir}`);

  if (strict && hardCount > 0) {
    console.error(`\nFAIL: ${hardCount} hard drift finding(s) under --strict.`);
    process.exit(1);
  }
}

main();
