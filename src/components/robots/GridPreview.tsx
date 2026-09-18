// Живое grid-превью конструктора (design.md robots §4, шаг 2): мини-график цены
// с отрисованными уровнями сетки, перестраивается tween 250ms при смене параметров,
// линия текущей цены пульсирует.
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { mockGetCandles } from '@/lib/tinvest/mock';
import { buildGridLevels } from '@/lib/robots/grid';

const W = 320;
const H = 180;

export default function GridPreview({
  instrumentId,
  lowerBound,
  upperBound,
  levels,
  currentPrice,
  height = H,
}: {
  instrumentId: string | null;
  lowerBound: number;
  upperBound: number;
  levels: number;
  currentPrice: number | null;
  height?: number;
}) {
  const candles = useMemo(
    () => (instrumentId ? mockGetCandles(instrumentId).slice(-90) : []),
    [instrumentId],
  );

  const model = useMemo(() => {
    if (candles.length < 2) return null;
    const prices = candles.map((c) => c.close);
    let min = Math.min(...prices, lowerBound);
    let max = Math.max(...prices, upperBound);
    const pad = (max - min) * 0.06 || 1;
    min -= pad;
    max += pad;
    const y = (v: number) => H - ((v - min) / (max - min)) * H;
    const pts = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (prices.length - 1)) * W).toFixed(1)},${y(p).toFixed(1)}`);
    const gridYs = buildGridLevels(lowerBound, upperBound, levels).map(y);
    return {
      line: pts.join(' '),
      gridYs,
      priceY: currentPrice ? y(currentPrice) : null,
      up: prices[prices.length - 1] >= prices[0],
    };
  }, [candles, lowerBound, upperBound, levels, currentPrice]);

  if (!model) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-subtle text-xs text-fg-muted"
        style={{ height }}
      >
        Выберите инструмент для превью сетки
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden>
      <path d={model.line} fill="none" stroke={model.up ? 'var(--long)' : 'var(--short)'} strokeWidth={1.4} opacity={0.9} />
      {model.gridYs.map((y, i) => (
        <motion.line
          key={i}
          x1={0}
          x2={W}
          initial={false}
          animate={{ y1: y, y2: y }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          stroke="var(--accent-yellow)"
          strokeOpacity={0.55}
          strokeWidth={1}
          strokeDasharray="5 4"
        />
      ))}
      {model.priceY !== null && (
        <motion.line
          x1={0}
          x2={W}
          initial={false}
          animate={{ y1: model.priceY, y2: model.priceY }}
          transition={{ duration: 0.25 }}
          stroke="var(--text-primary)"
          strokeWidth={1.2}
          className="pulse-dot"
        />
      )}
    </svg>
  );
}
