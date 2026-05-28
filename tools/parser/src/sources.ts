import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

export interface SourceMeta {
  repo_head: string | null;
  github_repo: string | null;
  generated_at: string | null;
}

export interface Sources {
  mode: "mock" | "repo";
  dir: string;
  meta: SourceMeta;
  codemap: string;
  seams: string;
  headDeltas: string;
  traceability: string;
  registry: string;
  /** Logical-name -> resolved source path, for the manifest. */
  paths: Record<string, string>;
}

const FILE_NAMES = {
  codemap: "ade-CODEMAP.md",
  seams: "ade-SEAMS.md",
  headDeltas: "ade-HEAD_DELTAS.md",
  traceability: "ade-TRACEABILITY.md",
  registry: "ade-invariant-registry.toml",
} as const;

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/**
 * Resolve the five source documents.
 *
 * - repo mode: `--source-dir <dir>` / `ADE_SOURCE_DIR`. Files are read from
 *   `<dir>/ade-*.md` (CI drops them flat) or `<dir>/docs/ade-*.md`.
 * - mock mode (default): the `ade-*.md` files committed at the repo root.
 *
 * Repo mode optionally reads `<dir>/source-meta.json` for the pinned commit,
 * the GitHub repo slug, and the source generation date.
 */
export function resolveSources(argv: string[], repoRoot: string): Sources {
  const flagIdx = argv.indexOf("--source-dir");
  const sourceDir =
    (flagIdx >= 0 ? argv[flagIdx + 1] : undefined) ?? process.env.ADE_SOURCE_DIR;

  const mode: "mock" | "repo" = sourceDir ? "repo" : "mock";
  const dir = sourceDir ? resolve(sourceDir) : repoRoot;

  const paths: Record<string, string> = {};
  const read = (logical: keyof typeof FILE_NAMES): string => {
    const name = FILE_NAMES[logical];
    const found = firstExisting([join(dir, name), join(dir, "docs", name)]);
    if (!found) {
      throw new Error(
        `Source document not found: ${name} (looked in ${dir} and ${dir}/docs). ` +
          (mode === "repo"
            ? "The CI fetch step must copy the ade docs into the source dir."
            : "Expected the mock file at the repo root."),
      );
    }
    paths[logical] = found;
    return readFileSync(found, "utf8");
  };

  let meta: SourceMeta = { repo_head: null, github_repo: null, generated_at: null };
  const metaPath = join(dir, "source-meta.json");
  if (existsSync(metaPath)) {
    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf8"));
      meta = {
        repo_head: raw.repo_head ?? null,
        github_repo: raw.github_repo ?? null,
        generated_at: raw.generated_at ?? null,
      };
    } catch (e) {
      throw new Error(`Malformed source-meta.json at ${metaPath}: ${(e as Error).message}`);
    }
  }

  return {
    mode,
    dir,
    meta,
    codemap: read("codemap"),
    seams: read("seams"),
    headDeltas: read("headDeltas"),
    traceability: read("traceability"),
    registry: read("registry"),
    paths,
  };
}
