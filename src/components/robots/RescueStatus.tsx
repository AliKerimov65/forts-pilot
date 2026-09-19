// Статус rescue-робота («Спасатель позиции») для карточки:
// состояние + вердикт анализатора с confidence, reasoning (до 3 строк),
// лестница плана чипами (выполнен/активен/ожидает), прогресс-бар recoveredPct,
// отсчёт до маржинального дедлайна (мм:сс, красный < 15 мин), чип маржи.
// Данные — снапшот движка getRescueStatus (поллинг 3с у активных).
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { RESCUE_STATE_LABELS, RESCUE_VERDICT_LABELS } from '@/lib/robots/config';
import type { RescueStep } from '@/lib/robots/rescue';
import { RegimeMarginChip } from './RegimeStatus';
import { useRescueStatus } from './utils';

/** Раз-секундный тик для обратного отсчёта до маржинального дедлайна */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** мм:сс (или ч:мм:сс при > 1 часа) */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Чип шага плана спасения: выполнен — зелёная галочка, активен — пульс, ожидает — серый */
function PlanStepChip({ step, active }: { step: RescueStep; active: boolean }) {
  const label = RESCUE_VERDICT_LABELS[step.kind] ?? step.kind;
  const trigger = step.triggerPrice > 0 ? `@ ${formatNumber(step.triggerPrice, 2)}` : 'по рынку';
  return (
    <span
      title={step.reason}
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[11px] font-semibold leading-none',
        step.done
          ? 'bg-long-dim text-long'
          : active
            ? 'border border-yellow/50 bg-yellow-glow text-yellow pulse-dot'
            : 'bg-panel-raised text-fg-muted',
      )}
    >
      {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
      {label} <span className="mono font-medium">{step.lots}л</span>
      {!step.done && <span className="mono font-normal opacity-80">{trigger}</span>}
    </span>
  );
}

export function RescueStatusPanel({ robotId, running }: { robotId: string; running: boolean }) {
  const snap = useRescueStatus(robotId, running);
  const now = useNow(running && snap?.msToDeadline != null);

  if (!snap) {
    return (
      <div className="mt-3 rounded-lg border border-subtle bg-inset px-3 py-2 text-xs text-fg-muted">
        Ожидание анализа — спасатель ещё не работал в этой сессии
      </div>
    );
  }

  // msToDeadline из снапшота посчитан на момент полла — пересчитываем от живого тика
  const msToDeadline = snap.marginDeadline != null ? snap.marginDeadline - now : snap.msToDeadline;
  const deadlineSoon = msToDeadline != null && msToDeadline < 15 * 60_000;
  const recovered = Math.min(1, Math.max(0, snap.recoveredPct));
  const firstPendingIdx = snap.plan.findIndex((s) => !s.done);

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-subtle bg-inset px-3 py-2.5">
      {/* Состояние + вердикт анализатора */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-[22px] items-center rounded-full bg-yellow-glow px-2 text-[11px] font-semibold leading-none text-yellow">
          {RESCUE_STATE_LABELS[snap.state] ?? snap.state}
        </span>
        <span className="text-[11px] font-semibold text-fg">
          {RESCUE_VERDICT_LABELS[snap.verdict] ?? snap.verdict}
          <span className="mono ml-1 font-medium text-fg-muted">{Math.round(snap.confidence * 100)}%</span>
        </span>
        {msToDeadline != null && (
          <span
            className={cn(
              'mono ml-auto text-xs',
              deadlineSoon ? 'font-bold text-short' : 'text-fg-secondary',
            )}
            title="Дедлайн возврата плеча (без комиссии за перенос)"
          >
            до возврата маржи <span className={cn('font-bold', deadlineSoon ? 'text-short' : 'text-fg')}>{formatCountdown(msToDeadline)}</span>
          </span>
        )}
      </div>

      {/* Reasoning — до 3 строк маленьким текстом */}
      {snap.reasoning.length > 0 && (
        <ul className="space-y-0.5">
          {snap.reasoning.slice(0, 3).map((line, i) => (
            <li key={i} className="truncate text-[11px] leading-4 text-fg-muted" title={line}>
              · {line}
            </li>
          ))}
        </ul>
      )}

      {/* План спасения — лестница чипов */}
      {snap.plan.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {snap.plan.map((step, i) => (
            <PlanStepChip key={i} step={step} active={i === firstPendingIdx} />
          ))}
        </div>
      )}

      {/* Прогресс восстановления + маржа */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-raised">
            <div
              className="h-full rounded-full bg-long transition-[width] duration-500"
              style={{ width: `${Math.round(recovered * 100)}%` }}
            />
          </div>
          <div className="mono mt-1 text-[10px] leading-3 text-fg-muted">
            отыграно <span className="font-semibold text-fg-secondary">{Math.round(recovered * 100)}%</span>
            {snap.addsLots > 0 && ` · добавки ${snap.addsLots} лот`}
            {snap.hedgeLots > 0 && ` · хедж ${snap.hedgeLots} лот`}
          </div>
        </div>
        <RegimeMarginChip level={snap.marginLevel} utilization={snap.marginUtilization} />
      </div>

      {snap.lastEventText && <div className="truncate text-[11px] leading-4 text-fg-muted">{snap.lastEventText}</div>}
    </div>
  );
}
