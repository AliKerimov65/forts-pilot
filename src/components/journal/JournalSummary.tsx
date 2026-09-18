// Ряд сводки журнала (journal.md §2.1): Чистый P&L, Сделок, Win-rate, Профит-фактор, Средняя сделка.
// Mobile — горизонтальная карусель карточек.
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import StatCard from '@/components/StatCard';
import { formatSignedRub } from '@/lib/format';
import type { JournalStats } from './journalUtils';

export default function JournalSummary({ stats }: { stats: JournalStats }) {
  const deltaPrev =
    stats.prevNetPnl !== null && stats.prevNetPnl !== 0
      ? `${stats.netPnl >= stats.prevNetPnl ? '+' : ''}${Math.round(((stats.netPnl - stats.prevNetPnl) / Math.abs(stats.prevNetPnl)) * 100)}% к прошлому периоду`
      : undefined;

  const cards = [
    <StatCard
      key="pnl"
      label="Чистый P&L"
      value={
        <span className={stats.netPnl >= 0 ? 'text-long' : 'text-short'}>{formatSignedRub(Math.round(stats.netPnl))}</span>
      }
      delta={deltaPrev}
      deltaPositive={stats.prevNetPnl !== null ? stats.netPnl >= stats.prevNetPnl : undefined}
      className="min-w-[210px] snap-start"
    />,
    <StatCard
      key="count"
      label="Сделок"
      value={<span className="mono">{stats.count}</span>}
      footer={`${stats.wins} прибыльных / ${stats.losses} убыточных`}
      className="min-w-[210px] snap-start"
    />,
    <StatCard
      key="wr"
      label="Win-rate"
      value={`${(stats.winRate * 100).toFixed(1).replace('.', ',')}%`}
      sparkline={stats.winRateSpark.length > 1 ? stats.winRateSpark : undefined}
      footer="доля прибыльных сделок"
      className="min-w-[210px] snap-start"
    />,
    <StatCard
      key="pf"
      label="Профит-фактор"
      value={stats.profitFactor === null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2).replace('.', ',')}
      footer="валовая прибыль / валовой убыток"
      className="min-w-[210px] snap-start"
    />,
    <StatCard
      key="avg"
      label="Средняя сделка"
      value={
        <span className={stats.avgTrade >= 0 ? 'text-long' : 'text-short'}>{formatSignedRub(Math.round(stats.avgTrade))}</span>
      }
      delta={`Средний R:R ${stats.rr}`}
      footer={
        stats.streak !== 0
          ? `Серия: ${Math.abs(stats.streak)} ${stats.streak > 0 ? 'прибыльных' : 'убыточных'} подряд`
          : 'Серии нет'
      }
      className="min-w-[210px] snap-start"
    />,
  ];

  return (
    <>
      {/* Mobile: карусель */}
      <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 md:hidden">
        {cards.map((c, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="shrink-0"
          >
            {c}
          </motion.div>
        ))}
      </div>
      {/* Desktop: 5 в ряд */}
      <div className={cn('hidden gap-3 md:grid md:grid-cols-3 xl:grid-cols-5')}>
        {cards.map((c, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
          >
            {c}
          </motion.div>
        ))}
      </div>
    </>
  );
}
