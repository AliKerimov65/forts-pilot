// Список сделок журнала (journal.md §1): desktop — таблица с сортировкой (время/P&L/длительность,
// layout-переезд строк), mobile — карточки со свайпом влево «Подробнее» (жёлтая подложка).
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Bot, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import SwipeActionRow from '@/components/monitor/SwipeActionRow';
import { formatDateShort, formatNumber, formatSignedRub, formatTime } from '@/lib/format';
import { formatDuration, REASON_LABELS, type EnrichedTrade } from './journalUtils';

type SortKey = 'time' | 'pnl' | 'duration';
type SortDir = 'asc' | 'desc';

const REASON_VARIANT: Record<EnrichedTrade['reason'], 'long' | 'short' | 'info' | 'neutral'> = {
  tp: 'long',
  sl: 'short',
  signal: 'info',
  manual: 'neutral',
};

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onToggle,
  right,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: (k: SortKey) => void;
  right?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(k)}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors',
        sortKey === k ? 'text-yellow' : 'text-fg-muted hover:text-fg-secondary',
        right && 'flex-row-reverse',
      )}
    >
      {label}
      {sortKey === k && (sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );
}

export interface TradesListProps {
  trades: EnrichedTrade[];
  onOpen: (t: EnrichedTrade) => void;
  /** Активны ли фильтры (для текста пустого состояния) */
  filtersActive: boolean;
  onResetFilters: () => void;
}

export default function TradesList({ trades, onOpen, filtersActive, onResetFilters }: TradesListProps) {
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const arr = [...trades];
    const mul = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'time') return (a.time - b.time) * mul;
      if (sortKey === 'pnl') return ((a.pnl ?? 0) - (b.pnl ?? 0)) * mul;
      return (a.durationMs - b.durationMs) * mul;
    });
    return arr;
  }, [trades, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  if (trades.length === 0) {
    if (filtersActive) {
      return (
        <section className="rounded-xl border border-subtle bg-panel p-4">
          <EmptyState
            title="Ничего не найдено"
            subtitle="Попробуйте смягчить условия — сбросьте фильтры"
            actionLabel="Сбросить фильтры"
            onAction={onResetFilters}
          />
        </section>
      );
    }
    return (
      <section className="rounded-xl border border-subtle bg-panel p-4">
        <EmptyState image="/empty-journal.svg" imageAlt="Пустой журнал" title="Сделок пока нет" subtitle="Запустите робота или совершите сделку в терминале" />
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-subtle bg-panel">
      {/* ===== Mobile: карточки ===== */}
      <ul className="space-y-2 p-3 md:hidden">
        <AnimatePresence initial={false}>
          {sorted.map((t, i) => (
            <motion.li
              key={t.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.2 }}
            >
              <SwipeActionRow actionLabel="Подробнее" tone="accent" onAction={() => onOpen(t)}>
                <button type="button" onClick={() => onOpen(t)} className="w-full rounded-xl border border-subtle bg-panel-raised p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="mono text-sm font-semibold uppercase text-fg">{t.ticker}</span>
                      <Badge variant={t.direction === 'long' ? 'long' : 'short'}>{t.direction === 'long' ? 'Лонг' : 'Шорт'}</Badge>
                    </div>
                    <span className={cn('mono text-sm font-bold', (t.pnl ?? 0) >= 0 ? 'text-long' : 'text-short')}>
                      {formatSignedRub(Math.round(t.pnl ?? 0))}
                    </span>
                  </div>
                  <div className="mono mt-1.5 flex items-center justify-between text-[11px] text-fg-secondary">
                    <span>
                      {formatDateShort(t.time)} {formatTime(t.time)} · {t.lots} лот
                    </span>
                    <Badge variant={REASON_VARIANT[t.reason]}>{REASON_LABELS[t.reason]}</Badge>
                  </div>
                </button>
              </SwipeActionRow>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {/* ===== Desktop: таблица ===== */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left">
              <th className="px-4 py-2.5">
                <SortHeader label="Время" k="time" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              </th>
              <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Инструмент</th>
              <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Направление</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Лоты</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Вход</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Выход</th>
              <th className="px-4 py-2.5 text-right">
                <SortHeader label="P&L" k="pnl" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right />
              </th>
              <th className="px-4 py-2.5 text-right">
                <SortHeader label="Длительность" k="duration" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} right />
              </th>
              <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Источник</th>
              <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Закрытие</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {sorted.map((t, i) => (
                <motion.tr
                  key={t.id}
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.2 }}
                  onClick={() => onOpen(t)}
                  className={cn(
                    'group h-10 cursor-pointer border-t border-subtle transition-colors hover:bg-panel-raised',
                    i % 2 === 1 && 'bg-[rgba(255,255,255,0.02)]',
                  )}
                >
                  <td className="mono px-4 py-2 text-[12px] text-fg-secondary">
                    {formatDateShort(t.time)} <span className="text-fg-muted">{formatTime(t.time)}</span>
                  </td>
                  <td className="mono px-4 py-2 text-[13px] font-semibold uppercase text-fg">{t.ticker}</td>
                  <td className="px-4 py-2">
                    <Badge variant={t.direction === 'long' ? 'long' : 'short'}>{t.direction === 'long' ? 'Лонг' : 'Шорт'}</Badge>
                  </td>
                  <td className="mono px-4 py-2 text-right text-[13px] text-fg">{t.lots}</td>
                  <td className="mono px-4 py-2 text-right text-[13px] text-fg-secondary">{formatNumber(t.entryPrice)}</td>
                  <td className="mono px-4 py-2 text-right text-[13px] text-fg-secondary">{formatNumber(t.exitPrice)}</td>
                  <td
                    className={cn(
                      'mono px-4 py-2 text-right text-[13px] font-semibold transition-colors group-hover:brightness-125',
                      (t.pnl ?? 0) >= 0 ? 'text-long' : 'text-short',
                    )}
                  >
                    {formatSignedRub(Math.round(t.pnl ?? 0))}
                  </td>
                  <td className="mono px-4 py-2 text-right text-[12px] text-fg-secondary">{formatDuration(t.durationMs)}</td>
                  <td className="px-4 py-2">
                    {t.source === 'robot' ? (
                      <Badge variant="accent">
                        <Bot className="h-3 w-3" />
                        {t.robotName ?? 'Робот'}
                      </Badge>
                    ) : (
                      <Badge variant="neutral">
                        <Hand className="h-3 w-3" />
                        Ручная
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={REASON_VARIANT[t.reason]}>{REASON_LABELS[t.reason]}</Badge>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </section>
  );
}
