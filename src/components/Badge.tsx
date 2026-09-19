// Badge — пилюля 22px (design.md §5); v2: + variant `warn`, compact-размер 18px для таблиц (v2-components.md §12)
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'long' | 'short' | 'info' | 'accent' | 'neutral' | 'warn';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  long: 'bg-long-dim text-long',
  short: 'bg-short-dim text-short',
  info: 'bg-[rgba(59,130,246,0.12)] text-info',
  accent: 'bg-yellow-glow text-yellow',
  neutral: 'bg-panel-raised text-fg-secondary',
  warn: 'bg-[rgba(245,165,36,0.12)] text-warn',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  /** compact — 18px для таблиц и плотных строк (по умолчанию default — 22px) */
  size?: 'default' | 'compact';
  children: ReactNode;
  className?: string;
}

export default function Badge({ variant = 'neutral', size = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-none',
        size === 'default' ? 'h-[22px]' : 'h-[18px]',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
