// Панель параметров стратегии 'regime' («Регламент MOEX · Hedge») — шаг 2 визарда.
// Группы: регламент сессии, хедж, клиринг-детектор, прибыль/переоткрытие,
// защита от маржин-колла. Подписи и описания — из REGIME_CONFIG_LABELS (контракт).
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { REGIME_CONFIG_LABELS, type RegimeConfig } from '@/lib/robots/config';
import { NumberField, Stepper, ToggleSwitch } from './controls';
import { validateRegimeConfig } from './utils';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-subtle bg-inset/60 p-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">{title}</h4>
      {children}
    </section>
  );
}

function Hint({ field }: { field: keyof typeof REGIME_CONFIG_LABELS }) {
  return <p className="text-xs leading-4 text-fg-muted">{REGIME_CONFIG_LABELS[field].description}</p>;
}

/** Слайдер с mono-значением (паттерн «Количество уровней» из шага grid) */
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

export default function RegimeParamsPanel({
  value,
  onChange,
}: {
  value: RegimeConfig;
  onChange: (next: RegimeConfig) => void;
}) {
  const set = (patch: Partial<RegimeConfig>) => onChange({ ...value, ...patch });
  const errors = validateRegimeConfig(value);
  const flatWindowError = value.flatBeforeCloseMinMin >= value.flatBeforeCloseMaxMin;
  const marginOrderError = !(value.marginWarn < value.marginReduce && value.marginReduce < value.marginEmergency);

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

      {/* ===== Регламент сессии ===== */}
      <Group title="Регламент сессии">
        <NumberField
          label={REGIME_CONFIG_LABELS.entryOffsetMin.label}
          value={value.entryOffsetMin}
          onChange={(v) => set({ entryOffsetMin: clamp(v, 5, 20) })}
          min={5}
          max={20}
          step={1}
          suffix="мин"
          hint={REGIME_CONFIG_LABELS.entryOffsetMin.description}
        />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={REGIME_CONFIG_LABELS.flatBeforeCloseMinMin.label}
            value={value.flatBeforeCloseMinMin}
            onChange={(v) => set({ flatBeforeCloseMinMin: clamp(v, 5, 120) })}
            min={5}
            max={120}
            step={1}
            suffix="мин"
            error={flatWindowError}
          />
          <NumberField
            label={REGIME_CONFIG_LABELS.flatBeforeCloseMaxMin.label}
            value={value.flatBeforeCloseMaxMin}
            onChange={(v) => set({ flatBeforeCloseMaxMin: clamp(v, 5, 120) })}
            min={5}
            max={120}
            step={1}
            suffix="мин"
            error={flatWindowError}
          />
        </div>
        <Hint field="flatBeforeCloseMinMin" />
        <SliderRow
          label={REGIME_CONFIG_LABELS.minConfidence.label}
          value={value.minConfidence}
          display={`${Math.round(value.minConfidence * 100)}%`}
          min={0.3}
          max={0.9}
          step={0.05}
          onChange={(v) => set({ minConfidence: round2(v) })}
          hint={REGIME_CONFIG_LABELS.minConfidence.description}
        />
      </Group>

      {/* ===== Хедж ===== */}
      <Group title="Хедж">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-fg">{REGIME_CONFIG_LABELS.hedgeEnabled.label}</span>
          <ToggleSwitch
            checked={value.hedgeEnabled}
            onChange={(v) => set({ hedgeEnabled: v })}
            label={REGIME_CONFIG_LABELS.hedgeEnabled.label}
          />
        </label>
        <Hint field="hedgeEnabled" />
        <SliderRow
          label={REGIME_CONFIG_LABELS.baseHedgeRatio.label}
          value={value.baseHedgeRatio}
          display={`${Math.round(value.baseHedgeRatio * 100)}%`}
          min={0.2}
          max={0.8}
          step={0.05}
          onChange={(v) => set({ baseHedgeRatio: round2(v) })}
          disabled={!value.hedgeEnabled}
          hint={REGIME_CONFIG_LABELS.baseHedgeRatio.description}
        />
      </Group>

      {/* ===== Клиринг-детектор ===== */}
      <Group title="Клиринг-детектор">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label={REGIME_CONFIG_LABELS.clearingWatchMin.label}
            value={value.clearingWatchMin}
            onChange={(v) => set({ clearingWatchMin: clamp(v, 3, 10) })}
            min={3}
            max={10}
            step={1}
            suffix="мин"
          />
          <NumberField
            label={REGIME_CONFIG_LABELS.jumpZThreshold.label}
            value={value.jumpZThreshold}
            onChange={(v) => set({ jumpZThreshold: clamp(v, 2, 4) })}
            min={2}
            max={4}
            step={0.1}
            suffix="z"
          />
        </div>
        <Hint field="jumpZThreshold" />
      </Group>

      {/* ===== Прибыль и переоткрытие ===== */}
      <Group title="Прибыль и переоткрытие">
        <NumberField
          label={REGIME_CONFIG_LABELS.takeProfitPts.label}
          value={value.takeProfitPts}
          onChange={(v) => set({ takeProfitPts: Math.max(10, Math.round(v)) })}
          min={10}
          step={10}
          suffix="шагов"
          hint={REGIME_CONFIG_LABELS.takeProfitPts.description}
        />
        <SliderRow
          label={REGIME_CONFIG_LABELS.tpClosePct.label}
          value={value.tpClosePct}
          display={`${Math.round(value.tpClosePct * 100)}%`}
          min={0.25}
          max={0.75}
          step={0.05}
          onChange={(v) => set({ tpClosePct: round2(v) })}
          hint={REGIME_CONFIG_LABELS.tpClosePct.description}
        />
        <SliderRow
          label={REGIME_CONFIG_LABELS.reentryRetracePct.label}
          value={value.reentryRetracePct}
          display={`${Math.round(value.reentryRetracePct * 100)}%`}
          min={0.2}
          max={0.5}
          step={0.05}
          onChange={(v) => set({ reentryRetracePct: round2(v) })}
          hint={REGIME_CONFIG_LABELS.reentryRetracePct.description}
        />
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-fg">{REGIME_CONFIG_LABELS.trailingEnabled.label}</span>
          <ToggleSwitch
            checked={value.trailingEnabled}
            onChange={(v) => set({ trailingEnabled: v })}
            label={REGIME_CONFIG_LABELS.trailingEnabled.label}
          />
        </label>
      </Group>

      {/* ===== Защита от маржин-колла ===== */}
      <Group title="Защита от маржин-колла">
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
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">{REGIME_CONFIG_LABELS.lots.label}</span>
          <Stepper value={value.lots} onChange={(v) => set({ lots: v })} min={1} max={20} suffix="лот" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">{REGIME_CONFIG_LABELS.maxPositionLots.label}</span>
          <Stepper
            value={value.maxPositionLots}
            onChange={(v) => set({ maxPositionLots: v })}
            min={1}
            max={50}
            suffix="лот"
          />
        </div>
        <Hint field="maxPositionLots" />
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
