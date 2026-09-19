// PageHeader — единая шапка раздела v2 (v2-components.md §1, design-v2.md §1.5)
// Обязателен на всех страницах, кроме Дашборда (hero-полоса) и Терминала (панель инструмента).
// Высота 64px desktop / auto (~56px) mobile; нижний отступ до контента 20px.
// Экспорт: default. Пропсы — PageHeaderProps.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Группа раздела: «Торговля», «Автоматика», «Учёт и риски», «Система» (только desktop) */
  group: string;
  /** Заголовок H1 (24/32 desktop, 20/26 mobile) */
  title: string;
  /** Живой контекст под заголовком: счётчики, статусы, mono-время */
  subtitle?: ReactNode;
  /** Пилюля статуса справа (напр. «Все лимиты в норме» на Рисках) */
  statusPill?: ReactNode;
  /** До 2 кнопок; остальное — в overflow-меню «⋯» */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ group, title, subtitle, statusPill, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-5 flex items-end justify-between gap-4 lg:h-16', className)}>
      <div className="min-w-0">
        <div className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted lg:block">
          {group}
        </div>
        <h1 className="mt-0.5 truncate text-xl font-bold leading-[26px] tracking-[-0.01em] text-fg lg:text-2xl lg:leading-8">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 truncate text-[13px] leading-[18px] text-fg-secondary">{subtitle}</p>}
      </div>
      {(statusPill || actions) && (
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          {statusPill}
          {actions}
        </div>
      )}
    </header>
  );
}
