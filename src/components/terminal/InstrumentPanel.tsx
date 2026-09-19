// Панель инструмента: тикер, цена с флэшем, дельта дня, диапазон дня, ★, fullscreen (terminal.md §2.2)
import { useRef, type TouchEvent } from 'react';
import { Maximize2, Minimize2, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import PriceTicker from '@/components/PriceTicker';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { formatDateShort } from '@/lib/format';
import { instrumentTypeLabel } from '@/lib/tinvest/instruments';
import type { Instrument } from '@/types/market';
import { fmtPnlRub, fmtPrice, futuresLabel, lotsWord } from './utils';

export interface InstrumentPanelProps {
  instrument: Instrument;
  /** Диапазон дня (из свечей/стакана) */
  dayLow?: number;
  dayHigh?: number;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Свайп влево/вправо — смена инструмента (mobile) */
  onSwipeInstrument?: (dir: 1 | -1) => void;
  compact?: boolean;
}

export default function InstrumentPanel({
  instrument,
  dayLow,
  dayHigh,
  isFavorite,
  onToggleFavorite,
  fullscreen,
  onToggleFullscreen,
  onSwipeInstrument,
  compact,
}: InstrumentPanelProps) {
  const quotes = useMarketStore((s) => s.quotes);
  // открытая позиция по выбранному инструменту (бейдж «В позиции»)
  const openPosition = useTradingStore((s) => s.positions.find((p) => p.instrumentId === instrument.uid));
  const quote = quotes[instrument.uid];
  const price = quote?.price;
  const pct = quote?.changePct ?? 0;
  const deltaAbs = price !== undefined ? (price * pct) / (100 + pct) : 0;

  const touchRef = useRef<number | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touchRef.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (touchRef.current === null || !onSwipeInstrument) return;
    const dx = e.changedTouches[0].clientX - touchRef.current;
    touchRef.current = null;
    if (Math.abs(dx) > 48) onSwipeInstrument(dx < 0 ? 1 : -1);
  };

  const rangePos =
    price !== undefined && dayLow !== undefined && dayHigh !== undefined && dayHigh > dayLow
      ? Math.min(1, Math.max(0, (price - dayLow) / (dayHigh - dayLow)))
      : null;

  return (
    <div
      className={cn('flex items-center gap-3 border-b border-subtle bg-panel px-3', compact ? 'h-12' : 'h-16 md:px-4')}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label="Избранное"
        className={cn('shrink-0 rounded-md p-1.5 transition-colors', isFavorite ? 'text-yellow' : 'text-fg-muted hover:text-yellow')}
      >
        <Star className={compact ? 'h-4 w-4' : 'h-5 w-5'} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={cn('mono shrink-0 whitespace-nowrap font-bold uppercase text-fg', compact ? 'text-sm' : 'text-xl')}>
            {futuresLabel(instrument)}
          </span>
          {/* бейдж класса + валюта расчётов */}
          <span className="shrink-0 rounded-[4px] bg-panel-raised px-1.5 py-px text-[9px] font-semibold uppercase leading-[14px] text-fg-secondary">
            {instrumentTypeLabel(instrument.type)}
          </span>
          <span className="mono shrink-0 text-[10px] font-semibold uppercase text-fg-muted">
            {instrument.currency}
          </span>
          {/* Плашка открытой позиции по выбранному инструменту */}
          {openPosition && (
            <span
              className={cn(
                'shrink-0 whitespace-nowrap rounded-[4px] border px-1.5 py-px font-semibold leading-[14px]',
                compact ? 'text-[9px]' : 'text-[10px]',
                openPosition.pnl >= 0
                  ? 'border-long/40 bg-long-dim text-long'
                  : 'border-short/40 bg-short-dim text-short',
              )}
            >
              В позиции: {openPosition.lots} {lotsWord(openPosition.lots)} ·{' '}
              {openPosition.direction === 'long' ? 'Лонг' : 'Шорт'} · P&L {fmtPnlRub(openPosition.pnl)}
            </span>
          )}
          {!compact && <span className="truncate text-xs text-fg-secondary">{instrument.name}</span>}
        </div>
        {!compact && (
          <div className="mono mt-0.5 flex gap-3 text-[11px] text-fg-muted">
            <span>лот {instrument.lot}</span>
            {instrument.marginBuy !== undefined && <span>ГО {Math.round(instrument.marginBuy).toLocaleString('ru-RU')} ₽</span>}
            <span>шаг {fmtPrice(instrument.minPriceIncrement, instrument)}</span>
            {/* экспирация — для фьючерсов/опционов */}
            {instrument.expirationDate && !Number.isNaN(Date.parse(instrument.expirationDate)) && (
              <span>эксп. {formatDateShort(Date.parse(instrument.expirationDate))}</span>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 md:gap-5">
        {/* Диапазон дня */}
        {!compact && rangePos !== null && (
          <div className="hidden w-40 md:block" title="Диапазон дня">
            <div className="mono flex justify-between text-[10px] text-fg-muted">
              <span>{fmtPrice(dayLow!, instrument)}</span>
              <span>{fmtPrice(dayHigh!, instrument)}</span>
            </div>
            <div className="relative mt-1 h-1 rounded-full bg-inset">
              <span
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-yellow"
                style={{ left: `${rangePos * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="text-right">
          {price !== undefined ? (
            <PriceTicker
              value={price}
              format={(v) => fmtPrice(v, instrument)}
              delta={quote?.delta}
              className={cn('font-bold text-fg', compact ? 'text-base' : 'text-2xl')}
            />
          ) : (
            <span className={cn('mono font-bold text-fg-muted', compact ? 'text-base' : 'text-2xl')}>—</span>
          )}
          <div className={cn('mono text-[11px] font-medium', pct >= 0 ? 'text-long' : 'text-short')}>
            {pct >= 0 ? '+' : '−'}
            {fmtPrice(Math.abs(deltaAbs), instrument)} ({pct >= 0 ? '+' : ''}
            {pct.toFixed(2)}%)
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? 'Свернуть график' : 'Развернуть график'}
          className="hidden shrink-0 rounded-md border border-subtle p-2 text-fg-secondary transition-colors hover:border-strong hover:text-fg md:block"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
