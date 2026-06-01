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
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 960, height: 640 });
  const ALL_TIERS = Object.keys(TIER_COLOR);
  const [activeTiers, setActiveTiers] = useState<Set<string>>(() => new Set(ALL_TIERS));

  const nodeMap = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);

  const toggleTier = (t: string) => {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
        // If the user just turned the last one off, reset to all on so the
        // graph never goes empty.
        if (next.size === 0) return new Set(ALL_TIERS);
      } else {
        next.add(t);
      }
      return next;
    });
  };
  const resetTiers = () => setActiveTiers(new Set(ALL_TIERS));
  const allOn = activeTiers.size === ALL_TIERS.length;

  // Measure BEFORE first paint so the canvas isn't created at a stale size
  // (a 0-wide canvas can leave the scene visually frozen / off-center).
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const w = Math.floor(containerRef.current.clientWidth);
    const h = Math.min(Math.max(Math.round(w * 0.62), 480), 800);
    setSize({ width: w, height: h });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        const h = Math.min(Math.max(Math.round(w * 0.62), 480), 800);
        setSize({ width: w, height: h });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Gentle camera auto-rotate on first load so the scene reads as 3D
  // immediately; stops on first user interaction.
  useEffect(() => {
    if (!fgRef.current) return;
    let stopped = false;
    const tryHook = () => {
      const fg = fgRef.current;
      if (!fg) return;
      const controls = fg.controls?.();
      if (!controls) {
        // Controls may not be ready on the first tick; retry next frame.
        if (!stopped) requestAnimationFrame(tryHook);
        return;
      }
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      const stop = () => {
        controls.autoRotate = false;
        stopped = true;
      };
      controls.addEventListener?.("start", stop);
      // Also stop after a generous window so the scene settles even if the
      // user never touches it.
      setTimeout(stop, 14000);
    };
    tryHook();
    return () => {
      stopped = true;
    };
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
        ref={fgRef}
        graphData={graphData}
        width={size.width}
        height={size.height}
        backgroundColor="#0a0e14"
        showNavInfo={false}
        controlType="orbit"
        enableNavigationControls={true}
        enablePointerInteraction={true}
        warmupTicks={20}
        cooldownTicks={Infinity}
        cooldownTime={20000}
        nodeVisibility={(n: any) => activeTiers.has(n.tier)}
        linkVisibility={(l: any) => {
          const sId = typeof l.source === "object" ? l.source.id : l.source;
          const tId = typeof l.target === "object" ? l.target.id : l.target;
          const s = nodeMap.get(sId);
          const t = nodeMap.get(tId);
          return !!s && !!t && activeTiers.has(s.tier) && activeTiers.has(t.tier);
        }}
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
        <button
          onClick={resetTiers}
          title={allOn ? "all tiers visible" : "click to show all tiers"}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
            cursor: allOn ? "default" : "pointer",
            opacity: allOn ? 0.7 : 1,
            font: "inherit",
          }}
          className="faint"
        >
          tier:
        </button>
        {Object.entries(TIER_COLOR).map(([t, c]) => {
          const on = activeTiers.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleTier(t)}
              title={on ? `hide ${t} rules` : `show ${t} rules`}
              style={{
                background: "none",
                border: "none",
                padding: "0.05rem 0",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                font: "inherit",
                color: "inherit",
                opacity: on ? 1 : 0.35,
                textDecoration: on ? "none" : "line-through",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  background: c,
                  display: "inline-block",
                  boxShadow: on ? "none" : "inset 0 0 0 1px rgba(255,255,255,0.2)",
                }}
              ></span>
              {t}
            </button>
          );
        })}
        <span className="faint">
          · click a tier to toggle · size = degree · drag to rotate · scroll to zoom · right-drag to pan · click a node to open the rule
        </span>
      </div>
    </div>
  );
}
