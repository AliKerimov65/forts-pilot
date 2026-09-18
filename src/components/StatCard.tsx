// StatCard — панель метрики: метка, mono-значение, дельта, мини-спарклайн (design.md §5)
import type { ReactNode } from 'react';
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
      className={cn(
        'group flex w-full flex-col gap-2 rounded-xl border border-subtle bg-panel p-4 text-left transition-all duration-200 md:p-5',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-strong',
        !onClick && 'hover:-translate-y-0.5 hover:border-strong',
        className,
      )}
    >
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
