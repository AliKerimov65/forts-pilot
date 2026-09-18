// Полоса маржи (monitor.md §1): стоимость портфеля, ГО, свободная маржа,
// загрузка депозита (прогресс-бар с делениями 50%/80% и цветовыми зонами), нереализ. P&L.
// Mobile — сворачиваемая плашка «Маржа N%» с accordion-деталями.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRub, formatSignedRub } from '@/lib/format';
import PriceTicker from '@/components/PriceTicker';

export interface MarginBarProps {
  totalAmount: number;
  blockedMargin: number;
  freeMargin: number;
  unrealizedPnl: number;
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

export default function MarginBar({ totalAmount, blockedMargin, freeMargin, unrealizedPnl }: MarginBarProps) {
  const [open, setOpen] = useState(false);
  const pct = totalAmount > 0 ? (blockedMargin / totalAmount) * 100 : 0;
  const zone = marginZone(pct);

  const cells = [
    { label: 'Стоимость портфеля', value: <PriceTicker value={totalAmount} format={(v) => formatRub(v)} /> },
    { label: 'Заблокировано ГО', value: formatRub(blockedMargin) },
    { label: 'Свободная маржа', value: formatRub(freeMargin) },
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop: полная полоса */}
      <div className="hidden items-center gap-6 md:flex">
        {cells.slice(0, 3).map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{c.label}</div>
            <div className="mono mt-1 truncate text-base font-bold text-fg">{c.value}</div>
          </div>
        ))}
        <div className="min-w-0 flex-1 px-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Загрузка депозита</span>
            <span className={cn('mono text-sm font-bold', ZONE_TEXT[zone])}>{pct.toFixed(0)}%</span>
          </div>
          <MarginProgress pct={pct} className="mt-2" />
          <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
            <span className="invisible">0</span>
            <span className="mono">50%</span>
            <span className="mono">80%</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Нереализованный P&L</div>
          <div className="mono mt-1 truncate text-base font-bold">{cells[3].value}</div>
        </div>
      </div>
    </section>
  );
}
