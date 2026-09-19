// StatCard — панель метрики: метка, mono-значение, дельта, мини-спарклайн (design.md §5, v2-components.md §3)
// v2: уровень L2 (bg-panel-raised + shadow-raised постоянно); hover — рамка border-strong БЕЗ translateY;
// кликабельная карточка получает аффорданс ArrowUpRight в углу (opacity 0 → 1 на hover) и фокус-кольцо.
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import Sparkline from '@/components/Sparkline';

export interface StatCardProps {
  /** Метка (caption uppercase) */
  label: string;
  /** Крупное mono-значение */
  value: ReactNode;
  /** Дельта, напр. "+0,98%" */
  delta?: string;
  /** Знак дельты (цвет long/short); undefined — нейтральная */
  deltaPositive?: boolean;
  /** Данные мини-спарклайна */
  sparkline?: number[];
  /** Подпись/футер под значением */
  footer?: ReactNode;
  /** Иконка справа сверху (Lucide) */
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export default function StatCard({
  label,
  value,
  delta,
  deltaPositive,
  sparkline,
  footer,
  icon,
  onClick,
  className,
}: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      role={onClick ? 'link' : undefined}
      className={cn(
        'group relative flex w-full flex-col gap-2 rounded-xl border border-subtle bg-panel-raised p-4 text-left shadow-raised transition-[border-color,box-shadow] duration-150 md:p-5',
        // v2 §4.2: hover без translateY — рамка усиливается, тень уже есть (L2)
        'hover:border-strong',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {onClick && (
        <ArrowUpRight
          className="absolute right-3 top-3 h-3.5 w-3.5 text-fg-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          aria-hidden
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">{label}</span>
        {icon}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="mono truncate text-xl font-bold leading-tight text-fg md:text-2xl">{value}</div>
          {delta && (
            <div
              className={cn(
                'mono mt-0.5 text-xs font-medium',
                deltaPositive === undefined && 'text-fg-secondary',
                deltaPositive === true && 'text-long',
                deltaPositive === false && 'text-short',
              )}
            >
              {deltaPositive === true && '▲ '}
              {deltaPositive === false && '▼ '}
              {delta}
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline
            data={sparkline}
            width={96}
            height={28}
            className="shrink-0 opacity-60 transition-opacity duration-200 group-hover:opacity-100"
          />
        )}
      </div>
      {footer && <div className="text-xs text-fg-secondary">{footer}</div>}
    </Comp>
  );
}
