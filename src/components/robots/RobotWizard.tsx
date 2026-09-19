// Конструктор робота — 3-шаговый wizard (design.md robots §4):
// drawer справа 560px (desktop) / bottom-sheet 92% (mobile).
// Шаг 1: стратегия + инструмент + режим. Шаг 2: параметры с живым grid-превью.
// Шаг 3: защита (SL/TP, лимиты) и запуск (боевой — ConfirmDangerModal press-and-hold).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, ArrowLeft, ArrowRight, Check, Grid3x3, LifeBuoy, Scale, TriangleAlert, X } from 'lucide-react';
import type { Instrument } from '@/types/market';
import type { Robot, RobotParams, RobotStrategy } from '@/types/robot';
import type { Position } from '@/types/trading';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { formatNumber, formatRub } from '@/lib/format';
import { instrumentTypeLabel } from '@/lib/tinvest/instruments';
import { mockGetPositions } from '@/lib/tinvest/mock';
import { useRobotsStore } from '@/store/robots';
import { useRiskStore } from '@/store/risk';
import { useTradingStore } from '@/store/trading';
import { useConnectionStore } from '@/store/connection';
import {
  defaultProtection,
  defaultRegimeExt,
  defaultRescueExt,
  defaultSignalExt,
  getExtConfig,
  useRobotsExtStore,
  type RegimeConfig,
  type RescueConfig,
  type RobotExtConfig,
} from '@/lib/robots/config';
import { TIMEFRAMES, type SignalTimeframe } from '@/lib/robots/signal';
import { findInstrumentMeta, useInstrumentMetaMap } from '@/components/dashboard/instrumentMeta';
import InstrumentPicker from './InstrumentPicker';
import GridPreview from './GridPreview';
import RegimeParamsPanel from './RegimeParamsPanel';
import RescueParamsPanel from './RescueParamsPanel';
import { confettiPieces, validateRegimeConfig, validateRescueConfig } from './utils';
import { NumberField, SegmentedControl, Stepper, ToggleSwitch } from './controls';

const STEPS = ['Стратегия', 'Параметры', 'Защита и запуск'] as const;
// rescue: дополнительный шаг выбора целевой убыточной позиции (шаг 1.5)
const RESCUE_STEPS = ['Стратегия', 'Позиция', 'Параметры', 'Защита и запуск'] as const;

interface WizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Режим редактирования — предзаполненный конструктор */
  editRobot?: Robot | null;
  /** Предвыбор стратегии (из шаблона) */
  initialStrategy?: RobotStrategy;
}

export default function RobotWizard({ open, onOpenChange, editRobot, initialStrategy }: WizardProps) {
  const navigate = useNavigate();
  const addRobot = useRobotsStore((s) => s.addRobot);
  const updateRobot = useRobotsStore((s) => s.updateRobot);
  const setStatus = useRobotsStore((s) => s.setStatus);
  const robotsCount = useRobotsStore((s) => s.robots.length);
  const runningCount = useRobotsStore((s) => s.robots.filter((r) => r.status === 'running').length);
  const setConfig = useRobotsExtStore((s) => s.setConfig);
  const riskLimits = useRiskStore((s) => s.limits);
  const addRiskEvent = useRiskStore((s) => s.addEvent);
  const portfolio = useTradingStore((s) => s.portfolio);
  const globalMode = useConnectionStore((s) => s.mode);

  const [step, setStep] = useState(0);
  const [done, setDone] = useState<null | { name: string; launched: boolean }>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  // Шаг 1
  const [strategy, setStrategy] = useState<RobotStrategy>('grid');
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'sandbox' | 'live'>('sandbox');

  // Шаг 2 — grid
  const [levels, setLevels] = useState(8);
  const [stepType, setStepType] = useState<'abs' | 'pct'>('pct');
  const [stepValue, setStepValue] = useState(0.4);
  const [lowerBound, setLowerBound] = useState(0);
  const [upperBound, setUpperBound] = useState(0);
  const [lotsPerLevel, setLotsPerLevel] = useState(1);
  const [rebuild, setRebuild] = useState(true);

  // Шаг 2 — signal
  const sigDefaults = defaultSignalExt();
  const [signalType, setSignalType] = useState<'ema_cross' | 'rsi'>('ema_cross');
  const [timeframe, setTimeframe] = useState<SignalTimeframe>('5m');
  const [emaFast, setEmaFast] = useState(sigDefaults.emaFast);
  const [emaSlow, setEmaSlow] = useState(sigDefaults.emaSlow);
  const [rsiPeriod, setRsiPeriod] = useState(sigDefaults.rsiPeriod);
  const [rsiOversold, setRsiOversold] = useState(sigDefaults.rsiOversold);
  const [rsiOverbought, setRsiOverbought] = useState(sigDefaults.rsiOverbought);
  const [useRsiFilter, setUseRsiFilter] = useState(sigDefaults.useRsiFilter);
  const [direction, setDirection] = useState<'long' | 'short' | 'both'>('both');
  const [signalLots, setSignalLots] = useState(1);
  const [maxPosition, setMaxPosition] = useState(sigDefaults.maxPositionLots);

  // Шаг 2 — regime («Регламент MOEX · Hedge»): полный конфиг одним объектом
  const [regime, setRegime] = useState<RegimeConfig>(defaultRegimeExt());

  // Шаг 1.5/2 — rescue («Спасатель позиции»): полный конфиг + тикер целевой позиции
  const [rescue, setRescue] = useState<RescueConfig>(defaultRescueExt());
  const [targetTicker, setTargetTicker] = useState('');

  // Шаг 3
  const protDefaults = defaultProtection();
  const [slOn, setSlOn] = useState(true);
  const [tpOn, setTpOn] = useState(true);
  const [slValue, setSlValue] = useState(1); // % (grid) или пункты… см. ниже
  const [tpValue, setTpValue] = useState(2);
  const [slPts, setSlPts] = useState(30); // signal: пункты
  const [tpPts, setTpPts] = useState(60);
  const [dailyLossLimit, setDailyLossLimit] = useState(protDefaults.dailyLossLimit);
  const [maxTrades, setMaxTrades] = useState(protDefaults.maxTradesPerDay);
  const [lossStreak, setLossStreak] = useState(protDefaults.stopAfterLossStreak);
  const [ackLive, setAckLive] = useState(false);

  // ---------- инициализация / предзаполнение ----------
  useEffect(() => {
    if (!open) return;
    setDone(null);
    setStep(0);
    setAckLive(false);
    if (editRobot) {
      const ext = getExtConfig(editRobot);
      setStrategy(editRobot.strategy);
      setName(editRobot.name);
      setMode(ext.mode);
      setInstrument(null); // инструмент показываем по тикеру
      setPrice(null);
      if (editRobot.params.strategy === 'grid') {
        const g = editRobot.params.grid;
        setLevels(g.levels);
        setLotsPerLevel(g.lotsPerLevel);
        setLowerBound(g.lowerBound);
        setUpperBound(g.upperBound);
        const stepPts = g.levels > 1 ? (g.upperBound - g.lowerBound) / (g.levels - 1) : 0;
        setStepType(ext.grid?.stepType ?? 'pct');
        setStepValue(
          ext.grid?.stepType === 'abs'
            ? round2(stepPts)
            : round2(((stepPts * 2) / (g.lowerBound + g.upperBound)) * 100),
        );
        setRebuild(ext.grid?.rebuild ?? true);
        setSlValue(ext.grid?.stopLossPct ?? 1);
        setTpValue(ext.grid?.takeProfitPct ?? 2);
      } else {
        const s = editRobot.params.signal;
        setSignalType(s.signalType === 'rsi' ? 'rsi' : 'ema_cross');
        setTimeframe((TIMEFRAMES as readonly string[]).includes(s.timeframe) ? (s.timeframe as SignalTimeframe) : '5m');
        setSignalLots(s.lots);
        setSlPts(s.stopLossPts ?? 30);
        setTpPts(s.takeProfitPts ?? 60);
        setSlOn((s.stopLossPts ?? 0) > 0);
        setTpOn((s.takeProfitPts ?? 0) > 0);
        const se = ext.signal ?? sigDefaults;
        setEmaFast(se.emaFast);
        setEmaSlow(se.emaSlow);
        setRsiPeriod(se.rsiPeriod);
        setRsiOversold(se.rsiOversold);
        setRsiOverbought(se.rsiOverbought);
        setUseRsiFilter(se.useRsiFilter);
        setDirection(se.direction);
        setMaxPosition(se.maxPositionLots);
      }
      if (editRobot.strategy === 'regime') {
        setRegime({ ...defaultRegimeExt(), ...(ext.regime ?? {}) });
      }
      if (editRobot.strategy === 'rescue') {
        setRescue({ ...defaultRescueExt(), ...(ext.rescue ?? {}) });
        setTargetTicker(editRobot.ticker);
      }
      setDailyLossLimit(ext.protection.dailyLossLimit);
      setMaxTrades(ext.protection.maxTradesPerDay);
      setLossStreak(ext.protection.stopAfterLossStreak);
    } else {
      setStrategy(initialStrategy ?? 'grid');
      setName('');
      setInstrument(null);
      setPrice(null);
      setMode(globalMode);
      setDailyLossLimit(riskLimits.dailyStopRub > 0 ? Math.round(riskLimits.dailyStopRub / 2) : protDefaults.dailyLossLimit);
      setMaxTrades(protDefaults.maxTradesPerDay);
      setLossStreak(protDefaults.stopAfterLossStreak);
      setSlOn(true);
      setTpOn(true);
      setDirection('both');
      setRegime(defaultRegimeExt());
      setRescue(defaultRescueExt());
      setTargetTicker('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editRobot, initialStrategy]);

  // Авто-границы от цены при выборе инструмента / смене шага
  const recalcBounds = (p: number, lv: number, st: 'abs' | 'pct', sv: number) => {
    const stepPts = st === 'pct' ? (p * sv) / 100 : sv;
    const half = (stepPts * (lv - 1)) / 2;
    setLowerBound(round2(p - half));
    setUpperBound(round2(p + half));
  };

  const onInstrument = (ins: Instrument, lastPrice: number | null) => {
    setInstrument(ins);
    setPrice(lastPrice);
    // Шорт запрещён по инструменту (shortEnabled=false) — принудительный long-only
    if (ins.shortEnabled === false) setDirection('long');
    if (lastPrice) recalcBounds(lastPrice, levels, stepType, stepValue);
  };

  useEffect(() => {
    if (price && strategy === 'grid' && !editRobot) recalcBounds(price, levels, stepType, stepValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, stepType, stepValue]);

  // ---------- производные ----------
  // rescue: 4 шага (выбор целевой позиции между стратегией и параметрами)
  const steps: readonly string[] = strategy === 'rescue' ? RESCUE_STEPS : STEPS;
  const stepName = steps[Math.min(step, steps.length - 1)];

  const stepPts = useMemo(() => {
    if (!price) return 0;
    return stepType === 'pct' ? (price * stepValue) / 100 : stepValue;
  }, [price, stepType, stepValue]);

  const approxStepPct = price ? (stepPts / price) * 100 : 0;

  // rescue: инструмент цели резолвим из каталога по uid (маркет-стор → mock-фолбэк)
  const metaMap = useInstrumentMetaMap();
  const rescueInstrument =
    strategy === 'rescue' && rescue.targetInstrumentId ? metaMap.get(rescue.targetInstrumentId) : undefined;
  const refPrice = price ?? (strategy === 'rescue' && rescue.targetAvgPrice > 0 ? rescue.targetAvgPrice : 0);
  const marginPerLot = instrument?.marginBuy ?? rescueInstrument?.marginBuy ?? (refPrice ? refPrice * 0.12 : 0);
  const totalMargin =
    strategy === 'grid'
      ? marginPerLot * lotsPerLevel * levels
      : strategy === 'regime'
        ? marginPerLot * regime.maxPositionLots
        : strategy === 'rescue'
          ? marginPerLot * rescue.maxTotalLots
          : marginPerLot * Math.min(signalLots, maxPosition);
  const freeMargin = portfolio?.freeMargin ?? 250_000; // демо-фолбэк
  const marginOk = totalMargin <= freeMargin;

  const riskPerTrade =
    strategy === 'signal' ? (slOn ? slPts * Math.min(signalLots, maxPosition) : 0) : slOn ? (price ?? 0) * (slValue / 100) * lotsPerLevel : 0;

  const canStep1 = strategy === 'rescue' ? true : Boolean(instrument || editRobot);
  const canPickTarget = Boolean(rescue.targetInstrumentId);
  const canStep2 =
    strategy === 'grid'
      ? upperBound > lowerBound && lowerBound > 0 && levels >= 3 && lotsPerLevel >= 1 && marginOk
      : strategy === 'regime'
        ? validateRegimeConfig(regime).length === 0 && marginOk
        : strategy === 'rescue'
          ? validateRescueConfig(rescue).length === 0 && marginOk
          : signalLots >= 1 && slPts > 0;

  const canNext =
    stepName === 'Стратегия' ? canStep1 : stepName === 'Позиция' ? canPickTarget : canStep2;

  /** Выбор целевой убыточной позиции → target*-поля rescue-конфига */
  const onRescueTarget = (pos: Position) => {
    setRescue((r) => ({
      ...r,
      targetInstrumentId: pos.instrumentId,
      targetDirection: pos.direction,
      targetLots: pos.lots,
      targetAvgPrice: pos.avgPrice,
      // потолок позиции — минимум исходная + один шаг добавки
      maxTotalLots: Math.max(r.maxTotalLots, pos.lots + 1),
    }));
    setTargetTicker(pos.ticker);
  };

  // ---------- сборка результата ----------
  const buildParams = (): RobotParams =>
    strategy === 'grid'
      ? { strategy: 'grid', grid: { upperBound, lowerBound, levels, lotsPerLevel } }
      : strategy === 'regime'
        ? {
            strategy: 'regime',
            regime: { lots: regime.lots, maxPositionLots: regime.maxPositionLots },
            // обязательная оболочка совместимости (движок regime её не читает)
            signal: { signalType: 'regime', timeframe: '5m', lots: regime.lots },
          }
        : strategy === 'rescue'
          ? {
              strategy: 'rescue',
              rescue: {
                targetDirection: rescue.targetDirection,
                targetLots: rescue.targetLots,
                targetAvgPrice: rescue.targetAvgPrice,
                maxTotalLots: rescue.maxTotalLots,
              },
              // обязательная оболочка совместимости (движок rescue её не читает)
              signal: { signalType: 'rescue', timeframe: '5m', lots: rescue.targetLots },
            }
          : {
              strategy: 'signal',
              signal: {
                signalType,
                timeframe,
                lots: Math.min(signalLots, maxPosition),
                stopLossPts: slOn ? slPts : undefined,
                takeProfitPts: tpOn ? tpPts : undefined,
              },
            };

  const buildExt = (): RobotExtConfig => ({
    mode,
    protection: { dailyLossLimit, maxTradesPerDay: maxTrades, stopAfterLossStreak: lossStreak },
    ...(strategy === 'grid'
      ? { grid: { stepType, rebuild, stopLossPct: slOn ? slValue : 0, takeProfitPct: tpOn ? tpValue : 0 } }
      : strategy === 'regime'
        ? { regime }
        : strategy === 'rescue'
          ? { rescue }
          : {
            signal: {
              emaFast,
              emaSlow,
              rsiPeriod,
              rsiOversold,
              rsiOverbought,
              useRsiFilter,
              // shortEnabled=false → принудительный long-only независимо от состояния UI
              direction: instrument?.shortEnabled === false ? 'long' : direction,
              maxPositionLots: maxPosition,
            },
          }),
  });

  const robotName = () =>
    name.trim() ||
    `${instrument?.ticker ?? editRobot?.ticker ?? targetTicker ?? 'FORTS'} ${
      strategy === 'grid' ? 'Grid' : strategy === 'regime' ? 'Регламент' : strategy === 'rescue' ? 'Спасатель' : 'Signal'
    } ${robotsCount + 1}`;

  const save = (launch: boolean) => {
    const params = buildParams();
    const ext = buildExt();

    if (editRobot) {
      updateRobot(editRobot.id, { name: robotName(), params });
      setConfig(editRobot.id, ext);
      if (editRobot.status === 'running') {
        setStatus(editRobot.id, 'paused');
        useTradingStore.getState().addEvent({
          type: 'robot',
          text: `«${editRobot.name}» поставлен на паузу: параметры изменены`,
          robotId: editRobot.id,
        });
      }
      onOpenChange(false);
      return;
    }

    // Лимит активных роботов из риск-настроек
    const wouldExceed = launch && runningCount >= riskLimits.maxActiveRobots;
    const robot = addRobot({
      name: robotName(),
      strategy,
      instrumentId: strategy === 'rescue' ? rescue.targetInstrumentId : (instrument?.uid ?? ''),
      ticker: strategy === 'rescue' ? targetTicker : (instrument?.ticker ?? ''),
      params,
      status: launch && !wouldExceed ? 'running' : 'off',
      stats: {
        dayPnl: 0,
        totalPnl: 0,
        trades: 0,
        winRate: 0,
        allocatedCapital: Math.round(totalMargin),
      },
    });
    setConfig(robot.id, ext);
    if (wouldExceed) {
      addRiskEvent({
        kind: 'robots_limit',
        text: `Лимит активных роботов (${riskLimits.maxActiveRobots}) — «${robot.name}» создан выключенным`,
      });
    }
    if (launch) navigator.vibrate?.(10);
    setDone({ name: robot.name, launched: launch && !wouldExceed });
  };

  const onLaunch = () => {
    if (mode === 'live') setConfirmLive(true);
    else save(true);
  };

  // ---------- рендер ----------
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[70] bg-[rgba(4,6,10,0.7)] backdrop-blur-[8px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
          >
            <motion.div
              className={cn(
                // v2 §2.1: drawer — уровень L3 (bg-overlay + border-strong + shadow-overlay)
                'absolute inset-x-0 bottom-0 top-[8dvh] flex flex-col overflow-hidden rounded-t-2xl border border-strong bg-overlay shadow-overlay',
                'sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[560px] sm:rounded-none sm:border-y-0 sm:border-r-0',
              )}
              initial={{ opacity: 0, x: 0, y: 60 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, y: 60 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Ручка sheet (mobile) */}
              <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-fg-muted/40 sm:hidden" />

              {/* Шапка (v2 §5.3.6: подпись текущего шага под заголовком) */}
              <div className="flex items-center gap-3 border-b border-subtle px-5 py-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-fg">
                    {editRobot ? 'Редактирование робота' : 'Новый робот'}
                  </h2>
                  {!done && (
                    <p className="mt-0.5 text-xs leading-4 text-fg-muted">
                      Шаг <span className="mono">{step + 1}</span> из <span className="mono">{steps.length}</span> — {stepName}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-panel-raised hover:text-fg"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {done ? (
                <SuccessScreen
                  name={done.name}
                  launched={done.launched}
                  onClose={() => onOpenChange(false)}
                  onTerminal={() => {
                    onOpenChange(false);
                    navigate('/terminal');
                  }}
                />
              ) : (
                <>
                  {/* Прогресс */}
                  <div className="flex items-center gap-2 px-5 pt-4">
                    {steps.map((s, i) => (
                      <div key={s} className="flex-1">
                        <div className="h-1 overflow-hidden rounded-full bg-inset">
                          <motion.div
                            className={cn('h-full rounded-full', i < step ? 'bg-long' : 'bg-yellow')}
                            initial={false}
                            animate={{ width: i <= step ? '100%' : '0%' }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                        <div
                          className={cn(
                            'mt-1.5 text-[10px] font-medium uppercase tracking-[0.08em]',
                            i === step ? 'text-yellow' : i < step ? 'text-long' : 'text-fg-muted',
                          )}
                        >
                          {i + 1} · {s}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Контент шага */}
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.2 }}
                      >
                        {stepName === 'Стратегия' && (
                          <StepStrategy
                            strategy={strategy}
                            setStrategy={setStrategy}
                            instrument={instrument}
                            editTicker={editRobot?.ticker}
                            onInstrument={onInstrument}
                            direction={direction}
                            setDirection={setDirection}
                            mode={mode}
                            setMode={setMode}
                            name={name}
                            setName={setName}
                          />
                        )}
                        {stepName === 'Позиция' && (
                          <StepRescueTarget
                            rescue={rescue}
                            onSelect={onRescueTarget}
                            editTicker={editRobot?.ticker}
                          />
                        )}
                        {stepName === 'Параметры' && strategy === 'grid' && (
                          <StepGrid
                            levels={levels}
                            setLevels={setLevels}
                            stepType={stepType}
                            setStepType={setStepType}
                            stepValue={stepValue}
                            setStepValue={setStepValue}
                            approxStepPct={approxStepPct}
                            lowerBound={lowerBound}
                            setLowerBound={setLowerBound}
                            upperBound={upperBound}
                            setUpperBound={setUpperBound}
                            lotsPerLevel={lotsPerLevel}
                            setLotsPerLevel={setLotsPerLevel}
                            rebuild={rebuild}
                            setRebuild={setRebuild}
                            totalMargin={totalMargin}
                            freeMargin={freeMargin}
                            marginOk={marginOk}
                            instrumentId={instrument?.uid ?? editRobot?.instrumentId ?? null}
                            price={price}
                            onFromPrice={() => price && recalcBounds(price, levels, stepType, stepValue)}
                          />
                        )}
                        {stepName === 'Параметры' && strategy === 'signal' && (
                          <StepSignal
                            signalType={signalType}
                            setSignalType={setSignalType}
                            emaFast={emaFast}
                            setEmaFast={setEmaFast}
                            emaSlow={emaSlow}
                            setEmaSlow={setEmaSlow}
                            rsiPeriod={rsiPeriod}
                            setRsiPeriod={setRsiPeriod}
                            rsiOversold={rsiOversold}
                            setRsiOversold={setRsiOversold}
                            rsiOverbought={rsiOverbought}
                            setRsiOverbought={setRsiOverbought}
                            useRsiFilter={useRsiFilter}
                            setUseRsiFilter={setUseRsiFilter}
                            timeframe={timeframe}
                            setTimeframe={setTimeframe}
                            lots={signalLots}
                            setLots={setSignalLots}
                            maxPosition={maxPosition}
                            setMaxPosition={setMaxPosition}
                          />
                        )}
                        {stepName === 'Параметры' && strategy === 'regime' && (
                          <StepRegime regime={regime} setRegime={setRegime} totalMargin={totalMargin} freeMargin={freeMargin} marginOk={marginOk} />
                        )}
                        {stepName === 'Параметры' && strategy === 'rescue' && (
                          <StepRescue
                            rescue={rescue}
                            setRescue={setRescue}
                            ticker={targetTicker || editRobot?.ticker || ''}
                            totalMargin={totalMargin}
                            freeMargin={freeMargin}
                            marginOk={marginOk}
                          />
                        )}
                        {stepName === 'Защита и запуск' && (
                          <StepProtection
                            strategy={strategy}
                            slOn={slOn}
                            setSlOn={setSlOn}
                            tpOn={tpOn}
                            setTpOn={setTpOn}
                            slValue={slValue}
                            setSlValue={setSlValue}
                            tpValue={tpValue}
                            setTpValue={setTpValue}
                            slPts={slPts}
                            setSlPts={setSlPts}
                            tpPts={tpPts}
                            setTpPts={setTpPts}
                            riskPerTrade={riskPerTrade}
                            dailyLossLimit={dailyLossLimit}
                            setDailyLossLimit={setDailyLossLimit}
                            maxTrades={maxTrades}
                            setMaxTrades={setMaxTrades}
                            lossStreak={lossStreak}
                            setLossStreak={setLossStreak}
                            mode={mode}
                            ackLive={ackLive}
                            setAckLive={setAckLive}
                            summary={buildSummary()}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Футер навигации — закреплён внизу drawer (v2 §5.3.6: bg-overlay + рамка сверху) */}
                  <div className="flex shrink-0 gap-2 border-t border-strong bg-overlay px-5 py-4">
                    {step > 0 ? (
                      <button
                        type="button"
                        onClick={() => setStep((s) => s - 1)}
                        className="flex h-11 items-center gap-1.5 rounded-[10px] border border-subtle px-4 text-sm font-medium text-fg-secondary hover:border-strong hover:text-fg"
                      >
                        <ArrowLeft className="h-4 w-4" /> Назад
                      </button>
                    ) : (
                      <div />
                    )}
                    <div className="flex flex-1 justify-end gap-2">
                      {step < steps.length - 1 && (
                        <button
                          type="button"
                          disabled={!canNext}
                          onClick={() => setStep((s) => s + 1)}
                          className="flex h-11 items-center gap-1.5 rounded-[10px] bg-yellow px-5 text-sm font-bold text-app transition-shadow hover:glow-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Далее <ArrowRight className="h-4 w-4" />
                        </button>
                      )}
                      {step === steps.length - 1 && !editRobot && (
                        <>
                          <button
                            type="button"
                            onClick={() => save(false)}
                            className="h-11 rounded-[10px] border border-subtle px-4 text-sm font-medium text-fg-secondary hover:border-strong hover:text-fg"
                          >
                            Сохранить без запуска
                          </button>
                          <button
                            type="button"
                            disabled={mode === 'live' && !ackLive}
                            onClick={onLaunch}
                            className="h-11 rounded-[10px] bg-yellow px-5 text-sm font-bold text-app transition-shadow hover:glow-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Запустить робота
                          </button>
                        </>
                      )}
                      {step === steps.length - 1 && editRobot && (
                        <button
                          type="button"
                          onClick={() => save(editRobot.status === 'running')}
                          className="h-11 rounded-[10px] bg-yellow px-5 text-sm font-bold text-app transition-shadow hover:glow-accent"
                        >
                          Сохранить изменения
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDangerModal
        open={confirmLive}
        onOpenChange={setConfirmLive}
        title="Запустить робота в боевом режиме?"
        description="Робот будет выставлять РЕАЛЬНЫЕ ордера на боевом счёте без дополнительных подтверждений. Убедитесь, что лимиты заданы верно."
        confirmLabel="Удерживайте для запуска"
        onConfirm={() => save(true)}
      />
    </>
  );

  function buildSummary(): Array<[string, string]> {
    const rows: Array<[string, string]> = [
      ['Имя', robotName()],
      [
        'Стратегия',
        strategy === 'grid'
          ? 'Grid (сетка)'
          : strategy === 'regime'
            ? 'Регламент MOEX · Hedge'
            : strategy === 'rescue'
              ? 'Спасатель позиции'
              : signalType === 'ema_cross'
                ? `EMA ${emaFast}/${emaSlow} cross`
                : 'RSI-разворот',
      ],
      ['Инструмент', (instrument?.ticker ?? editRobot?.ticker ?? (strategy === 'rescue' ? targetTicker : '')) || '—'],
      ...(instrument ? ([['Класс', instrumentTypeLabel(instrument.type)]] as Array<[string, string]>) : []),
      ['Режим', mode === 'live' ? 'Боевой' : 'Песочница'],
    ];
    if (strategy === 'rescue') {
      const ticker = targetTicker || editRobot?.ticker || '—';
      rows.push(
        [
          'Спасение',
          `${ticker} · ${rescue.targetDirection === 'long' ? 'Лонг' : 'Шорт'} ${rescue.targetLots} лота от ${formatNumber(rescue.targetAvgPrice, 2)}`,
        ],
        [
          'План',
          `до ${rescue.maxAvgSteps} усреднений · возврат маржи за ${rescue.marginReturnBufferMin} мин до закрытия`,
        ],
        ['Макс. суммарно', `${rescue.maxTotalLots} лот`],
        ['Хедж-пауза', rescue.hedgePauseEnabled ? 'вкл' : 'выкл'],
        ['Стоп-аут', rescue.allowStopOut ? `при просадке > ${Math.round(rescue.maxDrawdownPct * 100)}%` : 'выкл'],
      );
    } else if (strategy === 'regime') {
      rows.push(
        [
          'Режим дня',
          `Вход за ${regime.entryOffsetMin} мин до открытия · Флэт за ${regime.flatBeforeCloseMinMin}–${regime.flatBeforeCloseMaxMin} мин до закрытия`,
        ],
        ['Хедж', regime.hedgeEnabled ? `${Math.round(regime.baseHedgeRatio * 100)}%` : 'выкл'],
        [
          'Стоп маржи',
          `${Math.round(regime.marginReduce * 100)}/${Math.round(regime.marginEmergency * 100)}%`,
        ],
        ['Клиринг-детектор', `±${regime.clearingWatchMin} мин · z ≥ ${regime.jumpZThreshold}`],
        ['TP / переоткрытие', `${regime.takeProfitPts} шагов · фиксация ${Math.round(regime.tpClosePct * 100)}%`],
        ['Нога / макс. позиция', `${regime.lots} / ${regime.maxPositionLots} лот`],
      );
    } else if (strategy === 'grid') {
      rows.push(
        ['Границы', `${formatNumber(lowerBound, 2)} — ${formatNumber(upperBound, 2)}`],
        ['Уровней', String(levels)],
        ['Шаг', `≈ ${formatNumber(stepPts, 2)} пт (${approxStepPct.toFixed(2)}%)`],
        ['Лотов на уровень', String(lotsPerLevel)],
        ['Перестройка сетки', rebuild ? 'вкл' : 'выкл'],
      );
    } else {
      rows.push(
        ['Таймфрейм', timeframe],
        ['Направление', direction === 'both' ? 'Long/Short' : direction === 'long' ? 'Long' : 'Short'],
        ['Лотов на сигнал', String(signalLots)],
        ['Макс. позиция', `${maxPosition} лот`],
        ['SL / TP', `${slOn ? `${slPts} пт` : 'выкл'} / ${tpOn ? `${tpPts} пт` : 'выкл'}`],
      );
    }
    rows.push(
      ['Лимит убытка в день', formatRub(dailyLossLimit, 0)],
      ['Макс. сделок в день', maxTrades > 0 ? String(maxTrades) : 'без лимита'],
      ['ГО (оценка)', formatRub(totalMargin, 0)],
    );
    return rows;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ================= Шаг 1 =================

function StepStrategy(p: {
  strategy: RobotStrategy;
  setStrategy: (s: RobotStrategy) => void;
  instrument: Instrument | null;
  editTicker?: string;
  onInstrument: (ins: Instrument, price: number | null) => void;
  direction: 'long' | 'short' | 'both';
  setDirection: (d: 'long' | 'short' | 'both') => void;
  mode: 'sandbox' | 'live';
  setMode: (m: 'sandbox' | 'live') => void;
  name: string;
  setName: (v: string) => void;
}) {
  const longOnly = p.instrument?.shortEnabled === false;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { v: 'grid' as const, icon: Grid3x3, title: 'Grid', text: 'Сетка уровней для боковика' },
            { v: 'signal' as const, icon: Activity, title: 'Сигнальный', text: 'EMA-cross + RSI-фильтр' },
            {
              v: 'regime' as const,
              icon: Scale,
              title: 'Регламент MOEX · Hedge',
              text: 'Вход за 10 мин до открытия, флэт за 25–38 мин до закрытия, хедж-режим, защита от маржин-колла',
            },
            {
              v: 'rescue' as const,
              icon: LifeBuoy,
              title: 'Спасатель позиции',
              text: 'Анализ убыточной позиции, план спасения: усреднение с защитой от мартингейла, хедж-пауза, выход в безубыток. Плечо только внутри дня — возврат маржи за час до закрытия, без комиссии за перенос',
            },
          ]
        ).map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => p.setStrategy(opt.v)}
            className={cn(
              'rounded-xl border p-4 text-left transition-all',
              p.strategy === opt.v
                ? 'border-yellow bg-yellow-glow shadow-[0_0_24px_rgba(255,221,45,0.12)]'
                : 'border-subtle bg-inset hover:border-strong',
            )}
          >
            <opt.icon className={cn('h-6 w-6', p.strategy === opt.v ? 'text-yellow' : 'text-fg-muted')} strokeWidth={1.8} />
            <div className="mt-2 text-sm font-semibold text-fg">{opt.title}</div>
            <div className="mt-0.5 text-xs text-fg-secondary">{opt.text}</div>
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Инструмент</div>
        {p.strategy === 'rescue' && !p.editTicker ? (
          <div className="rounded-lg border border-subtle bg-inset px-3 py-2.5 text-xs leading-4 text-fg-muted">
            Инструмент, направление и размер задаются выбранной убыточной позицией на следующем шаге.
          </div>
        ) : p.editTicker && !p.instrument ? (
          <div className="rounded-lg border border-subtle bg-inset px-3 py-2.5">
            <span className="mono text-sm font-semibold uppercase text-fg">{p.editTicker}</span>
            <span className="ml-2 text-xs text-fg-muted">инструмент нельзя сменить при редактировании</span>
          </div>
        ) : (
          <InstrumentPicker value={p.instrument} onChange={p.onInstrument} />
        )}
        {p.instrument && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" size="compact">
              {instrumentTypeLabel(p.instrument.type)}
            </Badge>
            {longOnly && (
              <Badge variant="warn" size="compact">
                только лонг
              </Badge>
            )}
          </div>
        )}
        {longOnly && (
          <div className="mt-2 rounded-lg border border-warn/30 bg-[rgba(245,165,36,0.08)] px-3 py-2 text-xs text-warn">
            Шорт по {p.instrument?.ticker} недоступен (shortEnabled=выкл) — робот будет работать только в лонг.
          </div>
        )}
      </div>

      {p.strategy === 'signal' && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Направление</div>
          <SegmentedControl
            options={[
              { value: 'long' as const, label: 'Long' },
              { value: 'short' as const, label: 'Short', disabled: longOnly },
              { value: 'both' as const, label: 'Оба', disabled: longOnly },
            ]}
            value={longOnly ? 'long' : p.direction}
            onChange={p.setDirection}
          />
          {longOnly && (
            <div className="mt-1 text-xs text-fg-muted">По выбранному инструменту доступен только лонг.</div>
          )}
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Режим запуска</div>
        <SegmentedControl
          options={[
            { value: 'sandbox' as const, label: 'Песочница' },
            {
              value: 'live' as const,
              label: (
                <span className="inline-flex items-center gap-1">
                  <TriangleAlert className="h-3.5 w-3.5 text-yellow" /> Боевой
                </span>
              ),
            },
          ]}
          value={p.mode}
          onChange={p.setMode}
        />
        {p.mode === 'live' && (
          <div className="mt-2 rounded-lg border border-yellow/30 bg-yellow-glow px-3 py-2 text-xs text-yellow">
            Робот будет выставлять реальные ордера. Потребуется подтверждение удержанием.
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Имя робота</div>
        <input
          value={p.name}
          onChange={(e) => p.setName(e.target.value)}
          placeholder="Например, Si Grid Hunter"
          maxLength={40}
          className="w-full rounded-lg border border-subtle bg-inset px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-strong"
        />
      </div>
    </div>
  );
}

// ================= Шаг 2: Grid =================

function StepGrid(p: {
  levels: number;
  setLevels: (v: number) => void;
  stepType: 'abs' | 'pct';
  setStepType: (v: 'abs' | 'pct') => void;
  stepValue: number;
  setStepValue: (v: number) => void;
  approxStepPct: number;
  lowerBound: number;
  setLowerBound: (v: number) => void;
  upperBound: number;
  setUpperBound: (v: number) => void;
  lotsPerLevel: number;
  setLotsPerLevel: (v: number) => void;
  rebuild: boolean;
  setRebuild: (v: boolean) => void;
  totalMargin: number;
  freeMargin: number;
  marginOk: boolean;
  instrumentId: string | null;
  price: number | null;
  onFromPrice: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Количество уровней</span>
            <span className="mono text-sm font-bold text-yellow">{p.levels}</span>
          </div>
          <input
            type="range"
            min={3}
            max={20}
            step={1}
            value={p.levels}
            onChange={(e) => p.setLevels(e.target.valueAsNumber)}
            className="w-full accent-[#FFDD2D]"
          />
          <div className="mono mt-1 flex justify-between text-[10px] text-fg-muted">
            <span>3</span>
            <span>20</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Шаг сетки</div>
          <div className="flex items-start gap-2">
            <NumberField
              value={p.stepValue}
              onChange={p.setStepValue}
              min={0}
              step={p.stepType === 'pct' ? 0.05 : 1}
              suffix={p.stepType === 'pct' ? '%' : 'пт'}
              className="flex-1"
              hint={`примерно ${p.approxStepPct.toFixed(2)}% между уровнями`}
            />
            <SegmentedControl
              size="sm"
              options={[
                { value: 'pct' as const, label: '%' },
                { value: 'abs' as const, label: '₽' },
              ]}
              value={p.stepType}
              onChange={p.setStepType}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Нижняя граница" value={p.lowerBound} onChange={p.setLowerBound} min={0} suffix="пт" />
          <NumberField label="Верхняя граница" value={p.upperBound} onChange={p.setUpperBound} min={0} suffix="пт" />
        </div>
        <button
          type="button"
          onClick={p.onFromPrice}
          disabled={!p.price}
          className="rounded-lg border border-subtle px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg disabled:opacity-40"
        >
          Пересчитать от текущей цены{p.price ? ` (${formatNumber(p.price, 2)})` : ''}
        </button>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Лоты на уровень</span>
          <Stepper value={p.lotsPerLevel} onChange={p.setLotsPerLevel} min={1} max={10} />
        </div>

        {/* v2 §5.3.7: живые расчёты — L0-inset карточка-резюме с mono-строками;
            при выходе за маржу рамка border-short всей карточки */}
        <motion.div
          key={String(p.marginOk)}
          animate={p.marginOk ? {} : { x: [0, -6, 6, -4, 4, 0] }}
          transition={{ duration: 0.3 }}
          className={cn(
            'space-y-1 rounded-lg border p-3 text-[13px] shadow-inset',
            p.marginOk ? 'border-subtle bg-inset' : 'border-short bg-short-dim',
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-fg-secondary">Всего ГО при полной сетке</span>
            <span className={cn('mono font-bold', p.marginOk ? 'text-fg' : 'text-short')}>≈ {formatRub(p.totalMargin, 0)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-fg-secondary">Свободная маржа</span>
            <span className={cn('mono text-xs', p.marginOk ? 'text-fg-secondary' : 'text-short')}>
              {formatRub(p.freeMargin, 0)}
            </span>
          </div>
          {!p.marginOk && (
            <div className="flex items-center gap-1 pt-0.5 text-xs font-medium text-short">
              <TriangleAlert className="h-3 w-3" />
              Сетка не помещается в свободную маржу — уменьшите уровни или лоты
            </div>
          )}
        </motion.div>

        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-fg">Перестраивать сетку при выходе цены за границы</span>
          <ToggleSwitch checked={p.rebuild} onChange={p.setRebuild} label="Перестраивать сетку" />
        </label>
      </div>

      {/* Живое превью */}
      <div className="rounded-lg border border-subtle bg-inset p-2">
        <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-fg-muted">Превью сетки</div>
        <GridPreview
          instrumentId={p.instrumentId}
          lowerBound={p.lowerBound}
          upperBound={p.upperBound}
          levels={p.levels}
          currentPrice={p.price}
          height={210}
        />
      </div>
    </div>
  );
}

// ================= Шаг 2: Signal =================

function StepSignal(p: {
  signalType: 'ema_cross' | 'rsi';
  setSignalType: (v: 'ema_cross' | 'rsi') => void;
  emaFast: number;
  setEmaFast: (v: number) => void;
  emaSlow: number;
  setEmaSlow: (v: number) => void;
  rsiPeriod: number;
  setRsiPeriod: (v: number) => void;
  rsiOversold: number;
  setRsiOversold: (v: number) => void;
  rsiOverbought: number;
  setRsiOverbought: (v: number) => void;
  useRsiFilter: boolean;
  setUseRsiFilter: (v: boolean) => void;
  timeframe: SignalTimeframe;
  setTimeframe: (v: SignalTimeframe) => void;
  lots: number;
  setLots: (v: number) => void;
  maxPosition: number;
  setMaxPosition: (v: number) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Сигнал</div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { v: 'ema_cross' as const, title: `Пересечение EMA (${p.emaFast}/${p.emaSlow})`, text: 'Трендовый вход на кроссе' },
              { v: 'rsi' as const, title: `RSI <${p.rsiOversold} / >${p.rsiOverbought}`, text: 'Разворот из зон перепроданности' },
            ]
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => p.setSignalType(opt.v)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                p.signalType === opt.v ? 'border-yellow bg-yellow-glow' : 'border-subtle bg-inset hover:border-strong',
              )}
            >
              <div className="text-sm font-semibold text-fg">{opt.title}</div>
              <div className="mt-0.5 text-xs text-fg-secondary">{opt.text}</div>
            </button>
          ))}
        </div>
      </div>

      {p.signalType === 'ema_cross' ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">EMA быстрая</span>
            <Stepper value={p.emaFast} onChange={p.setEmaFast} min={2} max={50} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">EMA медленная</span>
            <Stepper value={p.emaSlow} onChange={p.setEmaSlow} min={5} max={200} />
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-fg">RSI-фильтр (не входить против зон)</span>
            <ToggleSwitch checked={p.useRsiFilter} onChange={p.setUseRsiFilter} label="RSI-фильтр" />
          </label>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">Период RSI</span>
            <Stepper value={p.rsiPeriod} onChange={p.setRsiPeriod} min={2} max={30} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">Перепроданность</span>
            <Stepper value={p.rsiOversold} onChange={p.setRsiOversold} min={10} max={45} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-fg">Перекупленность</span>
            <Stepper value={p.rsiOverbought} onChange={p.setRsiOverbought} min={55} max={90} />
          </div>
        </>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Таймфрейм</div>
        <SegmentedControl
          options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
          value={p.timeframe}
          onChange={p.setTimeframe}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-fg">Лоты на сигнал</span>
        <Stepper value={p.lots} onChange={p.setLots} min={1} max={10} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-fg">Макс. позиция</span>
        <Stepper value={p.maxPosition} onChange={p.setMaxPosition} min={1} max={20} suffix="лот" />
      </div>
    </div>
  );
}

// ================= Шаг 2: Regime (Регламент MOEX · Hedge) =================

function StepRegime({
  regime,
  setRegime,
  totalMargin,
  freeMargin,
  marginOk,
}: {
  regime: RegimeConfig;
  setRegime: (v: RegimeConfig) => void;
  totalMargin: number;
  freeMargin: number;
  marginOk: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-fg-secondary">
        Внутридневная стратегия по расписанию Мосбиржи: премаркет-анализ, вход на открытии, виртуальный
        хедж-неттинг, контроль клирингов и принудительный флэт перед закрытием дня.
      </p>
      <RegimeParamsPanel value={regime} onChange={setRegime} />
      {/* Живой расчёт маржи (v2 §5.3.7: L0-inset карточка, выход за маржу — рамка border-short) */}
      <div
        className={cn(
          'space-y-1 rounded-lg border p-3 text-[13px] shadow-inset',
          marginOk ? 'border-subtle bg-inset' : 'border-short bg-short-dim',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-secondary">ГО при макс. позиции</span>
          <span className={cn('mono font-bold', marginOk ? 'text-fg' : 'text-short')}>≈ {formatRub(totalMargin, 0)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-secondary">Свободная маржа</span>
          <span className={cn('mono text-xs', marginOk ? 'text-fg-secondary' : 'text-short')}>{formatRub(freeMargin, 0)}</span>
        </div>
        {!marginOk && (
          <div className="flex items-center gap-1 pt-0.5 text-xs font-medium text-short">
            <TriangleAlert className="h-3 w-3" />
            Позиция не помещается в свободную маржу — уменьшите лоты
          </div>
        )}
      </div>
    </div>
  );
}

// ================= Шаг 1.5: целевая позиция (rescue) =================

function StepRescueTarget({
  rescue,
  onSelect,
  editTicker,
}: {
  rescue: RescueConfig;
  onSelect: (pos: Position) => void;
  editTicker?: string;
}) {
  // Боевой режим — открытые позиции из trading-стора; демо — mock
  const token = useConnectionStore((s) => s.token);
  const livePositions = useTradingStore((s) => s.positions);
  const positions = token ? livePositions : mockGetPositions();
  const losing = positions.filter((p) => p.pnl < 0);
  const selectedKey = rescue.targetInstrumentId
    ? `${rescue.targetInstrumentId}:${rescue.targetDirection}:${rescue.targetLots}`
    : null;
  // Редактирование: целевая позиция могла закрыться — показываем сохранённый снимок цели
  const savedTargetMissing =
    Boolean(editTicker) && rescue.targetInstrumentId !== '' &&
    !losing.some((p) => `${p.instrumentId}:${p.direction}:${p.lots}` === selectedKey);

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-fg-secondary">
        Выберите открытую убыточную позицию — робот построит план спасения: усреднение по лестнице,
        хедж-пауза и выход в безубыток. Плечо используется только внутри дня.
      </p>

      {savedTargetMissing && (
        <div className="rounded-xl border border-yellow bg-yellow-glow p-3 text-xs leading-5">
          <span className="mono font-semibold uppercase text-fg">{editTicker}</span>
          <span className="ml-2 text-fg-secondary">
            текущая цель: {rescue.targetDirection === 'long' ? 'лонг' : 'шорт'} {rescue.targetLots} лот от{' '}
            <span className="mono">{formatNumber(rescue.targetAvgPrice, 2)}</span>
          </span>
          <div className="mt-1 text-fg-muted">Позиция не найдена среди убыточных — оставлены сохранённые параметры.</div>
        </div>
      )}

      {losing.length === 0 && !savedTargetMissing ? (
        <EmptyState
          compact
          icon={<LifeBuoy className="h-6 w-6 text-fg-muted" strokeWidth={1.5} />}
          title="Нет убыточных позиций для спасения"
          subtitle="Спасатель запускается на открытую позицию с убытком — как только такая появится в портфеле, она будет в этом списке."
        />
      ) : (
        <div className="space-y-2">
          {losing.map((pos) => {
            const key = `${pos.instrumentId}:${pos.direction}:${pos.lots}`;
            const selected = key === selectedKey;
            const posType = pos.instrumentType ?? findInstrumentMeta(pos.instrumentId)?.type;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(pos)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all',
                  selected
                    ? 'border-yellow bg-yellow-glow shadow-[0_0_24px_rgba(255,221,45,0.12)]'
                    : 'border-subtle bg-inset hover:border-strong',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                    selected ? 'border-yellow text-yellow' : 'border-subtle text-fg-muted',
                  )}
                >
                  {selected ? <Check className="h-4 w-4" strokeWidth={3} /> : <LifeBuoy className="h-4 w-4" strokeWidth={1.8} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="mono text-sm font-semibold uppercase text-fg">{pos.ticker}</span>
                    {posType && (
                      <Badge variant="neutral" size="compact">
                        {instrumentTypeLabel(posType)}
                      </Badge>
                    )}
                    <Badge variant={pos.direction === 'long' ? 'long' : 'short'} size="compact">
                      {pos.direction === 'long' ? 'Лонг' : 'Шорт'}
                    </Badge>
                  </span>
                  <span className="mono mt-0.5 block text-xs text-fg-secondary">
                    {pos.lots} лот · средняя {formatNumber(pos.avgPrice, 2)}
                  </span>
                </span>
                <span className="mono shrink-0 text-sm font-bold text-short">{formatNumber(pos.pnl, 0)} ₽</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ================= Шаг 2: Rescue (Спасатель позиции) =================

function StepRescue({
  rescue,
  setRescue,
  ticker,
  totalMargin,
  freeMargin,
  marginOk,
}: {
  rescue: RescueConfig;
  setRescue: (v: RescueConfig) => void;
  ticker: string;
  totalMargin: number;
  freeMargin: number;
  marginOk: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Цель спасения — снимок позиции с шага «Позиция» */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-subtle bg-inset px-3 py-2.5 text-xs">
        <LifeBuoy className="h-4 w-4 text-yellow" strokeWidth={1.8} />
        <span className="mono font-semibold uppercase text-fg">{ticker || '—'}</span>
        <span className="text-fg-secondary">
          {rescue.targetDirection === 'long' ? 'лонг' : 'шорт'} {rescue.targetLots} лот от{' '}
          <span className="mono">{formatNumber(rescue.targetAvgPrice, 2)}</span>
        </span>
      </div>
      <RescueParamsPanel value={rescue} onChange={setRescue} />
      {/* Живой расчёт маржи (v2 §5.3.7: L0-inset карточка, выход за маржу — рамка border-short) */}
      <div
        className={cn(
          'space-y-1 rounded-lg border p-3 text-[13px] shadow-inset',
          marginOk ? 'border-subtle bg-inset' : 'border-short bg-short-dim',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-secondary">ГО при макс. позиции</span>
          <span className={cn('mono font-bold', marginOk ? 'text-fg' : 'text-short')}>≈ {formatRub(totalMargin, 0)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-secondary">Свободная маржа</span>
          <span className={cn('mono text-xs', marginOk ? 'text-fg-secondary' : 'text-short')}>{formatRub(freeMargin, 0)}</span>
        </div>
        {!marginOk && (
          <div className="flex items-center gap-1 pt-0.5 text-xs font-medium text-short">
            <TriangleAlert className="h-3 w-3" />
            Позиция с добавками не помещается в свободную маржу — уменьшите макс. суммарно
          </div>
        )}
      </div>
    </div>
  );
}

// ================= Шаг 3: Защита =================

function StepProtection(p: {
  strategy: RobotStrategy;
  slOn: boolean;
  setSlOn: (v: boolean) => void;
  tpOn: boolean;
  setTpOn: (v: boolean) => void;
  slValue: number;
  setSlValue: (v: number) => void;
  tpValue: number;
  setTpValue: (v: number) => void;
  slPts: number;
  setSlPts: (v: number) => void;
  tpPts: number;
  setTpPts: (v: number) => void;
  riskPerTrade: number;
  dailyLossLimit: number;
  setDailyLossLimit: (v: number) => void;
  maxTrades: number;
  setMaxTrades: (v: number) => void;
  lossStreak: number;
  setLossStreak: (v: number) => void;
  mode: 'sandbox' | 'live';
  ackLive: boolean;
  setAckLive: (v: boolean) => void;
  summary: Array<[string, string]>;
}) {
  const isSignal = p.strategy === 'signal';
  const isRegime = p.strategy === 'regime';
  const isRescue = p.strategy === 'rescue';
  return (
    <div className="space-y-5">
      {/* SL/TP (для regime/rescue выходы задаются стратегией на шаге параметров) */}
      {isRegime || isRescue ? (
        <div className="rounded-xl border border-subtle bg-inset p-4 text-xs leading-5 text-fg-secondary">
          {isRescue
            ? 'Выходы управляются планом спасения: усреднение, хедж-пауза, восстановление и возврат плеча настраиваются на шаге «Параметры». Аварийный флэт добавок при маржинальном emergency работает всегда.'
            : 'Выходы управляются регламентом: тейк-профит, переоткрытие и принудительный флэт настраиваются на шаге «Параметры». Защита от маржин-колла закрывает позицию при аварийной утилизации маржи.'}
        </div>
      ) : (
      <div className="space-y-3 rounded-xl border border-subtle bg-inset p-4">
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Стоп-лосс / тейк-профит</div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg">
            Стоп-лосс
            {isSignal && <span className="ml-2 rounded bg-yellow-glow px-1.5 py-0.5 text-[10px] font-semibold text-yellow">обязателен</span>}
          </span>
          <ToggleSwitch checked={isSignal ? true : p.slOn} onChange={p.setSlOn} disabled={isSignal} label="Стоп-лосс" />
        </div>
        {(isSignal || p.slOn) && (
          <NumberField
            value={isSignal ? p.slPts : p.slValue}
            onChange={isSignal ? p.setSlPts : p.setSlValue}
            min={0}
            suffix={isSignal ? 'пунктов' : '% от средней'}
          />
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg">Тейк-профит</span>
          <ToggleSwitch checked={p.tpOn} onChange={p.setTpOn} label="Тейк-профит" />
        </div>
        {p.tpOn && (
          <NumberField
            value={isSignal ? p.tpPts : p.tpValue}
            onChange={isSignal ? p.setTpPts : p.setTpValue}
            min={0}
            suffix={isSignal ? 'пунктов' : '% от средней'}
          />
        )}
        <div className="rounded-lg bg-panel px-3 py-2 text-xs text-fg-secondary">
          Риск на сделку: <span className="mono font-semibold text-warn">{formatRub(p.riskPerTrade, 0)}</span>
        </div>
      </div>
      )}

      {/* Лимиты робота */}
      <div className="space-y-3">
        <NumberField
          label="Макс. убыток в день"
          value={p.dailyLossLimit}
          onChange={p.setDailyLossLimit}
          min={0}
          step={500}
          suffix="₽"
          hint="0 — без лимита. По умолчанию — половина дневного стопа из риск-настроек."
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">Макс. сделок в день</span>
          <Stepper value={p.maxTrades} onChange={p.setMaxTrades} min={0} max={200} step={5} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">Стоп после серии убытков</span>
          <Stepper value={p.lossStreak} onChange={p.setLossStreak} min={0} max={20} />
        </div>
      </div>

      {/* Резюме */}
      <div className="rounded-xl border border-subtle bg-inset p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Резюме</div>
        <dl className="space-y-1">
          {p.summary.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="mono text-right font-medium text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {p.mode === 'live' && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-yellow/30 bg-yellow-glow p-3">
          <input
            type="checkbox"
            checked={p.ackLive}
            onChange={(e) => p.setAckLive(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#FFDD2D]"
          />
          <span className="text-xs leading-5 text-fg">
            Я понимаю, что робот будет выставлять <b>реальные ордера</b> на боевом счёте, и принимаю риски.
          </span>
        </label>
      )}
    </div>
  );
}

// ================= Экран успеха =================

function SuccessScreen({
  name,
  launched,
  onClose,
  onTerminal,
}: {
  name: string;
  launched: boolean;
  onClose: () => void;
  onTerminal: () => void;
}) {
  // Конфетти из свечей (зелёные/красные прямоугольники, 1.2с)
  const confetti = useMemo(() => confettiPieces(26), []);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10">
      {confetti.map((c, i) => (
        <motion.span
          key={i}
          className="absolute top-0 rounded-[2px]"
          style={{ left: `${c.x}%`, width: c.w, height: c.h, backgroundColor: c.color }}
          initial={{ y: -40, opacity: 1, rotate: 0 }}
          animate={{ y: 480, opacity: 0, rotate: c.rotate }}
          transition={{ duration: 1.2, delay: c.delay, ease: 'easeIn' }}
        />
      ))}

      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 14 }}
        className={cn('h-4 w-4 rounded-full', launched ? 'bg-long pulse-dot' : 'bg-fg-muted')}
      />
      <h3 className="mt-4 text-xl font-bold text-fg">{launched ? 'Робот запущен' : 'Робот сохранён'}</h3>
      <p className="mt-1 text-center text-sm text-fg-secondary">
        «{name}» {launched ? 'работает и ждёт сигналов стратегии.' : 'добавлен в каталог выключенным.'}
      </p>

      <div className="mt-8 flex w-full max-w-[320px] flex-col gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent"
        >
          К роботам
        </button>
        <button
          type="button"
          onClick={onTerminal}
          className="h-11 rounded-[10px] border border-subtle text-sm font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg"
        >
          Смотреть в терминале
        </button>
      </div>
    </div>
  );
}
