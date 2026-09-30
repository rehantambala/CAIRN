import { useMemo } from 'react';

/**
 * Ambient contour field: concentric, irregular rings that drift against one another at different
 * speeds, like survey lines on a hillside. Deterministic, decorative, and never carries meaning.
 */
function ring(k: number, cx: number, cy: number) {
  const n = 84;
  const base = 70 + k * 58;
  const ph = k * 1.37;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.085 * Math.sin(3 * t + ph) + 0.05 * Math.sin(5 * t + 2.1 * ph) + 0.03 * Math.sin(8 * t + 3.3 * ph);
    pts.push([cx + base * 1.75 * wobble * Math.cos(t), cy + base * 0.95 * wobble * Math.sin(t)]);
  }
  // Closed Catmull-Rom spline converted to cubic Béziers.
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

export function Contours({ className = '' }: { className?: string }) {
  const rings = useMemo(() => Array.from({ length: 13 }, (_, k) => ({
    d: ring(k, 800, 450), dur: 26 + ((k * 7) % 19), dir: k % 2 ? 1 : -1, op: Math.max(0.05, 0.21 - k * 0.012),
  })), []);
  return (
    <svg className={`contours ${className}`} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {rings.map((r, i) => (
        <path key={i} d={r.d} className="contours__r" style={{ ['--dur' as string]: `${r.dur}s`, ['--dir' as string]: r.dir, opacity: r.op }} />
      ))}
    </svg>
  );
}
