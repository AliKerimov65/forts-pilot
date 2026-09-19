// Стратегия 'regime' — «Регламент MOEX · Hedge».
// State machine на каждый тик движка (3с):
//   премаркет-анализ (гэп/стакан/ATR) → вход на открытии → хедж-ноги →
//   клиринг-детектор (z-score + объём) → TP/переоткрытие/трейлинг →
//   детерминированный флэт перед закрытием дня → margin guard (reduce/emergency).
//
// ВАЖНО про неттинг: Т-Инвест — неттинговая система, реальной «двойной» позиции
// на счёте нет. Хедж ведётся ВИРТУАЛЬНЫМИ ногами {longLots, shortLots} в рантайме
// робота; в API уходит только ИЗМЕНЕНИЕ НЕТТО-ПОЗИЦИИ (buy/sell на дельту ног).
// Это позволяет держать экономику двух ног (средние входа, P&L каждой), не
// выставляя встречные заявки на биржу.
//
// Чистая логика: regimeTick не ходит в API сам — движок передаёт рыночный контекст
// (цену, свечи, дисбаланс стакана, оценку маржи, план сессии) и исполняет
// возвращённые ордера через executeRobotTrade.
import type { Candle } from '@/types/market';
import type { Direction } from '@/types/trading';
import { atrLast } from './signal';
import {
  getSessionPhase,
  mskDateKey,
  nearClearingWindow,
  type SessionPhase,
  type SessionPhaseInfo,
  type SessionPlan,
} from './schedule';
import type { MarginAssessment, MarginLevel } from './marginGuard';
import type { RegimeConfig } from './config';

// ---------- константы логики ----------

/** Доля сокращения нетто при уровне маржи 'reduce' */
const REDUCE_PCT = 0.3;
/** Кулдаун между ребалансами хеджа, мс */
const HEDGE_REBALANCE_COOLDOWN_MS = 30_000;
/** Кулдаун между срабатываниями клиринг-детектора, мс */
const JUMP_COOLDOWN_MS = 120_000;
/** Кулдаун повторного сокращения по марже, мс */
const MARGIN_REDUCE_COOLDOWN_MS = 60_000;
/** Окно входа после открытия сессии, мс (иначе вход по первому main-тику) */
const ENTRY_WINDOW_MS = 10 * 60_000;
/** Глубина истории тиков для детектора/оценок, мс */
const PRICE_MARKS_KEEP_MS = 35 * 60_000;
/** Глубина окна momentum-оценки хеджа, мс */
const MOMENTUM_WINDOW_MS = 5 * 60_000;
/** Всплеск объёма: последняя свеча vs медиана предыдущих */
const VOLUME_SPIKE_RATIO = 1.8;
/** Максимум переоткрытий после TP за день */
const MAX_REENTRIES_PER_DAY = 3;

// ---------- типы ----------

export type RegimeState =
  | 'idle'
  | 'analyzing'
  | 'entering'
  | 'positioned'
  | 'tp_waiting_reentry'
  | 'flat_for_close'
  | 'emergency_stopped';

/** Виртуальные хедж-ноги (нетто = longLots - shortLots) */
export interface HedgeLegs {
  longLots: number;
  shortLots: number;
  /** Средняя цена входа каждой ноги (0 если нога пуста) */
  avgLong: number;
  avgShort: number;
}

/** Результат премаркет-анализа */
export interface PreOpenAnalysis {
  at: number;
  /** Overnight-гэп, доля (цена vs последняя доступная свеча) */
  gapPct: number;
  /** Доля bid-объёма в стакане, 0..1 */
  imbalance: number;
  /** ATR, % от цены */
  atrPct: number;
  direction: 'long' | 'short' | 'flat';
  /** Уверенность 0..1 */
  confidence: number;
  reasons: string[];
}

/** Событие клиринг-скачка */
export interface ClearingJump {
  direction: 'up' | 'down';
  magnitude: number; // |z-score|
  at: number;
}

/** Рантайм-состояние regime-робота (живёт в памяти движка, не персистится) */
export interface RegimeRuntime {
  /** МСК-день, за который инициализированы дневные поля */
  dayKey: string;
  state: RegimeState;
  legs: HedgeLegs;
  /** Детерминированный момент принудительного флэта (ms), выбирается раз в день */
  flatAt: number | null;
  /** Новые входы запрещены до следующего дня (флэт-окно / margin reduce) */
  entriesBlocked: boolean;
  analysis: PreOpenAnalysis | null;
  /** За какой день сделан анализ / выполнен вход */
  analyzedFor: string;
  enteredFor: string;
  reentriesToday: number;

  // TP / переоткрытие / трейлинг
  tpDone: boolean;
  tpAnchorPrice: number;
  tpMoveAbs: number;
  bestSinceTp: number;
  closedOnTp: number; // лотов, закрытых на TP и ждущих переоткрытия

  // Клиринг-детектор
  priceMarks: Array<{ t: number; p: number }>;
  lastJumpAt: number;
  handledClearingKeys: string[];

  // Идемпотентность
  pendingOrder: boolean;
  lastActionAt: number;
  lastMarginReduceAt: number;

  // Для UI
  lastPhase: SessionPhaseInfo | null;
  lastMargin: MarginAssessment | null;
  lastJump: ClearingJump | null;
  unrealizedPts: number;
  lastEventText: string | null;

  // Кэши движка (троттлинг запросов)
  cacheBookAt: number;
  cacheImbalance: number;
  cacheMarginAt: number;
  cacheMargin: MarginAssessment | null;
  cacheImPerLotAt: number;
  cacheImPerLot: number;
}

/** Рыночный контекст тика (собирает движок) */
export interface RegimeTickContext {
  now: Date;
  price: number;
  /** Шаг цены инструмента (для перевода takeProfitPts в цену) */
  priceStep: number;
  plan: SessionPlan;
  phase: SessionPhaseInfo;
  /** Последние 1-мин свечи (ATR, всплеск объёма) */
  candles: Candle[];
  /** Доля bid-объёма стакана 0..1 (NaN — нет данных) */
  orderBookImbalance: number;
  /** Оценка маржи из marginGuard */
  margin: MarginAssessment;
  /** Сколько лотов ещё можно открыть по марже (maxLotsByMargin) */
  marginLotsCap: number;
}

/** Ордер для исполнения движком (изменение нетто-позиции) */
export interface RegimeAction {
  direction: Direction;
  lots: number;
  reason: string;
  /** Реализованный P&L, пункты (для закрывающих ордеров) */
  pnl?: number;
}

export interface RegimeTickResult {
  actions: RegimeAction[];
  /** Тексты событий для журнала */
  events: string[];
  /** Аварийный стоп робота (margin emergency) */
  emergencyStop: boolean;
}

// ---------- инициализация ----------

export function initRegimeRuntime(): RegimeRuntime {
  return {
    dayKey: '',
    state: 'idle',
    legs: { longLots: 0, shortLots: 0, avgLong: 0, avgShort: 0 },
    flatAt: null,
    entriesBlocked: false,
    analysis: null,
    analyzedFor: '',
    enteredFor: '',
    reentriesToday: 0,
    tpDone: false,
    tpAnchorPrice: 0,
    tpMoveAbs: 0,
    bestSinceTp: 0,
    closedOnTp: 0,
    priceMarks: [],
    lastJumpAt: 0,
    handledClearingKeys: [],
    pendingOrder: false,
    lastActionAt: 0,
    lastMarginReduceAt: 0,
    lastPhase: null,
    lastMargin: null,
    lastJump: null,
    unrealizedPts: 0,
    lastEventText: null,
    cacheBookAt: 0,
    cacheImbalance: NaN,
    cacheMarginAt: 0,
    cacheMargin: null,
    cacheImPerLotAt: 0,
    cacheImPerLot: 0,
  };
}

/** Детерминированный хэш строки (выбор момента флэта по дате) */
function dayHash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

// ---------- премаркет-анализ ----------

/**
 * Анализ перед открытием: overnight-гэп (цена vs последняя доступная свеча),
 * дисбаланс стакана, волатильность (ATR) → направление и уверенность.
 */
export function analyzePreOpen(price: number, candles: Candle[], imbalance: number): PreOpenAnalysis {
  const reasons: string[] = [];

  const ref = candles.length >= 2 ? candles[candles.length - 2].close : price;
  const gapPct = ref > 0 ? (price - ref) / ref : 0;
  reasons.push(`гэп ${(gapPct * 100).toFixed(2)}%`);

  const imb = Number.isFinite(imbalance) ? imbalance : 0.5;
  reasons.push(`стакан bid ${(imb * 100).toFixed(0)}%`);

  const atr = atrLast(candles, 14);
  const atrPct = price > 0 ? atr / price : 0;
  reasons.push(`ATR ${(atrPct * 100).toFixed(2)}%`);

  // Составной скор: гэп вес 0.6 (0.5% гэп = полный балл), дисбаланс 0.4
  const gapScore = Math.max(-1, Math.min(1, gapPct / 0.005));
  const imbScore = (imb - 0.5) * 2;
  const raw = 0.6 * gapScore + 0.4 * imbScore;

  const direction: PreOpenAnalysis['direction'] = raw > 0.15 ? 'long' : raw < -0.15 ? 'short' : 'flat';
  // Уверенность: сила сигнала, приглушённая высокой волатильностью
  const volFactor = Math.max(0.3, Math.min(1, 1.2 - atrPct / 0.005));
  const confidence = Math.min(1, Math.abs(raw)) * volFactor;

  return { at: Date.now(), gapPct, imbalance: imb, atrPct, direction, confidence, reasons };
}

// ---------- вспомогательные оценки ----------

/** Приближение VWAP по тикам за последние 30 минут (среднее по времени) */
export function vwapApprox(rt: RegimeRuntime): number | null {
  if (rt.priceMarks.length < 5) return null;
  let sum = 0;
  for (const m of rt.priceMarks) sum += m.p;
  return sum / rt.priceMarks.length;
}

/** Momentum за последние ~5 минут, доля от цены */
function momentumPct(rt: RegimeRuntime, nowMs: number): number {
  const from = nowMs - MOMENTUM_WINDOW_MS;
  const old = rt.priceMarks.find((m) => m.t >= from);
  const last = rt.priceMarks[rt.priceMarks.length - 1];
  if (!old || !last || old.p <= 0) return 0;
  return (last.p - old.p) / old.p;
}

/** Rolling z-score последней 1-мин доходности + флаг всплеска объёма */
export function clearingJumpSignal(
  rt: RegimeRuntime,
  candles: Candle[],
  zThreshold: number,
): ClearingJump | null {
  // 1-мин доходности из тиков (агрегируем в минутные корзины)
  const buckets = new Map<number, number>();
  for (const m of rt.priceMarks) buckets.set(Math.floor(m.t / 60_000), m.p);
  const closes = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  if (closes.length < 10) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const base = rets.slice(-21, -1);
  const lastRet = rets[rets.length - 1];
  if (base.length < 8) return null;
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  const variance = base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length;
  const std = Math.sqrt(variance);
  if (std <= 0) return null;
  const z = (lastRet - mean) / std;
  if (Math.abs(z) < zThreshold) return null;

  // Всплеск объёма: последняя свеча vs медиана предыдущих (если свечи есть — обязателен)
  if (candles.length >= 10) {
    const vols = candles.slice(-21, -1).map((c) => c.volume).sort((a, b) => a - b);
    const median = vols[Math.floor(vols.length / 2)] || 1;
    const lastVol = candles[candles.length - 1].volume;
    if (lastVol / median < VOLUME_SPIKE_RATIO) return null;
  }

  return { direction: z > 0 ? 'up' : 'down', magnitude: Math.abs(z), at: Date.now() };
}

// ---------- операции с ногами (эмиссия нетто-ордеров) ----------

function pushEvent(rt: RegimeRuntime, events: string[], text: string): void {
  rt.lastEventText = text;
  events.push(text);
}

/**
 * Изменить виртуальные ноги и вернуть нетто-ордер для API.
 * dLong/dShort — дельты лотов ног (знак = увеличение/уменьшение ноги).
 * Возвращает null, если нетто-изменение нулевое.
 */
function applyLegDelta(
  rt: RegimeRuntime,
  dLong: number,
  dShort: number,
  price: number,
  reason: string,
): RegimeAction | null {
  const legs = rt.legs;
  let pnl = 0;
  let hasPnl = false;

  if (dLong !== 0) {
    const newLong = legs.longLots + dLong;
    if (newLong < 0) return null;
    if (dLong > 0) {
      legs.avgLong = legs.longLots > 0 ? (legs.avgLong * legs.longLots + price * dLong) / newLong : price;
    } else {
      pnl += (price - legs.avgLong) * -dLong;
      hasPnl = true;
      if (newLong === 0) legs.avgLong = 0;
    }
    legs.longLots = newLong;
  }

  if (dShort !== 0) {
    const newShort = legs.shortLots + dShort;
    if (newShort < 0) return null;
    if (dShort > 0) {
      legs.avgShort = legs.shortLots > 0 ? (legs.avgShort * legs.shortLots + price * dShort) / newShort : price;
    } else {
      pnl += (legs.avgShort - price) * -dShort;
      hasPnl = true;
      if (newShort === 0) legs.avgShort = 0;
    }
    legs.shortLots = newShort;
  }

  const deltaNet = dLong - dShort;
  if (deltaNet === 0) return null; // встречные изменения ног внутренне компенсированы
  rt.lastActionAt = Date.now();
  return {
    direction: deltaNet > 0 ? 'long' : 'short',
    lots: Math.abs(deltaNet),
    reason,
    pnl: hasPnl ? pnl : undefined,
  };
}

/** Полный флэт всех ног одним нетто-ордером */
function flattenAll(rt: RegimeRuntime, price: number, reason: string): RegimeAction | null {
  const { longLots, shortLots } = rt.legs;
  if (longLots === 0 && shortLots === 0) return null;
  const action = applyLegDelta(rt, -longLots, -shortLots, price, reason);
  rt.tpDone = false;
  rt.closedOnTp = 0;
  return action;
}

/** Нереализованный P&L ног в пунктах */
function unrealized(legs: HedgeLegs, price: number): number {
  let u = 0;
  if (legs.longLots > 0) u += (price - legs.avgLong) * legs.longLots;
  if (legs.shortLots > 0) u += (legs.avgShort - price) * legs.shortLots;
  return u;
}

// ---------- главный тик ----------

/**
 * Тик regime-стратегии. Мутирует rt (ноги, флаги, события) и возвращает
 * ордера на изменение нетто-позиции для исполнения движком.
 * Идемпотентно: повторный тик при pendingOrder — no-op; вход/флэт/скачки —
 * один раз за день/окно (флаги analyzedFor/enteredFor/handledClearingKeys).
 */
export function regimeTick(rt: RegimeRuntime, ctx: RegimeTickContext, cfg: RegimeConfig): RegimeTickResult {
  const result: RegimeTickResult = { actions: [], events: [] , emergencyStop: false };
  if (rt.pendingOrder) return result;

  const now = ctx.now;
  const t = now.getTime();
  const price = ctx.price;
  const legs = rt.legs;
  rt.lastPhase = ctx.phase;
  rt.lastMargin = ctx.margin;

  // --- смена дня: сброс дневных полей, детерминированный выбор момента флэта ---
  const dayKey = mskDateKey(now);
  if (rt.dayKey !== dayKey) {
    rt.dayKey = dayKey;
    rt.entriesBlocked = false;
    rt.reentriesToday = 0;
    rt.tpDone = false;
    rt.closedOnTp = 0;
    rt.handledClearingKeys = [];
    rt.analyzedFor = '';
    rt.enteredFor = '';
    if (rt.state === 'flat_for_close' || rt.state === 'emergency_stopped') rt.state = 'idle';
    const span = Math.max(0, cfg.flatBeforeCloseMaxMin - cfg.flatBeforeCloseMinMin);
    const offsetMin = cfg.flatBeforeCloseMinMin + (span > 0 ? dayHash(dayKey) % (span + 1) : 0);
    rt.flatAt = ctx.plan.isTradingDay
      ? ctx.plan.dayClose.getTime() - offsetMin * 60_000
      : null;
    pushEvent(rt, result.events, `Новый день: флэт запланирован за ${offsetMin} мин до закрытия основной сессии`);
  }

  // --- история тиков ---
  const lastMark = rt.priceMarks[rt.priceMarks.length - 1];
  if (!lastMark || t - lastMark.t >= 2_000) rt.priceMarks.push({ t, p: price });
  while (rt.priceMarks.length > 0 && rt.priceMarks[0].t < t - PRICE_MARKS_KEEP_MS) rt.priceMarks.shift();
  rt.unrealizedPts = unrealized(legs, price);

  // --- margin guard: emergency — полный флёт и автостоп ---
  if (ctx.margin.level === 'emergency') {
    const action = flattenAll(rt, price, `МАРЖА emergency ${(ctx.margin.utilization * 100).toFixed(0)}% — полный флэт`);
    if (action) result.actions.push(action);
    rt.state = 'emergency_stopped';
    rt.entriesBlocked = true;
    result.emergencyStop = true;
    pushEvent(rt, result.events, `Аварийный стоп: утилизация маржи ${(ctx.margin.utilization * 100).toFixed(0)}% ≥ ${(cfg.marginEmergency * 100).toFixed(0)}%`);
    return result;
  }

  // --- margin guard: reduce — запрет входов + сокращение нетто ---
  if (ctx.margin.level === 'reduce') {
    rt.entriesBlocked = true;
    const net = legs.longLots - legs.shortLots;
    if (net !== 0 && t - rt.lastMarginReduceAt >= MARGIN_REDUCE_COOLDOWN_MS) {
      rt.lastMarginReduceAt = t;
      const cut = Math.max(1, Math.ceil(Math.abs(net) * REDUCE_PCT));
      const action = net > 0
        ? applyLegDelta(rt, -Math.min(cut, legs.longLots), 0, price, `Маржа reduce: сокращение лонга на ${cut} лот`)
        : applyLegDelta(rt, 0, -Math.min(cut, legs.shortLots), price, `Маржа reduce: сокращение шорта на ${cut} лот`);
      if (action) {
        result.actions.push(action);
        pushEvent(rt, result.events, `Маржа ${(ctx.margin.utilization * 100).toFixed(0)}% — сокращаем нетто на ${cut} лот`);
      }
    }
  }

  // --- закрытие сессии: если остались ноги после eveningClose — флэт ---
  if (ctx.phase.phase === 'closed' || !ctx.plan.isTradingDay) {
    const action = flattenAll(rt, price, 'Закрытие сессии — флэт остатка позиции');
    if (action) {
      result.actions.push(action);
      pushEvent(rt, result.events, 'Сессия закрыта: остаток позиции закрыт');
    }
    return result;
  }

  // --- принудительный флэт перед закрытием дня ---
  if (rt.flatAt !== null && t >= rt.flatAt && rt.state !== 'flat_for_close') {
    const action = flattenAll(rt, price, 'Принудительный флэт перед закрытием дня');
    if (action) result.actions.push(action);
    rt.state = 'flat_for_close';
    rt.entriesBlocked = true;
    pushEvent(rt, result.events, 'Флэт-окно: все ноги закрыты, входы запрещены до завтра');
    return result;
  }
  if (rt.state === 'flat_for_close') return result;

  // --- клиринг-детектор ---
  const window = nearClearingWindow(ctx.plan, now, cfg.clearingWatchMin);
  if (window) {
    const wKey = `${window.kind}:${window.start.toISOString()}`;
    if (!rt.handledClearingKeys.includes(wKey) && t - rt.lastJumpAt >= JUMP_COOLDOWN_MS) {
      const jump = clearingJumpSignal(rt, ctx.candles, cfg.jumpZThreshold);
      if (jump) {
        rt.lastJumpAt = t;
        rt.lastJump = jump;
        rt.handledClearingKeys.push(wKey);
        const net = legs.longLots - legs.shortLots;
        const jumpDir = jump.direction === 'up' ? 1 : -1;
        pushEvent(rt, result.events, `Клиринг-скачок ${jump.direction === 'up' ? 'вверх' : 'вниз'} (z=${jump.magnitude.toFixed(1)}) у ${window.kind === 'day' ? 'промклиринга' : 'вечернего клиринга'}`);
        if (net !== 0 && Math.sign(net) !== jumpDir) {
          // Позиция против скачка и скачок значимый — сократить доминирующую ногу
          if (jump.magnitude > cfg.jumpZThreshold * 1.2) {
            const cut = Math.max(1, Math.ceil(Math.abs(net) * 0.5));
            const action = net > 0
              ? applyLegDelta(rt, -Math.min(cut, legs.longLots), 0, price, `Клиринг-скачок против позиции: сокращение лонга`)
              : applyLegDelta(rt, 0, -Math.min(cut, legs.shortLots), price, `Клиринг-скачок против позиции: сокращение шорта`);
            if (action) result.actions.push(action);
          }
        } else if (net !== 0) {
          // Скачок по направлению позиции — частичная фиксация
          const take = Math.max(1, Math.floor(Math.abs(net) * cfg.tpClosePct));
          const action = net > 0
            ? applyLegDelta(rt, -Math.min(take, legs.longLots), 0, price, 'Клиринг-скачок по позиции: частичная фиксация лонга')
            : applyLegDelta(rt, 0, -Math.min(take, legs.shortLots), price, 'Клиринг-скачок по позиции: частичная фиксация шорта');
          if (action) result.actions.push(action);
        }
      }
    }
  }

  // --- премаркет-анализ (за entryOffsetMin до открытия) ---
  const analysisStart = ctx.plan.sessionOpen.getTime() - cfg.entryOffsetMin * 60_000;
  if (
    rt.analyzedFor !== dayKey &&
    t >= analysisStart &&
    (ctx.phase.phase === 'pre_open' || ctx.phase.phase === 'main') &&
    !rt.entriesBlocked
  ) {
    rt.analysis = analyzePreOpen(price, ctx.candles, ctx.orderBookImbalance);
    rt.analyzedFor = dayKey;
    rt.state = 'analyzing';
    const a = rt.analysis;
    pushEvent(
      rt,
      result.events,
      `Премаркет-анализ: ${a.direction} (уверенность ${(a.confidence * 100).toFixed(0)}%) — ${a.reasons.join(', ')}`,
    );
  }

  // --- вход на открытии основной сессии ---
  const a = rt.analysis;
  const inEntryWindow = t >= ctx.plan.sessionOpen.getTime() && t <= ctx.plan.sessionOpen.getTime() + ENTRY_WINDOW_MS;
  if (
    ctx.phase.phase === 'main' &&
    a &&
    rt.analyzedFor === dayKey &&
    rt.enteredFor !== dayKey &&
    inEntryWindow &&
    !rt.entriesBlocked &&
    ctx.margin.level !== 'reduce' &&
    (legs.longLots === 0 && legs.shortLots === 0)
  ) {
    if (a.direction !== 'flat' && a.confidence >= cfg.minConfidence) {
      const baseLots = Math.max(1, Math.min(cfg.lots, cfg.maxPositionLots, ctx.marginLotsCap));
      if (baseLots > 0) {
        // Хедж-нога при низкой уверенности или рискованной фазе
        const riskyPhase = window !== null || ctx.phase.phase !== 'main';
        const hedgeOn = cfg.hedgeEnabled && (a.confidence < 0.75 || riskyPhase);
        const hedgeLots = hedgeOn ? Math.min(Math.round(baseLots * cfg.baseHedgeRatio), cfg.maxPositionLots - baseLots) : 0;
        rt.state = 'entering';
        const action = a.direction === 'long'
          ? applyLegDelta(rt, baseLots, hedgeLots, price, `Вход по премаркет-сигналу: лонг ${baseLots}${hedgeLots ? ` + хедж шорт ${hedgeLots}` : ''}`)
          : applyLegDelta(rt, hedgeLots, baseLots, price, `Вход по премаркет-сигналу: шорт ${baseLots}${hedgeLots ? ` + хедж лонг ${hedgeLots}` : ''}`);
        rt.enteredFor = dayKey;
        rt.state = 'positioned';
        rt.bestSinceTp = price;
        if (action) {
          result.actions.push(action);
          pushEvent(rt, result.events, `Вход: ${a.direction} ${baseLots} лот${hedgeLots ? `, хедж ${hedgeLots} лот` : ''} (уверенность ${(a.confidence * 100).toFixed(0)}%)`);
        }
      }
    } else {
      rt.enteredFor = dayKey; // вход пропущен осознанно
      rt.state = 'idle';
      pushEvent(rt, result.events, `Вход пропущен: ${a.direction}, уверенность ${(a.confidence * 100).toFixed(0)}% < ${(cfg.minConfidence * 100).toFixed(0)}%`);
    }
  }

  // --- управление позицией (по доминирующей ноге; при хедже нетто может быть 0) ---
  const gross = legs.longLots + legs.shortLots;
  if (gross > 0) {
    const dominant: 'long' | 'short' = legs.longLots >= legs.shortLots ? 'long' : 'short';
    const domLots = dominant === 'long' ? legs.longLots : legs.shortLots;
    const avgEntry = dominant === 'long' ? legs.avgLong : legs.avgShort;
    const moveAbs = dominant === 'long' ? price - avgEntry : avgEntry - price;
    const tpAbs = cfg.takeProfitPts * ctx.priceStep;

    // Тейк-профит: частичная фиксация
    if (!rt.tpDone && tpAbs > 0 && moveAbs >= tpAbs) {
      const closeLots = Math.max(1, Math.round(domLots * cfg.tpClosePct));
      const action = dominant === 'long'
        ? applyLegDelta(rt, -Math.min(closeLots, legs.longLots), 0, price, `TP: фиксация ${closeLots} лот лонга (+${moveAbs.toFixed(0)} пт)`)
        : applyLegDelta(rt, 0, -Math.min(closeLots, legs.shortLots), price, `TP: фиксация ${closeLots} лот шорта (+${moveAbs.toFixed(0)} пт)`);
      rt.tpDone = true;
      rt.tpAnchorPrice = price;
      rt.tpMoveAbs = moveAbs;
      rt.bestSinceTp = price;
      rt.closedOnTp = closeLots;
      rt.state = 'tp_waiting_reentry';
      if (action) {
        result.actions.push(action);
        pushEvent(rt, result.events, `Тейк-профит: зафиксировано ${closeLots} лот, ждём откат для переоткрытия`);
      }
    }

    // Трейлинг после TP1
    if (rt.tpDone && cfg.trailingEnabled) {
      const fav = dominant === 'long' ? price : -price;
      const bestFav = dominant === 'long' ? rt.bestSinceTp : -rt.bestSinceTp;
      if (fav > bestFav) rt.bestSinceTp = price;
      const trailAbs = Math.max(rt.tpMoveAbs * 0.5, tpAbs * 0.4);
      const retraced = Math.abs(rt.bestSinceTp - price) >= trailAbs &&
        (dominant === 'long' ? price < rt.bestSinceTp : price > rt.bestSinceTp);
      if (retraced) {
        const action = flattenAll(rt, price, 'Трейлинг-стоп после TP');
        if (action) result.actions.push(action);
        rt.state = 'idle';
        rt.entriesBlocked = true; // день отработан
        pushEvent(rt, result.events, 'Трейлинг-стоп: остаток позиции закрыт, день завершён');
        return finishTick(rt, result);
      }
    }

    // Переоткрытие в «лучшей точке»: откат на reentryRetracePct от хода или возврат к VWAP
    if (rt.tpDone && rt.closedOnTp > 0 && rt.reentriesToday < MAX_REENTRIES_PER_DAY && !rt.entriesBlocked) {
      const retracePrice = dominant === 'long'
        ? rt.tpAnchorPrice - cfg.reentryRetracePct * rt.tpMoveAbs
        : rt.tpAnchorPrice + cfg.reentryRetracePct * rt.tpMoveAbs;
      const vwap = vwapApprox(rt);
      const hitRetrace = dominant === 'long' ? price <= retracePrice : price >= retracePrice;
      const hitVwap = vwap !== null && (dominant === 'long' ? price <= vwap : price >= vwap);
      if (hitRetrace || hitVwap) {
        const reLots = Math.min(rt.closedOnTp, cfg.maxPositionLots - (legs.longLots + legs.shortLots));
        if (reLots > 0) {
          const action = dominant === 'long'
            ? applyLegDelta(rt, reLots, 0, price, `Переоткрытие лонга ${reLots} лот на откате${hitVwap && !hitRetrace ? ' (VWAP)' : ''}`)
            : applyLegDelta(rt, 0, reLots, price, `Переоткрытие шорта ${reLots} лот на откате${hitVwap && !hitRetrace ? ' (VWAP)' : ''}`);
          rt.closedOnTp = 0;
          rt.tpDone = false; // новый цикл TP
          rt.reentriesToday += 1;
          rt.state = 'positioned';
          if (action) {
            result.actions.push(action);
            pushEvent(rt, result.events, `Переоткрытие ${reLots} лот в лучшей точке (${hitRetrace ? 'откат' : 'VWAP'})`);
          }
        }
      }
    }

    // --- ребаланс хедж-ног: сильный сигнал перевешивает одну ногу ---
    if (cfg.hedgeEnabled && rt.state === 'positioned' && t - rt.lastActionAt >= HEDGE_REBALANCE_COOLDOWN_MS) {
      const atr = atrLast(ctx.candles, 14);
      const atrPct = price > 0 ? atr / price : 0;
      const mom = momentumPct(rt, t);
      const strong = atrPct > 0 && Math.abs(mom) > atrPct * 1.5;
      const momDir: 'long' | 'short' = mom >= 0 ? 'long' : 'short';
      if (strong && momDir !== dominant) {
        // Momentum против доминирующей ноги — поднимаем встречную ногу до baseHedgeRatio
        const targetHedge = Math.min(
          Math.round(domLots * cfg.baseHedgeRatio),
          cfg.maxPositionLots - (legs.longLots + legs.shortLots),
        );
        const curHedge = momDir === 'long' ? legs.longLots : legs.shortLots;
        const add = targetHedge - curHedge;
        if (add >= 1) {
          const action = momDir === 'long'
            ? applyLegDelta(rt, add, 0, price, `Хедж-ребаланс: +${add} лот лонга против шорта (momentum)`)
            : applyLegDelta(rt, 0, add, price, `Хедж-ребаланс: +${add} лот шорта против лонга (momentum)`);
          if (action) result.actions.push(action);
        }
      } else if (strong && momDir === dominant) {
        // Сильный сигнал по позиции — снимаем хедж-ногу
        const hedgeLots = dominant === 'long' ? legs.shortLots : legs.longLots;
        if (hedgeLots >= 1) {
          const action = dominant === 'long'
            ? applyLegDelta(rt, 0, -hedgeLots, price, 'Сильный сигнал: снятие шорт-хеджа')
            : applyLegDelta(rt, -hedgeLots, 0, price, 'Сильный сигнал: снятие лонг-хеджа');
          if (action) result.actions.push(action);
        }
      }
    }
  }

  return finishTick(rt, result);
}

function finishTick(rt: RegimeRuntime, result: RegimeTickResult): RegimeTickResult {
  // Обновим нереализованный P&L после всех изменений ног
  const last = rt.priceMarks[rt.priceMarks.length - 1];
  if (last) rt.unrealizedPts = unrealized(rt.legs, last.p);
  return result;
}

// ---------- снапшот для UI ----------

/** Снимок состояния regime-робота для карточки/деталей (фаза, отсчёт, ноги) */
export interface RegimeStatusSnapshot {
  state: RegimeState;
  legs: HedgeLegs;
  /** Нетто-позиция, лотов (+ лонг / − шорт) */
  netLots: number;
  sessionPhase: SessionPhase | null;
  /** Ближайшее событие регламента и обратный отсчёт */
  nextEventAt: number | null;
  msToNext: number | null;
  /** Запланированный момент принудительного флэта, ms */
  flatAt: number | null;
  sessionOpen: number | null;
  dayClose: number | null;
  /** Премаркет-анализ дня */
  direction: 'long' | 'short' | 'flat' | null;
  confidence: number | null;
  marginLevel: MarginLevel | null;
  marginUtilization: number | null;
  unrealizedPts: number;
  lastJump: ClearingJump | null;
  lastEventText: string | null;
}

export function getRegimeSnapshot(rt: RegimeRuntime): RegimeStatusSnapshot {
  return {
    state: rt.state,
    legs: { ...rt.legs },
    netLots: rt.legs.longLots - rt.legs.shortLots,
    sessionPhase: rt.lastPhase?.phase ?? null,
    nextEventAt: rt.lastPhase?.nextEventAt.getTime() ?? null,
    msToNext: rt.lastPhase?.msToNext ?? null,
    flatAt: rt.flatAt,
    sessionOpen: rt.lastPhase?.sessionOpen.getTime() ?? null,
    dayClose: rt.lastPhase?.dayClose.getTime() ?? null,
    direction: rt.analysis?.direction ?? null,
    confidence: rt.analysis?.confidence ?? null,
    marginLevel: rt.lastMargin?.level ?? null,
    marginUtilization: rt.lastMargin?.utilization ?? null,
    unrealizedPts: rt.unrealizedPts,
    lastJump: rt.lastJump,
    lastEventText: rt.lastEventText,
  };
}

/** Проверка фазы сессии (экспорт для движка/UI) */
export { getSessionPhase };
