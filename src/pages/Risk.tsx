// Риск-менеджмент — /risk (risk.md)
// Кольца лимитов «Сегодня», настройки лимитов/маржи/автоматик (risk store, persist),
// аварийная кнопка СТОП-ВСЁ (press-and-hold), история срабатываний, sticky-панель сохранения.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Check, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cancelOrder, getPortfolio } from '@/lib/tinvest/services';
import { mockGetPortfolio } from '@/lib/tinvest/mock';
import { useConnectionStore } from '@/store/connection';
import { useRiskStore } from '@/store/risk';
import type { RiskAutomations, RiskLimits } from '@/store/risk';
import { useRobotsStore } from '@/store/robots';
import { useTradingStore } from '@/store/trading';
import { formatNumber, formatRub, formatTime, formatDateShort } from '@/lib/format';
import Badge from '@/components/Badge';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import EmptyState from '@/components/EmptyState';
import { Slider } from '@/components/ui/slider';
import LimitRing from '@/components/risk/LimitRing';
import NumberStepper from '@/components/risk/NumberStepper';
import Toggle from '@/components/risk/Toggle';
import EmergencyStop from '@/components/risk/EmergencyStop';
import ToastHost from '@/components/connect/ToastHost';
import { toast } from '@/components/connect/toast';

const PAGE_TRANSITION = { duration: 0.22, ease: 'easeOut' as const };
const NOTIF_KEY = 'fp_risk_notifications';

interface NotifPrefs {
  slTp: boolean;
  approaching: boolean;
  robotStopped: boolean;
  marginCall: boolean;
}

const NOTIF_ROWS: { key: keyof NotifPrefs; label: string }[] = [
  { key: 'slTp', label: 'Срабатывание SL/TP' },
  { key: 'approaching', label: 'Приближение к лимиту 80%' },
  { key: 'robotStopped', label: 'Остановка робота' },
  { key: 'marginCall', label: 'Предупреждение маржин-колл' },
];

function loadNotifs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_KEY);
    if (raw) return { slTp: true, approaching: true, robotStopped: true, marginCall: true, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { slTp: true, approaching: true, robotStopped: true, marginCall: true };
}

const KIND_META: Record<string, { label: string; variant: 'short' | 'info' | 'accent' | 'neutral' | 'long' }> = {
  daily_stop: { label: 'Дневной лимит убытка', variant: 'short' },
  margin: { label: 'Лимит маржи', variant: 'accent' },
  position_limit: { label: 'Лимит позиции', variant: 'accent' },
  robots_limit: { label: 'Роботы', variant: 'info' },
};

/** Цвет по заполненности лимита (зелёная <50%, жёлтая 50–80%, красная >80%) */
function ringColorClass(ratio: number): string {
  if (ratio > 0.8) return 'text-short';
  if (ratio >= 0.5) return 'text-warn';
  return 'text-long';
}

/** Панель-секция настроек */
function Section({
  title,
  children,
  danger,
  flash,
  className,
}: {
  title: string;
  danger?: boolean;
  flash?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'rounded-xl border bg-panel p-4 transition-colors duration-500 sm:p-5',
        danger ? 'border-short/60 bg-short-dim' : 'border-subtle',
        flash && 'bg-short-dim border-short',
        className,
      )}
    >
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">{title}</h2>
      {children}
    </motion.section>
  );
}

/** Строка настройки: метка + контрол; жёлтая кромка слева при несохранённом изменении */
function Field({
  label,
  hint,
  changed,
  error,
  children,
}: {
  label: string;
  hint?: string;
  changed?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        '-ml-2 border-l-2 pl-2 transition-colors duration-300',
        changed ? 'border-yellow' : 'border-transparent',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{label}</div>
          {hint && <div className="mt-0.5 text-xs text-fg-secondary">{hint}</div>}
        </div>
        {children}
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-short">{error}</p>}
    </div>
  );
}

export default function Risk() {
  const limits = useRiskStore((s) => s.limits);
  const automations = useRiskStore((s) => s.automations);
  const events = useRiskStore((s) => s.events);
  const currentDayPnl = useRiskStore((s) => s.currentDayPnl);
  const currentMarginPct = useRiskStore((s) => s.currentMarginPct);
  const setLimits = useRiskStore((s) => s.setLimits);
  const setAutomations = useRiskStore((s) => s.setAutomations);

  const positions = useTradingStore((s) => s.positions);
  const portfolio = useTradingStore((s) => s.portfolio);
  const mode = useConnectionStore((s) => s.mode);

  // Черновик настроек (применяются по «Сохранить»)
  const [draftLimits, setDraftLimits] = useState<RiskLimits>(limits);
  const [draftAuto, setDraftAuto] = useState<RiskAutomations>(automations);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [confirmClosePos, setConfirmClosePos] = useState(false);
  const [dangerFlash, setDangerFlash] = useState(false);
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const [notifs, setNotifs] = useState<NotifPrefs>(loadNotifs);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useEffect(() => {
    try {
      localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs));
    } catch {
      /* ignore */
    }
  }, [notifs]);

  // Подтягиваем текущие значения (день P&L, маржа) — из trading-стора или напрямую
  useEffect(() => {
    const apply = (dayPnl: number, total: number, blocked: number) => {
      useRiskStore.getState().setCurrents(dayPnl, total > 0 ? (blocked / total) * 100 : 0);
    };
    const p = useTradingStore.getState().portfolio;
    if (p) {
      apply(p.dayPnl, p.totalAmount, p.blockedMargin);
      return;
    }
    const token = useConnectionStore.getState().token;
    if (!token) {
      const mp = mockGetPortfolio();
      apply(mp.dayPnl, mp.totalAmount, mp.blockedMargin);
      return;
    }
    getPortfolio()
      .then((r) => apply(r.dayPnl, r.totalAmount, r.blockedMargin))
      .catch(() => {
        const mp = mockGetPortfolio();
        apply(mp.dayPnl, mp.totalAmount, mp.blockedMargin);
      });
  }, []);

  // Синхронизация черновика, если стор изменился извне и нет локальных правок
  const dirty =
    JSON.stringify(draftLimits) !== JSON.stringify(limits) ||
    JSON.stringify(draftAuto) !== JSON.stringify(automations);

  // ---------- производные значения ----------

  const dayLoss = Math.max(0, -currentDayPnl);
  const lossRatio = limits.dailyStopRub > 0 ? dayLoss / limits.dailyStopRub : 0;
  const marginRatio = limits.maxMarginPct > 0 ? currentMarginPct / limits.maxMarginPct : 0;
  const maxLotsNow = useMemo(() => positions.reduce((m, p) => Math.max(m, Math.abs(p.lots)), 0), [positions]);
  const lotsRatio = limits.maxPositionLots > 0 ? maxLotsNow / limits.maxPositionLots : 0;
  const maxRatio = Math.max(lossRatio, marginRatio, lotsRatio);
  const dailyStopHit = limits.dailyStopRub > 0 && currentDayPnl <= -limits.dailyStopRub;

  const portfolioPct =
    portfolio && portfolio.totalAmount > 0 && draftLimits.dailyStopRub > 0
      ? (draftLimits.dailyStopRub / portfolio.totalAmount) * 100
      : null;

  // ---------- валидация ----------

  const errors: Partial<Record<keyof RiskLimits, string>> = {};
  if (draftLimits.dailyStopRub < 0 || draftLimits.dailyStopRub > 50_000)
    errors.dailyStopRub = 'Допустимо 0–50 000 ₽ (0 — стоп выключен)';
  if (draftLimits.maxPositionLots < 1) errors.maxPositionLots = 'Минимум 1 лот';
  if (draftLimits.maxMarginPct < 10 || draftLimits.maxMarginPct > 90) errors.maxMarginPct = 'Допустимо 10–90%';
  if (draftLimits.maxActiveRobots < 1) errors.maxActiveRobots = 'Минимум 1 робот';
  const valid = Object.keys(errors).length === 0;

  // ---------- действия ----------

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 500)); // спиннер 500ms (risk.md §3)
    setLimits(draftLimits);
    setAutomations(draftAuto);
    setSaving(false);
    setSavedTick(true);
    flashTimer.current = setTimeout(() => setSavedTick(false), 1200);
    toast('Настройки рисков сохранены', {
      details: `дневной стоп ${formatRub(draftLimits.dailyStopRub, 0)} · маржа ${draftLimits.maxMarginPct}%`,
      variant: 'success',
    });
  };

  const reset = () => {
    setDraftLimits(limits);
    setDraftAuto(automations);
  };

  const toggleAuto = (key: keyof RiskAutomations, v: boolean) => {
    if (key === 'closePositionsOnDailyStop' && v) {
      setConfirmClosePos(true); // опасный тогл — ConfirmDangerModal (risk.md §3)
      return;
    }
    setDraftAuto((a) => ({ ...a, [key]: v }));
  };

  /** Аварийная остановка: стоп всех роботов + отмена ордеров + запись в историю */
  const emergencyActivate = useCallback((closePositions: boolean) => {
    const rs = useRobotsStore.getState();
    const active = rs.robots.filter((r) => r.status === 'running' || r.status === 'paused');
    active.forEach((r) => rs.setStatus(r.id, 'off'));

    const ts = useTradingStore.getState();
    const openOrders = ts.orders.filter((o) => o.status === 'new' || o.status === 'partially_filled');
    const hasToken = Boolean(useConnectionStore.getState().token);
    openOrders.forEach((o) => {
      if (hasToken) cancelOrder(o.orderId).catch(() => undefined); // лучшее усилие
      ts.removeOrder(o.orderId);
    });

    useRiskStore.getState().addEvent({
      kind: 'robots_limit',
      text: `Аварийная остановка: остановлено роботов ${active.length}, отменено ордеров ${openOrders.length}. Позиции: ${closePositions ? 'закрыть' : 'оставить'}.`,
    });

    navigator.vibrate?.(80);
    setEmergencyActive(true);
    setScreenFlash(true);
    setTimeout(() => setScreenFlash(false), 220);
    toast('Аварийная остановка выполнена', {
      details: `роботов остановлено: ${active.length} · ордеров отменено: ${openOrders.length}`,
      variant: 'error',
    });
  }, []);

  const pill = dailyStopHit
    ? { text: 'Лимит сработал — торговля ограничена', cls: 'bg-short-dim text-short' }
    : emergencyActive
      ? { text: 'Торговля остановлена аварийно', cls: 'bg-short-dim text-short' }
      : maxRatio >= 0.8
        ? { text: 'Приближение к лимиту', cls: 'bg-yellow-glow text-warn' }
        : { text: 'Все лимиты в норме', cls: 'bg-long-dim text-long' };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={PAGE_TRANSITION}
      className="space-y-4 pb-28"
    >
      <ToastHost />

      {/* Вспышка красным при аварийной остановке */}
      <AnimatePresence>
        {screenFlash && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[90] bg-short/25"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>

      {/* Шапка */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-extrabold leading-7 tracking-tight text-fg sm:text-[28px] sm:leading-[34px]">
          Риск-менеджмент
        </h1>
        <span className={cn('ml-auto rounded-full px-3 py-1.5 text-xs font-bold', pill.cls)}>
          {dailyStopHit || emergencyActive ? (
            <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" />
          )}
          {pill.text}
        </span>
      </div>

      {/* «Сегодня» — кольца лимитов */}
      <section className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">Сегодня</h2>
        <div className="flex gap-4 overflow-x-auto pb-1 sm:justify-around sm:overflow-visible">
          <LimitRing
            ratio={lossRatio}
            label="Убыток дня"
            value={`${formatNumber(dayLoss)} / ${formatNumber(limits.dailyStopRub)} ₽`}
            delay={0}
          />
          <LimitRing
            ratio={marginRatio}
            label="Маржа"
            value={`${Math.round(currentMarginPct)}% / ${limits.maxMarginPct}%`}
            delay={0.1}
          />
          <LimitRing
            ratio={lotsRatio}
            label="Макс. позиция"
            value={`${maxLotsNow} / ${limits.maxPositionLots} лотов`}
            delay={0.2}
          />
        </div>
      </section>

      {/* Сетка настроек */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Лимиты */}
        <Section title="Лимиты">
          <div className="space-y-5">
            <Field
              label="Дневной стоп, ₽"
              hint={portfolioPct !== null ? `= ${portfolioPct.toFixed(1).replace('.', ',')}% портфеля` : '0 — стоп выключен'}
              changed={draftLimits.dailyStopRub !== limits.dailyStopRub}
              error={errors.dailyStopRub}
            >
              <div className="w-full max-w-xs">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={50_000}
                    step={500}
                    value={draftLimits.dailyStopRub}
                    onChange={(e) =>
                      setDraftLimits((l) => ({ ...l, dailyStopRub: Math.round(Number(e.target.value) || 0) }))
                    }
                    className="mono h-9 w-28 rounded-lg border border-subtle bg-inset px-2.5 text-sm text-fg outline-none focus:border-strong"
                    aria-label="Дневной стоп в рублях"
                  />
                  <span className={cn('mono text-xs font-semibold', ringColorClass(lossRatio))}>
                    сегодня −{formatNumber(dayLoss)} ₽
                  </span>
                </div>
                <Slider
                  value={[Math.min(50_000, Math.max(0, draftLimits.dailyStopRub))]}
                  min={0}
                  max={50_000}
                  step={500}
                  onValueChange={([v]) => setDraftLimits((l) => ({ ...l, dailyStopRub: v }))}
                  aria-label="Дневной стоп, слайдер"
                />
              </div>
            </Field>

            <Field
              label="Макс. размер позиции, лоты"
              hint="На один инструмент"
              changed={draftLimits.maxPositionLots !== limits.maxPositionLots}
              error={errors.maxPositionLots}
            >
              <NumberStepper
                value={draftLimits.maxPositionLots}
                min={1}
                max={100}
                onChange={(v) => setDraftLimits((l) => ({ ...l, maxPositionLots: v }))}
                aria-label="Макс. размер позиции"
              />
            </Field>

            <Field
              label="Макс. активных роботов"
              changed={draftLimits.maxActiveRobots !== limits.maxActiveRobots}
              error={errors.maxActiveRobots}
            >
              <NumberStepper
                value={draftLimits.maxActiveRobots}
                min={1}
                max={20}
                onChange={(v) => setDraftLimits((l) => ({ ...l, maxActiveRobots: v }))}
                aria-label="Макс. активных роботов"
              />
            </Field>

            <Link to="/robots" className="inline-block text-xs font-semibold text-yellow hover:underline">
              Лимиты конкретного робота →
            </Link>
          </div>
        </Section>

        {/* Маржа */}
        <Section title="Маржа">
          <div className="space-y-5">
            <Field
              label="Лимит маржи, %"
              hint="Роботы не откроют новые позиции выше этого порога"
              changed={draftLimits.maxMarginPct !== limits.maxMarginPct}
              error={errors.maxMarginPct}
            >
              <div className="w-full max-w-xs">
                <div className="mono mb-2 text-sm font-bold text-fg">{draftLimits.maxMarginPct}%</div>
                <Slider
                  value={[draftLimits.maxMarginPct]}
                  min={10}
                  max={90}
                  step={5}
                  onValueChange={([v]) => setDraftLimits((l) => ({ ...l, maxMarginPct: v }))}
                  aria-label="Лимит маржи, слайдер"
                />
                {/* цветовая шкала зон */}
                <div className="mt-2 h-1 w-full rounded-full bg-gradient-to-r from-long via-warn to-short opacity-40" />
                <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
                  <span>10%</span>
                  <span>50%</span>
                  <span>90%</span>
                </div>
              </div>
            </Field>

            <div className="rounded-[10px] bg-[rgba(59,130,246,0.10)] px-3 py-2.5 text-xs text-info">
              Текущее ГО по открытым позициям:{' '}
              <span className="mono font-semibold">{formatRub(portfolio?.blockedMargin ?? 0, 0)}</span>
              {' · '}
              <Link to="/positions" className="font-semibold underline">
                Смотреть загрузку маржи
              </Link>
            </div>
          </div>
        </Section>

        {/* Защитные автоматики */}
        <Section title="Защитные автоматики" flash={dangerFlash}>
          <div className="space-y-4">
            <Field
              label="Стоп роботов при дневном лимите"
              hint="Все роботы остановятся при достижении дневного стопа"
              changed={draftAuto.stopRobotsOnDailyStop !== automations.stopRobotsOnDailyStop}
            >
              <Toggle
                checked={draftAuto.stopRobotsOnDailyStop}
                onChange={(v) => toggleAuto('stopRobotsOnDailyStop', v)}
                aria-label="Стоп роботов при дневном лимите"
              />
            </Field>
            <Field
              label="Закрывать позиции при дневном стопе"
              hint="Опасная опция: позиции закроются по рынку при срабатывании лимита"
              changed={draftAuto.closePositionsOnDailyStop !== automations.closePositionsOnDailyStop}
            >
              <Toggle
                checked={draftAuto.closePositionsOnDailyStop}
                onChange={(v) => toggleAuto('closePositionsOnDailyStop', v)}
                danger
                aria-label="Закрывать позиции при дневном стопе"
              />
            </Field>
            <Field
              label="Блокировать входы при превышении маржи"
              hint="Новые ордера будут отклонены выше лимита маржи"
              changed={draftAuto.blockOrdersOnMargin !== automations.blockOrdersOnMargin}
            >
              <Toggle
                checked={draftAuto.blockOrdersOnMargin}
                onChange={(v) => toggleAuto('blockOrdersOnMargin', v)}
                aria-label="Блокировать ордера при превышении маржи"
              />
            </Field>
            <Field
              label="Подтверждение боевых ордеров"
              hint="ConfirmDangerModal перед каждым ордером в боевом режиме"
              changed={draftAuto.confirmLiveOrders !== automations.confirmLiveOrders}
            >
              <Toggle
                checked={draftAuto.confirmLiveOrders}
                onChange={(v) => toggleAuto('confirmLiveOrders', v)}
                aria-label="Подтверждение боевых ордеров"
              />
            </Field>
          </div>
        </Section>

        {/* Уведомления о рисках */}
        <Section title="Уведомления о рисках">
          <div className="space-y-4">
            {NOTIF_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg">{row.label}</span>
                <Toggle
                  checked={notifs[row.key]}
                  onChange={(v) => setNotifs((n) => ({ ...n, [row.key]: v }))}
                  aria-label={row.label}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                toast('Тест: сработал стоп-лосс по Si-12.25', { details: '−420 ₽ · робот «Si Grid»', variant: 'error' })
              }
              className="flex h-10 items-center gap-2 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
            >
              <Bell className="h-4 w-4" />
              Тестовое уведомление
            </button>
          </div>
        </Section>

        {/* Аварийная кнопка */}
        <Section title="Аварийная остановка" danger className="lg:col-span-2">
          <div className="flex justify-center py-2">
            <EmergencyStop live={mode === 'live'} onActivate={emergencyActivate} />
          </div>
        </Section>
      </div>

      {/* История срабатываний */}
      <section className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">
          История срабатываний
        </h2>
        {events.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7 text-long" />}
            title="Срабатываний не было"
            subtitle="Здесь появятся события защитных лимитов и аварийной остановки"
          />
        ) : (
          <ul className="divide-y divide-subtle">
            <AnimatePresence initial={false}>
              {events.map((e) => {
                const meta = KIND_META[e.kind] ?? { label: e.kind, variant: 'neutral' as const };
                return (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                  >
                    <span className="mono shrink-0 text-xs text-fg-muted">
                      {formatDateShort(e.time)} · {formatTime(e.time)}
                    </span>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="min-w-0 flex-1 text-sm text-fg-secondary">{e.text}</span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* Sticky-панель сохранения */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-subtle bg-panel-raised p-3 shadow-xl shadow-black/40 lg:bottom-6"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
              Есть несохранённые изменения
            </span>
            <button
              type="button"
              onClick={reset}
              disabled={saving}
              className="h-10 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:bg-panel disabled:opacity-50"
            >
              Сбросить
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid || saving}
              className="flex h-10 items-center gap-2 rounded-[10px] bg-yellow px-5 text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : savedTick ? <Check className="h-4 w-4" /> : null}
              Сохранить
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDangerModal
        open={confirmClosePos}
        onOpenChange={setConfirmClosePos}
        title="Закрывать позиции при дневном стопе?"
        description="При достижении дневного лимита убытка все открытые позиции будут закрыты по рынку, возможно с проскальзыванием."
        confirmLabel="Удерживайте для включения"
        onConfirm={() => {
          setDraftAuto((a) => ({ ...a, closePositionsOnDailyStop: true }));
          setDangerFlash(true);
          setTimeout(() => setDangerFlash(false), 500);
        }}
      />
    </motion.div>
  );
}
