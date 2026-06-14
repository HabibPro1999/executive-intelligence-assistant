'use client';

export type ChartSpec = {
  kind: 'bar' | 'grouped-bar' | 'line';
  title: string;
  xLabel?: string;
  yLabel?: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
};

// Tasteful, consulting-grade palette. Cycles for >palette.length series.
const PALETTE = [
  '#1d4ed8', // brand
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#ec4899',
];

const isFiniteNum = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

// "Nice" round number for axis ticks so gridlines read cleanly.
function niceCeil(value: number): number {
  if (!isFiniteNum(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const frac = value / base;
  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function formatTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

export default function ChartBlock({ spec }: { spec: ChartSpec }) {
  // ---- Bullet-proof guards: never throw on untrusted LLM output. ----
  if (!spec || typeof spec !== 'object') return null;

  const categories = Array.isArray(spec.categories) ? spec.categories : [];
  const rawSeries = Array.isArray(spec.series) ? spec.series : [];
  if (categories.length === 0 || rawSeries.length === 0) return null;

  const kind: ChartSpec['kind'] =
    spec.kind === 'line' || spec.kind === 'grouped-bar' ? spec.kind : 'bar';

  // Sanitize series: keep only those with at least one finite value; clamp
  // each series' value array to the number of categories.
  const series = rawSeries
    .filter((s) => s && Array.isArray(s.values))
    .map((s) => ({
      name: typeof s.name === 'string' && s.name ? s.name : 'Series',
      values: categories.map((_, i) => {
        const v = s.values[i];
        return isFiniteNum(v) ? v : 0;
      }),
      hasFinite: s.values.some(isFiniteNum),
    }))
    .filter((s) => s.hasFinite);

  if (series.length === 0) return null;

  // Compute data range. Support negative values by tracking both bounds.
  let dataMin = 0;
  let dataMax = 0;
  let anyFinite = false;
  for (const s of series) {
    for (const v of s.values) {
      if (!isFiniteNum(v)) continue;
      anyFinite = true;
      if (v > dataMax) dataMax = v;
      if (v < dataMin) dataMin = v;
    }
  }
  if (!anyFinite) return null;

  // Avoid divide-by-zero on a flat/zero dataset.
  const yTop = dataMax > 0 ? niceCeil(dataMax) : dataMax === 0 && dataMin === 0 ? 1 : 0;
  const yBottom = dataMin < 0 ? -niceCeil(-dataMin) : 0;
  const range = yTop - yBottom;
  const safeRange = range > 0 ? range : 1;

  const multi = series.length > 1;
  const isLine = kind === 'line';
  const grouped = kind === 'grouped-bar' || (kind === 'bar' && multi);

  // ---- Geometry (viewBox units; SVG scales responsively). ----
  const W = 720;
  const H = 360;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 56;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const yToPx = (v: number) => padT + plotH - ((v - yBottom) / safeRange) * plotH;
  const zeroY = yToPx(0);

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => yBottom + (range * i) / tickCount);

  const slotW = plotW / categories.length;
  const xCenter = (i: number) => padL + slotW * (i + 0.5);

  const seriesColor = (i: number) => PALETTE[i % PALETTE.length];

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="mb-1 text-sm font-semibold text-ink">{spec.title || 'Chart'}</h4>

      {multi && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s, i) => (
            <span key={`${s.name}-${i}`} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: seriesColor(i) }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={spec.title || 'Chart'}
        className="block h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* y gridlines + tick labels */}
        {ticks.map((t, i) => {
          const y = yToPx(t);
          return (
            <g key={`tick-${i}`}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="#64748b"
              >
                {formatTick(t)}
              </text>
            </g>
          );
        })}

        {/* zero baseline emphasis when range crosses zero */}
        {yBottom < 0 && (
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="#cbd5e1" strokeWidth={1.5} />
        )}

        {/* y axis label */}
        {spec.yLabel && (
          <text
            transform={`translate(14 ${padT + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={11}
            fill="#475569"
          >
            {spec.yLabel}
          </text>
        )}

        {/* bars or lines */}
        {isLine
          ? series.map((s, si) => {
              const color = seriesColor(si);
              const pts = s.values.map((v, ci) => `${xCenter(ci)},${yToPx(v)}`).join(' ');
              return (
                <g key={`line-${si}`}>
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {s.values.map((v, ci) => (
                    <circle key={`dot-${si}-${ci}`} cx={xCenter(ci)} cy={yToPx(v)} r={2.5} fill={color} />
                  ))}
                </g>
              );
            })
          : categories.map((_, ci) => {
              const groupCount = grouped ? series.length : 1;
              const groupPad = slotW * 0.18;
              const groupW = slotW - groupPad * 2;
              const barW = groupW / groupCount;
              const x0 = padL + slotW * ci + groupPad;
              return (
                <g key={`group-${ci}`}>
                  {series.slice(0, groupCount).map((s, si) => {
                    const v = s.values[ci];
                    const yv = yToPx(v);
                    const top = Math.min(yv, zeroY);
                    const height = Math.abs(yv - zeroY);
                    return (
                      <rect
                        key={`bar-${ci}-${si}`}
                        x={x0 + barW * si}
                        y={top}
                        width={Math.max(barW - 2, 1)}
                        height={Math.max(height, 0)}
                        rx={2}
                        fill={seriesColor(si)}
                      />
                    );
                  })}
                </g>
              );
            })}

        {/* x category labels */}
        {categories.map((c, ci) => (
          <text
            key={`xlab-${ci}`}
            x={xCenter(ci)}
            y={padT + plotH + 16}
            textAnchor="middle"
            fontSize={10}
            fill="#64748b"
          >
            {String(c).length > 14 ? `${String(c).slice(0, 13)}…` : String(c)}
          </text>
        ))}

        {/* x axis label */}
        {spec.xLabel && (
          <text
            x={padL + plotW / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={11}
            fill="#475569"
          >
            {spec.xLabel}
          </text>
        )}
      </svg>
    </div>
  );
}
