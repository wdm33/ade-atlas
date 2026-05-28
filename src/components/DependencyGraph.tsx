import { useMemo, useState } from "react";

interface GNode {
  id: string;
  color: "BLUE" | "GREEN" | "RED" | null;
  depth: number;
}
interface GEdge {
  from: string;
  to: string;
}

const COLOR: Record<string, string> = {
  BLUE: "#4493f8",
  GREEN: "#3fb950",
  RED: "#f85149",
};
const fill = (c: string | null) => (c ? COLOR[c] : "#8b949e");

export default function DependencyGraph({
  nodes,
  edges,
  basePath,
}: {
  nodes: GNode[];
  edges: GEdge[];
  basePath: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const colW = 230;
    const rowH = 64;
    const padX = 90;
    const padY = 48;
    // Group by depth (column). Depth 0 = most depended-upon (left).
    const byDepth = new Map<number, GNode[]>();
    for (const n of nodes) {
      if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
      byDepth.get(n.depth)!.push(n);
    }
    const maxDepth = Math.max(...nodes.map((n) => n.depth), 0);
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    for (const [depth, ns] of byDepth) {
      ns.sort((a, b) => a.id.localeCompare(b.id));
      maxRows = Math.max(maxRows, ns.length);
      ns.forEach((n, i) => {
        pos.set(n.id, { x: padX + depth * colW, y: padY + i * rowH });
      });
    }
    const width = padX * 2 + maxDepth * colW + 60;
    const height = padY * 2 + (maxRows - 1) * rowH + 40;
    return { pos, width, height };
  }, [nodes]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of nodes) map.set(n.id, new Set());
    for (const e of edges) {
      map.get(e.from)?.add(e.to);
      map.get(e.to)?.add(e.from);
    }
    return map;
  }, [nodes, edges]);

  const isDim = (id: string) => hover != null && hover !== id && !neighbors.get(hover)?.has(id);

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-elev)" }}>
      <svg width={layout.width} height={layout.height} style={{ display: "block", minWidth: "100%" }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#475569" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          const active = hover === e.from || hover === e.to;
          const mx = (a.x + b.x) / 2;
          return (
            <path
              key={i}
              d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
              fill="none"
              stroke={active ? "var(--accent)" : "#33404f"}
              strokeWidth={active ? 1.8 : 1}
              markerEnd="url(#arrow)"
              opacity={hover && !active ? 0.18 : 0.8}
            />
          );
        })}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id)!;
          const dim = isDim(n.id);
          const w = Math.max(96, n.id.length * 7.6 + 22);
          return (
            <g
              key={n.id}
              transform={`translate(${p.x - w / 2}, ${p.y - 15})`}
              opacity={dim ? 0.25 : 1}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => (window.location.href = `${basePath}/modules/${n.id}`)}
            >
              <rect width={w} height={30} rx={6} fill="var(--bg-elev2)" stroke={fill(n.color)} strokeWidth={1.6} />
              <circle cx={12} cy={15} r={4} fill={fill(n.color)} />
              <text x={24} y={19} fontSize={12} fontFamily="var(--mono)" fill="var(--fg)">{n.id}</text>
            </g>
          );
        })}
      </svg>
      <div className="pill-row" style={{ padding: "0.6rem 0.9rem", borderTop: "1px solid var(--border)" }}>
        <span className="badge blue">BLUE core</span>
        <span className="badge green">GREEN glue</span>
        <span className="badge red">RED shell</span>
        <span className="badge mixed">mixed</span>
        <span className="faint" style={{ fontSize: "0.78rem" }}>
          arrows point to dependencies · hover to isolate · click to open a module
        </span>
      </div>
    </div>
  );
}
