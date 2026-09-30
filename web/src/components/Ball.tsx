/** Decorative tennis ball, drawn originally as a circle with two seams. Never carries meaning. */
export function Ball({ size = 96, rotate = 0, className = '', style }: { size?: number; rotate?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={`ball ${className}`} style={{ ['--r' as string]: `${rotate}deg`, width: size, height: size, ...style }} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="48" fill="#DFE84A" stroke="#1C3750" strokeWidth="2.5" />
      <path d="M14 20c22 10 22 50 0 60" fill="none" stroke="#F3F3E9" strokeWidth="5" strokeLinecap="round" />
      <path d="M86 20c-22 10-22 50 0 60" fill="none" stroke="#F3F3E9" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
