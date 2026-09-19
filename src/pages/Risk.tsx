// Риск-менеджмент — /risk (risk.md)
// Кольца лимитов «Сегодня», настройки лимитов/маржи/автоматик (risk store, persist),
// аварийная кнопка СТОП-ВСЁ (press-and-hold), история срабатываний, sticky-панель сохранения.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Bell,
  Check,
  History,
  Loader2,
  Percent,
  Power,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { cancelOrder, getPortfolio } from '@/lib/tinvest/services';
import { mockGetPortfolio } from '@/lib/tinvest/mock';
import { useConnectionStore } from '@/store/connection';
import { useRiskStore } from '@/store/risk';
import type { RiskAutomations, RiskLimits } from '@/store/risk';
import { useRobotsStore } from '@/store/robots';
import { useTradingStore } from '@/store/trading';
import { formatNumber, formatRub, formatTime, formatDateShort } from '@/lib/format';
import AnchorChips from '@/components/AnchorChips';
import Badge from '@/components/Badge';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
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

/** Склонение «изменение/изменения/изменений» */
function pluralChanges(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'изменение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'изменения';
  return 'изменений';
}

/** Цвет по заполненности лимита (зелёная <50%, жёлтая 50–80%, красная >80%) */
function ringColorClass(ratio: number): string {
  if (ratio > 0.8) return 'text-short';
  if (ratio >= 0.5) return 'text-warn';
  return 'text-long';
}

/** Панель-секция настроек v2: заголовок H3 + иконка 16px + caption-описание (design-v2.md 5.6.4) */
function Section({
  id,
  title,
  icon: Icon,
  desc,
  children,
  danger,
  flash,
  raised,
  className,
}: {
  id?: string;
  title: string;
  icon?: LucideIcon;
  desc?: string;
  danger?: boolean;
  flash?: boolean;
  /** L2-панель (raised + тень) — для аварийной остановки (design-v2.md 5.6.3) */
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'rounded-xl border p-4 transition-colors duration-500 sm:p-5',
        raised ? 'bg-panel-raised shadow-raised' : 'bg-panel',
        danger ? 'border-short/50' : 'border-subtle',
        flash && 'bg-short-dim border-short',
        className,
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        {Icon && (
          <Icon className={cn('h-4 w-4 shrink-0', danger ? 'text-short' : 'text-fg-muted')} strokeWidth={2} />
        )}
        <h2 className="text-base font-semibold leading-[22px] text-fg">{title}</h2>
        {desc && <p className="min-w-0 flex-1 truncate text-xs leading-4 text-fg-muted">{desc}</p>}
      </div>
      {children}
    </motion.section>
  );
}

/** Строка настройки: метка + контрол; dirty-кромка — inset-тень 2px жёлтая (v2-components.md §5) */
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
        '-ml-2 rounded-md pl-2 transition-shadow duration-300',
        changed && 'shadow-[inset_2px_0_0_var(--accent-yellow)]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{label}</div>
          {hint && <div className="mt-0.5 text-xs leading-4 text-fg-muted">{hint}</div>}
        </div>
        {children}
      </div>
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium leading-4 text-short">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
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
  // Тик для countdown активного ограничения в истории (design-v2.md 5.6.7)
  const [now, setNow] = useState(() => Date.now());
  // Прогресс мобильной карусели колец (полоса 2px, design-v2.md 5.6.8)
  const [ringsProgress, setRingsProgress] = useState(0);
  const ringsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

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

  // Счётчик изменённых полей для sticky-панели («3 изменения», design-v2.md 5.6.6)
  const changedCount =
    (Object.keys(limits) as (keyof RiskLimits)[]).filter((k) => draftLimits[k] !== limits[k]).length +
    (Object.keys(automations) as (keyof RiskAutomations)[]).filter((k) => draftAuto[k] !== automations[k]).length;

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

  const scrollToSection = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Countdown до конца дня для активного дневного стопа (история срабатываний)
  const msToMidnight = useMemo(() => {
    const end = new Date(now);
    end.setHours(24, 0, 0, 0);
    return Math.max(0, end.getTime() - now);
  }, [now]);
  const countdown = `${Math.floor(msToMidnight / 3_600_000)}ч ${Math.floor((msToMidnight % 3_600_000) / 60_000)}м`;
  const todayStart = new Date(now).setHours(0, 0, 0, 0);

  const pillNode = (
    <span className={cn('inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold', pill.cls)}>
      {dailyStopHit || emergencyActive ? (
        <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
      ) : (
        <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
      )}
      {pill.text}
    </span>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={PAGE_TRANSITION}
      className="space-y-4 pb-28 lg:space-y-5"
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

      {/* Шапка v2 (PageHeader, design-v2.md 5.6.1): пилюля статуса + «Не сохранено»/«Сохранить» */}
      <PageHeader
        group="Учёт и риски"
        title="Риск-менеджмент"
        subtitle={
          <>
            Убыток дня <span className="mono">−{formatNumber(dayLoss)} ₽</span>
            {' · маржа '}
            <span className="mono">{Math.round(currentMarginPct)}%</span>
          </>
        }
        statusPill={<span className="hidden sm:inline-flex">{pillNode}</span>}
        actions={
          dirty ? (
            <>
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow" />
                <span className="hidden md:inline">Не сохранено</span>
              </span>
              <button
                type="button"
                onClick={save}
                disabled={!valid || saving}
                className="flex h-8 items-center gap-1.5 rounded-[10px] bg-yellow px-3 text-[13px] font-bold text-app transition-shadow hover:glow-accent disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Сохранить
              </button>
            </>
          ) : undefined
        }
      />
      {/* Пилюля статуса под заголовком на mobile (design-v2.md 5.6.1) */}
      <div className="-mt-2 sm:hidden">{pillNode}</div>

      {/* Якоря-чипы секций (mobile, design-v2.md 5.6.8) */}
      <AnchorChips
        anchors={[
          { id: 'risk-limits', label: 'Лимиты' },
          { id: 'risk-margin', label: 'Маржа' },
          { id: 'risk-emergency', label: 'Аварийная' },
          { id: 'risk-automations', label: 'Автоматики' },
          { id: 'risk-history', label: 'История' },
        ]}
      />

      {/* «Сегодня» — кольца лимитов; клик по кольцу → скролл к секции (design-v2.md 5.6.2) */}
      <section className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={2} />
          <h2 className="text-base font-semibold leading-[22px] text-fg">Сегодня</h2>
          <p className="min-w-0 flex-1 truncate text-xs leading-4 text-fg-muted">Использование лимитов за текущую сессию</p>
        </div>
        <div
          ref={ringsRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const max = el.scrollWidth - el.clientWidth;
            setRingsProgress(max > 0 ? el.scrollLeft / max : 0);
          }}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 sm:snap-none sm:justify-around sm:overflow-visible"
        >
          <LimitRing
            ratio={lossRatio}
            label="Убыток дня"
            value={`${formatNumber(dayLoss)} / ${formatNumber(limits.dailyStopRub)} ₽`}
            caption={
              limits.dailyStopRub > 0
                ? `до стопа ${formatNumber(Math.max(0, limits.dailyStopRub - dayLoss))} ₽`
                : 'стоп выключен'
            }
            delay={0}
            onClick={() => scrollToSection('risk-limits')}
          />
          <LimitRing
            ratio={marginRatio}
            label="Маржа"
            value={`${Math.round(currentMarginPct)}% / ${limits.maxMarginPct}%`}
            caption={`ГО ${formatRub(portfolio?.blockedMargin ?? 0, 0)}`}
            delay={0.1}
            onClick={() => scrollToSection('risk-margin')}
          />
          <LimitRing
            ratio={lotsRatio}
            label="Макс. позиция"
            value={`${maxLotsNow} / ${limits.maxPositionLots} лотов`}
            caption={lotsRatio > 0 ? 'предел активен' : 'позиций нет'}
            delay={0.2}
            onClick={() => scrollToSection('risk-limits')}
          />
        </div>
        {/* Полоса-прогресс карусели (mobile, design-v2.md 5.6.8) */}
        <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-panel-raised sm:hidden">
          <div
            className="h-full w-1/3 rounded-full bg-yellow transition-transform duration-150"
            style={{ transform: `translateX(${ringsProgress * 200}%)` }}
          />
        </div>
      </section>

      {/* Сетка настроек: порядок по критичности (design-v2.md 5.6.3) */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        {/* Лимиты убытка */}
        <Section id="risk-limits" title="Лимиты убытка" icon={SlidersHorizontal} desc="Жёсткие пороги дня и позиции">
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
                    className="mono h-10 w-28 rounded-lg border border-subtle bg-inset px-3 text-sm text-fg outline-none transition-colors duration-[120ms] placeholder:text-fg-muted hover:border-strong focus:border-strong focus:shadow-[0_0_0_3px_var(--focus-ring)]"
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

        {/* Маржа и плечо */}
        <Section id="risk-margin" title="Маржа и плечо" icon={Percent} desc="Порог загрузки депозита">
          <div className="space-y-5">
            <Field
              label="Лимит маржи, %"
              hint="Роботы не откроют новые позиции выше этого порога"
              changed={draftLimits.maxMarginPct !== limits.maxMarginPct}
              error={errors.maxMarginPct}
            >
              <div className="w-full max-w-xs">
                <div className="mb-2">
                  <span className="mono inline-flex h-6 items-center rounded-md border border-subtle bg-panel-raised px-2 text-[13px] font-bold text-fg">
                    {draftLimits.maxMarginPct}%
                  </span>
                </div>
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

        {/* Аварийная кнопка — L2 с short-рамкой (design-v2.md 5.6.3) */}
        <Section
          id="risk-emergency"
          title="Аварийная остановка"
          icon={Power}
          desc="Стоп всех роботов и отмена ордеров одним действием"
          danger
          raised
          className="lg:col-span-2"
        >
          <div className="flex justify-center py-2">
            <EmergencyStop live={mode === 'live'} onActivate={emergencyActivate} />
          </div>
        </Section>

        {/* Защитные автоматики */}
        <Section id="risk-automations" title="Защитные автоматики" icon={ShieldCheck} desc="Реакция системы на срабатывание лимитов" flash={dangerFlash}>
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
        <Section id="risk-notifications" title="Уведомления" icon={Bell} desc="Какие события присылать push и в ленту">
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

      </div>

      {/* История срабатываний — таблица по §2.3 (историческая → zebra, design-v2.md 5.6.7) */}
      <section id="risk-history" className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={2} />
          <h2 className="text-base font-semibold leading-[22px] text-fg">История срабатываний</h2>
          {events.length > 0 && (
            <span className="rounded-full bg-panel-raised px-2 py-0.5 mono text-[11px] font-semibold text-fg-secondary">
              {events.length}
            </span>
          )}
          <span className="h-px flex-1 bg-subtle" />
        </div>
        <div className="overflow-hidden rounded-xl border border-subtle">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-[5] bg-panel shadow-[0_1px_0_0_var(--border-strong)]">
                <tr>
                  <th className="h-9 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                    Дата и время
                  </th>
                  <th className="h-9 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                    Лимит
                  </th>
                  <th className="h-9 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                    Событие
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState
                        compact
                        icon={<ShieldCheck className="h-6 w-6 text-long" strokeWidth={1.5} />}
                        title="Срабатываний не было"
                        subtitle="Здесь появятся события защитных лимитов и аварийной остановки"
                      />
                    </td>
                  </tr>
                ) : (
                  events.map((e) => {
                    const meta = KIND_META[e.kind] ?? { label: e.kind, variant: 'neutral' as const };
                    const activeToday = e.kind === 'daily_stop' && dailyStopHit && e.time >= todayStart;
                    return (
                      <tr
                        key={e.id}
                        className={cn(
                          'h-10 border-t border-subtle/60 transition-colors duration-[120ms] even:bg-white/[0.02] hover:bg-panel-raised',
                          activeToday && 'bg-panel-raised shadow-[inset_2px_0_0_var(--short)]',
                        )}
                      >
                        <td className="mono whitespace-nowrap px-3 text-left text-xs text-fg-muted">
                          {formatDateShort(e.time)} · {formatTime(e.time)}
                        </td>
                        <td className="px-3 text-center">
                          <Badge variant={meta.variant} size="compact">
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="min-w-0 px-3 text-sm text-fg-secondary">
                          <span className="block truncate">{e.text}</span>
                          {activeToday && (
                            <span className="mono block text-[11px] font-medium text-short">
                              до 00:00 ({countdown})
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Sticky-панель сохранения — L3, счётчик изменений (design-v2.md 5.6.6) */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed inset-x-3 bottom-[84px] z-40 mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-strong bg-overlay p-3 shadow-overlay lg:bottom-4"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
              <span className="mono mr-1.5 inline-flex h-[18px] items-center rounded-full bg-yellow-glow px-2 text-[11px] font-semibold text-yellow">
                {changedCount}
              </span>
              {pluralChanges(changedCount)} — не сохранено
            </span>
            <button
              type="button"
              onClick={() => {
                reset();
                toast('Изменения отменены', { variant: 'info' });
              }}
              disabled={saving}
              className="h-10 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:bg-panel-raised hover:text-fg disabled:opacity-50"
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
