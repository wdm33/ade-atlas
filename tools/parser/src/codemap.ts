import { toTree, sections, tables, unwrapInline } from "./markdown.ts";
import type { CodemapModule, TcbColor } from "./schema.ts";

interface CodemapParsed {
  repo_head: string;
  counts: {
    crates: number | null;
    canonical_types: number | null;
    tests: number | null;
    ci_checks: number | null;
    registry_rules: number | null;
  };
  modules: CodemapModule[];
  dep_edges: { from: string; to: string }[];
  external_deps: Record<string, string[]>;
  closed_surfaces: { name: string; location: string }[];
  ci_table: { script: string; enforces: string; cluster: string }[];
  sections: { title: string; body: string }[];
}

function colorOfHeading(title: string): TcbColor | null {
  if (/^BLUE\b/i.test(title)) return "BLUE";
  if (/^GREEN\b/i.test(title)) return "GREEN";
  if (/^RED\b/i.test(title)) return "RED";
  return null;
}

function firstInt(s: string): number | null {
  const m = /(\d[\d,]*)/.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Split "ade_network::session (GREEN by content)" -> { name, note }. */
function splitNameNote(title: string): { name: string; note: string | null } {
  const m = /^([A-Za-z_][A-Za-z0-9_:]*)/.exec(title.trim());
  const name = m ? m[1] : title.trim();
  const rest = title.slice(name.length).replace(/^[\s*()—-]+|[\s*()]+$/g, "").trim();
  return { name, note: rest.length > 0 ? rest : null };
}

/** Parse a single "| Attribute | Value |" table body into an attributes map. */
function attributeTable(body: string): Record<string, string> {
  const tree = toTree(body);
  const tbls = tables(tree, body);
  const attrs: Record<string, string> = {};
  for (const t of tbls) {
    const head = t.header.map((h) => unwrapInline(h).toLowerCase());
    if (!(head.includes("attribute") && head.includes("value"))) continue;
    for (const row of t.rows) {
      if (row.length < 2) continue;
      attrs[unwrapInline(row[0])] = row[1].trim();
    }
  }
  return attrs;
}

/** Parse a "GREEN-by-content sub-trees" table into subtree modules. */
function subtreeModules(parent: string, body: string): CodemapModule[] {
  const tree = toTree(body);
  const tbls = tables(tree, body);
  const out: CodemapModule[] = [];
  for (const t of tbls) {
    const head = t.header.map((h) => unwrapInline(h).toLowerCase());
    const idx = (label: string) => head.findIndex((h) => h.includes(label));
    const iSub = idx("sub-tree");
    if (iSub < 0) continue;
    const iPurpose = idx("purpose");
    const iMust = idx("must not");
    const iGate = idx("ci gate");
    for (const row of t.rows) {
      const cell = row[iSub] ?? "";
      const codeTok = /`([^`]+)`/.exec(cell)?.[1] ?? unwrapInline(cell);
      const noteTok = cell.replace(/`[^`]+`/, "").replace(/[*()]/g, "").trim();
      const attrs: Record<string, string> = {};
      if (iPurpose >= 0 && row[iPurpose]) attrs["Purpose"] = row[iPurpose].trim();
      if (iMust >= 0 && row[iMust]) attrs["MUST NOT"] = row[iMust].trim();
      if (iGate >= 0 && row[iGate]) attrs["CI gate"] = row[iGate].trim();
      out.push({
        name: codeTok,
        color: "GREEN",
        kind: "subtree",
        parent,
        note: noteTok.length > 0 ? noteTok : null,
        attributes: attrs,
      });
    }
  }
  return out;
}

function parseDeps(source: string): {
  edges: { from: string; to: string }[];
  external: Record<string, string[]>;
} {
  const block =
    sections(toTree(source), source, 3).find((s) => /Dependency direction/i.test(s.title))?.body ??
    "";
  const tree = toTree(block);
  let code = "";
  for (const c of tree.children) if (c.type === "code") code = (c as any).value;

  const edges: { from: string; to: string }[] = [];
  const external: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const line of code.split("\n")) {
    const arrow = line.indexOf("→");
    if (arrow < 0) continue;
    const lhs = line.slice(0, arrow);
    const rhs = line.slice(arrow);
    const from = /(ade_[a-z_]+)/.exec(lhs)?.[1];
    if (!from) continue;
    for (const m of rhs.matchAll(/ade_[a-z_]+/g)) {
      const to = m[0];
      if (to === from) continue;
      const key = `${from}->${to}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from, to });
      }
    }
    const brace = /\{([^}]*)\}/.exec(rhs);
    if (brace) {
      external[from] = brace[1]
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && !t.startsWith("ade_"));
    }
  }
  return { edges, external };
}

export function parseCodemap(source: string): CodemapParsed {
  const tree = toTree(source);
  const repo_head = /HEAD \(`([0-9a-f]{6,40})`/.exec(source)?.[1] ?? "";

  // Counts table.
  const counts = {
    crates: null as number | null,
    canonical_types: null as number | null,
    tests: null as number | null,
    ci_checks: null as number | null,
    registry_rules: null as number | null,
  };
  for (const t of tables(tree, source)) {
    const head = t.header.map((h) => unwrapInline(h).toLowerCase());
    if (!(head.includes("count") && head.includes("value"))) continue;
    for (const row of t.rows) {
      const label = unwrapInline(row[0]).toLowerCase();
      const val = firstInt(row[1] ?? "");
      if (label.includes("crate")) counts.crates = val;
      else if (label.includes("canonical")) counts.canonical_types = val;
      else if (label.startsWith("test")) counts.tests = val;
      else if (label.includes("ci check")) counts.ci_checks = val;
      else if (label.includes("registry")) counts.registry_rules = val;
    }
  }

  // Modules, grouped under the BLUE/GREEN/RED depth-2 sections.
  const modules: CodemapModule[] = [];
  for (const top of sections(tree, source, 2)) {
    const color = colorOfHeading(top.title);
    if (!color) continue;
    const bodyTree = toTree(top.body);
    for (const sub of sections(bodyTree, top.body, 3)) {
      if (/sub-trees/i.test(sub.title)) {
        const parent = splitNameNote(sub.title).name;
        modules.push(...subtreeModules(parent, sub.body));
        continue;
      }
      const { name, note } = splitNameNote(sub.title);
      if (!name.startsWith("ade_")) continue;
      const attrs = attributeTable(sub.body);
      if (Object.keys(attrs).length === 0) continue;
      const kind = name.includes("::") ? "submodule" : "crate";
      modules.push({ name, color, kind, parent: null, note, attributes: attrs });
    }
  }

  // Closed surfaces (names + locations) from the cross-reference paragraph.
  const closed_surfaces: { name: string; location: string }[] = [];
  const closedSec = sections(tree, source, 3).find((s) => /Closed enums/i.test(s.title));
  if (closedSec) {
    const re = /`([A-Za-z_][A-Za-z0-9_:]*)`\s*\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = re.exec(closedSec.body)) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      closed_surfaces.push({ name: m[1], location: m[2].trim() });
    }
  }

  // CI enforcement table(s).
  const ci_table: { script: string; enforces: string; cluster: string }[] = [];
  const ciSec = sections(tree, source, 3).find((s) => /CI enforcement/i.test(s.title));
  if (ciSec) {
    const ct = toTree(ciSec.body);
    for (const t of tables(ct, ciSec.body)) {
      const head = t.header.map((h) => unwrapInline(h).toLowerCase());
      if (!head.includes("script")) continue;
      for (const row of t.rows) {
        const script = (/`([^`]+)`/.exec(row[0])?.[1] ?? unwrapInline(row[0])).trim();
        if (!script.endsWith(".sh")) continue;
        ci_table.push({
          script,
          enforces: (row[1] ?? "").trim(),
          cluster: unwrapInline(row[2] ?? "").trim(),
        });
      }
    }
  }

  const { edges, external } = parseDeps(source);
  const topSections = sections(tree, source, 2).map((s) => ({ title: s.title, body: s.body }));

  modules.sort((a, b) => a.name.localeCompare(b.name));
  return {
    repo_head,
    counts,
    modules,
    dep_edges: edges,
    external_deps: external,
    closed_surfaces,
    ci_table,
    sections: topSections,
  };
}
