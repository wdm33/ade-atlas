import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";

export interface RuleRow {
  id: string;
  family: string;
  tier: string;
  status: string;
  statement: string;
  tests: number;
  ci: number;
  drift: boolean;
  gap: boolean;
  cluster: string | null;
}

const KNOWN_FAMILIES = ["T", "DC", "CN", "RO", "OP"];
const KNOWN_TIERS = ["true", "derived", "release", "operational"];
const KNOWN_STATUSES = ["enforced", "partial", "declared", "deprecated"];

// Known order first, then any value the data carries that isn't in the known
// list (e.g. a newly-added tier), so every facet present is filterable.
function facetOrder(values: string[], known: string[]): string[] {
  const present = new Set(values);
  const head = known.filter((k) => present.has(k));
  const tail = [...present].filter((k) => !known.includes(k)).sort();
  return [...head, ...tail];
}

function Chip({
  active,
  onClick,
  children,
  cls,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  cls?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`badge ${cls ?? "fam"}`}
      style={{
        cursor: "pointer",
        opacity: active ? 1 : 0.4,
        outline: active ? "1px solid var(--accent)" : "none",
        background: "none",
      }}
    >
      {children}
    </button>
  );
}

export default function SearchTable({
  rows,
  basePath,
}: {
  rows: RuleRow[];
  basePath: string;
}) {
  const [q, setQ] = useState("");
  const [fam, setFam] = useState<Set<string>>(new Set());
  const [tier, setTier] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Set<string>>(new Set());
  const [onlyDrift, setOnlyDrift] = useState(false);
  const [onlyGap, setOnlyGap] = useState(false);

  // Drill-down: initialize filters from URL params (e.g. /invariants?status=enforced).
  // Applied after mount to avoid an SSR/hydration mismatch.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q0 = p.get("q");
    if (q0) setQ(q0);
    const multi = (key: string, setter: (s: Set<string>) => void) => {
      const v = p.get(key);
      if (v) setter(new Set(v.split(",").map((x) => x.trim()).filter(Boolean)));
    };
    multi("status", setStatus);
    multi("family", setFam);
    multi("tier", setTier);
    if (p.get("drift") === "1") setOnlyDrift(true);
    if (p.get("gap") === "1") setOnlyGap(true);
  }, []);

  const fuse = useMemo(
    () => new Fuse(rows, { keys: ["id", "statement"], threshold: 0.34, ignoreLocation: true }),
    [rows],
  );

  const facets = useMemo(
    () => ({
      families: facetOrder(rows.map((r) => r.family), KNOWN_FAMILIES),
      tiers: facetOrder(rows.map((r) => r.tier), KNOWN_TIERS),
      statuses: facetOrder(rows.map((r) => r.status), KNOWN_STATUSES),
    }),
    [rows],
  );

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  const filtered = useMemo(() => {
    let base = q.trim() ? fuse.search(q.trim()).map((r) => r.item) : rows;
    return base.filter(
      (r) =>
        (fam.size === 0 || fam.has(r.family)) &&
        (tier.size === 0 || tier.has(r.tier)) &&
        (status.size === 0 || status.has(r.status)) &&
        (!onlyDrift || r.drift) &&
        (!onlyGap || r.gap),
    );
  }, [q, fam, tier, status, onlyDrift, onlyGap, rows, fuse]);

  const exportData = (kind: "json" | "csv") => {
    let blob: Blob;
    if (kind === "json") {
      blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    } else {
      const head = "id,family,tier,status,tests,ci,drift,gap,cluster,statement";
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = filtered.map((r) =>
        [r.id, r.family, r.tier, r.status, r.tests, r.ci, r.drift, r.gap, r.cluster ?? "", esc(r.statement)].join(","),
      );
      blob = new Blob([head + "\n" + lines.join("\n")], { type: "text/csv" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ade-invariants.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        <input
          type="search"
          placeholder="Search id or statement…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            flex: "1 1 280px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: "6px",
            color: "var(--fg)",
            padding: "0.5rem 0.7rem",
            fontSize: "0.92rem",
          }}
        />
        <button className="badge" style={{ cursor: "pointer", background: "var(--bg-elev2)" }} onClick={() => exportData("json")}>
          Export JSON
        </button>
        <button className="badge" style={{ cursor: "pointer", background: "var(--bg-elev2)" }} onClick={() => exportData("csv")}>
          Export CSV
        </button>
      </div>

      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <div className="pill-row">
          <span className="faint" style={{ fontSize: "0.78rem" }}>family</span>
          {facets.families.map((f) => (
            <Chip key={f} active={fam.size === 0 || fam.has(f)} onClick={() => toggle(fam, setFam, f)}>{f}</Chip>
          ))}
        </div>
        <div className="pill-row">
          <span className="faint" style={{ fontSize: "0.78rem" }}>tier</span>
          {facets.tiers.map((t) => (
            <Chip key={t} active={tier.size === 0 || tier.has(t)} onClick={() => toggle(tier, setTier, t)} cls="tier">{t}</Chip>
          ))}
        </div>
        <div className="pill-row">
          <span className="faint" style={{ fontSize: "0.78rem" }}>status</span>
          {facets.statuses.map((s) => (
            <Chip key={s} active={status.size === 0 || status.has(s)} onClick={() => toggle(status, setStatus, s)} cls={s}>{s}</Chip>
          ))}
        </div>
        <div className="pill-row">
          <Chip active={onlyDrift} onClick={() => setOnlyDrift((v) => !v)} cls="drift">drift only</Chip>
          <Chip active={onlyGap} onClick={() => setOnlyGap((v) => !v)} cls="gap">gaps only</Chip>
        </div>
      </div>

      <div className="muted" style={{ fontSize: "0.82rem", margin: "0.4rem 0 0.6rem" }}>
        {filtered.length} of {rows.length} rules
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Statement</th>
              <th style={{ textAlign: "right" }}>Tests</th>
              <th style={{ textAlign: "right" }}>CI</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="mono">
                  <a href={`${basePath}/invariants/${r.id}`}>{r.id}</a>
                </td>
                <td><span className="badge tier">{r.tier}</span></td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td style={{ maxWidth: "46ch" }}>
                  {r.statement.length > 160 ? r.statement.slice(0, 160) + "…" : r.statement}
                </td>
                <td style={{ textAlign: "right" }} className="mono">{r.tests}</td>
                <td style={{ textAlign: "right" }} className="mono">{r.ci}</td>
                <td>
                  <div className="tag-list">
                    {r.drift && <span className="badge drift">drift</span>}
                    {r.gap && <span className="badge gap">gap</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
