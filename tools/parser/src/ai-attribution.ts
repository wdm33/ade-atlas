import { execSync } from "node:child_process";

export interface ModelShare {
  model: string;
  lines: number;
  commits: number;
  pct: number;
}

export interface AiAttribution {
  enabled: boolean;
  commits_total: number;
  commits_attributed: number;
  lines_total: number;
  lines_ai: number;
  ai_pct: number;
  target_pct: number;
  by_model: ModelShare[];
  methodology: string;
}

export function emptyAttribution(reason: string): AiAttribution {
  return {
    enabled: false,
    commits_total: 0,
    commits_attributed: 0,
    lines_total: 0,
    lines_ai: 0,
    ai_pct: 0,
    target_pct: 90,
    by_model: [],
    methodology: `AI attribution disabled: ${reason}`,
  };
}

// Files that aren't really "code written" — lockfiles, generated manifests.
const SKIP_FILE = /(^|\/)(Cargo\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

/** Normalize the trailer's "actor" string to a stable model label. */
export function normalizeModel(actor: string): string {
  const a = actor.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /opus[\s\-_]?(\d+)[\.\-](\d+)/.exec(a))) return `Claude Opus ${m[1]}.${m[2]}`;
  if ((m = /sonnet[\s\-_]?(\d+)[\.\-](\d+)/.exec(a))) return `Claude Sonnet ${m[1]}.${m[2]}`;
  if ((m = /haiku[\s\-_]?(\d+)[\.\-](\d+)/.exec(a))) return `Claude Haiku ${m[1]}.${m[2]}`;
  if (/claude/.test(a)) return "Claude (unversioned)";
  if ((m = /gpt[\s\-_]?(\d+)/.exec(a))) return `GPT-${m[1]}`;
  if (/codex/.test(a)) return "Codex";
  if (/gemini/.test(a)) return "Gemini";
  return actor.trim() || "Unknown";
}

const TRAILER_RE = /^Co-Authored-By:\s*(.+)$/gim;

/**
 * Compute AI authorship from the repo's git history.
 *
 * Methodology: per-commit lines-added (git log --numstat) attributed to models
 * via `Co-Authored-By:` trailers. A commit's lines are AI-attributed when any
 * trailer maps to a known model; commits without an AI trailer are human-only.
 * When multiple distinct models co-author a commit, its lines split equally
 * among them. Lock files and binary diffs are excluded.
 */
export function computeAiAttribution(repoDir: string): AiAttribution {
  let raw: string;
  try {
    raw = execSync(
      "git log --no-merges --numstat --pretty=format:'§§COMMIT§§%H%n%B%n§§NUMSTAT§§'",
      { cwd: repoDir, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    ).toString();
  } catch (e) {
    return emptyAttribution(`git log failed in ${repoDir}: ${(e as Error).message}`);
  }

  const chunks = raw.split("§§COMMIT§§").filter((c) => c.trim().length > 0);

  let commitsTotal = 0;
  let commitsAttributed = 0;
  let linesTotal = 0;
  let linesAi = 0;
  const byModel = new Map<string, { lines: number; commits: number }>();

  for (const chunk of chunks) {
    commitsTotal++;
    const [bodyPart, numstatPart = ""] = chunk.split("§§NUMSTAT§§");

    // Sum added lines for this commit (skip binary diffs and lock files).
    let lines = 0;
    for (const line of numstatPart.trim().split("\n")) {
      if (!line.trim()) continue;
      const [added, _removed, ...rest] = line.split("\t");
      const file = rest.join("\t");
      if (added === "-" || !file) continue;
      if (SKIP_FILE.test(file)) continue;
      const n = Number(added);
      if (Number.isFinite(n)) lines += n;
    }
    linesTotal += lines;

    // Detect AI co-authors (one model per distinct trailer line).
    TRAILER_RE.lastIndex = 0;
    const models = new Set<string>();
    for (const m of bodyPart.matchAll(TRAILER_RE)) {
      const actor = m[1].replace(/\s*<[^>]*>\s*$/, "").trim();
      if (!actor) continue;
      models.add(normalizeModel(actor));
    }
    if (models.size === 0) continue;

    commitsAttributed++;
    linesAi += lines;
    const share = models.size > 0 ? lines / models.size : 0;
    for (const m of models) {
      const entry = byModel.get(m) ?? { lines: 0, commits: 0 };
      entry.lines += share;
      entry.commits += 1;
      byModel.set(m, entry);
    }
  }

  const ai_pct = linesTotal > 0 ? (linesAi / linesTotal) * 100 : 0;
  const by_model: ModelShare[] = [...byModel.entries()]
    .map(([model, v]) => ({
      model,
      lines: Math.round(v.lines),
      commits: v.commits,
      pct: linesTotal > 0 ? (v.lines / linesTotal) * 100 : 0,
    }))
    .sort((a, b) => b.lines - a.lines);

  return {
    enabled: true,
    commits_total: commitsTotal,
    commits_attributed: commitsAttributed,
    lines_total: linesTotal,
    lines_ai: linesAi,
    ai_pct,
    target_pct: 90,
    by_model,
    methodology:
      "Lines added per non-merge commit (git log --numstat) attributed to models via Co-Authored-By: trailers; lock files and binary diffs excluded. Co-authored lines split equally when multiple distinct models appear on the same commit; commits without an AI trailer count as human-only.",
  };
}
