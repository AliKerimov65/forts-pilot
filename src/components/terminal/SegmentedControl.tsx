// SegmentedControl — контейнер bg-inset radius 10px, активный сегмент bg-panel-raised
// с жёлтой нижней кромкой 2px, spring-переезд индикатора (design.md §5)
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface Segment {
  key: string;
  label: string;
}

export interface SegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
  /** Уникальный префикс layoutId, чтобы индикаторы разных контролов не переезжали друг в друга */
  id: string;
  className?: string;
  size?: 'sm' | 'md';
  /** Цвет активного сегмента */
  activeColor?: 'yellow' | 'long' | 'short';
}

export default function SegmentedControl({
  segments,
  value,
  onChange,
  id,
  className,
  size = 'md',
  activeColor = 'yellow',
}: SegmentedControlProps) {
  return (
    <div className={cn('flex rounded-[10px] bg-inset p-0.5', className)} role="tablist">
      {segments.map((seg) => {
        const active = seg.key === value;
        return (
          <button
            key={seg.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(seg.key)}
            className={cn(
              'relative flex-1 whitespace-nowrap rounded-[8px] font-medium transition-colors',
              size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className={cn(
                  'absolute inset-0 rounded-[8px] bg-panel-raised border-b-2',
                  activeColor === 'yellow' && 'border-yellow',
                  activeColor === 'long' && 'border-long',
                  activeColor === 'short' && 'border-short',
                )}
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative z-10">{seg.label}</span>
          </button>
        );
      })}
    </div>
  );
}
