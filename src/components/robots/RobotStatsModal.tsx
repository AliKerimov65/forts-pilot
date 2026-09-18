// Модалка статистики робота: equity-спарклайн, win-rate, профит-фактор,
// последние сделки, ссылка на журнал (фильтр по роботу).
import { useMemo } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import type { Robot } from '@/types/robot';
import RobotStatusDot from '@/components/RobotStatusDot';
import Sparkline from '@/components/Sparkline';
import { formatRub, formatSignedRub, formatTime } from '@/lib/format';
import { synthPnlSeries } from './utils';
import { useTradingStore } from '@/store/trading';
import { cn } from '@/lib/utils';

export default function RobotStatsModal({
  robot,
  open,
  onOpenChange,
}: {
  robot: Robot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trades = useTradingStore((s) => s.trades);
  const robotTrades = useMemo(() => trades.filter((t) => t.robotId === robot.id).slice(0, 10), [trades, robot.id]);

  const stats = useMemo(() => {
    const equity = synthPnlSeries(robot.id, robot.stats.totalPnl, 40, 0.42);
    const closed = robotTrades.filter((t) => t.pnl !== undefined);
    const grossWin = closed.filter((t) => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
    const grossLoss = Math.abs(closed.filter((t) => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    return { equity, profitFactor };
  }, [robot.id, robot.stats.totalPnl, robotTrades]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(4,6,10,0.7)] backdrop-blur-[8px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            className="max-h-[86dvh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-subtle bg-panel-raised p-5 sm:rounded-xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <RobotStatusDot status={robot.status} />
              <h3 className="flex-1 truncate text-lg font-bold text-fg">{robot.name}</h3>
              <span className="mono text-xs uppercase text-fg-muted">{robot.ticker}</span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Metric label="P&L всего" value={formatSignedRub(robot.stats.totalPnl, 0)} positive={robot.stats.totalPnl >= 0} />
              <Metric label="Win-rate" value={`${(robot.stats.winRate * 100).toFixed(0)}%`} positive={robot.stats.winRate >= 0.5} />
              <Metric
                label="Профит-фактор"
                value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
                positive={stats.profitFactor >= 1}
              />
            </div>

            <div className="mt-4 rounded-lg border border-subtle bg-inset p-3">
              <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-fg-muted">Equity робота (30д)</div>
              <Sparkline data={stats.equity} width={440} height={72} positive={robot.stats.totalPnl >= 0} className="w-full" />
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-fg-muted">Сделки робота</div>
              {robotTrades.length === 0 ? (
                <div className="rounded-lg border border-dashed border-subtle p-4 text-center text-xs text-fg-muted">
                  Сделок пока нет — робот ждёт сигнала
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="pb-1 font-medium">Время</th>
                      <th className="pb-1 font-medium">Сторона</th>
                      <th className="pb-1 text-right font-medium">Лоты</th>
                      <th className="pb-1 text-right font-medium">Цена</th>
                      <th className="pb-1 text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {robotTrades.map((t) => (
                      <tr key={t.id} className="border-t border-subtle/60">
                        <td className="mono py-1.5 text-fg-secondary">{formatTime(t.time)}</td>
                        <td className={cn('py-1.5 font-medium', t.direction === 'long' ? 'text-long' : 'text-short')}>
                          {t.direction === 'long' ? 'Buy' : 'Sell'}
                        </td>
                        <td className="mono py-1.5 text-right text-fg">{t.lots}</td>
                        <td className="mono py-1.5 text-right text-fg">{formatRub(t.price, 2)}</td>
                        <td
                          className={cn(
                            'mono py-1.5 text-right',
                            t.pnl === undefined ? 'text-fg-muted' : t.pnl >= 0 ? 'text-long' : 'text-short',
                          )}
                        >
                          {t.pnl === undefined ? '—' : formatSignedRub(t.pnl, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <Link
              to="/journal"
              className="mt-4 block rounded-[10px] border border-subtle py-2.5 text-center text-sm font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg"
            >
              Все сделки в журнале
            </Link>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="rounded-lg border border-subtle bg-panel p-3">
      <div className="text-[10px] uppercase tracking-[0.08em] text-fg-muted">{label}</div>
      <div className={cn('mono mt-0.5 text-sm font-bold', positive ? 'text-long' : 'text-short')}>{value}</div>
    </div>
  );
}
