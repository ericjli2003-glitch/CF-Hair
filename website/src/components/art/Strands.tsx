// Flowing "hair strand" line art, generated deterministically.
export function Strands({
  count = 22,
  className = "",
  stroke = "url(#strandGrad)",
  animate = true,
  seed = 1,
  width = 400,
  height = 600,
}: {
  count?: number;
  className?: string;
  stroke?: string;
  animate?: boolean;
  seed?: number;
  width?: number;
  height?: number;
}) {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x0 = -40 + t * (width * 0.55) + Math.sin(seed + i) * 6;
    const y0 = -20;
    const sway = 90 + 60 * Math.sin(seed * 1.7 + t * 3.1);
    const c1x = x0 + sway;
    const c1y = height * 0.28 + 30 * Math.cos(t * 4 + seed);
    const c2x = x0 - sway * 0.6 + width * 0.45;
    const c2y = height * 0.62 + 40 * Math.sin(t * 5 + seed);
    const x1 = x0 + width * 0.6 + 50 * Math.sin(t * 2.2 + seed);
    const y1 = height + 30;
    paths.push(`M${x0.toFixed(1)},${y0} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x1.toFixed(1)},${y1}`);
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="strandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dcc6" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#d9a67c" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f3e3d3" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          pathLength={1}
          fill="none"
          stroke={stroke}
          strokeWidth={i % 5 === 0 ? 1.6 : 0.8}
          strokeLinecap="round"
          className={animate ? "strand animate-draw" : undefined}
          style={animate ? { animationDelay: `${200 + i * 70}ms` } : undefined}
        />
      ))}
    </svg>
  );
}
