// NavBadge — атомарный бейдж навигации v2 (v2-components.md §10, v2-shell.md §2.4)
// Единый источник стиля бейджей: sidebar, tabbar, sheet «Ещё», табы со счётчиками.
// kind 'count' — пилюля 18px с mono-числом (accent — жёлтая, neutral — нейтральная);
// kind 'dot' — точка-алерт 6px (critical — красная с пульсацией, warn — янтарная, error — красная).
// Экспорт: default.
import { cn } from '@/lib/utils';

export type NavBadgeProps =
  | { kind: 'count'; count: number; variant: 'accent' | 'neutral'; className?: string }
  | { kind: 'dot'; level: 'critical' | 'warn' | 'error'; className?: string };

export default function NavBadge(props: NavBadgeProps) {
  if (props.kind === 'count') {
    const { count, variant, className } = props;
    if (count <= 0) return null;
    return (
      <span
        className={cn(
          'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1',
          'mono text-[11px] font-semibold leading-none',
          variant === 'accent' ? 'bg-yellow-glow text-yellow' : 'bg-panel-raised text-fg-secondary',
          className,
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  }

  const { level, className } = props;
  return (
    <span
      className={cn(
        'h-1.5 w-1.5 rounded-full',
        level === 'critical' && 'bg-short animate-pulse',
        level === 'warn' && 'bg-warn',
        level === 'error' && 'bg-short',
        className,
      )}
    />
  );
}
