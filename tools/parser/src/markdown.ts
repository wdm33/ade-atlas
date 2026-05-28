import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root, Heading, Table, Node } from "mdast";

const processor = unified().use(remarkParse).use(remarkGfm);

export function toTree(md: string): Root {
  return processor.parse(md) as Root;
}

/** Concatenated plain text of a node's inline content (code spans kept verbatim). */
export function nodeText(node: Node): string {
  let out = "";
  visit(node as Root, (n: any) => {
    if (n.type === "text" || n.type === "inlineCode") out += n.value;
  });
  return out.trim();
}

/** Raw source substring for a node, using its position offsets. */
export function rawSlice(source: string, node: Node): string {
  const pos = (node as any).position;
  if (!pos) return "";
  return source.slice(pos.start.offset, pos.end.offset);
}

export interface Section {
  title: string;
  depth: number;
  /** Raw markdown body between this heading and the next heading of depth <= this. */
  body: string;
}

/**
 * Sections at a given heading depth. Each section's body is the raw markdown
 * after the heading line up to the next heading of depth <= `depth` (or EOF).
 */
export function sections(tree: Root, source: string, depth: number): Section[] {
  const headings: { depth: number; title: string; start: number; lineEnd: number }[] = [];
  for (const child of tree.children) {
    if (child.type === "heading") {
      const h = child as Heading;
      headings.push({
        depth: h.depth,
        title: nodeText(h),
        start: h.position!.start.offset!,
        lineEnd: h.position!.end.offset!,
      });
    }
  }
  const out: Section[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.depth !== depth) continue;
    let end = source.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].depth <= depth) {
        end = headings[j].start;
        break;
      }
    }
    out.push({ title: h.title, depth: h.depth, body: source.slice(h.lineEnd, end).trim() });
  }
  return out;
}

export interface ParsedTable {
  header: string[];
  rows: string[][];
}

/**
 * Raw markdown of a table cell. The `tableCell` node's own offsets include the
 * surrounding `|` delimiters under remark-gfm, so we slice by the extent of its
 * inline children instead (preserving links / code / bold, dropping pipes).
 */
function cellRaw(source: string, cell: Node): string {
  const kids = (cell as any).children as Node[] | undefined;
  if (!kids || kids.length === 0) return "";
  const start = (kids[0] as any).position?.start.offset;
  const end = (kids[kids.length - 1] as any).position?.end.offset;
  if (start == null || end == null) return nodeText(cell);
  return source.slice(start, end).trim();
}

/** All GFM tables in a tree, each as { header, rows } with raw-markdown cells. */
export function tables(tree: Root, source: string): ParsedTable[] {
  const out: ParsedTable[] = [];
  visit(tree, "table", (table: Table) => {
    const rows = table.children.map((row) =>
      row.children.map((cell) => cellRaw(source, cell)),
    );
    if (rows.length === 0) return;
    out.push({ header: rows[0], rows: rows.slice(1) });
  });
  return out;
}

/** First fenced code block in a markdown fragment, or null. */
export function firstCodeBlock(md: string): string | null {
  const tree = toTree(md);
  let found: string | null = null;
  visit(tree, "code", (n: any) => {
    if (found === null) found = n.value as string;
  });
  return found;
}

/** Strip surrounding backticks / bold / link markup to a bare token (best effort). */
export function unwrapInline(md: string): string {
  let s = md.trim();
  // [text](url) -> text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // `code` -> code, **bold** -> bold, *em* -> em
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/\*\*([^*]*)\*\*/g, "$1");
  s = s.replace(/\*([^*]*)\*/g, "$1");
  return s.trim();
}

/** Split a markdown bullet list fragment into top-level item bodies (raw). */
export function listItems(md: string): string[] {
  const tree = toTree(md);
  const out: string[] = [];
  // Only the first top-level list, to avoid nested-list duplication.
  for (const child of tree.children) {
    if (child.type === "list") {
      for (const item of (child as any).children) {
        out.push(nodeText(item));
      }
      break;
    }
  }
  return out;
}
