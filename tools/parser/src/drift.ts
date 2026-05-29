import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { InvariantRule, DriftFinding } from "./schema.ts";
import type { TraceabilityParsed } from "./traceability.ts";

type Codemap = ReturnType<typeof import("./codemap.ts").parseCodemap>;
type HeadDeltas = ReturnType<typeof import("./head-deltas.ts").parseHeadDeltas>;

interface DriftInputs {
  rules: InvariantRule[];
  trace: TraceabilityParsed;
  codemap: Codemap;
  head: HeadDeltas;
  repoDir: string | null; // when set, run repo-tree checks
}

export function computeDrift(inp: DriftInputs): DriftFinding[] {
  const { rules, trace, codemap, head, repoDir } = inp;
  const findings: DriftFinding[] = [];
  const hard = (kind: string, detail: string) => findings.push({ severity: "hard", kind, detail });
  const soft = (kind: string, detail: string) => findings.push({ severity: "soft", kind, detail });

  // --- Doc-internal (always) ---------------------------------------------
  if (codemap.counts.registry_rules != null && codemap.counts.registry_rules !== rules.length) {
    hard(
      "count-mismatch",
      `CODEMAP claims ${codemap.counts.registry_rules} registry rules but the registry has ${rules.length}.`,
    );
  }

  const regIds = new Set(rules.map((r) => r.id));
  const traceIds = new Set(trace.rules.map((r) => r.id));
  // Doc-coverage gaps: the append-only registry routinely runs ahead of the last
  // TRACEABILITY regeneration. This is a gap to SURFACE, not fatal corruption — the
  // dashboard's job is to show it, so it stays soft (does not block deploy).
  for (const r of rules) {
    if (!traceIds.has(r.id)) soft("rule-missing-from-traceability", `${r.id} is in the registry but absent from TRACEABILITY.`);
  }
  for (const tr of trace.rules) {
    if (!regIds.has(tr.id)) soft("rule-missing-from-registry", `${tr.id} is in TRACEABILITY but absent from the registry.`);
  }

  for (const r of rules) {
    for (const x of r.cross_ref) {
      if (!regIds.has(x)) soft("unresolved-cross-ref", `${r.id} references unknown rule ${x}.`);
    }
  }

  for (const tr of trace.rules) {
    for (const t of tr.tests_drift) soft("test-not-on-disk", `${tr.id}: registry-named test "${t}" not located on disk (per TRACEABILITY).`);
    for (const c of tr.ci_drift) soft("ci-not-on-disk", `${tr.id}: registry-named CI "${c}" not located on disk (per TRACEABILITY).`);
  }

  if (codemap.repo_head && head.head && codemap.repo_head !== head.head) {
    soft("doc-head-skew", `CODEMAP HEAD ${codemap.repo_head} != HEAD_DELTAS HEAD ${head.head}.`);
  }

  // --- Repo-tree (only when a checkout is available) ---------------------
  if (repoDir) {
    let gitHead: string | null = null;
    try {
      gitHead = execSync("git rev-parse --short HEAD", { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      /* not a git checkout */
    }
    if (gitHead && codemap.repo_head && gitHead !== codemap.repo_head) {
      // Benign doc-regen lag: the docs were last regenerated at one commit and the
      // repo has since advanced. Surface it; don't block the projection from shipping.
      soft("repo-head-skew", `Docs were generated at HEAD ${codemap.repo_head} but the repo is at ${gitHead}.`);
    }

    for (const r of rules) {
      // code_locus / ci_script are free-text navigation hints that lag refactors
      // (e.g. recovery.rs -> recovery/mod.rs) even while the rule stays enforced
      // via its tests + CI. Surface a stale reference; never block the deploy on
      // one — the authoritative evidence is the tests/CI, not the path string.
      for (const p of r.code_loci) {
        if (p.startsWith("crates/") && !existsSync(join(repoDir, p))) {
          soft("code-locus-missing", `${r.id} (${r.status}): cited code path ${p} no longer exists (likely moved/renamed).`);
        }
      }
      for (const ref of r.ci_scripts) {
        const rel = ref.startsWith("ci/") ? ref : `ci/${ref}`;
        if (!existsSync(join(repoDir, rel))) {
          soft("ci-script-missing", `${r.id} (${r.status}): cited CI script ${rel} no longer exists (likely moved/renamed).`);
        }
      }
    }

    // Workspace members vs CODEMAP crates.
    const cargoPath = join(repoDir, "Cargo.toml");
    if (existsSync(cargoPath)) {
      const cargo = readFileSync(cargoPath, "utf8");
      const membersBlock = /members\s*=\s*\[([^\]]*)\]/s.exec(cargo)?.[1] ?? "";
      const members = [...membersBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^crates\//, ""));
      const codemapCrates = new Set(codemap.modules.filter((m) => m.kind === "crate").map((m) => m.name));
      for (const mem of members) {
        if (!codemapCrates.has(mem)) hard("crate-not-in-codemap", `Workspace member ${mem} is absent from CODEMAP.`);
      }
      for (const c of codemapCrates) {
        if (!members.includes(c)) soft("codemap-crate-not-in-workspace", `CODEMAP crate ${c} is not a workspace member.`);
      }
    }
  }

  return findings;
}
