// EmptyState — иконка-призрак в круге 64px, заголовок, подпись, CTA (design.md §5)
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
  /** Текст CTA-кнопки */
  actionLabel?: string;
  onAction?: () => void;
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
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-8 text-center', className)}>
      {image ? (
        <img src={image} alt={imageAlt} className="h-40 w-auto opacity-90" loading="lazy" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-panel-raised text-fg-muted">
          {icon}
        </div>
      )}
      <div>
        <div className="text-base font-semibold text-fg">{title}</div>
        {subtitle && <div className="mt-1 max-w-xs text-sm text-fg-secondary">{subtitle}</div>}
      </div>
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          className="mt-1 rounded-[10px] bg-yellow font-semibold text-app hover:bg-yellow/90 hover:glow-accent"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
