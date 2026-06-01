import { useEffect, useMemo, useState } from "react";

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
const W = 1000;
const H = 600;

export default function InvariantSkeleton({
  rules,
  edges,
  basePath,
}: {
  rules: RuleNode[];
  edges: Edge[];
  basePath: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);

  const ruleById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [edges]);

  useEffect(() => {
    // O(n²) force layout — fine for ~300 nodes, runs once on mount.
    // Repulsion + edge springs + center pull, with deterministic init so the
    // layout doesn't jitter between visits.
    const n = rules.length;
    const pos: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    rules.forEach((r, i) => {
      const seed = [...r.id].reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
      const angle = ((Math.abs(seed) * 0.13 + i) % 1000) / 1000 * Math.PI * 2;
      const radius = 80 + ((i % 17) / 17) * 200;
      pos[r.id] = {
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });

    const ITER = 220;
    const REPEL = 900;
    const SPRING_K = 0.05;
    const SPRING_L = 70;
    const CENTER_K = 0.006;
    const DAMP = 0.82;
    const MAX_V = 12;

    for (let iter = 0; iter < ITER; iter++) {
      for (let i = 0; i < n; i++) {
        const pa = pos[rules[i].id];
        for (let j = i + 1; j < n; j++) {
          const pb = pos[rules[j].id];
          let dx = pa.x - pb.x;
          let dy = pa.y - pb.y;
          const d2 = dx * dx + dy * dy + 1;
          const d = Math.sqrt(d2);
          const f = REPEL / d2;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          pa.vx += fx;
          pa.vy += fy;
          pb.vx -= fx;
          pb.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = SPRING_K * (d - SPRING_L);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      for (const r of rules) {
        const p = pos[r.id];
        p.vx += (W / 2 - p.x) * CENTER_K;
        p.vy += (H / 2 - p.y) * CENTER_K;
        if (p.vx > MAX_V) p.vx = MAX_V;
        if (p.vx < -MAX_V) p.vx = -MAX_V;
        if (p.vy > MAX_V) p.vy = MAX_V;
        if (p.vy < -MAX_V) p.vy = -MAX_V;
        p.vx *= DAMP;
        p.vy *= DAMP;
        p.x += p.vx;
        p.y += p.vy;
        // Clamp to viewBox (with a margin for radius).
        const M = 16;
        if (p.x < M) p.x = M;
        if (p.x > W - M) p.x = W - M;
        if (p.y < M) p.y = M;
        if (p.y > H - M) p.y = H - M;
      }
    }

    const final = new Map<string, { x: number; y: number }>();
    for (const r of rules) final.set(r.id, { x: pos[r.id].x, y: pos[r.id].y });
    setPositions(final);
  }, [rules, edges]);

  if (!positions) {
    return (
      <div
        style={{
          height: 480,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
        className="muted"
      >
        Computing layout for {rules.length} rules…
      </div>
    );
  }

  const hoverNode = hover ? ruleById.get(hover) ?? null : null;
  const hoverPos = hover ? positions.get(hover) ?? null : null;
  const hoverNeighbors = hover ? adj.get(hover) ?? new Set<string>() : null;

  return (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elev)",
        overflow: "hidden",
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
        {edges.map((e, i) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          const active = hover != null && (e.from === hover || e.to === hover);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "var(--accent)" : "#33404f"}
              strokeWidth={active ? 0.9 : 0.4}
              opacity={hover ? (active ? 0.9 : 0.05) : 0.2}
            />
          );
        })}
        {rules.map((r) => {
          const p = positions.get(r.id)!;
          const d = degree.get(r.id) ?? 0;
          const radius = Math.min(2.4 + Math.sqrt(d) * 1.1, 8.5);
          const dim = hover != null && r.id !== hover && !(hoverNeighbors?.has(r.id));
          return (
            <circle
              key={r.id}
              cx={p.x}
              cy={p.y}
              r={radius}
              fill={TIER_COLOR[r.tier] ?? "#8b949e"}
              opacity={dim ? 0.18 : 0.85}
              stroke={hover === r.id ? "var(--fg)" : "transparent"}
              strokeWidth={1.4}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                window.location.href = `${basePath}/invariants/${r.id}`;
              }}
            />
          );
        })}
      </svg>

      {hoverNode && hoverPos && (
        <div
          style={{
            position: "absolute",
            left: `calc(${(hoverPos.x / W) * 100}% + 10px)`,
            top: `calc(${(hoverPos.y / H) * 100}% + 10px)`,
            background: "var(--bg-elev2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            padding: "0.5rem 0.7rem",
            fontSize: "0.78rem",
            maxWidth: "min(28rem, 60%)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{hoverNode.id}</div>
          <div className="faint" style={{ margin: "0.2rem 0", fontSize: "0.72rem" }}>
            {hoverNode.tier} · {hoverNode.status} · {degree.get(hoverNode.id) ?? 0} refs
          </div>
          <div style={{ color: "var(--fg)" }}>
            {hoverNode.statement.length > 180
              ? hoverNode.statement.slice(0, 180) + "…"
              : hoverNode.statement}
          </div>
        </div>
      )}

      <div
        className="pill-row"
        style={{
          padding: "0.5rem 0.8rem",
          borderTop: "1px solid var(--border)",
          fontSize: "0.78rem",
          flexWrap: "wrap",
          gap: "0.5rem 1rem",
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
          · size = degree · hover for detail · click to open a rule
        </span>
      </div>
    </div>
  );
}
