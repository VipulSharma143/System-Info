import { memo, useId } from 'react';

interface SparklineProps {
  points: number[];
  color: string;
  /** Upper bound of the y-axis. 100 for percentages; "auto" scales to the series' own peak. */
  max?: number | 'auto';
  height?: number;
  /** Mark the latest reading with a dot. */
  dot?: boolean;
  strokeWidth?: number;
}

const WIDTH = 240;

// Smooth area line. Memoised: charts re-render only when their own series actually changed.
function Sparkline({ points, color, max = 100, height = 32, dot = false, strokeWidth = 2 }: SparklineProps) {
  const gradientId = useId();
  if (points.length < 2) return <div style={{ height }} />;

  // Headroom keeps the line off the top edge; the guard avoids dividing by zero for an all-zero series.
  const ceiling = max === 'auto' ? Math.max(...points) * 1.15 || 1 : max;
  const pad = strokeWidth + 1;
  const usable = height - pad * 2;
  const step = WIDTH / (points.length - 1);
  const coords = points.map((p, i) => [i * step, pad + usable - (Math.min(p, ceiling) / ceiling) * usable] as const);

  // Quadratic midpoints give a soft curve without overshooting the data.
  let path = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const [px, py] = coords[i - 1];
    const [x, y] = coords[i];
    path += ` Q${px.toFixed(1)},${py.toFixed(1)} ${((px + x) / 2).toFixed(1)},${((py + y) / 2).toFixed(1)}`;
  }
  const [lx, ly] = coords[coords.length - 1];
  path += ` L${lx.toFixed(1)},${ly.toFixed(1)}`;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${path} L${WIDTH},${height} L0,${height} Z`} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* A zero-length round-capped line stays a true circle even though the viewBox is stretched. */}
      {dot && <path d={`M${lx},${ly} h0.01`} stroke={color} strokeWidth={9} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export default memo(Sparkline);
