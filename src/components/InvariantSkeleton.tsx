import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";

interface RuleNode {
  id: string;
  tier: string;
  family: string;
  status: string;
  statement: string;
}
interface Edge {
  from: string;
  to: string;
}

const TIER_COLOR: Record<string, string> = {
  true: "#4493f8",
  derived: "#a371f7",
  constraint: "#d29922",
  release: "#3fb950",
  operational: "#8b949e",
};

// Stripped back to the smallest set of props known to work — no experimental
// controlType / enableNavigationControls / cooldownTicks=Infinity / refresh()
// dances. Just data + sizing + click/hover + a simple per-node dim on hover.

export default function InvariantSkeleton({
  rules,
  edges,
  basePath,
}: {
  rules: RuleNode[];
  edges: Edge[];
  basePath: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [width, setWidth] = useState(960);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const height = 640;

  // Match container width on mount + whenever it resizes.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    setWidth(Math.floor(containerRef.current.clientWidth));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const outAdj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      m.get(e.from)!.add(e.to);
    }
    return m;
  }, [edges]);
  const inAdj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [edges]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const graphData = useMemo(() => {
    const nodes = rules.map((r) => ({
      ...r,
      val: 1 + (degree.get(r.id) ?? 0) * 2.4,
      color: TIER_COLOR[r.tier] ?? "#8b949e",
    }));
    const links = edges.map((e) => ({ source: e.from, target: e.to }));
    return { nodes, links };
  }, [rules, edges, degree]);

  const connectedSet = useMemo(() => {
    if (!hoveredId) return null;
    const s = new Set<string>([hoveredId]);
    for (const id of outAdj.get(hoveredId) ?? []) s.add(id);
    for (const id of inAdj.get(hoveredId) ?? []) s.add(id);
    return s;
  }, [hoveredId, outAdj, inAdj]);

  return (
    <div
      ref={containerRef}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "#0a0e14",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Explicit-height wrapper so the lib's container can't grow past the
          canvas. Some force-graph wrapper styles default to flex which lets
          it expand vertically if the parent has no height bound. */}
      <div style={{ width: "100%", height: `${height}px` }}>
        <ForceGraph3D
          ref={fgRef}
          graphData={graphData}
          width={width}
          height={height}
          backgroundColor="#0a0e14"
          showNavInfo={false}
          nodeId="id"
          nodeLabel={(n: any) => {
            const stmt = n.statement.length > 160 ? n.statement.slice(0, 160) + "…" : n.statement;
            const out = [...(outAdj.get(n.id) ?? [])].sort();
            const inc = [...(inAdj.get(n.id) ?? [])].sort();
            const dir = (label: string, ids: string[]) => ids.length === 0 ? "" : `
              <div style="margin-bottom:0.25em">
                <span style="color:#9aa6b2">${label} (${ids.length}): </span>
                <span style="font-family:ui-monospace,monospace;color:#c9d6e3">${ids.join(", ")}</span>
              </div>`;
            const dirHtml = (out.length > 0 || inc.length > 0)
              ? `<div style="margin-top:0.5em;padding-top:0.4em;border-top:1px solid #2a313c;font-size:0.78em;line-height:1.5;max-width:34rem">${dir("↗ references", out)}${dir("↙ referenced by", inc)}</div>`
              : "";
            return `
              <div style="font-family:ui-monospace,monospace;font-weight:600">${n.id}</div>
              <div style="color:#9aa6b2;font-size:0.78em;margin:0.15em 0">${n.tier} · ${n.status} · ${out.length} out · ${inc.length} in</div>
              <div style="max-width:32rem">${stmt}</div>
              ${dirHtml}
            `;
          }}
          nodeVal={(n: any) => n.val}
          nodeColor={(n: any) => {
            if (!connectedSet) return n.color;
            if (n.id === hoveredId) return "#ffffff";
            if (connectedSet.has(n.id)) return n.color;
            return "#1c2330";
          }}
          linkColor={(l: any) => {
            if (!hoveredId) return "rgba(150,170,200,0.18)";
            const sId = typeof l.source === "object" ? l.source.id : l.source;
            const tId = typeof l.target === "object" ? l.target.id : l.target;
            if (sId === hoveredId || tId === hoveredId) return "#58a6ff";
            return "rgba(80,90,110,0.06)";
          }}
          linkWidth={0.6}
          linkDirectionalArrowLength={2.5}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(n: any) => {
            window.location.href = `${basePath}/invariants/${n.id}`;
          }}
          onNodeHover={(n: any) => {
            if (containerRef.current) containerRef.current.style.cursor = n ? "pointer" : "default";
            setHoveredId(n ? n.id : null);
          }}
        />
      </div>

      <div
        style={{
          padding: "0.5rem 0.8rem",
          borderTop: "1px solid var(--border)",
          fontSize: "0.78rem",
          color: "var(--fg-muted)",
          background: "var(--bg-elev)",
        }}
      >
        tier:&nbsp;
        {Object.entries(TIER_COLOR).map(([t, c]) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", marginRight: "0.9rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: c, display: "inline-block" }}></span>
            {t}
          </span>
        ))}
        <span className="faint">· size = degree · drag to rotate · scroll to zoom · click a node to open the rule</span>
      </div>
    </div>
  );
}
