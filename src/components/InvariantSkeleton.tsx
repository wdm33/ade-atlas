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

  // Tier filter — click a chip to hide that tier; click "tier:" to reset.
  // If the user turns the last one off we silently reset to all on so the
  // graph can never go empty (which would look like a regression).
  const ALL_TIERS = Object.keys(TIER_COLOR);
  const [activeTiers, setActiveTiers] = useState<Set<string>>(() => new Set(ALL_TIERS));
  const toggleTier = (t: string) => {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
        if (next.size === 0) return new Set(ALL_TIERS);
      } else {
        next.add(t);
      }
      return next;
    });
  };
  const resetTiers = () => setActiveTiers(new Set(ALL_TIERS));
  const allOn = activeTiers.size === ALL_TIERS.length;

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

  // Once the lib is ready: set the initial camera back so you see the whole
  // skeleton, then turn on auto-rotate. When the user touches the scene
  // (OrbitControls 'start' event), pause rotation and queue a resume 1 minute
  // later — the timer resets on every fresh interaction.
  useEffect(() => {
    let stopped = false;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let controlsRef: any = null;
    let onStart: (() => void) | null = null;

    const setup = () => {
      if (stopped) return;
      const fg = fgRef.current;
      const controls = fg?.controls?.();
      if (!fg || !controls) {
        requestAnimationFrame(setup);
        return;
      }
      fg.cameraPosition?.({ z: 3000 });
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      controlsRef = controls;
      onStart = () => {
        controls.autoRotate = false;
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
          if (!stopped) controls.autoRotate = true;
        }, 60_000);
      };
      controls.addEventListener?.("start", onStart);
    };
    setup();

    return () => {
      stopped = true;
      if (resumeTimer) clearTimeout(resumeTimer);
      if (controlsRef && onStart) controlsRef.removeEventListener?.("start", onStart);
    };
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

  const nodeMap = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);

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
          nodeVisibility={(n: any) => activeTiers.has(n.tier)}
          linkVisibility={(l: any) => {
            const sId = typeof l.source === "object" ? l.source.id : l.source;
            const tId = typeof l.target === "object" ? l.target.id : l.target;
            const s = nodeMap.get(sId);
            const t = nodeMap.get(tId);
            return !!s && !!t && activeTiers.has(s.tier) && activeTiers.has(t.tier);
          }}
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
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem 0.9rem",
          alignItems: "center",
        }}
      >
        <button
          onClick={resetTiers}
          title={allOn ? "all tiers visible" : "click to show all tiers"}
          className="faint"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
            font: "inherit",
            cursor: allOn ? "default" : "pointer",
            opacity: allOn ? 0.7 : 1,
          }}
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
        <span className="faint">· click a tier to toggle · size = degree · drag to rotate · scroll to zoom · click a node to open</span>
      </div>
    </div>
  );
}
