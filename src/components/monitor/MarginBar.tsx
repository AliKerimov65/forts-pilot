// Полоса маржи (monitor.md §1): стоимость портфеля, ГО, свободная маржа,
// загрузка депозита (прогресс-бар с делениями 50%/80% и цветовыми зонами), нереализ. P&L.
// Mobile — сворачиваемая плашка «Маржа N%» с accordion-деталями.
import { useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRub, formatSignedRub } from '@/lib/format';
import PriceTicker from '@/components/PriceTicker';
import { useRiskStore } from '@/store/risk';
import type { MarginAttributes } from '@/lib/tinvest/services';

export interface MarginBarProps {
  totalAmount: number;
  blockedMargin: number;
  freeMargin: number;
  unrealizedPnl: number;
  /** Ликвидный портфель из UsersService/GetMarginAttributes (₽); undefined — данные ещё не загружены */
  liquidPortfolio?: number;
  /**
   * Маржинальные атрибуты счёта (UsersService/GetMarginAttributes).
   * Когда переданы — «Заблокировано» = startingMargin, «Свободная маржа» = amountOfMarginFunds
   * («запас маржи»), утилизация = startingMargin / liquidPortfolio.
   */
  marginAttr?: MarginAttributes | null;
  /** Ошибка загрузки маржи (НЕ глушим): показываем стейт с причиной и кнопкой «Повторить» */
  marginError?: string | null;
  /** Маржинальная торговля не подключена на счёте (API вернуло нули) */
  marginNotEnabled?: boolean;
  onMarginRetry?: () => void;
}

function marginZone(pct: number): 'long' | 'warn' | 'short' {
  if (pct >= 80) return 'short';
  if (pct >= 50) return 'warn';
  return 'long';
}

const ZONE_BAR: Record<'long' | 'warn' | 'short', string> = {
  long: 'bg-long',
  warn: 'bg-warn',
  short: 'bg-short',
};
const ZONE_TEXT: Record<'long' | 'warn' | 'short', string> = {
  long: 'text-long',
  warn: 'text-warn',
  short: 'text-short',
};

function MarginProgress({ pct, className }: { pct: number; className?: string }) {
  const zone = marginZone(pct);
  return (
    <div className={cn('relative h-2 w-full rounded-full bg-inset', className)}>
      <motion.div
        className={cn('absolute inset-y-0 left-0 rounded-full', ZONE_BAR[zone])}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, pct)}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      {/* деления 50% / 80% */}
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-fg-muted/50" />
      <span className="absolute inset-y-[-2px] left-[80%] w-px bg-fg-muted/50" />
    </div>
  );
}

export default function MarginBar({
  totalAmount,
  blockedMargin,
  freeMargin,
  unrealizedPnl,
  liquidPortfolio,
  marginAttr,
  marginError,
  marginNotEnabled,
  onMarginRetry,
}: MarginBarProps) {
  const [open, setOpen] = useState(false);
  const maxMarginPct = useRiskStore((s) => s.limits.maxMarginPct);
  // С атрибутами маржи — точные значения из GetMarginAttributes (UsersService);
  // без них — фолбэк на агрегаты портфеля (сумма varMargin позиций / кэш).
  const liquid = marginAttr ? marginAttr.liquidPortfolio : liquidPortfolio;
  const blocked = marginAttr ? Math.max(0, marginAttr.startingMargin) : blockedMargin;
  const free = marginAttr ? Math.max(0, marginAttr.amountOfMarginFunds) : freeMargin;
  const pct = marginAttr
    ? marginAttr.liquidPortfolio > 0
      ? (Math.max(0, marginAttr.startingMargin) / marginAttr.liquidPortfolio) * 100
      : marginAttr.amountOfMissingFunds > 0
        ? 100
        : 0
    : totalAmount > 0
      ? (blockedMargin / totalAmount) * 100
      : 0;
  const zone = marginZone(pct);

  // Явные стейты маржи: ошибка API (с повтором) / маржинальная торговля не подключена
  const marginNotice = marginError ? (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-warn/40 bg-[rgba(245,165,36,0.1)] px-3 py-2 text-[12px] font-medium text-warn">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">Данные о марже недоступны: {marginError}</span>
      {onMarginRetry && (
        <button
          type="button"
          onClick={onMarginRetry}
          className="h-7 shrink-0 rounded-md border border-warn/50 px-3 text-[12px] font-semibold text-warn transition-colors hover:bg-warn/10"
        >
          Повторить
        </button>
      )}
    </div>
  ) : marginNotEnabled ? (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-subtle bg-inset px-3 py-2 text-[12px] font-medium text-fg-secondary">
      <AlertTriangle className="h-4 w-4 shrink-0 text-fg-muted" />
      <span className="flex-1">Маржинальная торговля не подключена на этом счёте</span>
      {onMarginRetry && (
        <button
          type="button"
          onClick={onMarginRetry}
          className="h-7 shrink-0 rounded-md border border-subtle px-3 text-[12px] font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg"
        >
          Обновить
        </button>
      )}
    </div>
  ) : null;

  const cells = [
    { label: 'Стоимость портфеля', value: <PriceTicker value={totalAmount} format={(v) => formatRub(v)} /> },
    { label: 'Заблокировано', value: formatRub(blocked) },
    { label: 'Свободная маржа', value: formatRub(free) },
    // Ликвидный портфель — из GetMarginAttributes (UsersService), демо — mock
    { label: 'Ликвидный портфель', value: liquid !== undefined ? formatRub(liquid) : '—' },
    {
      label: 'Нереализованный P&L',
      value: (
        <span className={unrealizedPnl >= 0 ? 'text-long' : 'text-short'}>
          <PriceTicker value={unrealizedPnl} format={(v) => formatSignedRub(v)} signed={false} />
        </span>
      ),
    },
  ];

  return (
    <section className="rounded-xl border border-subtle bg-panel p-4 md:p-5">
      {marginNotice}
      {/* Mobile: сворачиваемая плашка */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 md:hidden"
        aria-expanded={open}
      >
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Маржа</span>
        <span className={cn('mono text-sm font-bold', ZONE_TEXT[zone])}>{pct.toFixed(0)}%</span>
        <MarginProgress pct={pct} className="flex-1" />
        <ChevronDown className={cn('h-4 w-4 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden md:hidden"
          >
            <div className="mt-4 grid grid-cols-2 gap-3">
              {cells.map((c) => (
                <div key={c.label}>
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{c.label}</div>
                  <div className="mono mt-0.5 text-sm font-semibold text-fg">{c.value}</div>
                </div>
              ))}
            </div>
            {/* v2 §5.4.2: порог из риск-настроек + переход на /risk */}
            <Link
              to="/risk"
              className="mt-3 flex items-center justify-between rounded-lg px-1 py-1 text-[11px] text-fg-muted transition-colors hover:text-fg"
            >
              <span>
                Лимит загрузки депозита: <span className="mono">{maxMarginPct}%</span> (риск-настройки)
              </span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop: полная полоса */}
      <div className="hidden items-center gap-6 md:flex">
        {cells.slice(0, 4).map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{c.label}</div>
            <div className="mono mt-1 truncate text-base font-bold text-fg">{c.value}</div>
          </div>
        ))}
        {/* v2 §5.4.2: блок маржи — ссылка на /risk (hover-аффорданс), порог лимита подписью под баром */}
        <Link to="/risk" className="group/margin min-w-0 flex-1 rounded-lg px-2 py-1 transition-colors hover:bg-panel-raised">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted transition-colors group-hover/margin:text-fg-secondary">
              Загрузка депозита
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover/margin:opacity-100" />
            </span>
            <span className={cn('mono text-sm font-bold', ZONE_TEXT[zone])}>{pct.toFixed(0)}%</span>
          </div>
          <MarginProgress pct={pct} className="mt-2" />
          <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
            <span className="mono">лимит {maxMarginPct}%</span>
            <span className="mono">50%</span>
            <span className="mono">80%</span>
          </div>
        </Link>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Нереализованный P&L</div>
          <div className="mono mt-1 truncate text-base font-bold">{cells[4].value}</div>
        </div>
      </div>
    </section>
  );
}
