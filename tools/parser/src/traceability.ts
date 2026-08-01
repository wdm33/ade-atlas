import { toTree, sections, tables, unwrapInline } from "./markdown.ts";
import type { TraceabilityRule } from "./schema.ts";

// A real rule id ends in a numeric segment (T-DET-01, CN-KES-HEADER-02). The
// nested-format family-group headings (### T-BOUND, ### CN-ADMIT) carry the ID
// stem WITHOUT a numeric suffix, so this regex is what separates rules from the
// group headers they sit under.
const RULE_ID_RE = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[a-z]*)\b/;

// Status lives in the heading in the nested format: "#### `T-X-01` — _enforced_"
// (also _partial_ / _declared_ / _enforced_scaffolding_). Read it off the raw
// heading, not nodeText — the double emphasis in `_enforced_scaffolding_` does
// not survive markdown-to-text flattening.
const HEADING_STATUS_RE = /—\s*_([a-z_]+?)_\s*$/;

// Two "test not present at HEAD" notations across doc generations:
//   old flat: `name` **[not found on disk — drift]**
//   nested:   `name` †           (dagger, enumerated under Cross-reference checks)
const BRACKET_DRIFT_RE = /`([^`]+)`\s*\*\*\[not (?:found )?on disk\s*[—-]\s*drift\]\*\*/g;
const DAGGER_DRIFT_RE = /`([^`]+)`\s*†/g;

// A load-bearing cell with no enforcement evidence. Covers both generations'
// phrasings; a bare em-dash / empty cell also counts.
const NO_EVIDENCE_RE =
  /not yet enforced|no enforcing code|no tests? (?:named|listed)|no ci script|—\s*gap|gap\)/i;

function isGap(cell: string): boolean {
  const s = unwrapInline(cell).trim();
  if (s === "" || s === "—" || s === "-") return true;
  return NO_EVIDENCE_RE.test(cell);
}

function extractDrift(cell: string): string[] {
  const out: string[] = [];
  for (const re of [BRACKET_DRIFT_RE, DAGGER_DRIFT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cell)) !== null) out.push(m[1]);
  }
  return out;
}

/** From a 2-column "Aspect | Location" table, map bold aspect -> raw value cell. */
function aspectMap(body: string): Record<string, string> {
  const tree = toTree(body);
  const tbls = tables(tree, body);
  const map: Record<string, string> = {};
  for (const t of tbls) {
    for (const row of t.rows) {
      if (row.length < 2) continue;
      const key = row[0].replace(/\*\*/g, "").trim().toLowerCase();
      map[key] = row[1].trim();
    }
  }
  return map;
}

function parseMetaLine(body: string): {
  tier: string | null;
  status: string | null;
  strengthened: string[];
} {
  // Old flat format only: "_tier: true · status: enforced · strengthened: A, B_"
  const line = body.split("\n").find((l) => /_tier:/.test(l)) ?? "";
  const clean = line.replace(/^_+|_+$/g, "");
  const tier = /tier:\s*([a-z]+)/.exec(clean)?.[1] ?? null;
  const status = /status:\s*([a-z]+)/.exec(clean)?.[1] ?? null;
  const strRaw = /strengthened:\s*(.+)$/.exec(clean)?.[1] ?? "";
  const strengthened = strRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { tier, status, strengthened };
}

export interface TraceabilityParsed {
  rules: TraceabilityRule[];
  summary: {
    total: number;
    enforced: number;
    partial: number;
    declared: number;
    deprecated: number;
    by_tier: Record<string, number>;
    by_family: Record<string, number>;
  };
}

function parseSummary(source: string): TraceabilityParsed["summary"] {
  // Status counts appear as table rows in both generations, backticked in the
  // flat doc ("| `enforced` | 159 |") and plain in the nested doc
  // ("| enforced | 297 |"). \b guards against matching enforced_scaffolding.
  const statusCount = (name: string): number =>
    Number(new RegExp("`?\\b" + name + "\\b`?\\s*\\|\\s*(\\d+)").exec(source)?.[1] ?? 0);

  const total = Number(
    /Total rules\s*\|\s*\*\*(\d+)\*\*/.exec(source)?.[1] ?? // flat
      /\*\*Total\*\*\s*\|\s*\*\*?(\d+)/.exec(source)?.[1] ?? // nested inventory table
      0,
  );

  // Tiers exist only in the flat doc's "By tier:" line; the nested doc carries
  // no tier data (the site sources tier from the registry instead).
  const byTier: Record<string, number> = {};
  const tierLine = /By tier:\s*([^\n]+)/.exec(source)?.[1] ?? "";
  for (const m of tierLine.matchAll(/(true|derived|release|operational)\s*(\d+)/g)) {
    byTier[m[1]] = Number(m[2]);
  }

  // Families: flat doc has a "By family: T 12 DC 134 …" line; nested doc has a
  // per-family table whose first numeric column is the rule count.
  const byFamily: Record<string, number> = {};
  const famLine = /By family:\s*([^\n]+)/.exec(source)?.[1];
  if (famLine) {
    for (const m of famLine.matchAll(/\b(T|DC|CN|RO|OP)\s+(\d+)/g)) byFamily[m[1]] = Number(m[2]);
  } else {
    for (const m of source.matchAll(/^\|\s*(T|CN|DC|OP|RO)\s*\|\s*(\d+)\s*\|/gm)) {
      byFamily[m[1]] = Number(m[2]);
    }
  }

  return {
    total,
    enforced: statusCount("enforced"),
    partial: statusCount("partial"),
    declared: statusCount("declared"),
    deprecated:
      statusCount("deprecated") || Number(/deprecated`?\s*\|\s*\*\*?(\d+)/.exec(source)?.[1] ?? 0),
    by_tier: byTier,
    by_family: byFamily,
  };
}

export function parseTraceability(source: string): TraceabilityParsed {
  const tree = toTree(source);

  // Nested format (current): rules are level-4 headings under level-3 family
  // groups. Flat format (legacy fixtures): rules are the level-3 headings.
  // Detect by whether any level-4 heading parses as a real rule id.
  const level4 = sections(tree, source, 4).filter((s) => RULE_ID_RE.test(s.title));
  const nested = level4.length > 0;
  const ruleSections = nested ? level4 : sections(tree, source, 3);

  const rules: TraceabilityRule[] = [];
  for (const sec of ruleSections) {
    const m = RULE_ID_RE.exec(sec.title);
    if (!m) continue; // not a rule section (prose subsection, family group, …)
    const id = m[1];
    const a = aspectMap(sec.body);

    let tier: string | null;
    let status: string | null;
    let strengthened: string[];
    let statement: string;
    if (nested) {
      // Status is in the heading; the Requirement cell is the rule statement;
      // tier is not carried by this doc (registry is the tier source).
      status = HEADING_STATUS_RE.exec(sec.rawHeading)?.[1] ?? null;
      tier = null;
      strengthened = [];
      statement = unwrapInline(a["requirement"] ?? "");
    } else {
      const meta = parseMetaLine(sec.body);
      tier = meta.tier;
      status = meta.status;
      strengthened = meta.strengthened;
      statement = sec.title.replace(RULE_ID_RE, "").replace(/^:\s*/, "").trim();
    }

    const codeCell = a["code"] ?? "";
    const testsCell = a["tests"] ?? "";
    const ciCell = a["ci"] ?? "";

    rules.push({
      id,
      statement,
      tier,
      status,
      strengthened,
      source: a["source"] ?? "",
      requirement: a["requirement"] ?? "",
      code: codeCell,
      code_gap: isGap(codeCell),
      tests_text: testsCell,
      tests_gap: isGap(testsCell),
      tests_drift: extractDrift(testsCell),
      ci_text: ciCell,
      ci_gap: isGap(ciCell),
      ci_drift: extractDrift(ciCell),
    });
  }

  rules.sort((x, y) => x.id.localeCompare(y.id));
  return { rules, summary: parseSummary(source) };
}
