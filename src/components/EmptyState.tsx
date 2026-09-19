// EmptyState — единый шаблон пустого состояния v2 (v2-components.md §6)
// Иконка в круге 64px bg-panel-raised + border-subtle (или SVG-ассет 160px) → H3 16/22 →
// подпись 13/18 text-fg-secondary (max-width 320px) → до 2 CTA (primary + ghost).
// Полный вариант: вертикальные отступы 48px; compact (внутри виджетов/тела таблицы) — 24px.
// Публичные пропсы v1 сохранены; добавлены compact, secondaryLabel, onSecondary.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface EmptyStateProps {
  /** Иконка (Lucide) внутри круга — либо image */
  icon?: ReactNode;
  /** Картинка (SVG-ассет из public/) вместо иконки */
  image?: string;
  imageAlt?: string;
  title: string;
  subtitle?: string;
  /** Текст primary CTA-кнопки */
  actionLabel?: string;
  onAction?: () => void;
  /** Второй CTA (ghost), напр. «Сбросить фильтры» */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Мини-вариант внутри виджета/тела таблицы (отступы 24px вместо 48px) */
  compact?: boolean;
  className?: string;
}

export default function EmptyState({
  icon,
  image,
  imageAlt = '',
  title,
  subtitle,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-6' : 'py-12',
        className,
      )}
    >
      {image ? (
        <img src={image} alt={imageAlt} className="h-40 w-auto opacity-90" loading="lazy" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-subtle bg-panel-raised text-fg-muted">
          {icon}
        </div>
      )}
      <h3 className="mt-4 text-base font-semibold leading-[22px] text-fg">{title}</h3>
      {subtitle && <p className="mt-1 max-w-[320px] text-[13px] leading-[18px] text-fg-secondary">{subtitle}</p>}
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <div className="mt-5 flex gap-2">
          {actionLabel && onAction && (
            <Button
              onClick={onAction}
              className="h-9 rounded-[10px] bg-yellow px-4 text-sm font-semibold text-app hover:bg-yellow/90 hover:glow-accent"
            >
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              onClick={onSecondary}
              variant="outline"
              className="h-9 rounded-[10px] border-subtle bg-transparent px-4 text-sm font-medium text-fg-secondary hover:border-strong hover:bg-panel-raised hover:text-fg"
            >
              {secondaryLabel}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
