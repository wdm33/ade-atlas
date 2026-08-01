import { parse as parseToml } from "smol-toml";
import { familyOf, type InvariantRule } from "./schema.ts";

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  if (typeof v === "string" && v.trim().length > 0) {
    // A comma-joined scalar (e.g. ci_script = "ci/a.sh, ci/b.sh").
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v;
  return null;
}

/**
 * Normalize CI-script references. Registry entries sometimes pack several
 * scripts into one string separated by ',', ';', or whitespace
 * (e.g. "ci/a.sh; ci/b.sh"); split them into individual path tokens so that
 * per-script existence checks and references resolve one script at a time
 * instead of stat-ing the whole joined string as a single (missing) path. The
 * path-safe filter drops any non-path noise a future descriptor might add.
 */
function splitScripts(xs: string[]): string[] {
  return xs
    .flatMap((s) => s.split(/[;,\s]+/))
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_./-]+$/.test(s));
}

/** Extract path-like code loci from a free-text code_locus field. */
export function extractCodeLoci(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // crate source paths (files or directories) and ci scripts referenced inline.
  const re = /(?:crates|ci|docs)\/[A-Za-z0-9_./-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    let tok = m[0];
    // Trim trailing punctuation that the char class may have swallowed via '.'/'-'.
    tok = tok.replace(/[.;,]+$/, "");
    if (!seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

export function parseRegistry(toml: string): InvariantRule[] {
  const doc = parseToml(toml) as { rules?: unknown[] };
  const raw = Array.isArray(doc.rules) ? doc.rules : [];
  const rules: InvariantRule[] = raw.map((entryUnknown) => {
    const e = entryUnknown as Record<string, unknown>;
    const id = String(e.id ?? "");
    if (!id) throw new Error("Registry rule missing id");

    const codeLocusRaw = typeof e.code_locus === "string" ? e.code_locus : "";
    // ci_script (scalar) and ci_scripts (array) both occur, and either can pack
    // multiple scripts into one string — split into individual paths.
    const ciScripts = splitScripts([...asArray(e.ci_script), ...asArray(e.ci_scripts)]);

    return {
      id,
      family: familyOf(id),
      tier: String(e.tier ?? "") as InvariantRule["tier"],
      status: String(e.status ?? "declared") as InvariantRule["status"],
      statement: String(e.statement ?? ""),
      source: String(e.source ?? ""),
      cross_ref: asArray(e.cross_ref),
      code_locus_raw: codeLocusRaw,
      code_loci: extractCodeLoci(codeLocusRaw),
      tests: asArray(e.tests),
      ci_scripts: dedupe(ciScripts),
      strengthened_in: asArray(e.strengthened_in),
      strengthens: asArray(e.strengthens),
      introduced_in: asStringOrNull(e.introduced_in),
      cluster: asStringOrNull(e.cluster),
      authority_surface: asStringOrNull(e.authority_surface),
      attack_rationale: asStringOrNull(e.attack_rationale),
      evidence_notes: asStringOrNull(e.evidence_notes),
      evidence: asArray(e.evidence),
      open_obligation: asStringOrNull(e.open_obligation),
      notes: asStringOrNull(e.notes),
    };
  });

  // Stable ordering by id (deterministic output regardless of file order).
  rules.sort((a, b) => a.id.localeCompare(b.id));
  return rules;
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
