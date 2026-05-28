import { toTree, sections, tables, nodeText } from "./markdown.ts";
import type { TraceabilityRule } from "./schema.ts";

// Heading text is backtick-stripped by nodeText: "T-DET-01: statement..."
const RULE_ID_RE = /^([A-Z]+-[A-Z0-9-]+)\b/;
const DRIFT_RE = /`([^`]+)`\s*\*\*\[not (?:found )?on disk\s*[—-]\s*drift\]\*\*/g;

function gap(cell: string, needle: string): boolean {
  return cell.includes(needle);
}

function extractDrift(cell: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  DRIFT_RE.lastIndex = 0;
  while ((m = DRIFT_RE.exec(cell)) !== null) out.push(m[1]);
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
  // e.g. "_tier: true · status: enforced · strengthened: PHASE4-N-B, PHASE4-B1_"
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
  const num = (re: RegExp): number => {
    const m = re.exec(source);
    return m ? Number(m[1]) : 0;
  };
  const totalRow = /Total rules\s*\|\s*\*\*(\d+)\*\*/.exec(source);
  // The status counts appear as table rows: "| `enforced` | 159 |"
  const statusCount = (name: string): number =>
    Number(new RegExp("`" + name + "`\\s*\\|\\s*(\\d+)").exec(source)?.[1] ?? 0);

  const byTier: Record<string, number> = {};
  const tierLine = /By tier:\s*([^\n]+)/.exec(source)?.[1] ?? "";
  for (const m of tierLine.matchAll(/(true|derived|release|operational)\s*(\d+)/g)) {
    byTier[m[1]] = Number(m[2]);
  }
  const byFamily: Record<string, number> = {};
  const famLine = /By family:\s*([^\n]+)/.exec(source)?.[1] ?? "";
  for (const m of famLine.matchAll(/\b(T|DC|CN|RO|OP)\s+(\d+)/g)) {
    byFamily[m[1]] = Number(m[2]);
  }

  return {
    total: totalRow ? Number(totalRow[1]) : 0,
    enforced: statusCount("enforced"),
    partial: statusCount("partial"),
    declared: statusCount("declared"),
    deprecated: statusCount("deprecated") || num(/deprecated`?\s*\|\s*\*\*?(\d+)/),
    by_tier: byTier,
    by_family: byFamily,
  };
}

export function parseTraceability(source: string): TraceabilityParsed {
  const tree = toTree(source);
  const ruleSections = sections(tree, source, 3);
  const rules: TraceabilityRule[] = [];

  for (const sec of ruleSections) {
    const m = RULE_ID_RE.exec(sec.title);
    if (!m) continue; // not a rule section (e.g. a prose subsection)
    const id = m[1];
    const statement = sec.title.replace(RULE_ID_RE, "").replace(/^:\s*/, "").trim();
    const meta = parseMetaLine(sec.body);
    const a = aspectMap(sec.body);

    const codeCell = a["code"] ?? "";
    const testsCell = a["tests"] ?? "";
    const ciCell = a["ci"] ?? "";

    rules.push({
      id,
      statement,
      tier: meta.tier,
      status: meta.status,
      strengthened: meta.strengthened,
      source: a["source"] ?? "",
      requirement: a["requirement"] ?? "",
      code: codeCell,
      code_gap: gap(codeCell, "no enforcing code") || gap(codeCell, "— gap"),
      tests_text: testsCell,
      tests_gap: gap(testsCell, "no tests named") || gap(testsCell, "— gap"),
      tests_drift: extractDrift(testsCell),
      ci_text: ciCell,
      ci_gap: gap(ciCell, "no CI script") || gap(ciCell, "— gap"),
      ci_drift: extractDrift(ciCell),
    });
  }

  rules.sort((x, y) => x.id.localeCompare(y.id));
  return { rules, summary: parseSummary(source) };
}
