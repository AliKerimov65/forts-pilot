// Карточки выбора режима Песочница/Боевой (connection.md — шаг 3 / секция «Режим»)
import { motion } from 'framer-motion';
import { FlaskConical, TriangleAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/Badge';
import type { AppMode } from '@/types/account';

export interface ModeCardsProps {
  value: AppMode;
  onChange: (mode: AppMode) => void;
  disabled?: boolean;
}

export default function ModeCards({ value, onChange, disabled }: ModeCardsProps) {
  const card = (
    mode: AppMode,
    opts: {
      title: string;
      description: string;
      icon: typeof Zap;
      badge?: { text: string; variant: 'info' | 'accent' };
      warning?: string;
    },
  ) => {
    const selected = value === mode;
    const isLive = mode === 'live';
    return (
      <motion.button
        key={mode}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => onChange(mode)}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        animate={{ scale: selected ? 1.02 : 1 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'flex w-full flex-col gap-2 rounded-xl border bg-inset p-4 text-left transition-colors duration-200 disabled:opacity-50',
          selected
            ? isLive
              ? 'border-yellow bg-yellow-glow'
              : 'border-info bg-[rgba(59,130,246,0.10)]'
            : 'border-subtle hover:border-strong',
        )}
      >
        <span className="flex w-full items-center gap-2.5">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              selected
                ? isLive
                  ? 'bg-yellow text-app'
                  : 'bg-info text-white'
                : 'bg-panel-raised text-fg-muted',
            )}
          >
            <opts.icon className="h-4 w-4" />
          </span>
          <span className="text-sm font-bold text-fg">{opts.title}</span>
          {opts.badge && (
            <Badge variant={opts.badge.variant} className="ml-auto">
              {opts.badge.text}
            </Badge>
          )}
        </span>
        <span className="text-sm leading-relaxed text-fg-secondary">{opts.description}</span>
        {opts.warning && (
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium',
              selected ? 'bg-yellow-glow text-yellow' : 'bg-panel-raised text-fg-muted',
            )}
          >
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            {opts.warning}
          </span>
        )}
      </motion.button>
    );
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Режим работы">
      {card('sandbox', {
        title: 'Песочница',
        description: 'Виртуальные деньги. Тестируйте роботов без риска. Рекомендуем начать здесь.',
        icon: FlaskConical,
        badge: { text: 'Рекомендуется', variant: 'info' },
      })}
      {card('live', {
        title: 'Боевой',
        description: 'Реальные деньги и реальные ордера на бирже.',
        icon: Zap,
        warning: 'Роботы будут выставлять настоящие заявки',
      })}
    </div>
  );
}
