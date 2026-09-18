// Движок исполнения стратегий — singleton-цикл поверх zustand-сторов.
// Каждые 3с: getLastPrices по инструментам running-роботов → сигналы стратегий →
// ордера через postOrder (режим sandbox/live выбирается в services автоматически).
// Без токена (демо) — локальная симуляция исполнения по текущей мок-цене.
// Сделки пишутся в trading-стор (addTrade → журнал), статистика — в robots-стор,
// дневной стоп риск-стора останавливает всех роботов с записью в историю.
import type { Candle } from '@/types/market';
import type { Robot } from '@/types/robot';
import type { Direction } from '@/types/trading';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useRiskStore } from '@/store/risk';
import { useRobotsStore } from '@/store/robots';
import { useTradingStore } from '@/store/trading';
import { getCandles, getLastPrices, postOrder } from '@/lib/tinvest/services';
import { mockGetCandles, mockGetLastPrices } from '@/lib/tinvest/mock';
import { POLLING_DEFAULTS } from '@/lib/tinvest/polling';
import { formatRub } from '@/lib/format';
import { getExtConfig } from './config';
import { gridInventoryGuard, gridTick, initGridRuntime, type GridRuntime } from './grid';
import {
  applyTick,
  evaluateEntry,
  evaluateExit,
  initSignalRuntime,
  timeframeToInterval,
  timeframeToMs,
  type SignalRuntime,
} from './signal';

const CANDLES_REFRESH_MS = 60_000;
const CANDLES_COUNT = 120;

// ---------- рантайм-состояние движка (не персистится) ----------

const gridRuntimes = new Map<string, GridRuntime>();
const signalRuntimes = new Map<string, SignalRuntime>();
const candlesCache = new Map<string, { fetchedAt: number; candles: Candle[] }>();

interface DayCounters {
  day: string; // Date().toDateString()
  tradesToday: number;
  wins: number;
  losses: number;
  lossStreak: number;
}
const counters = new Map<string, DayCounters>();

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let dailyStopHandledOn = ''; // дата, когда уже обработали дневной стоп

/** Запустить цикл движка (идемпотентно) */
export function startRobotsEngine(): void {
  if (timer !== null) return;
  timer = setInterval(() => void tick(), POLLING_DEFAULTS.prices);
  void tick();
}

/** Остановить цикл движка */
export function stopRobotsEngine(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Сбросить рантайм робота (при удалении/перезапуске после правок) */
export function resetRobotRuntime(robotId: string): void {
  gridRuntimes.delete(robotId);
  signalRuntimes.delete(robotId);
  counters.delete(robotId);
}

/** Текущая позиция/экспозиция робота для UI */
export function getRobotExposure(robot: Robot): string {
  if (robot.strategy === 'grid') {
    const rt = gridRuntimes.get(robot.id);
    if (!rt) return 'сетка не инициализирована';
    const active = rt.levels.filter((l) => l.holding).length;
    return rt.positionLots > 0
      ? `в позиции ${rt.positionLots} лот · ${active} ур.`
      : `${rt.levels.length} уровней, вне позиции`;
  }
  const rt = signalRuntimes.get(robot.id);
  if (rt?.position) {
    return `в позиции ${rt.position.direction === 'long' ? 'лонг' : 'шорт'} ${rt.position.lots} лот`;
  }
  return 'вне позиции';
}

/** Состояние уровней grid-робота для мини-графика (UI) */
export function getGridRuntime(robotId: string): GridRuntime | undefined {
  return gridRuntimes.get(robotId);
}

/** Позиция сигнального робота для мини-графика (UI) */
export function getSignalRuntime(robotId: string): SignalRuntime | undefined {
  return signalRuntimes.get(robotId);
}

// ---------- цикл ----------

async function tick(): Promise<void> {
  if (ticking) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  ticking = true;
  try {
    await tickInner();
  } finally {
    ticking = false;
  }
}

async function tickInner(): Promise<void> {
  const robotsStore = useRobotsStore.getState();
  const running = robotsStore.robots.filter((r) => r.status === 'running');

  // Чистка рантайма удалённых роботов
  const aliveIds = new Set(robotsStore.robots.map((r) => r.id));
  for (const [id] of gridRuntimes) if (!aliveIds.has(id)) gridRuntimes.delete(id);
  for (const [id] of signalRuntimes) if (!aliveIds.has(id)) signalRuntimes.delete(id);
  for (const [id] of counters) if (!aliveIds.has(id)) counters.delete(id);

  // --- Дневной стоп риск-менеджмента: остановка всех роботов ---
  const risk = useRiskStore.getState();
  if (risk.isDailyStopHit() && risk.automations.stopRobotsOnDailyStop) {
    const today = new Date().toDateString();
    if (running.length > 0 && dailyStopHandledOn !== today) {
      dailyStopHandledOn = today;
      risk.addEvent({
        kind: 'daily_stop',
        text: `Дневной лимит убытка (${formatRub(risk.limits.dailyStopRub, 0)}) достигнут — роботы остановлены`,
      });
      useTradingStore.getState().addEvent({
        type: 'risk',
        text: `Дневной стоп ${formatRub(risk.limits.dailyStopRub, 0)}: все роботы остановлены`,
        amount: risk.currentDayPnl,
      });
    }
    for (const r of running) useRobotsStore.getState().setStatus(r.id, 'paused');
    return;
  }

  if (running.length === 0) return;

  const token = useConnectionStore.getState().token;
  const useMock = !token;
  const instrumentIds = [...new Set(running.map((r) => r.instrumentId))];

  let prices = new Map<string, number>();
  try {
    const quotes = useMock ? mockGetLastPrices(instrumentIds) : await getLastPrices(instrumentIds);
    useMarketStore.getState().updateQuotes(quotes);
    prices = new Map(quotes.map((q) => [q.instrumentId, q.price]));
  } catch (e) {
    // Ошибка поллинга цен — все running-роботы в error
    const msg = e instanceof Error ? e.message : 'Ошибка получения котировок';
    for (const r of running) useRobotsStore.getState().setStatus(r.id, 'error', msg);
    return;
  }

  for (const robot of running) {
    const price = prices.get(robot.instrumentId);
    if (!price || price <= 0) continue;
    try {
      if (robot.strategy === 'grid') await tickGridRobot(robot, price, useMock);
      else await tickSignalRobot(robot, price, useMock);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка исполнения';
      useRobotsStore.getState().setStatus(robot.id, 'error', msg);
      useTradingStore.getState().addEvent({
        type: 'robot',
        text: `Робот «${robot.name}» остановлен: ${msg}`,
        robotId: robot.id,
      });
    }
  }
}

// ---------- grid ----------

async function tickGridRobot(robot: Robot, price: number, useMock: boolean): Promise<void> {
  if (robot.params.strategy !== 'grid') return;
  const params = robot.params.grid;
  const ext = getExtConfig(robot);
  const gridExt = ext.grid ?? { stepType: 'pct' as const, rebuild: true };

  let rt = gridRuntimes.get(robot.id);
  if (!rt) {
    rt = initGridRuntime(params, price);
    gridRuntimes.set(robot.id, rt);
    return; // первый тик — только инициализация базовой цены
  }

  // Защита инвентаря (SL/TP по % от средней)
  const guard = gridInventoryGuard(rt, price, gridExt.stopLossPct, gridExt.takeProfitPct);
  if (guard) {
    await executeRobotTrade(robot, 'short', guard.lots, price, useMock, guard.pnl, guard.reason);
    return;
  }

  const { actions, rebuilt, bounds } = gridTick(rt, params, price, { rebuild: gridExt.rebuild });

  if (rebuilt && bounds) {
    useRobotsStore.getState().updateRobot(robot.id, {
      params: { strategy: 'grid', grid: { ...params, ...bounds } },
    });
    useTradingStore.getState().addEvent({
      type: 'robot',
      text: `«${robot.name}»: сетка перестроена ${formatRub(bounds.lowerBound, 0)}–${formatRub(bounds.upperBound, 0)}`,
      robotId: robot.id,
      instrumentId: robot.instrumentId,
    });
  }

  for (const action of actions) {
    if (countersExceeded(robot)) break;
    const direction: Direction = action.type === 'buy' ? 'long' : 'short';
    await executeRobotTrade(robot, direction, action.lots, price, useMock, action.pnl, action.reason);
  }
}

// ---------- signal ----------

async function ensureSignalRuntime(robot: Robot, useMock: boolean): Promise<SignalRuntime | null> {
  if (robot.params.strategy !== 'signal') return null;
  const params = robot.params.signal;
  const key = `${robot.instrumentId}:${params.timeframe}`;
  const cached = candlesCache.get(key);

  if (!cached || Date.now() - cached.fetchedAt > CANDLES_REFRESH_MS) {
    const interval = timeframeToInterval(params.timeframe);
    const intervalMs = timeframeToMs(params.timeframe);
    const to = new Date();
    const from = new Date(to.getTime() - CANDLES_COUNT * intervalMs);
    const candles = useMock
      ? mockGetCandles(robot.instrumentId, interval, CANDLES_COUNT)
      : await getCandles(robot.instrumentId, from, to, interval, CANDLES_COUNT);
    candlesCache.set(key, { fetchedAt: Date.now(), candles });
  }

  let rt = signalRuntimes.get(robot.id);
  if (!rt) {
    rt = initSignalRuntime(candlesCache.get(key)!.candles.map((c) => ({ ...c })), params.timeframe);
    signalRuntimes.set(robot.id, rt);
  }
  return rt;
}

async function tickSignalRobot(robot: Robot, price: number, useMock: boolean): Promise<void> {
  if (robot.params.strategy !== 'signal') return;
  const params = robot.params.signal;
  const ext = getExtConfig(robot);
  const signalExt = ext.signal!;
  const rt = await ensureSignalRuntime(robot, useMock);
  if (!rt) return;

  applyTick(rt, price, Date.now());

  // Выход: SL/TP / встречный сигнал — каждый тик
  const exit = evaluateExit(rt, params, signalExt, price);
  if (exit && rt.position) {
    const direction: Direction = exit.direction === 'long' ? 'short' : 'long';
    const reasonText =
      exit.reason === 'sl' ? 'Стоп-лосс' : exit.reason === 'tp' ? 'Тейк-профит' : 'Встречный сигнал';
    await executeRobotTrade(robot, direction, exit.lots, price, useMock, exit.pnl, reasonText);
    rt.position = null;
    return;
  }

  // Вход — один активный на робота
  if (!rt.position && !countersExceeded(robot)) {
    const entry = evaluateEntry(rt, params, signalExt);
    if (entry) {
      const executed = await executeRobotTrade(
        robot,
        entry.direction,
        entry.lots,
        price,
        useMock,
        undefined,
        entry.reason,
      );
      if (executed) {
        rt.position = { direction: entry.direction, lots: entry.lots, entryPrice: executed };
      }
    }
  }
}

// ---------- исполнение и учёт ----------

function getCounters(robotId: string): DayCounters {
  const today = new Date().toDateString();
  let c = counters.get(robotId);
  if (!c || c.day !== today) {
    // День сменился — сбрасываем дневные счётчики, win/loss инициализируем из статистики
    const stats = useRobotsStore.getState().robots.find((r) => r.id === robotId)?.stats;
    const wins = Math.round((stats?.trades ?? 0) * (stats?.winRate ?? 0));
    c = {
      day: today,
      tradesToday: 0,
      wins,
      losses: Math.max(0, (stats?.trades ?? 0) - wins),
      lossStreak: 0,
    };
    counters.set(robotId, c);
  }
  return c;
}

/** Лимит сделок в день по защитному конфигу робота */
function countersExceeded(robot: Robot): boolean {
  const ext = getExtConfig(robot);
  const c = getCounters(robot.id);
  return ext.protection.maxTradesPerDay > 0 && c.tradesToday >= ext.protection.maxTradesPerDay;
}

/**
 * Исполнить сделку робота: ордер через API (или симуляция в демо), запись в журнал,
 * обновление статистики, проверка защитных лимитов. Возвращает цену исполнения или null.
 */
async function executeRobotTrade(
  robot: Robot,
  direction: Direction,
  lots: number,
  price: number,
  useMock: boolean,
  pnl: number | undefined,
  reason: string,
): Promise<number | null> {
  const connection = useConnectionStore.getState();

  let executedPrice = price;
  let commission: number | undefined;

  if (!useMock) {
    // Боевой/песочный контур — реальный ордер через T-Invest API
    const result = await postOrder({
      instrumentId: robot.instrumentId,
      direction,
      lots,
      orderType: 'market',
    });
    if (result.status === 'rejected') {
      throw new Error(result.message || 'Ордер отклонён биржей');
    }
    if (result.lotsExecuted <= 0) return null;
    executedPrice = result.executedPrice ?? price;
    commission = result.commission;
    if (connection.mode === 'live') navigator.vibrate?.(10);
  } else {
    navigator.vibrate?.(10);
  }

  // Сделка в журнал (addTrade сам добавляет событие в ленту)
  const trade = {
    id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instrumentId: robot.instrumentId,
    ticker: robot.ticker,
    direction,
    lots,
    price: executedPrice,
    commission,
    pnl,
    source: 'robot' as const,
    robotId: robot.id,
    robotName: robot.name,
    time: Date.now(),
  };
  useTradingStore.getState().addTrade(trade);
  useTradingStore.getState().addEvent({
    type: 'robot',
    text: `«${robot.name}»: ${reason}`,
    robotId: robot.id,
    instrumentId: robot.instrumentId,
  });

  // Статистика робота
  const c = getCounters(robot.id);
  c.tradesToday += 1;
  if (pnl !== undefined) {
    if (pnl >= 0) {
      c.wins += 1;
      c.lossStreak = 0;
    } else {
      c.losses += 1;
      c.lossStreak += 1;
    }
  }
  const current = useRobotsStore.getState().robots.find((r) => r.id === robot.id);
  if (current) {
    const closed = c.wins + c.losses;
    useRobotsStore.getState().updateStats(robot.id, {
      trades: current.stats.trades + 1,
      dayPnl: current.stats.dayPnl + (pnl ?? 0),
      totalPnl: current.stats.totalPnl + (pnl ?? 0),
      winRate: closed > 0 ? c.wins / closed : current.stats.winRate,
    });
  }

  // Защитные лимиты робота
  const ext = getExtConfig(robot);
  const dayPnl = (current?.stats.dayPnl ?? 0) + (pnl ?? 0);
  if (ext.protection.dailyLossLimit > 0 && dayPnl <= -ext.protection.dailyLossLimit) {
    useRobotsStore.getState().setStatus(robot.id, 'paused');
    useTradingStore.getState().addEvent({
      type: 'risk',
      text: `«${robot.name}» остановлен: дневной лимит убытка ${formatRub(ext.protection.dailyLossLimit, 0)}`,
      amount: dayPnl,
      robotId: robot.id,
    });
  } else if (ext.protection.stopAfterLossStreak > 0 && c.lossStreak >= ext.protection.stopAfterLossStreak) {
    useRobotsStore.getState().setStatus(robot.id, 'paused');
    useTradingStore.getState().addEvent({
      type: 'risk',
      text: `«${robot.name}» остановлен: серия из ${c.lossStreak} убыточных сделок`,
      robotId: robot.id,
    });
  }

  return executedPrice;
}
