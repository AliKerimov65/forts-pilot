// ToggleSwitch 44×24 (design.md §5): active — жёлтый трек, spring-переезд ручки
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  danger?: boolean;
  'aria-label'?: string;
}

export default function Toggle({ checked, onChange, disabled, danger, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? (danger ? 'bg-short' : 'bg-yellow') : 'border border-subtle bg-panel-raised',
      )}
      {...rest}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full',
          checked ? 'left-[22px] bg-app' : 'left-0.5 bg-fg-muted',
        )}
      />
    </button>
  );
}
