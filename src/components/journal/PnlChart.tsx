// График накопленного P&L (journal.md §2.2): area-градиент по знаку,
// ромбы-маркеры лучшей/худшей сделки (клик → карточка сделки), переключатель ₽/%.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { formatDateShort, formatNumber, formatSignedRub, formatTime } from '@/lib/format';
import { cumulativePnl, type EnrichedTrade } from './journalUtils';

type Unit = 'rub' | 'pct';

interface ChartPoint {
  time: number;
  value: number;
  trade: EnrichedTrade;
}

export interface PnlChartProps {
  trades: EnrichedTrade[];
  best: EnrichedTrade | null;
  worst: EnrichedTrade | null;
  onTradeClick: (t: EnrichedTrade) => void;
}

export default function PnlChart({ trades, best, worst, onTradeClick }: PnlChartProps) {
  const [unit, setUnit] = useState<Unit>('rub');

  const base = useMemo(() => cumulativePnl(trades), [trades]);
  const totalAbs = Math.max(1, Math.abs(base.length > 0 ? base[base.length - 1].pnl : 0) || 1);

  const data: ChartPoint[] = useMemo(
    () =>
      base.map((p) => ({
        time: p.time,
        value: unit === 'rub' ? p.pnl : Math.round((p.pnl / totalAbs) * 10000) / 100,
        trade: p.trade,
      })),
    [base, unit, totalAbs],
  );

  const up = data.length > 1 ? data[data.length - 1].value >= data[0].value : true;
  const stroke = up ? 'var(--long)' : 'var(--short)';
  const gradFrom = up ? 'rgba(22,199,132,0.25)' : 'rgba(234,57,67,0.25)';

  const bestTime = best?.time;
  const worstTime = worst?.time;

  const fmtValue = (v: number) => (unit === 'rub' ? formatSignedRub(Math.round(v)) : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-subtle bg-panel p-4 md:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Накопленный P&L</h3>
        <div className="flex rounded-[10px] bg-inset p-0.5">
          {(
            [
              ['rub', '₽'],
              ['pct', '%'],
            ] as [Unit, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setUnit(v)}
              className={cn(
                'relative rounded-lg px-3 py-1 text-xs font-semibold transition-colors',
                unit === v ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {unit === v && (
                <motion.span
                  layoutId="pnl-unit"
                  className="absolute inset-0 rounded-lg border-b-2 border-yellow bg-panel-raised"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {data.length < 2 ? (
        <div className="flex h-[220px] items-center justify-center text-xs text-fg-muted">Недостаточно сделок для графика</div>
      ) : (
        <div className="mt-3 h-[220px] md:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pnlArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={gradFrom} />
                  <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(t: number) => formatDateShort(t)}
                tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(v: number) => (unit === 'rub' ? `${formatNumber(Math.round(v / 1000))}k` : `${v}%`)}
                tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as ChartPoint;
                  return (
                    <div className="rounded-lg border border-subtle bg-panel-raised px-3 py-2 text-xs shadow-lg">
                      <div className="mono text-fg-muted">
                        {formatDateShort(p.time)} {formatTime(p.time)}
                      </div>
                      <div className={cn('mono mt-0.5 font-bold', p.value >= 0 ? 'text-long' : 'text-short')}>
                        {fmtValue(p.value)}
                      </div>
                      <div className="mono mt-0.5 text-fg-secondary">
                        {p.trade.ticker} · {formatSignedRub(Math.round(p.trade.pnl ?? 0))}
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={1.8}
                fill="url(#pnlArea)"
                animationDuration={600}
                dot={(props) => {
                  const p = props.payload as ChartPoint;
                  const isBest = bestTime !== undefined && p.time === bestTime;
                  const isWorst = worstTime !== undefined && p.time === worstTime;
                  if (!isBest && !isWorst) return <g key={p.time} />;
                  const color = isBest ? 'var(--long)' : 'var(--short)';
                  return (
                    <g
                      key={p.time}
                      transform={`translate(${props.cx},${props.cy})`}
                      className="cursor-pointer"
                      onClick={() => onTradeClick(p.trade)}
                    >
                      <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill={color} stroke="var(--bg-app)" strokeWidth={1.5}>
                        <title>{`${isBest ? 'Лучшая' : 'Худшая'} сделка: ${formatSignedRub(Math.round(p.trade.pnl ?? 0))} · ${p.trade.ticker}`}</title>
                      </rect>
                    </g>
                  );
                }}
                activeDot={{ r: 3.5, fill: stroke, stroke: 'var(--bg-app)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
