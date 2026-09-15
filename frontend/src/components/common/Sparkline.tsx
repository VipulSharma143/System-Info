interface SparklineProps {
  points: number[];
  color: string;
  /**
   * Upper bound of the y-axis. Defaults to 100 because most callers plot
   * percentages. Pass "auto" for unbounded series (network throughput,
   * for example) — a fixed 100 would clamp every point to the ceiling and
   * flatten the line into a solid block.
   */
  max?: number | 'auto';
  height?: number;
}

export default function Sparkline({ points, color, max = 100, height = 32 }: SparklineProps) {
  if (points.length < 2) {
    return <div style={{ height }} />;
  }

  // Auto-scale to the series' own peak, with a small headroom factor so the
  // line doesn't sit flush against the top edge. Guarded against an
  // all-zero series, which would otherwise divide by zero.
  const resolvedMax =
    max === 'auto' ? Math.max(...points) * 1.15 || 1 : max;

  const width = 120;
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - (Math.min(p, resolvedMax) / resolvedMax) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className="overflow-visible"
      aria-hidden="true"
    >
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
