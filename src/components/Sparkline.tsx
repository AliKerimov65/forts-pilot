// Sparkline / MiniChart — SVG линия 1.5px + area-градиент по знаку (design.md §5)
import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SparklineProps {
  /** Ряд значений */
  data: number[];
  width?: number;
  height?: number;
  /** Принудительный знак; по умолчанию — по (last - first) */
  positive?: boolean;
  className?: string;
}

export default function Sparkline({ data, width = 96, height = 28, positive, className }: SparklineProps) {
  const gid = useId();
  if (data.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }
  const isUp = positive ?? data[data.length - 1] >= data[0];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => [i * stepX, height - 2 - ((v - min) / range) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = isUp ? 'var(--long)' : 'var(--short)';
  const gradFrom = isUp ? 'rgba(22,199,132,0.25)' : 'rgba(234,57,67,0.25)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('block', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradFrom} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
