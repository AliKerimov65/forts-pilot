// Панель параметров стратегии 'rescue' («Спасатель позиции») — шаг параметров визарда.
// Группы: план спасения (усреднение с анти-мартингейл-кэпом), хедж-пауза, аварийный
// выход, маржинальный регламент (возврат плеча до конца дня). Подписи — из
// RESCUE_CONFIG_LABELS (контракт), валидация — validateRescueConfig.
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RESCUE_CONFIG_LABELS, type RescueConfig } from '@/lib/robots/config';
import { NumberField, Stepper, ToggleSwitch } from './controls';
import { validateRescueConfig } from './utils';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-subtle bg-inset/60 p-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">{title}</h4>
      {children}
    </section>
  );
}

function Hint({ field }: { field: keyof typeof RESCUE_CONFIG_LABELS }) {
  return <p className="text-xs leading-4 text-fg-muted">{RESCUE_CONFIG_LABELS[field].description}</p>;
}

/** Слайдер с mono-значением (паттерн из RegimeParamsPanel) */
function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className={cn(disabled && 'pointer-events-none opacity-45')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-fg">{label}</span>
        <span className="mono text-sm font-bold text-yellow">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="w-full accent-[#FFDD2D]"
        aria-label={label}
      />
      <div className="mono mt-1 flex justify-between text-[10px] text-fg-muted">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {hint && <p className="mt-1 text-xs leading-4 text-fg-muted">{hint}</p>}
    </div>
  );
}

export default function RescueParamsPanel({
  value,
  onChange,
}: {
  value: RescueConfig;
  onChange: (next: RescueConfig) => void;
}) {
  const set = (patch: Partial<RescueConfig>) => onChange({ ...value, ...patch });
  const errors = validateRescueConfig(value);
  const marginOrderError = !(value.marginWarn < value.marginReduce && value.marginReduce < value.marginEmergency);
  const totalLotsError = value.targetLots > 0 && value.maxTotalLots <= value.targetLots;

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="space-y-1 rounded-xl border border-short bg-short-dim p-3">
          {errors.map((e) => (
            <div key={e} className="flex items-start gap-1.5 text-xs font-medium text-short">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {e}
            </div>
          ))}
        </div>
      )}

      {/* ===== План спасения ===== */}
      <Group title="План спасения">
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">{RESCUE_CONFIG_LABELS.maxAvgSteps.label}</span>
          <Stepper value={value.maxAvgSteps} onChange={(v) => set({ maxAvgSteps: v })} min={1} max={5} />
        </div>
        <Hint field="maxAvgSteps" />
        <SliderRow
          label={RESCUE_CONFIG_LABELS.stepAtrMult.label}
          value={value.stepAtrMult}
          display={`×${value.stepAtrMult.toFixed(1)}`}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(v) => set({ stepAtrMult: round2(v) })}
          hint={RESCUE_CONFIG_LABELS.stepAtrMult.description}
        />
        <SliderRow
          label={RESCUE_CONFIG_LABELS.lotMult.label}
          value={value.lotMult}
          display={`×${value.lotMult.toFixed(2)}`}
          min={1}
          max={1.5}
          step={0.05}
          onChange={(v) => set({ lotMult: round2(v) })}
          hint={`${RESCUE_CONFIG_LABELS.lotMult.description}. Защита от мартингейла: жёсткий кэп ×1.5.`}
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">{RESCUE_CONFIG_LABELS.maxTotalLots.label}</span>
          <Stepper
            value={value.maxTotalLots}
            onChange={(v) => set({ maxTotalLots: v })}
            min={1}
            max={50}
            suffix="лот"
          />
        </div>
        {totalLotsError && (
          <p className="flex items-center gap-1 text-xs font-medium text-short">
            <AlertCircle className="h-3 w-3 shrink-0" />
            Должно быть больше лотов целевой позиции ({value.targetLots})
          </p>
        )}
        <Hint field="maxTotalLots" />
        <SliderRow
          label={RESCUE_CONFIG_LABELS.recoverTargetPct.label}
          value={value.recoverTargetPct}
          display={`${(value.recoverTargetPct * 100).toFixed(1)}%`}
          min={0.001}
          max={0.02}
          step={0.001}
          onChange={(v) => set({ recoverTargetPct: round3(v) })}
          hint={RESCUE_CONFIG_LABELS.recoverTargetPct.description}
        />
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-fg">{RESCUE_CONFIG_LABELS.recoverCloseAll.label}</span>
          <ToggleSwitch
            checked={value.recoverCloseAll}
            onChange={(v) => set({ recoverCloseAll: v })}
            label={RESCUE_CONFIG_LABELS.recoverCloseAll.label}
          />
        </label>
        <Hint field="recoverCloseAll" />
      </Group>

      {/* ===== Хедж-пауза ===== */}
      <Group title="Хедж-пауза">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-fg">{RESCUE_CONFIG_LABELS.hedgePauseEnabled.label}</span>
          <ToggleSwitch
            checked={value.hedgePauseEnabled}
            onChange={(v) => set({ hedgePauseEnabled: v })}
            label={RESCUE_CONFIG_LABELS.hedgePauseEnabled.label}
          />
        </label>
        <Hint field="hedgePauseEnabled" />
      </Group>

      {/* ===== Аварийный выход ===== */}
      <Group title="Аварийный выход">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-fg">{RESCUE_CONFIG_LABELS.allowStopOut.label}</span>
          <ToggleSwitch
            checked={value.allowStopOut}
            onChange={(v) => set({ allowStopOut: v })}
            label={RESCUE_CONFIG_LABELS.allowStopOut.label}
          />
        </label>
        <Hint field="allowStopOut" />
        <SliderRow
          label={RESCUE_CONFIG_LABELS.maxDrawdownPct.label}
          value={value.maxDrawdownPct}
          display={`${(value.maxDrawdownPct * 100).toFixed(0)}%`}
          min={0.01}
          max={0.15}
          step={0.01}
          onChange={(v) => set({ maxDrawdownPct: round2(v) })}
          disabled={!value.allowStopOut}
          hint={RESCUE_CONFIG_LABELS.maxDrawdownPct.description}
        />
      </Group>

      {/* ===== Маржинальный регламент ===== */}
      <Group title="Маржинальный регламент">
        <NumberField
          label={RESCUE_CONFIG_LABELS.marginReturnBufferMin.label}
          value={value.marginReturnBufferMin}
          onChange={(v) => set({ marginReturnBufferMin: clamp(Math.round(v), 30, 120) })}
          min={30}
          max={120}
          step={5}
          suffix="мин"
          hint="Возврат плеча до конца дня — без комиссии за перенос непокрытой позиции. Дедлайн = конец основной сессии − этот буфер."
        />
        <NumberField
          label={RESCUE_CONFIG_LABELS.minActionBeforeDeadlineMin.label}
          value={value.minActionBeforeDeadlineMin}
          onChange={(v) => set({ minActionBeforeDeadlineMin: clamp(Math.round(v), 5, 60) })}
          min={5}
          max={60}
          step={1}
          suffix="мин"
          hint={RESCUE_CONFIG_LABELS.minActionBeforeDeadlineMin.description}
        />
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="Предупр., %"
            value={Math.round(value.marginWarn * 100)}
            onChange={(v) => set({ marginWarn: clamp(v, 10, 95) / 100 })}
            min={10}
            max={95}
            step={1}
            suffix="%"
            error={marginOrderError}
          />
          <NumberField
            label="Сокращение, %"
            value={Math.round(value.marginReduce * 100)}
            onChange={(v) => set({ marginReduce: clamp(v, 10, 95) / 100 })}
            min={10}
            max={95}
            step={1}
            suffix="%"
            error={marginOrderError}
          />
          <NumberField
            label="Авария, %"
            value={Math.round(value.marginEmergency * 100)}
            onChange={(v) => set({ marginEmergency: clamp(v, 10, 95) / 100 })}
            min={10}
            max={95}
            step={1}
            suffix="%"
            error={marginOrderError}
          />
        </div>
        <Hint field="marginEmergency" />
        <p className="rounded-lg bg-panel px-3 py-2 text-xs leading-4 text-fg-muted">
          Аварийный флэт добавок при маржинальном emergency работает всегда и не отключается
          риск-оверрайдами счёта.
        </p>
      </Group>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
