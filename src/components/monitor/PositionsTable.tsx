// Таблица/карточки открытых позиций (monitor.md §2.1).
// Desktop — таблица с inline-раскрытием строки; mobile — карточки со свайпом «Закрыть».
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, ChevronDown, Hand, Shield, ShieldPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Position } from '@/types/trading';
import Badge from '@/components/Badge';
import PriceTicker from '@/components/PriceTicker';
import EmptyState from '@/components/EmptyState';
import { formatRub, formatSignedRub } from '@/lib/format';
import { instrumentTypeLabel } from '@/lib/tinvest/instruments';
import { effectiveSlTp, formatPositionPrice, isBondPosition, pnlPct, positionInstrument, positionSource, useSlTpStore } from './monitorData';
import SwipeActionRow from './SwipeActionRow';

/** Бейдж класса инструмента позиции (Акция/Фьючерс/ETF/Валюта/Облигация…) */
function ClassBadge({ p }: { p: Position }) {
  const meta = positionInstrument(p);
  if (!meta) return null;
  return (
    <Badge variant="neutral" size="compact">
      {instrumentTypeLabel(meta.type)}
    </Badge>
  );
}

function SourceBadge({ p }: { p: Position }) {
  const src = positionSource(p);
  if (src.source === 'robot') {
    return (
      <Badge variant="accent">
        <Bot className="h-3 w-3" />
        {src.robotName}
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">
      <Hand className="h-3 w-3" />
      Ручная
    </Badge>
  );
}

function PnlCell({ p }: { p: Position }) {
  const pct = pnlPct(p);
  return (
    <div className={cn('mono text-right', p.pnl >= 0 ? 'text-long' : 'text-short')}>
      <PriceTicker value={p.pnl} format={(v) => formatSignedRub(v)} className="font-semibold" />
      <div className="text-[11px] opacity-80">{pct >= 0 ? '+' : ''}{pct.toFixed(2).replace('.', ',')}%</div>
    </div>
  );
}

function SlTpCell({ p, kind }: { p: Position; kind: 'sl' | 'tp' }) {
  const map = useSlTpStore((s) => s.map);
  const eff = effectiveSlTp(p, map);
  const v = kind === 'sl' ? eff.sl : eff.tp;
  return (
    <span className={cn('mono inline-flex items-center gap-1 text-[13px]', kind === 'sl' ? 'text-short' : 'text-long')}>
      {kind === 'sl' && <Shield className="h-3 w-3" />}
      {formatPositionPrice(p, v)}
    </span>
  );
}

/** Мини-шкала позиции: SL — вход — текущая — TP */
function PositionScale({ p }: { p: Position }) {
  const map = useSlTpStore((s) => s.map);
  const { sl, tp } = effectiveSlTp(p, map);
  const lo = Math.min(sl, tp, p.avgPrice, p.currentPrice);
  const hi = Math.max(sl, tp, p.avgPrice, p.currentPrice);
  const range = Math.max(hi - lo, 1e-9);
  const at = (v: number) => `${((v - lo) / range) * 100}%`;
  return (
    <div className="relative h-14 rounded-lg bg-inset px-2">
      <span className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-strong" style={{ left: 0 }} />
      {/* SL / TP */}
      <span className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2 bg-short" style={{ left: at(sl) }} />
      <span className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2 bg-long" style={{ left: at(tp) }} />
      {/* вход */}
      <span className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-fg-muted" style={{ left: at(p.avgPrice) }} />
      {/* текущая */}
      <motion.span
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-app bg-yellow"
        animate={{ left: at(p.currentPrice) }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      />
      <div className="mono absolute bottom-1 left-2 right-2 flex justify-between text-[10px] text-fg-muted">
        <span className="text-short">SL {formatPositionPrice(p, sl)}</span>
        <span>вход {formatPositionPrice(p, p.avgPrice)}</span>
        <span className="text-long">TP {formatPositionPrice(p, tp)}</span>
      </div>
    </div>
  );
}

/** Панель быстрых действий в раскрытой строке/карточке */
function PositionActions({
  p,
  onTrailStop,
  onFlip,
  onPartialClose,
}: {
  p: Position;
  onTrailStop: (p: Position) => void;
  onFlip: (p: Position) => void;
  onPartialClose: (p: Position, lots: number) => void;
}) {
  const [lots, setLots] = useState(1);
  const btn =
    'h-9 rounded-lg border border-subtle px-3 text-xs font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={() => onTrailStop(p)}>
        Подтянуть стоп
      </button>
      <button type="button" className={btn} onClick={() => onFlip(p)}>
        Перевернуть
      </button>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={p.lots}
          value={lots}
          onChange={(e) => setLots(Math.max(1, Math.min(p.lots, Number(e.target.value) || 1)))}
          className="mono h-9 w-16 rounded-lg border border-subtle bg-inset px-2 text-center text-xs text-fg outline-none focus:border-strong"
        />
        <button type="button" className={btn} onClick={() => onPartialClose(p, lots)}>
          Закрыть частично
        </button>
      </div>
    </div>
  );
}

export interface PositionsTableProps {
  positions: Position[];
  onClose: (p: Position) => void;
  onOpenSlTp: (p: Position) => void;
  onTrailStop: (p: Position) => void;
  onFlip: (p: Position) => void;
  onPartialClose: (p: Position, lots: number) => void;
  onOpenTerminal: () => void;
}

const HEADERS = ['Инструмент', 'Направление', 'Кол-во', 'Средняя', 'Текущая', 'Нереализ. P&L', 'SL', 'TP', 'Источник', ''];

/** Шапка таблицы по v2 §2.3: 36px, caption 11px uppercase, числовые колонки вправо */
function TableHead() {
  return (
    <thead className="sticky top-0 z-[5] bg-panel shadow-[0_1px_0_0_var(--border-strong)]">
      <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
        {HEADERS.map((h, i) => (
          <th key={i} className={cn('h-9 px-4 font-semibold', i >= 2 && i <= 7 && 'text-right')}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default function PositionsTable(props: PositionsTableProps) {
  const { positions, onClose, onOpenSlTp, onOpenTerminal } = props;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totals = useMemo(
    () => ({
      pnl: positions.reduce((a, p) => a + p.pnl, 0),
      margin: positions.reduce((a, p) => a + (p.margin ?? 0), 0),
    }),
    [positions],
  );

  const emptyBody = (
    <EmptyState
      compact
      icon={<Shield className="h-7 w-7" />}
      title="Открытых позиций нет"
      subtitle="Запустите робота или откройте позицию в терминале"
      actionLabel="Открыть терминал"
      onAction={onOpenTerminal}
    />
  );

  // v2 §5.4.8: пустое состояние — в теле таблицы (colSpan), шапка секции остаётся на месте
  if (positions.length === 0) {
    return (
      <section className="overflow-hidden rounded-xl border border-subtle bg-panel">
        <div className="flex items-center justify-between px-4 pt-4 md:px-5">
          <h3 className="text-sm font-semibold text-fg">
            Открытые позиции <span className="mono text-fg-muted">(0)</span>
          </h3>
        </div>
        <div className="md:hidden">{emptyBody}</div>
        <div className="mt-2 hidden md:block">
          <table className="w-full border-collapse text-sm">
            <TableHead />
            <tbody>
              <tr>
                <td colSpan={HEADERS.length}>{emptyBody}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-subtle bg-panel">
      <div className="flex items-center justify-between px-4 pt-4 md:px-5">
        <h3 className="text-sm font-semibold text-fg">
          Открытые позиции <span className="mono text-fg-muted">({positions.length})</span>
        </h3>
        {positions.some(isBondPosition) && (
          <span className="text-[11px] text-fg-muted">Цены облигаций — в % от номинала</span>
        )}
      </div>

      {/* ===== Mobile: карточки ===== */}
      <ul className="space-y-2 p-3 md:hidden">
        {positions.map((p, i) => {
          const expanded = expandedId === p.instrumentId;
          return (
            <motion.li
              key={p.instrumentId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.03, duration: 0.25 }}
            >
              <SwipeActionRow actionLabel="Закрыть" tone="danger" onAction={() => onClose(p)}>
                <div
                  className={cn(
                    'rounded-xl border border-subtle bg-panel-raised p-3',
                    pnlPct(p) <= -3 && 'border-l-[3px] border-l-short',
                    pnlPct(p) >= 3 && 'border-l-[3px] border-l-long',
                  )}
                  onClick={() => setExpandedId(expanded ? null : p.instrumentId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/terminal?figi=${p.figi ?? p.instrumentId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="mono text-sm font-semibold uppercase text-fg"
                      >
                        {p.ticker}
                      </Link>
                      <Badge variant={p.direction === 'long' ? 'long' : 'short'}>
                        {p.direction === 'long' ? 'Лонг' : 'Шорт'}
                      </Badge>
                      <ClassBadge p={p} />
                      <span className="mono text-xs text-fg-secondary">{p.lots} лот</span>
                    </div>
                    <PnlCell p={p} />
                  </div>
                  <div className="mono mt-2 grid grid-cols-4 gap-1 text-[11px] text-fg-secondary">
                    <span>Ср. {formatPositionPrice(p, p.avgPrice)}</span>
                    <span>
                      Тек. <PriceTicker value={p.currentPrice} format={(v) => formatPositionPrice(p, v)} />
                    </span>
                    <SlTpCell p={p} kind="sl" />
                    <SlTpCell p={p} kind="tp" />
                  </div>
                  {isBondPosition(p) && (
                    <div className="mt-1 text-[10px] text-fg-muted">Цены облигаций — в % от номинала</div>
                  )}
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="pt-3">
                          <PositionScale p={p} />
                          <div className="mt-2 flex items-center justify-between">
                            <SourceBadge p={p} />
                            <button
                              type="button"
                              className="flex h-9 items-center gap-1 rounded-lg border border-subtle px-3 text-xs font-semibold text-fg-secondary hover:text-fg"
                              onClick={() => onOpenSlTp(p)}
                            >
                              <ShieldPlus className="h-3.5 w-3.5" /> SL/TP
                            </button>
                          </div>
                          <PositionActions {...props} p={p} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </SwipeActionRow>
            </motion.li>
          );
        })}
      </ul>

      {/* ===== Desktop: таблица (v2 §2.3: sticky-заголовок 36px, zebra отменена в живой таблице,
          собственный скролл, sticky-футер итогов) ===== */}
      <div className="mt-2 hidden max-h-[520px] overflow-auto md:block">
        <table className="w-full border-collapse text-sm">
          <TableHead />
          <tbody>
            {positions.map((p, i) => {
              const expanded = expandedId === p.instrumentId;
              const pct = pnlPct(p);
              return [
                <motion.tr
                  key={p.instrumentId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.03, duration: 0.25 }}
                  onClick={() => setExpandedId(expanded ? null : p.instrumentId)}
                  className={cn(
                    'h-10 cursor-pointer border-t border-subtle/60 transition-colors duration-[120ms] hover:bg-panel-raised',
                    // v2 §2.3: семантическая кромка по P&L; у раскрытой строки — жёлтая кромка поверх
                    !expanded && pct <= -3 && 'shadow-[inset_3px_0_0_var(--short)]',
                    !expanded && pct >= 3 && 'shadow-[inset_3px_0_0_var(--long)]',
                    expanded && 'bg-panel-raised shadow-[inset_2px_0_0_var(--accent-yellow)]',
                  )}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`/terminal?figi=${p.figi ?? p.instrumentId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="mono text-[13px] font-semibold uppercase text-fg hover:text-yellow"
                      >
                        {p.ticker}
                      </Link>
                      <ClassBadge p={p} />
                    </div>
                    {p.name && <div className="max-w-[160px] truncate text-[11px] text-fg-muted">{p.name}</div>}
                    {isBondPosition(p) && <div className="text-[10px] text-fg-muted">цена в % от номинала</div>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={p.direction === 'long' ? 'long' : 'short'}>
                      {p.direction === 'long' ? 'Лонг' : 'Шорт'}
                    </Badge>
                  </td>
                  <td className="mono px-4 py-2 text-right text-[13px] text-fg">{p.lots}</td>
                  <td className="mono px-4 py-2 text-right text-[13px] text-fg-secondary">{formatPositionPrice(p, p.avgPrice)}</td>
                  <td className="mono px-4 py-2 text-right text-[13px] text-fg">
                    <PriceTicker value={p.currentPrice} format={(v) => formatPositionPrice(p, v)} />
                  </td>
                  <td className="px-4 py-2">
                    <PnlCell p={p} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <SlTpCell p={p} kind="sl" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <SlTpCell p={p} kind="tp" />
                  </td>
                  <td className="px-4 py-2">
                    <SourceBadge p={p} />
                  </td>
                  <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        title="Установить SL/TP"
                        className="flex h-8 items-center gap-1 rounded-lg border border-subtle px-2 text-[11px] font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
                        onClick={() => onOpenSlTp(p)}
                      >
                        <ShieldPlus className="h-3.5 w-3.5" />
                        SL/TP
                      </button>
                      <button
                        type="button"
                        title="Закрыть позицию"
                        className="flex h-8 items-center gap-1 rounded-lg border border-short/60 px-2 text-[11px] font-semibold text-short transition-colors hover:bg-short-dim"
                        onClick={() => onClose(p)}
                      >
                        <X className="h-3.5 w-3.5" />
                        Закрыть
                      </button>
                      <ChevronDown
                        className={cn('h-4 w-4 text-fg-muted transition-transform', expanded && 'rotate-180')}
                      />
                    </div>
                  </td>
                </motion.tr>,
                <AnimatePresence key={`${p.instrumentId}-exp`} initial={false}>
                  {expanded && (
                    <tr>
                      <td colSpan={10} className="p-0">
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden bg-inset/60"
                        >
                          <div className="grid gap-4 px-6 py-4 lg:grid-cols-2">
                            <PositionScale p={p} />
                            <PositionActions {...props} p={p} />
                          </div>
                        </motion.div>
                      </td>
                    </tr>
                  )}
                </AnimatePresence>,
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-strong text-[13px]">
              <td
                className="sticky bottom-0 h-10 bg-panel-raised px-4 text-xs font-medium uppercase tracking-[0.08em] text-fg-muted"
                colSpan={5}
              >
                Итого
              </td>
              <td
                className={cn(
                  'mono sticky bottom-0 h-10 bg-panel-raised px-4 text-right font-semibold',
                  totals.pnl >= 0 ? 'text-long' : 'text-short',
                )}
              >
                {formatSignedRub(totals.pnl)}
              </td>
              <td className="mono sticky bottom-0 h-10 bg-panel-raised px-4 text-right text-fg-secondary" colSpan={4}>
                ГО {formatRub(totals.margin, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
