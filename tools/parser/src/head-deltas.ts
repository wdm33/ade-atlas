import { toTree, tables, sections, unwrapInline, listItems, type ParsedTable } from "./markdown.ts";
import type { Commit, HeadDeltasFile } from "./schema.ts";

type Parsed = Omit<HeadDeltasFile, "schema_version" | "generated_at">;

function code(s: string): string {
  return (/`([^`]+)`/.exec(s)?.[1] ?? unwrapInline(s)).trim();
}

function findTable(tbls: ParsedTable[], ...needles: string[]): ParsedTable | null {
  for (const t of tbls) {
    const head = t.header.map((h) => unwrapInline(h).toLowerCase());
    if (needles.every((n) => head.some((h) => h.includes(n)))) return t;
  }
  return null;
}

function allTables(tbls: ParsedTable[], ...needles: string[]): ParsedTable[] {
  return tbls.filter((t) => {
    const head = t.header.map((h) => unwrapInline(h).toLowerCase());
    return needles.every((n) => head.some((h) => h.includes(n)));
  });
}

function dateIn(s: string): string | null {
  return /(\d{4}-\d{2}-\d{2}[ T0-9:+-]*)/.exec(s)?.[1]?.trim() ?? null;
}

export function parseHeadDeltas(source: string): Parsed {
  const tree = toTree(source);
  const tbls = tables(tree, source);

  const baseline = /Baseline:\s*`([0-9a-f]+)`/.exec(source)?.[1] ?? "";
  const head = /HEAD:\s*`([0-9a-f]+)`/.exec(source)?.[1] ?? "";
  // Capture the whole line (the subject can itself contain parens, e.g. docs(cluster)).
  const baselineLine = /Baseline:[^\n]*/.exec(source)?.[0] ?? "";
  const headLine = /HEAD:[^\n]*/.exec(source)?.[0] ?? "";

  const stat = /(\d+)\s+commits?,\s*(\d+)\s+files?\s+changed,\s*\+(\d+)\s*\/\s*-(\d+)/.exec(source);

  // Commit log.
  const commits: Commit[] = [];
  const commitTable = findTable(tbls, "hash", "summary");
  if (commitTable) {
    for (const row of commitTable.rows) {
      commits.push({
        hash: code(row[0] ?? ""),
        type: unwrapInline(row[1] ?? "").trim(),
        summary: (row[2] ?? "").trim(),
      });
    }
  }

  // New / modified modules.
  const new_modules = (findTable(tbls, "module", "color")?.rows ?? []).map((row) => ({
    module: code(row[0] ?? ""),
    detail: row
      .slice(1)
      .map((c) => c.trim())
      .filter(Boolean)
      .join(" — "),
  }));
  const modified_modules = (findTable(tbls, "module", "scope")?.rows ?? []).map((row) => ({
    module: code(row[0] ?? ""),
    detail: row
      .slice(1)
      .map((c) => c.trim())
      .filter(Boolean)
      .join(" — "),
  }));

  // New rules.
  const new_rules = (findTable(tbls, "id", "summary")?.rows ?? []).map((row) => ({
    id: code(row[0] ?? ""),
    status: unwrapInline(row[1] ?? "").trim(),
    cluster: unwrapInline(row[2] ?? "").trim(),
    summary: (row[3] ?? "").trim(),
  }));

  // CI check deltas (Check | Status | What it checks).
  const new_ci_checks = allTables(tbls, "check", "status").flatMap((t) =>
    t.rows.map((row) => ({
      check: code(row[0] ?? ""),
      status: unwrapInline(row[1] ?? "").trim(),
      detail: (row[2] ?? "").trim(),
    })),
  );

  // Strengthenings bullet list.
  const strSec = sections(tree, source, 3).find((s) => /Strengthenings recorded/i.test(s.title));
  const strengthenings = strSec ? listItems(strSec.body) : [];

  // Residual.
  const residualSec = sections(tree, source, 3).find((s) => /Honest residual/i.test(s.title));
  const residual = residualSec ? residualSec.body.trim() : "";

  const rules_at_baseline = Number(/Rules at baseline[^*]*\*\*(\d+)\*\*/.exec(source)?.[1] ?? "") || null;
  const rules_at_head = Number(/Rules at HEAD[^*]*\*\*(\d+)\*\*/.exec(source)?.[1] ?? "") || null;

  const topSections = sections(tree, source, 2).map((s) => ({ title: s.title, body: s.body }));

  return {
    baseline,
    head,
    baseline_date: dateIn(baselineLine),
    head_date: dateIn(headLine),
    commit_count: stat ? Number(stat[1]) : null,
    files_changed: stat ? Number(stat[2]) : null,
    lines_added: stat ? Number(stat[3]) : null,
    lines_removed: stat ? Number(stat[4]) : null,
    commits,
    new_modules,
    modified_modules,
    new_rules,
    strengthenings,
    new_ci_checks,
    rules_at_baseline,
    rules_at_head,
    residual,
    sections: topSections,
  };
}
