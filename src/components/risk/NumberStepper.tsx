// Степпер числового значения (risk.md — «Макс. лотов…» и т.п.)
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NumberStepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  'aria-label'?: string;
}

export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  disabled,
  ...rest
}: NumberStepperProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn = cn(
    'flex h-9 w-9 items-center justify-center rounded-lg text-fg-secondary transition-colors',
    'hover:bg-panel-raised hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent',
  );
  return (
    <div className="flex items-center gap-1 rounded-[10px] border border-subtle bg-inset p-1" {...rest}>
      <button type="button" className={btn} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} aria-label="Уменьшить">
        <Minus className="h-4 w-4" />
      </button>
      <span className="mono w-12 text-center text-sm font-semibold text-fg">{value}</span>
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} aria-label="Увеличить">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
