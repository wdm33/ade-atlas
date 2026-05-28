import { toTree, sections, tables, firstCodeBlock, listItems, unwrapInline } from "./markdown.ts";
import type { SeamsFile } from "./schema.ts";

type Parsed = Omit<SeamsFile, "schema_version" | "generated_at" | "repo_head">;

function code(s: string): string {
  return (/`([^`]+)`/.exec(s)?.[1] ?? unwrapInline(s)).trim();
}

function sectionByTitle(source: string, depth: number, re: RegExp) {
  return sections(toTree(source), source, depth).find((s) => re.test(s.title));
}

function registryRows(body: string | undefined) {
  if (!body) return [];
  const tree = toTree(body);
  const out: { registry: string; location: string; detail: string }[] = [];
  for (const t of tables(tree, body)) {
    const head = t.header.map((h) => unwrapInline(h).toLowerCase());
    if (!head.some((h) => h.includes("registry"))) continue;
    const iLoc = head.findIndex((h) => h.includes("location"));
    // The change/extension rule is the last column.
    for (const row of t.rows) {
      out.push({
        registry: code(row[0] ?? ""),
        location: (iLoc >= 0 ? row[iLoc] : row[1] ?? "").trim(),
        detail: (row[row.length - 1] ?? "").trim(),
      });
    }
  }
  return out;
}

export function parseSeams(source: string): Parsed {
  const tree = toTree(source);

  // 1. Surface-reduction pipelines.
  const surfaceSec = sectionByTitle(source, 2, /Surface Reduction/i);
  const pipelines: { surface: string; body: string }[] = [];
  if (surfaceSec) {
    for (const sub of sections(toTree(surfaceSec.body), surfaceSec.body, 3)) {
      if (!/^Surface:/i.test(sub.title)) continue;
      pipelines.push({
        surface: sub.title.replace(/^Surface:\s*/i, "").trim(),
        body: firstCodeBlock(sub.body) ?? sub.body.trim(),
      });
    }
  }

  // 3. Closed vs extensible registries.
  const closed_registries = registryRows(sectionByTitle(source, 3, /^Closed\b/i)?.body);
  const extensible_registries = registryRows(sectionByTitle(source, 3, /^Extensible\b/i)?.body);

  // 4. Frozen vs version-gated contracts.
  const frozen_contracts = listItems(sectionByTitle(source, 3, /^Frozen\b/i)?.body ?? "");
  const version_gated = listItems(sectionByTitle(source, 3, /^Version-gated\b/i)?.body ?? "");

  // 7. Candidate / not-yet-wired seams.
  const candSec = sectionByTitle(source, 2, /Candidate.*Seams|Not-Yet-Wired/i);
  const candidate_seams = listItems(candSec?.body ?? "").map((item) => {
    const bold = /\*\*([^*]+)\*\*/.exec(item)?.[1];
    const title = (bold ?? item.split(/[.—]/)[0]).trim();
    return { title, body: item.trim() };
  });

  const topSections = sections(tree, source, 2).map((s) => ({ title: s.title, body: s.body }));

  return {
    pipelines,
    closed_registries,
    extensible_registries,
    frozen_contracts,
    version_gated,
    candidate_seams,
    sections: topSections,
  };
}
