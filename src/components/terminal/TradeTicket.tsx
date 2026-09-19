// Торговый тикет: Купить/Продать, тип ордера, цена/лоты со степперами,
// расчёт ГО/объёма, SL/TP-блок с R:R (terminal.md §2.4)
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, ChevronDown, Minus, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { useMarketStore } from '@/store/market';
import type { Instrument } from '@/types/market';
import type { Direction } from '@/types/trading';
import SegmentedControl from './SegmentedControl';
import { fmtPrice, futuresLabel, roundToStep } from './utils';

export type TicketOrderType = 'market' | 'limit' | 'best';

export interface TicketState {
  direction: Direction;
  orderType: TicketOrderType;
  /** Цена (null → рыночная) */
  price: number | null;
  lots: number;
  slOn: boolean;
  sl: number | null;
  tpOn: boolean;
  tp: number | null;
}

export interface TradeTicketProps {
  instrument: Instrument | null;
  state: TicketState;
  onChange: (patch: Partial<TicketState>) => void;
  onSubmit: () => void;
  submitting?: boolean;
  /** Timestamp вспышки поля цены (тап по стакану) */
  priceFlashAt?: number;
  /** ГО (₽/лот) — из инструмента или getFuturesMargin */
  marginBuy?: number;
  marginSell?: number;
  /** Флэш сегмента Купить/Продать по шорткату B/S (v2 §5.2.8) */
  dirFlash?: { dir: Direction; at: number } | null;
  /** Ref на блок «Лоты» — фокус после выбора инструмента (v2 §5.2.8) */
  lotsRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}

function Stepper({
  value,
  onChange,
  step,
  min,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        aria-label="Меньше"
        className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-subtle text-fg-secondary transition-colors hover:border-strong hover:text-fg"
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="mono min-w-[3ch] text-center text-sm font-semibold text-fg">{value}</span>
      <button
        type="button"
        aria-label="Больше"
        className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-subtle text-fg-secondary transition-colors hover:border-strong hover:text-fg"
        onClick={() => onChange(value + step)}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PriceField({
  label,
  value,
  step,
  instrument,
  onChange,
  flashAt,
  placeholder,
}: {
  label: string;
  value: number | null;
  step: number;
  instrument: Instrument | null;
  onChange: (v: number | null) => void;
  flashAt?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value !== null ? String(value) : '');
  // синхронизация текста с внешним значением (тап по стакану и т.п.) — паттерн derived state
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value !== null ? String(value) : '');
  }
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-fg-secondary">
        {label}
      </span>
      <input
        key={flashAt}
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
          setText(raw);
          const v = parseFloat(raw);
          onChange(Number.isFinite(v) ? roundToStep(v, step) : null);
        }}
        onBlur={() => {
          const v = parseFloat(text);
          setText(Number.isFinite(v) ? fmtPrice(roundToStep(v, step), instrument).replace(/\s/g, ' ') : '');
        }}
        className={cn(
          'mono h-10 w-full rounded-[8px] border border-subtle bg-inset px-3 text-sm font-semibold text-fg focus:border-strong focus:outline-none',
          flashAt && 'border-yellow transition-colors',
        )}
        style={flashAt ? { boxShadow: '0 0 0 2px rgba(255,221,45,0.35)' } : undefined}
      />
    </label>
  );
}

export default function TradeTicket({
  instrument,
  state,
  onChange,
  onSubmit,
  submitting,
  priceFlashAt,
  marginBuy,
  marginSell,
  dirFlash,
  lotsRef,
  className,
}: TradeTicketProps) {
  const quotes = useMarketStore((s) => s.quotes);
  const orderBook = useMarketStore((s) => s.orderBook);
  const [sltpOpen, setSltpOpen] = useState(false);
  const [slMode, setSlMode] = useState<'price' | 'pct' | 'rub'>('price');
  const [tpMode, setTpMode] = useState<'price' | 'pct' | 'rub'>('price');

  // v2 §5.2.8: шорткаты B/S подсвечивают сегмент Купить/Продать флэшем 300ms
  const [flashDir, setFlashDir] = useState<Direction | null>(null);
  const lastFlashAt = useRef(0);
  useEffect(() => {
    if (!dirFlash || dirFlash.at === lastFlashAt.current) return;
    lastFlashAt.current = dirFlash.at;
    setFlashDir(dirFlash.dir);
    const t = setTimeout(() => setFlashDir(null), 300);
    return () => clearTimeout(t);
  }, [dirFlash]);

  const step = instrument?.minPriceIncrement ?? 1;
  const quote = instrument ? quotes[instrument.uid] : undefined;
  const bestBid = orderBook?.bids[0]?.price;
  const bestAsk = orderBook?.asks[0]?.price;

  const isBuy = state.direction === 'long';
  const entry =
    state.orderType === 'market'
      ? (quote?.price ?? null)
      : state.orderType === 'best'
        ? (isBuy ? bestAsk : bestBid) ?? quote?.price ?? null
        : state.price;

  // расчёт ГО / объёма
  const marginPerLot = isBuy ? (marginBuy ?? instrument?.marginBuy) : (marginSell ?? instrument?.marginSell);
  const marginTotal = marginPerLot !== undefined ? marginPerLot * state.lots : null;
  const volumeTotal = entry !== null ? entry * state.lots : null;

  // SL/TP расчёты
  const rr = useMemo(() => {
    if (entry === null) return null;
    const risk = state.slOn && state.sl !== null ? Math.abs(entry - state.sl) * state.lots : null;
    const profit = state.tpOn && state.tp !== null ? Math.abs(state.tp - entry) * state.lots : null;
    const ratio = risk !== null && profit !== null && risk > 0 ? profit / risk : null;
    return { risk, profit, ratio };
  }, [entry, state.slOn, state.sl, state.tpOn, state.tp, state.lots]);

  const setAlt = (kind: 'sl' | 'tp', mode: 'pct' | 'rub', v: number) => {
    if (entry === null || !Number.isFinite(v) || v <= 0) return;
    // для лонга SL ниже входа, для шорта выше; TP зеркально
    const sign = kind === 'sl' ? (isBuy ? -1 : 1) : isBuy ? 1 : -1;
    const price = mode === 'pct' ? entry * (1 + (sign * v) / 100) : entry + sign * (v / state.lots);
    onChange(kind === 'sl' ? { sl: roundToStep(price, step) } : { tp: roundToStep(price, step) });
  };

  const altValue = (kind: 'sl' | 'tp'): string => {
    if (entry === null) return '';
    const p = kind === 'sl' ? state.sl : state.tp;
    if (p === null) return '';
    const mode = kind === 'sl' ? slMode : tpMode;
    if (mode === 'pct') return (Math.abs(p - entry) / entry * 100).toFixed(2);
    if (mode === 'rub') return Math.round(Math.abs(p - entry) * state.lots).toString();
    return '';
  };

  const submitLabel = instrument
    ? `${isBuy ? 'Купить' : 'Продать'} ${state.lots} лот${state.lots > 1 ? 'а' : ''} · ${futuresLabel(instrument)}`
    : 'Выберите инструмент';

  return (
    <div className={cn('flex h-full flex-col overflow-y-auto', className)}>
      <div className="border-b border-subtle px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-secondary">Тикет</span>
      </div>
      <div className="flex-1 space-y-3 p-3">
        {/* Купить / Продать */}
        <div className="grid grid-cols-2 gap-2">
          {(['long', 'short'] as const).map((d) => (
            <motion.button
              key={d}
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => onChange({ direction: d })}
              className={cn(
                'h-10 rounded-[10px] text-sm font-bold transition-[colors,box-shadow] duration-200',
                state.direction === d
                  ? d === 'long'
                    ? 'bg-long text-app'
                    : 'bg-short text-white'
                  : 'border border-subtle text-fg-muted hover:text-fg-secondary',
                flashDir === d && 'shadow-[0_0_0_3px_rgba(255,221,45,0.45)]',
              )}
            >
              {d === 'long' ? 'Купить' : 'Продать'}
            </motion.button>
          ))}
        </div>

        {/* Тип ордера */}
        <SegmentedControl
          id="ticket-type"
          segments={[
            { key: 'limit', label: 'Лимитный' },
            { key: 'market', label: 'Рыночный' },
            { key: 'best', label: 'Лучшая цена' },
          ]}
          value={state.orderType}
          onChange={(k) => onChange({ orderType: k as TicketOrderType })}
        />

        {/* Цена */}
        {state.orderType === 'limit' && (
          <div className="flex items-end gap-2">
            <PriceField
              label="Цена"
              value={state.price}
              step={step}
              instrument={instrument}
              onChange={(v) => onChange({ price: v })}
              flashAt={priceFlashAt}
              placeholder={quote ? fmtPrice(quote.price, instrument) : '0'}
            />
            <button
              type="button"
              onClick={() => {
                const best = isBuy ? bestAsk : bestBid;
                if (best !== undefined) onChange({ price: roundToStep(best, step) });
              }}
              className="h-10 shrink-0 rounded-[8px] border border-subtle px-2 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-yellow hover:text-yellow"
              title="Подставить лучшую цену из стакана"
            >
              Лучшая
            </button>
          </div>
        )}

        {/* Лоты — фокус после выбора инструмента (v2 §5.2.8) */}
        <div className="flex items-end justify-between gap-2">
          <div ref={lotsRef} tabIndex={-1} className="rounded-lg">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-fg-secondary">
              Лоты
            </span>
            <Stepper value={state.lots} onChange={(v) => onChange({ lots: v })} step={1} min={1} />
          </div>
          <div className="mono text-right text-[11px] leading-4 text-fg-muted">
            {marginTotal !== null && <div>ГО: ≈ {Math.round(marginTotal).toLocaleString('ru-RU')} ₽</div>}
            {volumeTotal !== null && <div>Объём: ≈ {Math.round(volumeTotal).toLocaleString('ru-RU')} ₽</div>}
          </div>
        </div>

        {/* SL/TP блок */}
        <div className="rounded-[10px] border border-subtle bg-inset">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-fg-secondary"
            onClick={() => setSltpOpen((o) => !o)}
          >
            Стоп-лосс / Тейк-профит
            <ChevronDown className={cn('h-4 w-4 transition-transform', sltpOpen && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {sltpOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="space-y-3 px-3 pb-3">
                  {(['sl', 'tp'] as const).map((kind) => {
                    const on = kind === 'sl' ? state.slOn : state.tpOn;
                    const mode = kind === 'sl' ? slMode : tpMode;
                    const setMode = kind === 'sl' ? setSlMode : setTpMode;
                    const isSl = kind === 'sl';
                    return (
                      <div key={kind} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() =>
                              onChange(
                                isSl
                                  ? { slOn: !on, sl: !on && state.sl === null && entry !== null ? roundToStep(entry * (isBuy ? 0.995 : 1.005), step) : state.sl }
                                  : { tpOn: !on, tp: !on && state.tp === null && entry !== null ? roundToStep(entry * (isBuy ? 1.01 : 0.99), step) : state.tp },
                              )
                            }
                            className={cn(
                              'flex items-center gap-2 text-xs font-semibold',
                              isSl ? 'text-short' : 'text-long',
                            )}
                          >
                            <span
                              className={cn(
                                'relative h-5 w-9 rounded-full transition-colors',
                                on ? (isSl ? 'bg-short' : 'bg-long') : 'bg-panel-raised',
                              )}
                            >
                              <span
                                className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg transition-transform"
                                style={{ transform: on ? 'translateX(18px)' : 'translateX(0)' }}
                              />
                            </span>
                            {isSl ? 'Стоп-лосс' : 'Тейк-профит'}
                          </button>
                          {on && (
                            <SegmentedControl
                              id={`${kind}-mode`}
                              size="sm"
                              segments={[
                                { key: 'price', label: 'Цена' },
                                { key: 'pct', label: '%' },
                                { key: 'rub', label: '₽' },
                              ]}
                              value={mode}
                              onChange={(k) => setMode(k as 'price' | 'pct' | 'rub')}
                              className="w-[132px]"
                            />
                          )}
                        </div>
                        {on &&
                          (mode === 'price' ? (
                            <PriceField
                              label={isSl ? 'Цена SL' : 'Цена TP'}
                              value={isSl ? state.sl : state.tp}
                              step={step}
                              instrument={instrument}
                              onChange={(v) => onChange(isSl ? { sl: v } : { tp: v })}
                            />
                          ) : (
                            <label className="block">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-fg-secondary">
                                {mode === 'pct' ? '% от входа' : '₽ риска'}
                              </span>
                              <input
                                defaultValue={altValue(kind)}
                                key={`${kind}-${mode}-${entry}`}
                                inputMode="decimal"
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
                                  setAlt(kind, mode, v);
                                }}
                                className="mono h-10 w-full rounded-[8px] border border-subtle bg-panel px-3 text-sm font-semibold text-fg focus:border-strong focus:outline-none"
                              />
                            </label>
                          ))}
                      </div>
                    );
                  })}
                  {rr && (rr.risk !== null || rr.profit !== null) && (
                    <div className="mono rounded-[6px] bg-panel px-2 py-1.5 text-[11px] text-fg-secondary">
                      {rr.risk !== null && <span className="text-short">Риск: {Math.round(rr.risk).toLocaleString('ru-RU')} ₽</span>}
                      {rr.risk !== null && rr.profit !== null && ' · '}
                      {rr.profit !== null && <span className="text-long">Профит: {Math.round(rr.profit).toLocaleString('ru-RU')} ₽</span>}
                      {rr.ratio !== null && <span className="text-yellow"> · R:R 1:{rr.ratio.toFixed(1)}</span>}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Итоговая кнопка — 44px, mono-semibold (v2 §5.2.4) */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={!instrument || submitting || (state.orderType === 'limit' && state.price === null)}
          onClick={onSubmit}
          className={cn(
            'mono h-11 w-full rounded-[10px] text-sm font-semibold transition-[colors,filter] duration-200 disabled:opacity-45',
            isBuy ? 'bg-long text-app hover:brightness-110' : 'bg-short text-white hover:brightness-110',
          )}
        >
          {submitting ? 'Отправка…' : submitLabel}
        </motion.button>

        {instrument && (
          <Link
            to={`/robots?new=grid&symbol=${instrument.ticker}`}
            className="flex h-8 items-center justify-center gap-1.5 rounded-full border border-subtle text-[11px] font-semibold text-fg-secondary transition-colors hover:border-yellow hover:text-yellow"
          >
            <Bot className="h-3.5 w-3.5" />
            Создать робота по {futuresLabel(instrument)}
          </Link>
        )}
      </div>
    </div>
  );
}
