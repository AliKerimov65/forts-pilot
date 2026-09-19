// «Риск-контроль по счетам» — ручное отключение дневного стоп-лосса по конкретному
// счёту (risk overrides из CONTRACT). Отключается ТОЛЬКО daily-stop; маржинальный
// emergency-флэт работает всегда. Отключение — через ConfirmDangerModal (press-and-hold),
// включение — мгновенно, без модала.
import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateShort, formatTime } from '@/lib/format';
import type { Account } from '@/types/account';
import { useConnectionStore } from '@/store/connection';
import { useRiskStore } from '@/store/risk';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import Toggle from '@/components/risk/Toggle';
import { toast } from '@/components/connect/toast';

/** Счета для списка: боевые — из connection store; в демо без счетов — один демо-счёт */
export function useRiskAccounts(): Account[] {
  const accounts = useConnectionStore((s) => s.accounts);
  const accountId = useConnectionStore((s) => s.accountId);
  if (accounts.length > 0) return accounts;
  return [{ id: accountId ?? 'demo', name: 'Демо-счёт', type: '', status: '' }];
}

export default function AccountRiskControl() {
  const accounts = useRiskAccounts();
  const currentAccountId = useConnectionStore((s) => s.accountId);
  const overrides = useRiskStore((s) => s.accountOverrides);
  const setOverride = useRiskStore((s) => s.setAccountRiskOverride);
  const addEvent = useRiskStore((s) => s.addEvent);
  const [confirmFor, setConfirmFor] = useState<Account | null>(null);

  const onToggle = (acc: Account, next: boolean) => {
    if (next) {
      // Включение риск-контроля — мгновенно, без подтверждения
      setOverride(acc.id, false);
      addEvent({ kind: 'robots_limit', text: `Риск-контроль включён снова для счёта «${acc.name}»` });
      toast('Риск-контроль включён', { details: acc.name, variant: 'success' });
      return;
    }
    // Отключение — опасное действие: press-and-hold подтверждение
    setConfirmFor(acc);
  };

  return (
    <div className="space-y-2">
      {accounts.map((acc) => {
        const override = overrides[acc.id];
        const disabled = override?.disabled === true;
        const isCurrent = acc.id === currentAccountId || (currentAccountId == null && acc.id === 'demo');
        return (
          <div
            key={acc.id}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border px-3 py-2.5',
              disabled ? 'border-short/50 bg-short-dim/40' : 'border-subtle bg-inset',
            )}
          >
            {disabled ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-short" strokeWidth={2} />
            ) : (
              <ShieldCheck className="h-4 w-4 shrink-0 text-long" strokeWidth={2} />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-fg">{acc.name}</span>
                {isCurrent && (
                  <span className="rounded-full bg-panel-raised px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">
                    текущий
                  </span>
                )}
                {disabled && (
                  <span className="rounded-full bg-short-dim px-2 py-0.5 text-[11px] font-bold text-short">
                    Риски отключены
                  </span>
                )}
              </div>
              <div className="mono mt-0.5 text-[11px] text-fg-muted">
                {disabled && override?.disabledAt
                  ? `отключены ${formatDateShort(Date.parse(override.disabledAt))} · ${formatTime(Date.parse(override.disabledAt))}`
                  : 'дневной стоп-лосс активен'}
                {disabled && override?.note ? ` · ${override.note}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn('text-xs font-medium', disabled ? 'text-short' : 'text-fg-secondary')}>
                {disabled ? 'Отключён' : 'Включён'}
              </span>
              {disabled && (
                <button
                  type="button"
                  onClick={() => onToggle(acc, true)}
                  className="h-8 rounded-lg border border-subtle px-3 text-xs font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
                >
                  Включить снова
                </button>
              )}
              <Toggle
                checked={!disabled}
                onChange={(v) => onToggle(acc, v)}
                aria-label={`Риск-контроль счёта ${acc.name}`}
              />
            </div>
          </div>
        );
      })}
      <p className="text-xs leading-4 text-fg-muted">
        Отключается только автоматический дневной стоп-лосс. Защита от маржин-колла
        (экстренное закрытие) продолжает работать всегда.
      </p>

      <ConfirmDangerModal
        open={confirmFor !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmFor(null);
        }}
        title={`Отключить риск-контроль для «${confirmFor?.name}»?`}
        description="Вы отключаете автоматический дневной стоп-лосс для этого счёта. Роботы не будут остановлены при превышении дневного убытка. Защита от маржин-колла (экстренное закрытие) продолжит работать всегда."
        confirmLabel="Удерживайте для отключения"
        onConfirm={() => {
          if (!confirmFor) return;
          setOverride(confirmFor.id, true);
          addEvent({
            kind: 'daily_stop',
            text: `Дневной стоп-лосс вручную отключён для счёта «${confirmFor.name}» (защита от маржин-колла активна)`,
          });
          toast('Риск-контроль отключён', {
            details: `${confirmFor.name} · дневной стоп-лосс не остановит роботов`,
            variant: 'error',
          });
        }}
      />
    </div>
  );
}
