// Распределение сделок (journal.md §2.3): гистограмма P&L (20 корзин, центр 0,
// красные/зелёные бары) + плашки «Лучшая / Худшая / Самая долгая».
import { useMemo } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber, formatSignedRub } from '@/lib/format';
import { formatDuration, pnlHistogram, type EnrichedTrade, type JournalStats } from './journalUtils';

export interface DistributionPanelProps {
  trades: EnrichedTrade[];
  stats: JournalStats;
  onTradeClick: (t: EnrichedTrade) => void;
}

export default function DistributionPanel({ trades, stats, onTradeClick }: DistributionPanelProps) {
  const bins = useMemo(() => pnlHistogram(trades, 20), [trades]);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-subtle bg-panel p-4 md:p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <BarChart3 className="h-4 w-4 text-info" />
        Распределение
      </h3>

      {bins.length === 0 ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-fg-muted">Нет данных</div>
      ) : (
        <div className="mt-3 h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bins} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
              <XAxis hide dataKey="to" />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const b = payload[0].payload as { from: number; to: number; count: number };
                  return (
                    <div className="mono rounded-lg border border-subtle bg-panel-raised px-3 py-2 text-xs shadow-lg">
                      <span className="text-fg">{b.count} сделок</span>
                      <span className="text-fg-muted">
                        {': '}
                        {formatSignedRub(Math.round(b.from))}…{formatSignedRub(Math.round(b.to))}
                      </span>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]} animationDuration={400}>
                {bins.map((b, i) => (
                  <Cell key={i} fill={b.from >= 0 ? 'var(--long)' : b.to <= 0 ? 'var(--short)' : 'var(--warn)'} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mono mt-1 flex justify-between text-[10px] text-fg-muted">
        <span className="text-short">{bins.length > 0 ? formatNumber(Math.round(bins[0].from)) : ''}</span>
        <span>0</span>
        <span className="text-long">{bins.length > 0 ? `+${formatNumber(Math.round(bins[bins.length - 1].to))}` : ''}</span>
      </div>

      {/* Экстремумы */}
      <div className="mt-3 space-y-2">
        {stats.best && (
          <button
            type="button"
            onClick={() => onTradeClick(stats.best!)}
            className="flex w-full items-center justify-between rounded-[10px] border-l-[3px] border-l-long border border-subtle bg-inset px-3 py-2 text-left transition-colors hover:bg-panel-raised"
          >
            <span className="text-xs text-fg-secondary">
              Лучшая сделка <span className="mono ml-1 uppercase text-fg">{stats.best.ticker}</span>
            </span>
            <span className="mono text-xs font-bold text-long">{formatSignedRub(Math.round(stats.best.pnl ?? 0))}</span>
          </button>
        )}
        {stats.worst && (
          <button
            type="button"
            onClick={() => onTradeClick(stats.worst!)}
            className="flex w-full items-center justify-between rounded-[10px] border-l-[3px] border-l-short border border-subtle bg-inset px-3 py-2 text-left transition-colors hover:bg-panel-raised"
          >
            <span className="text-xs text-fg-secondary">
              Худшая сделка <span className="mono ml-1 uppercase text-fg">{stats.worst.ticker}</span>
            </span>
            <span className="mono text-xs font-bold text-short">{formatSignedRub(Math.round(stats.worst.pnl ?? 0))}</span>
          </button>
        )}
        {stats.longest && (
          <button
            type="button"
            onClick={() => onTradeClick(stats.longest!)}
            className={cn(
              'flex w-full items-center justify-between rounded-[10px] border border-subtle bg-inset px-3 py-2 text-left transition-colors hover:bg-panel-raised',
            )}
          >
            <span className="text-xs text-fg-secondary">
              Самая долгая <span className="mono ml-1 uppercase text-fg">{stats.longest.ticker}</span>
            </span>
            <span className="mono text-xs font-semibold text-fg">{formatDuration(stats.longest.durationMs)}</span>
          </button>
        )}
      </div>
    </section>
  );
}
