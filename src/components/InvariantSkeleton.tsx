import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { Vector3 } from "three";

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
  // 30 ≈ the d3-force default; range drives both charge and link distance for a
  // visibly stronger tight↔spread effect than charge alone.
  const [spread, setSpread] = useState(30);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Bidirectional adjacency for the "show neighbor names on hover" labels.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [edges]);

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

  // Apply the spread slider to charge + link distance. Reheats the sim each
  // change so the new layout settles into place visibly.
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      const fg = fgRef.current;
      if (!fg) {
        if (!cancelled) requestAnimationFrame(apply);
        return;
      }
      const charge = fg.d3Force?.("charge");
      const link = fg.d3Force?.("link");
      if (!charge || !link) {
        if (!cancelled) requestAnimationFrame(apply);
        return;
      }
      charge.strength(-spread);
      link.distance(15 + spread * 0.4); // 19 (tight) … 95 (wide)
      fg.d3ReheatSimulation?.();
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [spread]);

  // Neighbor name labels as HTML overlays, projected from the 3D scene each
  // animation frame. Rendering as DOM (instead of three.js sprites) keeps
  // them always-on-top with constant screen size, like the main tooltip.
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const neighborIds = useMemo(() => {
    if (!hoveredId) return [] as string[];
    return [...(adjacency.get(hoveredId) ?? [])];
  }, [hoveredId, adjacency]);

  useEffect(() => {
    if (!hoveredId) return;
    let raf = 0;
    const projector = new Vector3();
    // The library mutates the node objects we passed in (graphData.nodes)
    // with .x / .y / .z each tick, so the closure array is the live source.
    const nodesById = new Map<string, any>();
    for (const n of graphData.nodes) nodesById.set(n.id, n);
    const tick = () => {
      const fg = fgRef.current;
      const container = containerRef.current;
      const camera = fg?.camera?.();
      if (camera && container) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        for (const id of neighborIds) {
          const node = nodesById.get(id);
          const el = labelRefs.current[id];
          if (!el) continue;
          if (!node || node.x == null) {
            el.style.opacity = "0";
            continue;
          }
          projector.set(node.x, node.y, node.z ?? 0).project(camera);
          if (projector.z >= 1) {
            el.style.opacity = "0";
            continue;
          }
          const sx = (projector.x * 0.5 + 0.5) * w;
          const sy = (-projector.y * 0.5 + 0.5) * h;
          el.style.transform = `translate(-50%, -120%) translate(${sx}px, ${sy}px)`;
          el.style.opacity = "1";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hoveredId, neighborIds, graphData]);

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
    // val drives sphere volume; the renderer takes the cube root for radius.
    // Linear-in-degree gives a ~4× radius spread across the registry, so hubs
    // are obviously larger than leaves instead of all looking the same.
    const nodes = rules.map((r) => ({
      ...r,
      val: 1 + (degree.get(r.id) ?? 0) * 2.4,
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
          setHoveredId(n ? n.id : null);
        }}
      />

      {/* Neighbor name labels as an HTML overlay over the canvas, projected
          from 3D positions each frame. Always on top, constant screen size. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          // Stop just above the legend bar so labels don't overlap controls.
          bottom: 44,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 5,
        }}
      >
        {neighborIds.map((id) => (
          <div
            key={id}
            ref={(el) => {
              labelRefs.current[id] = el;
            }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              padding: "2px 7px",
              fontFamily: "var(--mono)",
              fontSize: "0.74rem",
              color: "#e6edf3",
              background: "rgba(13,17,23,0.92)",
              border: "1px solid var(--accent-dim, #1f6feb)",
              borderRadius: 4,
              boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
              whiteSpace: "nowrap",
              opacity: 0,
              transform: "translate(-50%, -120%) translate(-9999px, -9999px)",
              willChange: "transform, opacity",
              transition: "opacity 60ms linear",
            }}
          >
            {id}
          </div>
        ))}
      </div>

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
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", marginLeft: "0.5rem" }}>
          <span className="faint">spread:</span>
          <span className="faint" style={{ fontSize: "0.72rem" }}>tight</span>
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={spread}
            onChange={(e) => setSpread(Number(e.target.value))}
            aria-label="Layout spread"
            title="Adjust node repulsion + edge length"
            style={{ width: 110, accentColor: "var(--accent)" }}
          />
          <span className="faint" style={{ fontSize: "0.72rem" }}>spread</span>
        </span>
        <span className="faint">
          · click a tier to toggle · size = degree · drag to rotate · scroll to zoom · right-drag to pan · click a node to open the rule
        </span>
      </div>
    </div>
  );
}
