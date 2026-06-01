import { useEffect, useMemo, useRef, useState } from "react";
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

const STATUS_GLOW: Record<string, string> = {
  enforced: "#3fb950",
  partial: "#d29922",
  declared: "#8b949e",
};

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
  const [size, setSize] = useState({ width: 960, height: 640 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        // Cap height in the 480–800px range, ~62% of width.
        const h = Math.min(Math.max(Math.round(w * 0.62), 480), 800);
        setSize({ width: w, height: h });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  // ForceGraph wants {id,...} nodes and {source,target} links. Pre-compute the
  // val (rendered size) and a fixed color so the simulation doesn't recompute
  // them per tick.
  const graphData = useMemo(() => {
    const nodes = rules.map((r) => ({
      ...r,
      val: 1 + Math.sqrt(degree.get(r.id) ?? 0) * 2.5,
      color: TIER_COLOR[r.tier] ?? "#8b949e",
    }));
    const links = edges.map((e) => ({ source: e.from, target: e.to }));
    return { nodes, links };
  }, [rules, edges, degree]);

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
      <ForceGraph3D
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="#0a0e14"
        showNavInfo={false}
        nodeId="id"
        nodeLabel={(n: any) => {
          const d = degree.get(n.id) ?? 0;
          const stmt = n.statement.length > 140 ? n.statement.slice(0, 140) + "…" : n.statement;
          return `
            <div style="font-family:ui-monospace,monospace;font-weight:600">${n.id}</div>
            <div style="color:#9aa6b2;font-size:0.78em;margin:0.15em 0">${n.tier} · ${n.status} · ${d} refs</div>
            <div style="max-width:30rem">${stmt}</div>
          `;
        }}
        nodeVal={(n: any) => n.val}
        nodeColor={(n: any) => n.color}
        nodeOpacity={0.95}
        nodeResolution={12}
        linkColor={() => "rgba(150,170,200,0.18)"}
        linkOpacity={0.4}
        linkWidth={0.6}
        linkDirectionalArrowLength={2.5}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => "rgba(180,200,230,0.5)"}
        enableNodeDrag={true}
        onNodeClick={(n: any) => {
          window.location.href = `${basePath}/invariants/${n.id}`;
        }}
        onNodeHover={(n: any) => {
          if (containerRef.current) containerRef.current.style.cursor = n ? "pointer" : "default";
        }}
      />

      <div
        className="pill-row"
        style={{
          padding: "0.5rem 0.8rem",
          borderTop: "1px solid var(--border)",
          fontSize: "0.78rem",
          flexWrap: "wrap",
          gap: "0.5rem 1rem",
          background: "var(--bg-elev)",
        }}
      >
        <span className="faint">tier:</span>
        {Object.entries(TIER_COLOR).map(([t, c]) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: c, display: "inline-block" }}></span>
            {t}
          </span>
        ))}
        <span className="faint">
          · size = degree · drag to rotate · scroll to zoom · right-drag to pan · click a node to open the rule
        </span>
      </div>
    </div>
  );
}
