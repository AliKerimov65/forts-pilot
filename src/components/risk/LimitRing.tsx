// Кольцевой индикатор использования лимита Ø72px (risk.md §2.1)
// Дуга: зелёная <50%, жёлтая 50–80%, красная >80%; >80% — пульсация; центр — процент mono.
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface LimitRingProps {
  /** 0..1 (может быть >1 — зашкал) */
  ratio: number;
  label: string;
  /** Подпись-значение под кольцом, напр. «1 800 / 10 000 ₽» */
  value: string;
  /** Мини-подпись контекста/тренда под значением, caption (design-v2.md 5.6.2) */
  caption?: string;
  /** Клик по кольцу → скролл к соответствующей секции (design-v2.md 5.6.2) */
  onClick?: () => void;
  /** Задержка stagger-анимации при загрузке */
  delay?: number;
}

const R = 30;
const C = 2 * Math.PI * R;

function ringColorClass(ratio: number): string {
  if (ratio > 0.8) return 'text-short';
  if (ratio >= 0.5) return 'text-warn';
  return 'text-long';
}

const STROKE: Record<string, string> = {
  'text-long': 'var(--long)',
  'text-warn': 'var(--warn)',
  'text-short': 'var(--short)',
};

export default function LimitRing({ ratio, label, value, caption, onClick, delay = 0 }: LimitRingProps) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const colorClass = ringColorClass(ratio);
  const hot = ratio > 0.8;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick
        ? {
            type: 'button' as const,
            onClick,
            'aria-label': `${label}: ${Math.round(ratio * 100)}% — перейти к настройкам`,
          }
        : {})}
      className={cn(
        'flex w-[132px] shrink-0 snap-center flex-col items-center gap-1.5 rounded-xl p-1 text-center',
        onClick && 'transition-colors duration-[120ms] hover:bg-panel-raised',
      )}
    >
      <motion.div
        className={cn('relative h-[72px] w-[72px]', hot && 'animate-pulse')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay, duration: 0.3 }}
      >
        <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="6" />
          <motion.circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            stroke={STROKE[colorClass]}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - clamped) }}
            transition={{ delay, duration: 0.7, ease: 'easeOut' }}
          />
        </svg>
        <span className={cn('mono absolute inset-0 flex items-center justify-center text-sm font-bold', colorClass)}>
          {Math.round(ratio * 100)}%
        </span>
      </motion.div>
      <div>
        <div className="text-xs font-semibold text-fg">{label}</div>
        <div className="mono mt-0.5 text-[11px] leading-tight text-fg-secondary">{value}</div>
        {caption && <div className="mt-0.5 text-[11px] leading-tight text-fg-muted">{caption}</div>}
      </div>
    </Wrapper>
  );
}
