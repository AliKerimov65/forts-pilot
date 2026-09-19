// Нижние табы центра терминала: Ордера / Позиции / Сделки / Сетка робота (terminal.md §2.5)
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { History, Inbox, Layers, LayoutGrid, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import NavBadge from '@/components/NavBadge';
import PriceTicker from '@/components/PriceTicker';
import { formatTime } from '@/lib/format';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import type { Instrument } from '@/types/market';
import type { Order, Position } from '@/types/trading';
import type { Robot } from '@/types/robot';
import { fmtPrice, futuresLabel } from './utils';

export interface CenterTabsProps {
  instrument: Instrument | null;
  gridRobot: Robot | null;
  onCancelOrder: (order: Order) => void;
  onClosePosition: (position: Position) => void;
  className?: string;
}

const STATUS_LABEL: Record<Order['status'], string> = {
  new: 'Активен',
  partially_filled: 'Частично',
  filled: 'Исполнен',
  cancelled: 'Отменён',
  rejected: 'Отклонён',
};

export default function CenterTabs({ instrument, gridRobot, onCancelOrder, onClosePosition, className }: CenterTabsProps) {
  const orders = useTradingStore((s) => s.orders);
  const positions = useTradingStore((s) => s.positions);
  const trades = useTradingStore((s) => s.trades);
  const quotes = useMarketStore((s) => s.quotes);
  const uid = instrument?.uid;

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === 'new' || o.status === 'partially_filled'),
    [orders],
  );
  const instrumentOrders = uid ? activeOrders.filter((o) => o.instrumentId === uid) : activeOrders;
  const [tab, setTab] = useState<'orders' | 'positions' | 'trades' | 'grid'>('orders');

  const gridLevels = useMemo(() => {
    if (!gridRobot || gridRobot.strategy !== 'grid' || !('grid' in gridRobot.params)) return [];
    const g = gridRobot.params.grid;
    if (g.levels < 2) return [g.lowerBound];
    const arr: number[] = [];
    for (let i = 0; i < g.levels; i++) arr.push(g.lowerBound + ((g.upperBound - g.lowerBound) * i) / (g.levels - 1));
    return arr;
  }, [gridRobot]);

  // v2 §5.2.5: счётчики — бейджами mono 11px bg-panel-raised рядом с подписью таба
  const tabs = [
    { key: 'orders' as const, label: 'Ордера', count: activeOrders.length },
    { key: 'positions' as const, label: 'Позиции', count: positions.length },
    { key: 'trades' as const, label: 'Сделки', count: undefined },
    { key: 'grid' as const, label: 'Сетка робота', count: undefined },
  ];

  // Таблицы по спецификации v2 §2.3: заголовок 36px caption 11px, числа вправо mono, строки 40px
  const thCls = 'mono h-9 px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted text-right first:text-left';
  const tdCls = 'mono px-2 py-2 text-[12px] text-fg text-right';

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex gap-1 border-b border-subtle px-2 pt-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-t-[8px] px-3 pb-2 pt-1.5 text-[12px] font-semibold transition-colors duration-[120ms]',
              tab === t.key ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {t.label}
            {t.count !== undefined && <NavBadge kind="count" count={t.count} variant="neutral" />}
            {tab === t.key && (
              <motion.span layoutId="center-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-yellow" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'orders' && (
          <table className="w-full">
            <thead className="sticky top-0 z-[5] bg-panel shadow-[0_1px_0_0_var(--border-strong)]">
              <tr>
                <th className={thCls}>Время</th>
                <th className={thCls}>Тип</th>
                <th className={thCls}>Напр.</th>
                <th className={thCls}>Цена</th>
                <th className={thCls}>Лоты</th>
                <th className={thCls}>Статус</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {instrumentOrders.map((o) => (
                <tr key={o.orderId} className="h-10 border-b border-subtle/40 transition-colors duration-[120ms] hover:bg-panel-raised">
                  <td className={tdCls + ' text-left'}>{formatTime(o.time)}</td>
                  <td className={tdCls}>{o.orderType === 'limit' ? 'Лимит' : 'Рынок'}</td>
                  <td className={tdCls}>
                    <Badge variant={o.direction === 'long' ? 'long' : 'short'}>
                      {o.direction === 'long' ? 'Лонг' : 'Шорт'}
                    </Badge>
                  </td>
                  <td className={tdCls}>{o.price !== undefined ? fmtPrice(o.price, instrument) : '—'}</td>
                  <td className={tdCls}>
                    {o.status === 'partially_filled' ? `${o.lotsExecuted}/${o.lotsRequested}` : o.lotsRequested}
                  </td>
                  <td className={tdCls + ' text-fg-secondary'}>{STATUS_LABEL[o.status]}</td>
                  <td className={tdCls}>
                    <button
                      type="button"
                      aria-label="Отменить ордер"
                      onClick={() => onCancelOrder(o)}
                      className="rounded p-1 text-fg-muted transition-colors hover:bg-short-dim hover:text-short"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {instrumentOrders.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      compact
                      icon={<Inbox className="h-6 w-6" strokeWidth={1.5} />}
                      title="Нет активных ордеров"
                      subtitle="Выставленные ордера появятся здесь — тап по цене в стакане подставит её в тикет"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'positions' && (
          <table className="w-full">
            <thead className="sticky top-0 z-[5] bg-panel shadow-[0_1px_0_0_var(--border-strong)]">
              <tr>
                <th className={thCls}>Инструмент</th>
                <th className={thCls}>Напр.</th>
                <th className={thCls}>Кол-во</th>
                <th className={thCls}>Ср. цена</th>
                <th className={thCls}>Текущая</th>
                <th className={thCls}>P&L</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const cur = quotes[p.instrumentId]?.price ?? p.currentPrice;
                const pnl = (cur - p.avgPrice) * p.lots * (p.direction === 'long' ? 1 : -1);
                return (
                  <tr key={p.instrumentId} className="h-10 border-b border-subtle/40 transition-colors duration-[120ms] hover:bg-panel-raised">
                    <td className={tdCls + ' text-left font-semibold uppercase'}>{p.ticker}</td>
                    <td className={tdCls}>
                      <Badge variant={p.direction === 'long' ? 'long' : 'short'}>
                        {p.direction === 'long' ? 'Лонг' : 'Шорт'}
                      </Badge>
                    </td>
                    <td className={tdCls}>{p.lots}</td>
                    <td className={tdCls}>{fmtPrice(p.avgPrice, instrument?.uid === p.instrumentId ? instrument : null)}</td>
                    <td className={tdCls}>
                      <PriceTicker value={cur} format={(v) => fmtPrice(v, instrument?.uid === p.instrumentId ? instrument : null)} />
                    </td>
                    <td className={cn(tdCls, 'font-semibold', pnl >= 0 ? 'text-long' : 'text-short')}>
                      {pnl >= 0 ? '+' : ''}
                      {Math.round(pnl).toLocaleString('ru-RU')} ₽
                    </td>
                    <td className={tdCls}>
                      <button
                        type="button"
                        onClick={() => onClosePosition(p)}
                        className="rounded-md border border-subtle px-2 py-0.5 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-short hover:text-short"
                      >
                        Закрыть
                      </button>
                    </td>
                  </tr>
                );
              })}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      compact
                      icon={<Layers className="h-6 w-6" strokeWidth={1.5} />}
                      title="Нет открытых позиций"
                      subtitle="Открытые позиции по счёту появятся здесь"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'trades' && (
          <div className="divide-y divide-subtle/40">
            {trades.slice(0, 50).map((t) => (
              <div key={t.id} className="mono flex items-center gap-3 px-3 py-1.5 text-[12px]">
                <span className="text-fg-muted">{formatTime(t.time)}</span>
                <Badge variant={t.direction === 'long' ? 'long' : 'short'} className="shrink-0">
                  {t.direction === 'long' ? '▲' : '▼'}
                </Badge>
                <span className="font-semibold uppercase text-fg">{t.ticker}</span>
                <span className="text-fg-secondary">{t.lots} × {fmtPrice(t.price, instrument?.uid === t.instrumentId ? instrument : null)}</span>
                {t.source === 'robot' && <span className="text-[10px] text-info">{t.robotName ?? 'робот'}</span>}
                {t.pnl !== undefined && (
                  <span className={cn('ml-auto font-semibold', t.pnl >= 0 ? 'text-long' : 'text-short')}>
                    {t.pnl >= 0 ? '+' : ''}
                    {Math.round(t.pnl).toLocaleString('ru-RU')} ₽
                  </span>
                )}
              </div>
            ))}
            {trades.length === 0 && (
              <EmptyState
                compact
                icon={<History className="h-6 w-6" strokeWidth={1.5} />}
                title="Сделок сегодня нет"
                subtitle="Исполненные сделки появятся в этой ленте"
              />
            )}
          </div>
        )}

        {tab === 'grid' && (
          <div>
            {gridRobot && gridLevels.length > 0 ? (
              <>
                <div className="flex items-center justify-between border-b border-subtle/40 px-3 py-2">
                  <span className="text-xs font-semibold text-fg">{gridRobot.name}</span>
                  <span className={cn('mono text-[12px] font-semibold', gridRobot.stats.dayPnl >= 0 ? 'text-long' : 'text-short')}>
                    P&L сетки: {gridRobot.stats.dayPnl >= 0 ? '+' : ''}
                    {Math.round(gridRobot.stats.dayPnl).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
                <table className="w-full">
                  <thead className="sticky top-0 z-[5] bg-panel shadow-[0_1px_0_0_var(--border-strong)]">
                    <tr>
                      <th className={thCls}>Уровень</th>
                      <th className={thCls}>Цена</th>
                      <th className={thCls}>Объём</th>
                      <th className={thCls}>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridLevels.map((p, i) => {
                      const cur = uid ? quotes[uid]?.price : undefined;
                      const status = cur === undefined ? 'ждёт' : p < cur ? 'исполнен' : i % 3 === 1 ? 'в ордере' : 'ждёт';
                      return (
                        <tr key={i} className="h-10 border-b border-subtle/40 transition-colors duration-[120ms] hover:bg-panel-raised">
                          <td className={tdCls + ' text-left'}>#{i + 1}</td>
                          <td className={tdCls}>{fmtPrice(p, instrument)}</td>
                          <td className={tdCls}>{'grid' in gridRobot.params ? gridRobot.params.grid.lotsPerLevel : 1}</td>
                          <td className={tdCls}>
                            <Badge variant={status === 'исполнен' ? 'long' : status === 'в ордере' ? 'accent' : 'neutral'}>
                              {status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <EmptyState
                compact
                icon={<LayoutGrid className="h-6 w-6" strokeWidth={1.5} />}
                title={`По ${instrument ? futuresLabel(instrument) : 'инструменту'} нет grid-робота`}
                subtitle="Создайте grid-робота, чтобы видеть уровни сетки на графике"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
