// SectionTitle — заголовок секции внутри страницы v2 (v2-components.md §2)
// H2 + опциональный mono-счётчик + линия-разделитель на всю ширину + ghost-действие.
// Экспорт: default. Пропсы — SectionTitleProps.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionTitleProps {
  title: string;
  /** Счётчик-пилюля рядом с заголовком, напр. «Активные (3)» */
  count?: number;
  /** Опциональная ghost-ссылка/действие справа, напр. «Все →» */
  action?: ReactNode;
  className?: string;
}

export default function SectionTitle({ title, count, action, className }: SectionTitleProps) {
  return (
    <div className={cn('mb-3 mt-8 flex items-center gap-3 first:mt-0', className)}>
      <h2 className="text-base font-semibold leading-[22px] text-fg">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-panel-raised px-2 py-0.5 mono text-[11px] font-semibold text-fg-secondary">
          {count}
        </span>
      )}
      <span className="h-px flex-1 bg-subtle" />
      {action}
    </div>
  );
}
