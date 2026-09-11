interface SparklineProps {
  points: number[];
  color: string;
  max?: number;
  height?: number;
}

export default function Sparkline({ points, color, max = 100, height = 32 }: SparklineProps) {
  if (points.length < 2) {
    return <div style={{ height }} />;
  }

  const width = 120;
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - (Math.min(p, max) / max) * height;
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
