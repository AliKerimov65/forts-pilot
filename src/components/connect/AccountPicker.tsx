// Радио-карточки выбора счёта (connection.md — шаг 2 / секция «Счета»)
import { motion } from 'framer-motion';
import { Check, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/Badge';
import type { Account } from '@/types/account';

export interface AccountPickerProps {
  accounts: Account[];
  value: string | null;
  onChange: (accountId: string) => void;
}

/** Человекочитаемый тип счёта из сырого enum Т-Инвестиций */
function accountTypeLabel(type: string): { text: string; variant: 'info' | 'accent' | 'neutral' } {
  const t = type.toUpperCase();
  if (t.includes('IIS')) return { text: 'ИИС', variant: 'info' };
  if (t.includes('INVEST_BOX')) return { text: 'Инвесткопилка', variant: 'neutral' };
  if (t.includes('TINKOFF')) return { text: 'Брокерский', variant: 'accent' };
  return { text: 'Счёт', variant: 'neutral' };
}

export default function AccountPicker({ accounts, value, onChange }: AccountPickerProps) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Выбор счёта">
      {accounts.map((a) => {
        const selected = a.id === value;
        const type = accountTypeLabel(a.type);
        return (
          <motion.button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(a.id)}
            whileTap={{ scale: 0.98 }}
            animate={{ scale: selected ? 1.01 : 1 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'flex w-full items-center gap-3 rounded-[10px] border bg-inset px-3.5 py-3 text-left transition-colors duration-200',
              selected ? 'border-yellow bg-yellow-glow' : 'border-subtle hover:border-strong',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                selected ? 'bg-yellow text-app' : 'bg-panel-raised text-fg-muted',
              )}
            >
              <Wallet className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg">{a.name}</span>
              <span className="mono block text-xs text-fg-secondary">•…{a.id.slice(-4)}</span>
            </span>
            <Badge variant={type.variant}>{type.text}</Badge>
            <motion.span
              initial={false}
              animate={{ scale: selected ? 1 : 0.4, opacity: selected ? 1 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yellow text-app"
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}
