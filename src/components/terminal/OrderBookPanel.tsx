// Стакан N×N с полосами глубины и спред-строкой (terminal.md §1, design.md §5 OrderBookRow)
// Тап по цене → подставить в тикет (onPriceClick).
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import { useMarketStore } from '@/store/market';
import type { Instrument, OrderBookLevel } from '@/types/market';
import { fmtPrice } from './utils';

export interface OrderBookPanelProps {
  instrument: Instrument | null;
  depth?: number;
  onPriceClick?: (price: number) => void;
  className?: string;
}

function Row({
  level,
  side,
  maxQty,
  instrument,
  onClick,
}: {
  level: OrderBookLevel;
  side: 'bid' | 'ask';
  maxQty: number;
  instrument: Instrument | null;
  onClick?: (price: number) => void;
}) {
  const widthPct = maxQty > 0 ? Math.min(100, (level.quantity / maxQty) * 100) : 0;
  return (
    <button
      type="button"
      onClick={() => onClick?.(level.price)}
      className="group relative flex h-[26px] w-full cursor-pointer items-center justify-between overflow-hidden rounded-[4px] px-2 text-right transition-colors hover:bg-panel-raised md:h-[24px]"
    >
      {/* полоса глубины (tween 150ms) */}
      <motion.span
        className={cn('absolute inset-y-0 right-0', side === 'ask' ? 'bg-short-dim' : 'bg-long-dim')}
        initial={false}
        animate={{ width: `${widthPct}%` }}
        transition={{ duration: 0.15 }}
      />
      <span className={cn('mono relative z-10 text-[13px] font-medium', side === 'ask' ? 'text-short' : 'text-long')}>
        {fmtPrice(level.price, instrument)}
      </span>
      <span className="mono relative z-10 text-[11px] text-fg-secondary">{level.quantity}</span>
    </button>
  );
}

export default function OrderBookPanel({ instrument, depth = 10, onPriceClick, className }: OrderBookPanelProps) {
  const orderBook = useMarketStore((s) => s.orderBook);
  const isIndex = instrument?.type === 'index';

  const { asks, bids, maxQty, spread, spreadPct, totalBid, totalAsk } = useMemo(() => {
    const asks = (orderBook?.asks ?? []).slice(0, depth);
    const bids = (orderBook?.bids ?? []).slice(0, depth);
    const maxQty = Math.max(1, ...asks.map((l) => l.quantity), ...bids.map((l) => l.quantity));
    const bestAsk = asks[0]?.price;
    const bestBid = bids[0]?.price;
    const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : null;
    const spreadPct = spread !== null && bestBid ? (spread / bestBid) * 100 : null;
    return {
      asks: asks.slice().reverse(), // продажи сверху, худшая цена наверху
      bids,
      maxQty,
      spread,
      spreadPct,
      totalBid: bids.reduce((s, l) => s + l.quantity, 0),
      totalAsk: asks.reduce((s, l) => s + l.quantity, 0),
    };
  }, [orderBook, depth]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-secondary">Стакан</span>
        <span className="mono text-[11px] text-fg-muted">{depth}×{depth}</span>
      </div>
      {isIndex ? (
        // По индексам стакана нет (CONTRACT.md §Правила 1) — только котировки
        <EmptyState
          compact
          icon={<LineChart className="h-6 w-6" strokeWidth={1.5} />}
          title="По индексам стакан недоступен"
          subtitle="Индекс — только котировки: график и последняя цена. Торговля ведётся через фьючерс или ETF на индекс"
          className="flex-1"
        />
      ) : (
      <div className="flex-1 overflow-y-auto p-1.5">
        {/* caption-шапка колонок (v2 §5.2.3) */}
        <div className="flex h-6 items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
          <span>Цена</span>
          <span>Объём</span>
        </div>
        {asks.map((l) => (
          <Row key={`a-${l.price}`} level={l} side="ask" maxQty={maxQty} instrument={instrument} onClick={onPriceClick} />
        ))}
        {/* спред-строка: подпись caption справа, не только жёлтая каёмка (v2 §5.2.3) */}
        <div className="my-1 flex h-7 items-center justify-between rounded-[6px] border-y border-yellow/40 bg-inset px-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">Спред</span>
          <span className="mono text-[12px] font-semibold text-yellow">
            {spread !== null ? fmtPrice(spread, instrument) : '—'}
            {spread !== null && (
              <span className="ml-1.5 text-[10px] font-normal text-fg-muted">
                спред {Math.round(spread / (instrument?.minPriceIncrement || 1))}
                {spreadPct !== null && ` · ${spreadPct.toFixed(3)}%`}
              </span>
            )}
          </span>
        </div>
        {bids.map((l) => (
          <Row key={`b-${l.price}`} level={l} side="bid" maxQty={maxQty} instrument={instrument} onClick={onPriceClick} />
        ))}
        {asks.length === 0 && bids.length === 0 && (
          <EmptyState
            compact
            icon={<BookOpen className="h-6 w-6" strokeWidth={1.5} />}
            title="Нет данных стакана"
            subtitle="Котировки появятся после подключения потока"
          />
        )}
      </div>
      )}
      {!isIndex && (
      <div className="mono flex justify-between border-t border-subtle px-3 py-1.5 text-[11px] text-fg-muted">
        <span>
          Покупка: <span className="text-long">{totalBid.toLocaleString('ru-RU')}</span>
        </span>
        <span>
          Продажа: <span className="text-short">{totalAsk.toLocaleString('ru-RU')}</span>
        </span>
      </div>
      )}
    </div>
  );
}
