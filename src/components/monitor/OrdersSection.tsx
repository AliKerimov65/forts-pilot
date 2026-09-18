// Активные ордера (monitor.md §2.2): табы «Все / Лимитные / Стопы / От роботов»,
// группировка робо-ордеров по роботу, отмена (✕ / свайп) со strike-through анимацией.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, ChevronDown, Hand, ListFilter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { formatNumber, formatTime } from '@/lib/format';
import type { MonitorOrder, OrderKind } from './monitorData';
import SwipeActionRow from './SwipeActionRow';

type OrderTab = 'all' | 'limit' | 'stop' | 'robot';

const TABS: { value: OrderTab; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'limit', label: 'Лимитные' },
  { value: 'stop', label: 'Стопы' },
  { value: 'robot', label: 'От роботов' },
];

const KIND_BADGE: Record<OrderKind, { label: string; variant: 'info' | 'short' | 'long' }> = {
  limit: { label: 'Лимит', variant: 'info' },
  stop: { label: 'Стоп', variant: 'short' },
  take: { label: 'Тейк', variant: 'long' },
};

function StatusDot({ status }: { status: MonitorOrder['status'] }) {
  if (status === 'partially_filled')
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-warn">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
        Частично
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-long">
      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-long" />
      Активен
    </span>
  );
}

function matchesTab(o: MonitorOrder, tab: OrderTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'robot') return o.source === 'robot';
  if (tab === 'limit') return o.kind === 'limit';
  return o.kind === 'stop' || o.kind === 'take';
}

export interface OrdersSectionProps {
  orders: MonitorOrder[];
  onCancel: (o: MonitorOrder) => void;
  cancellingIds: Set<string>;
}

export default function OrdersSection({ orders, onCancel, cancellingIds }: OrdersSectionProps) {
  const [tab, setTab] = useState<OrderTab>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c: Record<OrderTab, number> = { all: orders.length, limit: 0, stop: 0, robot: 0 };
    orders.forEach((o) => {
      if (o.kind === 'limit') c.limit += 1;
      else c.stop += 1;
      if (o.source === 'robot') c.robot += 1;
    });
    return c;
  }, [orders]);

  const filtered = useMemo(() => orders.filter((o) => matchesTab(o, tab)), [orders, tab]);

  /** Группы: роботы — сворачиваемые группы, ручные — плоско */
  const groups = useMemo(() => {
    const robotGroups = new Map<string, MonitorOrder[]>();
    const manual: MonitorOrder[] = [];
    filtered.forEach((o) => {
      if (o.source === 'robot' && o.robotName) {
        const arr = robotGroups.get(o.robotName) ?? [];
        arr.push(o);
        robotGroups.set(o.robotName, arr);
      } else manual.push(o);
    });
    return { robotGroups: [...robotGroups.entries()], manual };
  }, [filtered]);

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const renderOrderRow = (o: MonitorOrder, idx: number) => {
    const kb = KIND_BADGE[o.kind];
    const cancelling = cancellingIds.has(o.orderId);
    return (
      <motion.tr
        key={o.orderId}
        layout="position"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: cancelling ? 0.4 : 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ delay: Math.min(idx, 10) * 0.03, duration: 0.25 }}
        className={cn('h-10 border-t border-subtle/60 transition-colors hover:bg-panel-raised', idx % 2 === 1 && 'bg-[rgba(255,255,255,0.02)]')}
      >
        <td className="mono px-4 py-2 text-[12px] text-fg-muted">{formatTime(o.time)}</td>
        <td className="px-4 py-2">
          <Link to={`/terminal?figi=${o.instrumentId}`} className="mono text-[13px] font-semibold uppercase text-fg hover:text-yellow">
            {o.ticker}
          </Link>
        </td>
        <td className="px-4 py-2">
          <Badge variant={kb.variant}>{kb.label}</Badge>
        </td>
        <td className="px-4 py-2">
          <Badge variant={o.direction === 'long' ? 'long' : 'short'}>{o.direction === 'long' ? 'Покупка' : 'Продажа'}</Badge>
        </td>
        <td className={cn('mono px-4 py-2 text-right text-[13px] text-fg', cancelling && 'line-through')}>
          {o.price !== undefined ? formatNumber(o.price) : 'Рынок'}
        </td>
        <td className="mono px-4 py-2 text-right text-[13px] text-fg-secondary">
          {o.lotsExecuted}/{o.lotsRequested}
        </td>
        <td className="px-4 py-2">
          <StatusDot status={o.status} />
        </td>
        <td className="px-4 py-2 text-[11px] text-fg-muted">{o.source === 'robot' ? o.robotName : 'Вручную'}</td>
        <td className="px-4 py-2 text-right">
          <button
            type="button"
            title="Отменить ордер"
            disabled={cancelling}
            onClick={() => onCancel(o)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-subtle text-fg-muted transition-colors hover:border-short hover:text-short disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </td>
      </motion.tr>
    );
  };

  const renderOrderCard = (o: MonitorOrder, idx: number) => {
    const kb = KIND_BADGE[o.kind];
    const cancelling = cancellingIds.has(o.orderId);
    return (
      <motion.li
        key={o.orderId}
        layout="position"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: cancelling ? 0.4 : 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ delay: Math.min(idx, 10) * 0.03, duration: 0.25 }}
      >
        <SwipeActionRow actionLabel="Отменить" tone="danger" onAction={() => onCancel(o)} disabled={cancelling}>
          <div className="rounded-xl border border-subtle bg-panel-raised p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="mono text-sm font-semibold uppercase text-fg">{o.ticker}</span>
                <Badge variant={kb.variant}>{kb.label}</Badge>
                <Badge variant={o.direction === 'long' ? 'long' : 'short'}>
                  {o.direction === 'long' ? 'Покупка' : 'Продажа'}
                </Badge>
              </div>
              <StatusDot status={o.status} />
            </div>
            <div className="mono mt-2 flex items-center justify-between text-xs text-fg-secondary">
              <span className={cancelling ? 'line-through' : undefined}>
                {o.price !== undefined ? formatNumber(o.price) : 'Рынок'} · {o.lotsExecuted}/{o.lotsRequested} лот
              </span>
              <span className="inline-flex items-center gap-1 text-fg-muted">
                {o.source === 'robot' ? <Bot className="h-3 w-3 text-yellow" /> : <Hand className="h-3 w-3" />}
                {o.source === 'robot' ? o.robotName : 'Вручную'} · {formatTime(o.time)}
              </span>
            </div>
          </div>
        </SwipeActionRow>
      </motion.li>
    );
  };

  return (
    <section className="overflow-hidden rounded-xl border border-subtle bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 md:px-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ListFilter className="h-4 w-4 text-fg-muted" />
          Активные ордера
        </h3>
        {/* Табы */}
        <div className="flex rounded-[10px] bg-inset p-0.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                'relative rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                tab === t.value ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {tab === t.value && (
                <motion.span
                  layoutId="orders-tab"
                  className="absolute inset-0 rounded-lg border-b-2 border-yellow bg-panel-raised"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">
                {t.label}{' '}
                <motion.span
                  key={counts[t.value]}
                  initial={{ scale: 1.2 }}
                  animate={{ scale: 1 }}
                  className="mono inline-block text-fg-muted"
                >
                  ({counts[t.value]})
                </motion.span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ListFilter className="h-7 w-7" />}
          title="Активных ордеров нет"
          subtitle="Запустите робота или выставьте ордер в терминале"
          className="py-8"
        />
      ) : (
        <>
          {/* Mobile: карточки */}
          <ul className="space-y-2 p-3 md:hidden">
            <AnimatePresence initial={false}>
              {groups.robotGroups.map(([name, arr]) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(name)}
                    className="mb-2 flex w-full items-center gap-2 px-1 text-xs font-semibold text-yellow"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {name} — {arr.length} орд.
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsed.has(name) && '-rotate-90')} />
                  </button>
                  <AnimatePresence initial={false}>
                    {!collapsed.has(name) && (
                      <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="space-y-2 overflow-hidden"
                      >
                        {arr.map((o, i) => renderOrderCard(o, i))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </li>
              ))}
              {groups.manual.map((o, i) => renderOrderCard(o, i))}
            </AnimatePresence>
          </ul>

          {/* Desktop: таблица */}
          <div className="hidden overflow-x-auto md:block">
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                  {['Время', 'Инструмент', 'Тип', 'Направление', 'Цена', 'Лоты', 'Статус', 'Источник', ''].map((h, i) => (
                    <th key={i} className={cn('px-4 py-2 font-medium', (i === 4 || i === 5 || i === 8) && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {groups.robotGroups.map(([name, arr]) => [
                    <tr key={name} className="border-t border-subtle">
                      <td colSpan={9} className="px-4 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(name)}
                          className="flex items-center gap-2 text-xs font-semibold text-yellow"
                        >
                          <Bot className="h-3.5 w-3.5" />
                          {name} — {arr.length} орд.
                          <ChevronDown
                            className={cn('h-3.5 w-3.5 transition-transform', collapsed.has(name) && '-rotate-90')}
                          />
                        </button>
                      </td>
                    </tr>,
                    ...(!collapsed.has(name) ? arr.map((o, i) => renderOrderRow(o, i)) : []),
                  ])}
                  {groups.manual.map((o, i) => renderOrderRow(o, i))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
