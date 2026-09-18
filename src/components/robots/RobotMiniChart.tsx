// Мини-график робота (design.md §2): линия цены + уровни сетки (grid) или
// EMA-линии и маркеры входов ▲▼ (signal). Чистый SVG, без библиотек.
import { useMemo } from 'react';
import type { Candle } from '@/types/market';
import type { Robot } from '@/types/robot';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { mockGetCandles } from '@/lib/tinvest/mock';
import { buildGridLevels } from '@/lib/robots/grid';
import { getGridRuntime, getSignalRuntime } from '@/lib/robots/engine';
import { emaSeries, timeframeToMs } from '@/lib/robots/signal';
import { getExtConfig } from '@/lib/robots/config';

const W = 300;
const H = 56;

function toPath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export default function RobotMiniChart({ robot, className }: { robot: Robot; className?: string }) {
  const storeCandles = useMarketStore((s) => s.candles[robot.instrumentId]);
  const trades = useTradingStore((s) => s.trades);
  // Подписка на ререндер раз в поллинг: котировка инструмента
  const quote = useMarketStore((s) => s.quotes[robot.instrumentId]);

  const candles: Candle[] = useMemo(() => {
    if (storeCandles && storeCandles.length >= 20) return storeCandles.slice(-80);
    return mockGetCandles(robot.instrumentId).slice(-80);
  }, [storeCandles, robot.instrumentId]);

  const model = useMemo(() => {
    if (candles.length < 2) return null;
    const prices = candles.map((c) => c.close);
    let min = Math.min(...prices);
    let max = Math.max(...prices);

    // Учитываем границы сетки, чтобы уровни попали в кадр
    let gridLevels: number[] = [];
    let holdingLevels: number[] = [];
    if (robot.strategy === 'grid' && robot.params.strategy === 'grid') {
      const p = robot.params.grid;
      gridLevels = buildGridLevels(p.lowerBound, p.upperBound, p.levels);
      const rt = getGridRuntime(robot.id);
      holdingLevels = rt ? rt.levels.filter((l) => l.holding).map((l) => l.price) : [];
      min = Math.min(min, p.lowerBound);
      max = Math.max(max, p.upperBound);
    }
    const pad = (max - min) * 0.08 || 1;
    min -= pad;
    max += pad;

    const x = (i: number) => (i / (prices.length - 1)) * W;
    const y = (v: number) => H - ((v - min) / (max - min)) * H;

    const linePts: Array<[number, number]> = prices.map((p, i) => [x(i), y(p)]);
    const up = prices[prices.length - 1] >= prices[0];

    // EMA-линии для сигнального
    let emaFastPath = '';
    let emaSlowPath = '';
    if (robot.strategy === 'signal') {
      const ext = getExtConfig(robot);
      const se = ext.signal!;
      const ef = emaSeries(prices, se.emaFast);
      const es = emaSeries(prices, se.emaSlow);
      emaFastPath = toPath(prices.map((_, i) => [x(i), y(ef[i])]));
      emaSlowPath = toPath(prices.map((_, i) => [x(i), y(es[i])]));
    }

    // Маркеры сделок робота в пределах окна графика
    const t0 = candles[0].time;
    const t1 = candles[candles.length - 1].time + timeframeToMs(robot.strategy === 'signal' && robot.params.strategy === 'signal' ? robot.params.signal.timeframe : '5m');
    const markers = trades
      .filter((t) => t.robotId === robot.id && t.time >= t0 && t.time <= t1)
      .slice(0, 12)
      .map((t) => ({
        x: ((t.time - t0) / (t1 - t0)) * W,
        y: y(t.price),
        dir: t.direction,
      }));

    // Текущая позиция сигнального (линия входа)
    let entryY: number | null = null;
    if (robot.strategy === 'signal') {
      const pos = getSignalRuntime(robot.id)?.position;
      if (pos) entryY = y(pos.entryPrice);
    }

    return {
      linePath: toPath(linePts),
      areaPath: `${toPath(linePts)} L${W},${H} L0,${H} Z`,
      up,
      gridLevels: gridLevels.map((v) => ({ y: y(v), holding: holdingLevels.includes(v) || closeToHeld(v, holdingLevels) })),
      emaFastPath,
      emaSlowPath,
      markers,
      entryY,
      lastY: y(prices[prices.length - 1]),
    };
    // quote в deps — перерисовка на каждый тик цены
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, robot, trades, quote]);

  if (!model) return <div className={className} style={{ height: H }} />;

  const stroke = model.up ? 'var(--long)' : 'var(--short)';
  const gradId = `rg-${robot.id}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: '100%', height: H, display: 'block' }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Уровни сетки */}
      {model.gridLevels.map((l, i) => (
        <line
          key={i}
          x1={0}
          x2={W}
          y1={l.y}
          y2={l.y}
          stroke={l.holding ? 'var(--long)' : 'var(--border-strong)'}
          strokeWidth={l.holding ? 1.5 : 1}
          strokeDasharray={l.holding ? undefined : '4 3'}
          opacity={l.holding ? 0.9 : 0.55}
        />
      ))}

      <path d={model.areaPath} fill={`url(#${gradId})`} />
      <path d={model.linePath} fill="none" stroke={stroke} strokeWidth={1.5} />

      {model.emaFastPath && (
        <path d={model.emaFastPath} fill="none" stroke="var(--accent-yellow)" strokeWidth={1} opacity={0.85} />
      )}
      {model.emaSlowPath && (
        <path d={model.emaSlowPath} fill="none" stroke="var(--info)" strokeWidth={1} opacity={0.85} />
      )}

      {/* Линия входа сигнального робота */}
      {model.entryY !== null && (
        <line x1={0} x2={W} y1={model.entryY} y2={model.entryY} stroke="var(--warn)" strokeWidth={1} strokeDasharray="6 3" />
      )}

      {/* Маркеры сделок */}
      {model.markers.map((m, i) =>
        m.dir === 'long' ? (
          <path key={i} d={`M${m.x},${m.y - 5} l3.4,6 h-6.8 Z`} fill="var(--long)" />
        ) : (
          <path key={i} d={`M${m.x},${m.y + 5} l3.4,-6 h-6.8 Z`} fill="var(--short)" />
        ),
      )}

      {/* Точка текущей цены */}
      <circle cx={W - 2} cy={model.lastY} r={2.4} fill={stroke} className="pulse-dot" />
    </svg>
  );
}

function closeToHeld(v: number, held: number[]): boolean {
  return held.some((h) => Math.abs(h - v) < 1e-9);
}
