// Локальные контролы страницы «Роботы» (design.md §5): SegmentedControl, ToggleSwitch, Stepper.
// Свои — общие components/* редактировать нельзя, а ui/* использует shadcn-токены,
// которых нет в палитре FORTS PILOT.
import { useId, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------- SegmentedControl ----------

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  return (
    <div className={cn('flex rounded-[10px] bg-inset p-1', className)} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex-1 rounded-lg font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-seg`}
                className="absolute inset-0 rounded-lg border-b-2 border-yellow bg-panel-raised"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- ToggleSwitch (44×24, active — жёлтый трек) ----------

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-yellow' : 'bg-inset border border-subtle',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <motion.span
        className={cn(
          'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full shadow',
          checked ? 'bg-app' : 'bg-fg-muted',
        )}
        animate={{ left: checked ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

// ---------- Stepper (− значение +) ----------

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  suffix,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-subtle text-fg-secondary transition-colors hover:border-strong hover:text-fg disabled:opacity-40';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Minus className="h-4 w-4" />
      </button>
      <span className="mono min-w-[52px] text-center text-sm font-semibold text-fg">
        {value}
        {suffix && <span className="ml-1 text-xs text-fg-muted">{suffix}</span>}
      </span>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------- NumberField (mono-инпут с меткой) ----------

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  hint,
  error,
  className,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: ReactNode;
  error?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">
          {label}
        </span>
      )}
      <span
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-inset px-3 py-2 transition-colors',
          error ? 'border-short' : focused ? 'border-strong' : 'border-subtle',
        )}
      >
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) onChange(v);
            else if (e.target.value === '') onChange(0);
          }}
          className="mono w-full bg-transparent text-sm font-medium text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && <span className="mono shrink-0 text-xs text-fg-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}
