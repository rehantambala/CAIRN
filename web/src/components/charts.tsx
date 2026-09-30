import { fmt, signed } from '../format';

export function LineChart({ points }: { points: { x: string; y: number }[] }) {
  const W = 960, H = 320, P = 40;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = Math.max(1, max - min);
  const X = (i: number) => P + (i / Math.max(1, points.length - 1)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score from ${fmt(points[0].y)} to ${fmt(last.y)} over ${points.length} days`} className="chart">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeWidth="1" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <circle cx={X(points.length - 1)} cy={Y(last.y)} r="8" fill="var(--color-ball)" stroke="currentColor" strokeWidth="2" />
        <text x={P} y={22} fontSize="18" fill="currentColor">{fmt(max)}</text>
        <text x={P} y={H - 12} fontSize="18" fill="currentColor">{fmt(min)}</text>
        <text x={W - P} y={H - 12} fontSize="18" fill="currentColor" textAnchor="end">{last.x}</text>
      </svg>
    </figure>
  );
}

export function Bars({ data }: { data: { k: string; v: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.v)));
  return (
    <div className="bars" role="img" aria-label={`Daily score gain, maximum ${fmt(max)}`}>
      {data.map((d) => <div key={d.k} className="bars__col" title={`${d.k}: ${signed(d.v)}`}><div className="bars__bar" style={{ height: `${Math.max(2, (Math.abs(d.v) / max) * 100)}%` }} /></div>)}
    </div>
  );
}
