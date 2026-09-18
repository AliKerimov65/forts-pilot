// Badge — пилюля 22px (design.md §5)
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'long' | 'short' | 'info' | 'accent' | 'neutral';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  long: 'bg-long-dim text-long',
  short: 'bg-short-dim text-short',
  info: 'bg-[rgba(59,130,246,0.12)] text-info',
  accent: 'bg-yellow-glow text-yellow',
  neutral: 'bg-panel-raised text-fg-secondary',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export default function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-none',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
