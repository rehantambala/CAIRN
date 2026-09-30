/**
 * The CAIRN mark: four balanced stones, drawn as ellipses so that it survives at favicon size.
 * `build` loops the stack assembling (used as the loading indicator); `settle` plays it once;
 * `sway` adds a barely perceptible balance motion. All motion is disabled under reduced-motion.
 */
export function Mark({ size = 40, mode = 'still', className = '' }: { size?: number; mode?: 'still' | 'settle' | 'build'; className?: string }) {
  const stones = [
    { cx: 32, cy: 52, rx: 25, ry: 9.5, r: 0 },
    { cx: 35, cy: 36, rx: 17.5, ry: 8.5, r: -5 },
    { cx: 30, cy: 21.5, rx: 11.5, ry: 6.8, r: 7 },
    { cx: 33, cy: 10, rx: 5.2, ry: 4.2, r: -8 },
  ];
  return (
    <svg className={`cairn cairn--${mode} ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {stones.map((s, i) => (
        <g key={i} className="cairn__s" style={{ ['--i' as string]: i }}>
          <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={`rotate(${s.r} ${s.cx} ${s.cy})`} fill="currentColor" stroke="var(--cairn-gap, var(--bg, #B7D7F5))" strokeWidth="2.4" />
          <path d={`M${s.cx - s.rx * 0.55} ${s.cy - s.ry * 0.25} q ${s.rx * 0.35} ${-s.ry * 0.55} ${s.rx * 0.8} ${-s.ry * 0.3}`} transform={`rotate(${s.r} ${s.cx} ${s.cy})`} fill="none" stroke="var(--cairn-glint, #F3F3E9)" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
        </g>
      ))}
    </svg>
  );
}
