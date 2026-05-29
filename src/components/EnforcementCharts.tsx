interface Counts {
  [k: string]: number;
}

const STATUS_COLOR: Counts | Record<string, string> = {
  enforced: "#3fb950",
  partial: "#d29922",
  declared: "#8b949e",
  deprecated: "#6e7781",
};

function Bar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.2rem" }}>
        <span className="mono">{label}</span>
        <span className="muted">
          {value} <span className="faint">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div style={{ background: "var(--bg-elev2)", borderRadius: "4px", height: "8px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

export default function EnforcementCharts({
  byStatus,
  byTier,
  byFamily,
  total,
}: {
  byStatus: Counts;
  byTier: Counts;
  byFamily: Counts;
  total: number;
}) {
  // Known order first, then any unfamiliar keys (e.g. a newly-added tier) so
  // nothing the registry reports is silently dropped.
  const order = (counts: Counts, known: string[]) => {
    const present = Object.keys(counts).filter((k) => counts[k] != null);
    const head = known.filter((k) => present.includes(k));
    const tail = present.filter((k) => !known.includes(k)).sort();
    return [...head, ...tail];
  };
  const statusOrder = order(byStatus, ["enforced", "partial", "declared", "deprecated"]);
  const tierOrder = order(byTier, ["true", "derived", "release", "operational"]);
  const famOrder = order(byFamily, ["T", "DC", "CN", "RO", "OP"]);
  const tierMax = Math.max(...tierOrder.map((k) => byTier[k]), 1);
  const famMax = Math.max(...famOrder.map((k) => byFamily[k]), 1);

  return (
    <div className="grid cols-3">
      <div className="card">
        <h3>By status</h3>
        {statusOrder.map((k) => (
          <Bar key={k} label={k} value={byStatus[k]} total={total} color={(STATUS_COLOR as Record<string, string>)[k] ?? "#58a6ff"} />
        ))}
      </div>
      <div className="card">
        <h3>By tier</h3>
        {tierOrder.map((k) => (
          <Bar key={k} label={k} value={byTier[k]} total={tierMax} color="#58a6ff" />
        ))}
      </div>
      <div className="card">
        <h3>By family</h3>
        {famOrder.map((k) => (
          <Bar key={k} label={k} value={byFamily[k]} total={famMax} color="#a371f7" />
        ))}
      </div>
    </div>
  );
}
