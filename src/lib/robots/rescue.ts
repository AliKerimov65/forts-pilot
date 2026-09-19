// Стратегия 'rescue' — «Спасатель позиции».
// Пользователь выбирает убыточную позицию (uid, направление, лоты, средняя цена —
// из портфеля); робот каждый тик анализирует состояние позиции и рынок, строит план
// спасения (лестница усреднения / хедж-пауза / выход с восстановлением / стоп-аут)
// и исполняет его рыночными ордерами через движок.
//
// МАРЖИНАЛЬНЫЙ РЕГЛАМЕНТ (ключевое требование):
// комиссия Т-Инвестиций за непокрытую позицию = 0, если плечо возвращено до конца
// торгового дня (или <5000 ₽). Поэтому робот использует плечо ТОЛЬКО внутри дня:
//   marginDeadline = dayClose − marginReturnBufferMin (дефолт 60 мин).
// До дедлайна — усреднения/хеджи разрешены (с marginGuard). После дедлайна новые
// добавки запрещены, все лоты, добавленные роботом сверх исходной позиции
// пользователя, закрываются (возврат плеча); исходная позиция НЕ закрывается
// принудительно — это актив пользователя (кроме случая allowStopOut).
//
// ВАЖНО про неттинг: Т-Инвест — неттинговая система, «замок» на счёте невозможен.
// Хедж-пауза = продажа всего объёма позиции (счёт → флэт, просадка заморожена)
// с обратным входом при снятии хеджа. Учёт ног ведётся виртуально в рантайме.
//
// Чистая логика: rescueTick не ходит в API — движок передаёт рыночный контекст
// (цена, 5-мин свечи, стакан, маржа, план сессии) и исполняет возвращённые ордера.
import type { Candle } from '@/types/market';
import type { Direction } from '@/types/trading';
import { atrLast, emaSeries, rsiLast } from './signal';
import {
  mskDateKey,
  nearClearingWindow,
  type SessionPhase,
  type SessionPhaseInfo,
  type SessionPlan,
} from './schedule';
import { estimateCarryFee, type MarginAssessment, type MarginLevel } from './marginGuard';
import type { RescueConfig } from './config';

// ---------- константы логики ----------

/** Анти-мартингейл-кэп множителя лотов докупки */
const LOT_MULT_CAP = 1.5;
/** Порог RSI перепроданности/перекупленности для обоснования усреднения */
const RSI_SOFT_OVERSOLD = 35;
const RSI_SOFT_OVERBOUGHT = 65;
/** Окно наблюдения вокруг клиринга для анализа, мин */
const CLEARING_WATCH_MIN = 5;
/** Минимальный ATR для работы (защита от деления на ноль), доля цены */
const MIN_ATR_PCT = 0.0005;

// ---------- типы ----------

export type RescueVerdict = 'wait' | 'average_down' | 'hedge_pause' | 'recover_exit' | 'stop_out';

export type RescueState =
  | 'monitoring'
  | 'averaging'
  | 'hedged'
  | 'recovering'
  | 'returning_margin'
  | 'stopped';

/** Шаг плана спасения (для UI: лестница с done-флагами) */
export interface RescueStep {
  kind: 'average_down' | 'hedge_pause' | 'recover_exit' | 'stop_out';
  /** Лотов по шагу */
  lots: number;
  /** Цена-триггер шага (для hedge_pause — 0: по рынку при ухудшении) */
  triggerPrice: number;
  done: boolean;
  reason: string;
}

/** Выполненная докупка робота (виртуальная нога поверх позиции пользователя) */
export interface RescueAdd {
  lots: number;
  price: number;
}

/** Результат анализа тика (вердикт + объяснение по-русски) */
export interface RescueAnalysis {
  at: number;
  price: number;
  /** Просадка исходной позиции, пункты (со знаком: <0 — убыток) */
  drawdownPts: number;
  /** Просадка исходной позиции, доля (≥0 — убыток, <0 — прибыль) */
  drawdownPct: number;
  /** Стоимость суммарной позиции (исходная + добавки), ₽ */
  positionValueRub: number;
  /** Заблокированная маржа (оценка по ГО на лот), ₽ */
  blockedMarginRub: number;
  trend: 'up' | 'down' | 'flat';
  rsi: number;
  atr: number;
  /** Доля bid-объёма стакана 0..1 (NaN — нет данных) */
  orderBookImbalance: number;
  sessionPhase: SessionPhase;
  nearClearing: boolean;
  /** мс до маржинального дедлайна (null — неторговый день) */
  msToDeadline: number | null;
  verdict: RescueVerdict;
  /** Уверенность в вердикте 0..1 */
  confidence: number;
  /** Объяснение вердикта, строки по-русски */
  reasoning: string[];
}

/** Рантайм-состояние rescue-робота (память движка, не персистится) */
export interface RescueRuntime {
  /** МСК-день инициализации дневных полей */
  dayKey: string;
  state: RescueState;
  /** Докупки робота (живые) */
  adds: RescueAdd[];
  /** Офсетный хедж: лотов и средняя цена (0 — хеджа нет) */
  hedgeLots: number;
  hedgeAvgPrice: number;
  /** План спасения с done-флагами (перестраивается каждый тик) */
  plan: RescueStep[];
  /** Число выполненных шагов усреднения */
  stepsDone: number;
  /** Цена последней докупки (0 — не было; якорь = targetAvgPrice) */
  lastAddPrice: number;
  /** Просадка исходной позиции на старте робота, пункты (для recoveredPct) */
  initialDrawdownPts: number | null;
  /** Доля отыгранной просадки 0..1 */
  recoveredPct: number;
  verdict: RescueVerdict;
  confidence: number;
  reasoning: string[];
  analysis: RescueAnalysis | null;
  /** Маржинальный дедлайн дня, ms (dayClose − marginReturnBufferMin) */
  marginDeadlineAt: number | null;
  /** Плечо уже возвращено за этот МСК-день (ключ дня или '') */
  marginReturnedFor: string;
  lastMargin: MarginAssessment | null;
  lastEventText: string | null;
  /** Идемпотентность: ордер в процессе исполнения движком */
  pendingOrder: boolean;

  // Кэши движка (троттлинг запросов)
  cacheBookAt: number;
  cacheImbalance: number;
  cacheMarginAt: number;
  cacheMargin: MarginAssessment | null;
  cacheImPerLotAt: number;
  cacheImPerLot: number;
}

/** Рыночный контекст тика (собирает движок) */
export interface RescueTickContext {
  now: Date;
  price: number;
  plan: SessionPlan;
  phase: SessionPhaseInfo;
  /** Последние 5-мин свечи (EMA20/EMA50, RSI, ATR) */
  candles: Candle[];
  /** Доля bid-объёма стакана 0..1 (NaN — нет данных) */
  orderBookImbalance: number;
  /** Оценка маржи из marginGuard */
  margin: MarginAssessment;
  /** Сколько лотов ещё можно открыть по марже (maxLotsByMargin) */
  marginLotsCap: number;
  /** ГО на лот, ₽ (для оценки заблокированной маржи и carry fee) */
  imPerLot: number;
}

/** Ордер для исполнения движком */
export interface RescueAction {
  direction: Direction;
  lots: number;
  reason: string;
  /** Реализованный P&L, пункты (для закрывающих ордеров) */
  pnl?: number;
}

export interface RescueTickResult {
  actions: RescueAction[];
  /** Тексты событий для журнала */
  events: string[];
  /** Остановить робота (спасение завершено / стоп-аут) */
  stopRobot: boolean;
  /** Текст причины остановки */
  stopReason?: string;
}

// ---------- инициализация ----------

export function initRescueRuntime(): RescueRuntime {
  return {
    dayKey: '',
    state: 'monitoring',
    adds: [],
    hedgeLots: 0,
    hedgeAvgPrice: 0,
    plan: [],
    stepsDone: 0,
    lastAddPrice: 0,
    initialDrawdownPts: null,
    recoveredPct: 0,
    verdict: 'wait',
    confidence: 0,
    reasoning: [],
    analysis: null,
    marginDeadlineAt: null,
    marginReturnedFor: '',
    lastMargin: null,
    lastEventText: null,
    pendingOrder: false,
    cacheBookAt: 0,
    cacheImbalance: NaN,
    cacheMarginAt: 0,
    cacheMargin: null,
    cacheImPerLotAt: 0,
    cacheImPerLot: 0,
  };
}

// ---------- производные позиции ----------

/** Суммарно добавленных роботом лотов (сверх исходной позиции пользователя) */
export function addsLotsOf(rt: RescueRuntime): number {
  return rt.adds.reduce((a, x) => a + x.lots, 0);
}

/** Средневзвешенная цена всей позиции (исходная + докупки) */
export function weightedAvg(cfg: RescueConfig, rt: RescueRuntime): number {
  const total = cfg.targetLots + addsLotsOf(rt);
  if (total <= 0) return cfg.targetAvgPrice;
  let sum = cfg.targetAvgPrice * cfg.targetLots;
  for (const a of rt.adds) sum += a.price * a.lots;
  return sum / total;
}

/** Эффективный множитель лотов с анти-мартингейл-кэпом */
export function effectiveLotMult(cfg: RescueConfig): number {
  return Math.min(Math.max(1, cfg.lotMult), LOT_MULT_CAP);
}

function pushEvent(rt: RescueRuntime, events: string[], text: string): void {
  rt.lastEventText = text;
  events.push(text);
}

// ---------- анализатор ----------

/**
 * Анализ состояния позиции и рынка на тике: просадка, маржа, тренд EMA20/EMA50 (5м),
 * RSI, ATR, дисбаланс стакана, фаза сессии, клиринг, маржинальный дедлайн → вердикт.
 */
export function analyzeRescue(
  cfg: RescueConfig,
  rt: RescueRuntime,
  ctx: RescueTickContext,
): RescueAnalysis {
  const price = ctx.price;
  const dirSign = cfg.targetDirection === 'long' ? 1 : -1;
  const reasoning: string[] = [];

  // --- состояние позиции ---
  const drawdownPts = (price - cfg.targetAvgPrice) * dirSign * cfg.targetLots;
  const drawdownPct = cfg.targetAvgPrice > 0
    ? ((cfg.targetAvgPrice - price) / cfg.targetAvgPrice) * dirSign
    : 0;
  const totalLots = cfg.targetLots + addsLotsOf(rt);
  const positionValueRub = totalLots * price;
  const blockedMarginRub = (totalLots + rt.hedgeLots) * ctx.imPerLot;
  reasoning.push(
    drawdownPct > 0
      ? `просадка ${(drawdownPct * 100).toFixed(2)}% (${Math.round(drawdownPts)} пт на исходный объём)`
      : `позиция в плюсе ${(Math.abs(drawdownPct) * 100).toFixed(2)}%`,
  );

  // --- рынок: тренд EMA20/EMA50, RSI, ATR по 5-мин свечам ---
  const closes = ctx.candles.map((c) => c.close);
  const emaFast = emaSeries(closes, 20);
  const emaSlow = emaSeries(closes, 50);
  const ef = emaFast[emaFast.length - 1] ?? price;
  const es = emaSlow[emaSlow.length - 1] ?? price;
  let atr = atrLast(ctx.candles, 14);
  if (atr <= 0) atr = price * MIN_ATR_PCT;
  const trend: RescueAnalysis['trend'] =
    ef - es > atr * 0.2 ? 'up' : es - ef > atr * 0.2 ? 'down' : 'flat';
  const rsi = rsiLast(closes, 14);
  reasoning.push(
    `тренд ${trend === 'up' ? 'восходящий' : trend === 'down' ? 'нисходящий' : 'боковой'} (EMA20/EMA50), RSI ${rsi.toFixed(0)}, ATR ${atr.toFixed(1)}`,
  );

  const imb = ctx.orderBookImbalance;
  if (Number.isFinite(imb)) {
    reasoning.push(`стакан: bid ${(imb * 100).toFixed(0)}% / ask ${((1 - imb) * 100).toFixed(0)}%`);
  }

  // --- сессия и клиринг ---
  const nearClearing = nearClearingWindow(ctx.plan, ctx.now, CLEARING_WATCH_MIN) !== null;
  if (nearClearing) reasoning.push('рядом окно клиринга — повышенная осторожность');
  if (ctx.phase.phase !== 'main' && ctx.phase.phase !== 'evening') {
    reasoning.push('вне торговой сессии — действия запрещены');
  }

  // --- маржинальный дедлайн ---
  const msToDeadline = rt.marginDeadlineAt !== null ? rt.marginDeadlineAt - ctx.now.getTime() : null;
  if (msToDeadline !== null) {
    reasoning.push(
      msToDeadline > 0
        ? `до дедлайна возврата маржи ${Math.ceil(msToDeadline / 60_000)} мин`
        : 'маржинальный дедлайн пройден — новые добавки запрещены, плечо возвращается',
    );
  }

  // --- вердикт ---
  const { verdict, confidence } = decideVerdict(cfg, rt, ctx, {
    price,
    drawdownPct,
    trend,
    rsi,
    atr,
    imb,
    msToDeadline,
    reasoning,
  });

  return {
    at: ctx.now.getTime(),
    price,
    drawdownPts,
    drawdownPct,
    positionValueRub,
    blockedMarginRub,
    trend,
    rsi,
    atr,
    orderBookImbalance: imb,
    sessionPhase: ctx.phase.phase,
    nearClearing,
    msToDeadline,
    verdict,
    confidence,
    reasoning,
  };
}

/** Выбор вердикта по приоритетам: stop_out → recover_exit → average_down → hedge_pause → wait */
function decideVerdict(
  cfg: RescueConfig,
  rt: RescueRuntime,
  ctx: RescueTickContext,
  m: {
    price: number;
    drawdownPct: number;
    trend: 'up' | 'down' | 'flat';
    rsi: number;
    atr: number;
    imb: number;
    msToDeadline: number | null;
    reasoning: string[];
  },
): { verdict: RescueVerdict; confidence: number } {
  const dirSign = cfg.targetDirection === 'long' ? 1 : -1;
  const r = m.reasoning;
  const inSession = ctx.phase.phase === 'main' || ctx.phase.phase === 'evening';

  // 1. Стоп-аут: просадка больше лимита
  if (m.drawdownPct >= cfg.maxDrawdownPct) {
    if (cfg.allowStopOut) {
      r.push(
        `просадка ${(m.drawdownPct * 100).toFixed(2)}% ≥ лимита ${(cfg.maxDrawdownPct * 100).toFixed(1)}% — фиксируем убыток (stop_out разрешён)`,
      );
      return { verdict: 'stop_out', confidence: 0.9 };
    }
    r.push(
      `просадка ${(m.drawdownPct * 100).toFixed(2)}% ≥ лимита ${(cfg.maxDrawdownPct * 100).toFixed(1)}%, но stop_out запрещён — исходную позицию не трогаем`,
    );
    if (cfg.hedgePauseEnabled && rt.hedgeLots === 0 && inSession) {
      r.push('замораживаем просадку офсетным хеджем');
      return { verdict: 'hedge_pause', confidence: 0.8 };
    }
    return { verdict: 'wait', confidence: 0.6 };
  }

  // 2. Цель восстановления достигнута
  const wAvg = weightedAvg(cfg, rt);
  const recoverPrice = wAvg * (1 + cfg.recoverTargetPct * dirSign);
  const recovered = dirSign > 0 ? m.price >= recoverPrice : m.price <= recoverPrice;
  if (recovered && (addsLotsOf(rt) > 0 || rt.hedgeLots > 0 || cfg.recoverCloseAll)) {
    r.push(
      `цена ${m.price.toFixed(1)} достигла цели восстановления ${recoverPrice.toFixed(1)} (weightedAvg ${wAvg.toFixed(1)} + ${(cfg.recoverTargetPct * 100).toFixed(1)}%)`,
    );
    return { verdict: 'recover_exit', confidence: 0.95 };
  }

  // 3. Усреднение: лестница с шагом stepAtrMult × ATR от последней докупки
  if (inSession && rt.stepsDone < cfg.maxAvgSteps) {
    const anchor = rt.lastAddPrice > 0 ? rt.lastAddPrice : cfg.targetAvgPrice;
    const stepAbs = cfg.stepAtrMult * m.atr;
    const better = dirSign > 0 ? m.price <= anchor - stepAbs : m.price >= anchor + stepAbs;
    if (better) {
      const oversold = dirSign > 0 ? m.rsi <= RSI_SOFT_OVERSOLD : m.rsi >= RSI_SOFT_OVERBOUGHT;
      const trendAgainst = (dirSign > 0 && m.trend === 'down') || (dirSign < 0 && m.trend === 'up');
      const imbFavors = Number.isFinite(m.imb) && (dirSign > 0 ? m.imb > 0.55 : m.imb < 0.45);
      if (oversold || !trendAgainst) {
        if (oversold) {
          r.push(
            dirSign > 0
              ? `RSI ${m.rsi.toFixed(0)} — перепроданность, шаг усреднения оправдан`
              : `RSI ${m.rsi.toFixed(0)} — перекупленность, шаг усреднения оправдан`,
          );
        } else {
          r.push('тренд не против позиции — усреднение допустимо');
        }
        if (trendAgainst) r.push('тренд против позиции, но перепроданность перевешивает');
        if (imbFavors) r.push('дисбаланс стакана в пользу позиции');
        const confidence = 0.5 + (oversold ? 0.2 : 0) + (imbFavors ? 0.15 : 0) - (trendAgainst ? 0.25 : 0);
        // Маржинальный регламент: не добавляемся вплотную к дедлайну
        const minActionMs = cfg.minActionBeforeDeadlineMin * 60_000;
        if (m.msToDeadline !== null && m.msToDeadline < minActionMs) {
          r.push(
            `до дедлайна возврата маржи < ${cfg.minActionBeforeDeadlineMin} мин — добавка пропущена (плечо не успеть вернуть осмысленно)`,
          );
          return { verdict: 'wait', confidence: 0.5 };
        }
        if (ctx.margin.level === 'reduce' || ctx.margin.level === 'emergency') {
          r.push(`маржа ${ctx.margin.level} — новые добавки запрещены`);
          return { verdict: 'wait', confidence: 0.5 };
        }
        if (m.msToDeadline !== null && m.msToDeadline <= 0) {
          return { verdict: 'wait', confidence: 0.5 };
        }
        return { verdict: 'average_down', confidence: Math.min(1, Math.max(0, confidence)) };
      }
      r.push(
        `тренд против позиции, RSI ${m.rsi.toFixed(0)} — без перепроданности шаг усреднения не оправдан, ждём`,
      );
    }
  } else if (rt.stepsDone >= cfg.maxAvgSteps) {
    r.push(`все ${cfg.maxAvgSteps} шага усреднения использованы`);
  }

  // 4. Хедж-пауза: тренд против, просадка значимая, хеджа ещё нет
  const trendAgainst = (dirSign > 0 && m.trend === 'down') || (dirSign < 0 && m.trend === 'up');
  if (
    cfg.hedgePauseEnabled &&
    rt.hedgeLots === 0 &&
    trendAgainst &&
    m.drawdownPct >= cfg.maxDrawdownPct * 0.5 &&
    inSession &&
    (m.msToDeadline === null || m.msToDeadline > cfg.minActionBeforeDeadlineMin * 60_000)
  ) {
    r.push('тренд против позиции и просадка растёт — офсетный хедж заморозит убыток');
    return { verdict: 'hedge_pause', confidence: 0.65 };
  }

  // 5. Снятие хеджа: тренд развернулся к позиции (обрабатывается в исполнителе)
  if (rt.hedgeLots > 0 && !trendAgainst) {
    r.push('тренд развернулся к позиции — хедж можно снимать');
  }

  return { verdict: 'wait', confidence: 0.6 };
}

// ---------- генератор плана ----------

/**
 * Лестница усреднения: шаги average_down от текущего прогресса, цель recover_exit
 * (weightedAvg + recoverTargetPct), альтернативы hedge_pause / stop_out.
 * Лоты шагов: targetLots × lotMultEff^k, суммарно ≤ maxTotalLots и ≤ marginLotsCap.
 */
export function buildRescuePlan(
  cfg: RescueConfig,
  rt: RescueRuntime,
  atr: number,
  price: number,
  marginLotsCap: number,
): RescueStep[] {
  const dirSign = cfg.targetDirection === 'long' ? 1 : -1;
  const mult = effectiveLotMult(cfg);
  const steps: RescueStep[] = [];
  const stepAbs = Math.max(cfg.stepAtrMult * atr, price * MIN_ATR_PCT);

  let cumAdds = addsLotsOf(rt);
  let anchor = rt.lastAddPrice > 0 ? rt.lastAddPrice : cfg.targetAvgPrice;
  let marginLeft = Math.max(0, marginLotsCap);
  // Плановые добавки — для расчёта плановой weightedAvg
  let plannedSum = cfg.targetAvgPrice * cfg.targetLots;
  for (const a of rt.adds) plannedSum += a.price * a.lots;
  let plannedLots = cfg.targetLots + cumAdds;

  for (let k = rt.stepsDone; k < cfg.maxAvgSteps; k++) {
    const power = k + 1; // первая докупка = targetLots × mult
    let lots = Math.max(1, Math.round(cfg.targetLots * Math.pow(mult, power)));
    lots = Math.min(lots, Math.max(0, cfg.maxTotalLots - cfg.targetLots - cumAdds), marginLeft);
    if (lots <= 0) break;
    const trigger = anchor - stepAbs * dirSign;
    steps.push({
      kind: 'average_down',
      lots,
      triggerPrice: trigger,
      done: false,
      reason: `Усреднение #${k + 1}: докупка ${lots} лот при цене ${dirSign > 0 ? '≤' : '≥'} ${trigger.toFixed(1)}`,
    });
    cumAdds += lots;
    marginLeft -= lots;
    anchor = trigger;
    plannedSum += trigger * lots;
    plannedLots += lots;
  }

  // Цель восстановления от плановой weightedAvg
  const plannedWAvg = plannedLots > 0 ? plannedSum / plannedLots : cfg.targetAvgPrice;
  const recoverPrice = plannedWAvg * (1 + cfg.recoverTargetPct * dirSign);
  steps.push({
    kind: 'recover_exit',
    lots: cfg.recoverCloseAll ? plannedLots : cumAdds,
    triggerPrice: recoverPrice,
    done: rt.state === 'stopped',
    reason: `Выход при ${recoverPrice.toFixed(1)} (weightedAvg ${plannedWAvg.toFixed(1)} + ${(cfg.recoverTargetPct * 100).toFixed(1)}%)${cfg.recoverCloseAll ? ', закрыть всё' : ', частями'}`,
  });

  // Альтернатива: хедж-пауза
  if (cfg.hedgePauseEnabled) {
    steps.push({
      kind: 'hedge_pause',
      lots: plannedLots,
      triggerPrice: 0,
      done: rt.hedgeLots > 0,
      reason: 'Хедж-пауза: офсетная позиция замораживает просадку при ухудшении тренда',
    });
  }

  // Альтернатива: стоп-аут
  if (cfg.allowStopOut) {
    const stopPrice = cfg.targetAvgPrice * (1 - cfg.maxDrawdownPct * dirSign);
    steps.push({
      kind: 'stop_out',
      lots: plannedLots,
      triggerPrice: stopPrice,
      done: rt.state === 'stopped',
      reason: `Стоп-аут при просадке ${(cfg.maxDrawdownPct * 100).toFixed(1)}% (${dirSign > 0 ? '≤' : '≥'} ${stopPrice.toFixed(1)}): закрытие всей позиции`,
    });
  }

  return steps;
}

// ---------- исполнитель (главный тик) ----------

/**
 * Тик rescue-стратегии. Мутирует rt (добавки, хедж, флаги) и возвращает ордера
 * для исполнения движком. Идемпотентно: повторный тик при pendingOrder — no-op;
 * возврат плеча и стоп-аут — один раз за день (флаг marginReturnedFor / state).
 */
export function rescueTick(rt: RescueRuntime, ctx: RescueTickContext, cfg: RescueConfig): RescueTickResult {
  const result: RescueTickResult = { actions: [], events: [], stopRobot: false };
  if (rt.pendingOrder) return result;

  const now = ctx.now;
  const t = now.getTime();
  const price = ctx.price;
  const dirSign = cfg.targetDirection === 'long' ? 1 : -1;
  const addDir: Direction = cfg.targetDirection; // докупка — в сторону позиции
  const closeDir: Direction = cfg.targetDirection === 'long' ? 'short' : 'long';

  // --- смена дня: если добавки/хедж пережили дедлайн (приложение было закрыто) — возврат плеча ---
  const dayKey = mskDateKey(now);
  const inSessionNow = ctx.phase.phase === 'main' || ctx.phase.phase === 'evening';
  if (rt.dayKey !== dayKey) {
    const carried = addsLotsOf(rt) + rt.hedgeLots;
    rt.dayKey = dayKey;
    if (carried > 0 && inSessionNow) {
      pushEvent(rt, result.events, `Новый день: ${carried} лот плеча пережили дедлайн — немедленный возврат маржи`);
      closeRobotLeverage(cfg, rt, price, result, 'Возврат плеча на новом дне');
    }
  }

  // --- маржинальный дедлайн дня: dayClose − marginReturnBufferMin ---
  rt.marginDeadlineAt = ctx.plan.isTradingDay
    ? ctx.plan.dayClose.getTime() - cfg.marginReturnBufferMin * 60_000
    : null;
  rt.lastMargin = ctx.margin;

  // --- анализатор ---
  const analysis = analyzeRescue(cfg, rt, ctx);
  rt.analysis = analysis;
  rt.verdict = analysis.verdict;
  rt.confidence = analysis.confidence;
  rt.reasoning = analysis.reasoning;

  // Прогресс восстановления относительно стартовой просадки
  if (rt.initialDrawdownPts === null) rt.initialDrawdownPts = analysis.drawdownPts;
  const dd0 = rt.initialDrawdownPts;
  rt.recoveredPct =
    dd0 < 0
      ? Math.min(1, Math.max(0, 1 - analysis.drawdownPts / dd0))
      : analysis.drawdownPts >= 0
        ? 1
        : 0;

  // --- план с done-флагами ---
  rt.plan = buildRescuePlan(cfg, rt, analysis.atr, price, ctx.marginLotsCap);

  // --- МАРЖА emergency: немедленный флэт добавок/хеджа.
  // Исходная позиция пользователя НЕ закрывается. Этот флэт НЕ отключается
  // никакими risk-overrides — защита от маржин-колла абсолютна. ---
  if (ctx.margin.level === 'emergency') {
    const closed = closeRobotLeverage(cfg, rt, price, result, `МАРЖА emergency ${(ctx.margin.utilization * 100).toFixed(0)}% — флэт добавок и хеджа`);
    if (closed > 0) {
      pushEvent(rt, result.events, `Аварийный возврат плеча: закрыто ${closed} лот (утилизация маржи ${(ctx.margin.utilization * 100).toFixed(0)}%)`);
    }
    return result;
  }

  // --- действия только в торговой сессии (main/evening; не closed/clearing/pre_open) ---
  const inSession = ctx.phase.phase === 'main' || ctx.phase.phase === 'evening';
  if (!inSession || !ctx.plan.isTradingDay) return result;

  const addsLots = addsLotsOf(rt);

  // --- маржинальный дедлайн: возврат плеча (исходную позицию не трогаем) ---
  if (
    rt.marginDeadlineAt !== null &&
    t >= rt.marginDeadlineAt &&
    rt.marginReturnedFor !== dayKey &&
    (addsLots > 0 || rt.hedgeLots > 0)
  ) {
    rt.marginReturnedFor = dayKey;
    rt.state = 'returning_margin';
    const closed = closeRobotLeverage(cfg, rt, price, result, 'Маржинальный дедлайн: возврат плеча');
    pushEvent(
      rt,
      result.events,
      `Дедлайн возврата маржи (${cfg.marginReturnBufferMin} мин до конца основной сессии): закрыто ${closed} лот добавок/хеджа, исходная позиция ${cfg.targetLots} лот остаётся`,
    );
    if (addsLotsOf(rt) === 0 && rt.hedgeLots === 0) rt.state = 'monitoring';
    return result;
  }

  // --- исполнение вердикта ---
  switch (analysis.verdict) {
    case 'stop_out': {
      // allowStopOut: закрываем ВСЁ, включая исходную позицию пользователя
      closeRobotLeverage(cfg, rt, price, result, 'Стоп-аут: возврат плеча');
      const pnl = (price - cfg.targetAvgPrice) * dirSign * cfg.targetLots;
      result.actions.push({
        direction: closeDir,
        lots: cfg.targetLots,
        reason: `Стоп-аут: закрытие исходной позиции ${cfg.targetLots} лот (просадка ≥ ${(cfg.maxDrawdownPct * 100).toFixed(1)}%)`,
        pnl,
      });
      rt.state = 'stopped';
      result.stopRobot = true;
      result.stopReason = 'Стоп-аут: просадка превысила лимит, позиция закрыта';
      pushEvent(rt, result.events, `Стоп-аут: вся позиция закрыта, P&L ${Math.round(pnl)} пт`);
      break;
    }

    case 'recover_exit': {
      // Снимаем хедж, затем фиксируем
      closeHedge(cfg, rt, price, result, 'Выход с восстановлением: снятие хеджа');
      if (cfg.recoverCloseAll) {
        // Целиком: добавки + исходная позиция → спасение завершено
        const pnlAdds = closeAdds(cfg, rt, price, result, addsLots, 'Выход с восстановлением: фиксация добавок');
        const pnlTarget = (price - cfg.targetAvgPrice) * dirSign * cfg.targetLots;
        result.actions.push({
          direction: closeDir,
          lots: cfg.targetLots,
          reason: `Цель восстановления достигнута: закрытие исходной позиции ${cfg.targetLots} лот`,
          pnl: pnlTarget,
        });
        rt.state = 'stopped';
        rt.recoveredPct = 1;
        result.stopRobot = true;
        result.stopReason = 'Позиция спасена: цель восстановления достигнута';
        pushEvent(rt, result.events, `Спасение завершено: выход по цели, P&L фиксации ${Math.round(pnlAdds + pnlTarget)} пт`);
      } else if (addsLots > 0) {
        // Частичные фиксации добавок шагами (исходная позиция остаётся)
        const chunk = Math.max(1, Math.ceil(addsLots / Math.max(1, cfg.maxAvgSteps)));
        closeAdds(cfg, rt, price, result, Math.min(chunk, addsLots), `Выход с восстановлением: частичная фиксация ${Math.min(chunk, addsLots)} лот`);
        rt.state = 'recovering';
        pushEvent(rt, result.events, `Частичная фиксация на цели: закрыто ${Math.min(chunk, addsLots)} лот добавок`);
      }
      break;
    }

    case 'average_down': {
      const step = rt.plan.find((s) => s.kind === 'average_down' && !s.done);
      if (!step || step.lots <= 0) break;
      // Повторная проверка дедлайна непосредственно перед добавлением
      const msLeft = rt.marginDeadlineAt !== null ? rt.marginDeadlineAt - t : Infinity;
      if (msLeft < cfg.minActionBeforeDeadlineMin * 60_000) break;
      const fee = estimateCarryFee(step.lots * price);
      rt.adds.push({ lots: step.lots, price });
      rt.stepsDone += 1;
      rt.lastAddPrice = price;
      rt.state = 'averaging';
      result.actions.push({
        direction: addDir,
        lots: step.lots,
        reason: `Усреднение #${rt.stepsDone}: ${addDir === 'long' ? 'покупка' : 'продажа'} ${step.lots} лот по ${price.toFixed(1)}`,
      });
      pushEvent(
        rt,
        result.events,
        `Усреднение #${rt.stepsDone}/${cfg.maxAvgSteps}: +${step.lots} лот по ${price.toFixed(1)}, новая weightedAvg ${weightedAvg(cfg, rt).toFixed(1)}; комиссия за перенос этой добавки ~${fee} ₽/день (возврат до дедлайна — бесплатно)`,
      );
      break;
    }

    case 'hedge_pause': {
      if (rt.hedgeLots === 0 && rt.state !== 'hedged') {
        // Неттинг: офсетный хедж = продажа/покупка всего объёма (счёт → флэт, просадка заморожена)
        const hedgeLots = cfg.targetLots + addsLots;
        rt.hedgeLots = hedgeLots;
        rt.hedgeAvgPrice = price;
        rt.state = 'hedged';
        result.actions.push({
          direction: closeDir,
          lots: hedgeLots,
          reason: `Хедж-пауза: офсет ${hedgeLots} лот — просадка заморожена`,
        });
        pushEvent(rt, result.events, `Хедж-пауза: офсет ${hedgeLots} лот по ${price.toFixed(1)}, просадка заморожена до разворота тренда`);
      }
      break;
    }

    case 'wait':
    default: {
      // Снятие хеджа при развороте тренда к позиции (если хедж был поставлен ранее)
      const trendFavors =
        (dirSign > 0 && analysis.trend === 'up') || (dirSign < 0 && analysis.trend === 'down');
      if (rt.hedgeLots > 0 && trendFavors) {
        closeHedge(cfg, rt, price, result, 'Тренд развернулся к позиции: снятие хеджа');
        rt.state = 'monitoring';
        pushEvent(rt, result.events, `Хедж снят по ${price.toFixed(1)} — тренд снова в пользу позиции`);
      }
      break;
    }
  }

  if (rt.state === 'monitoring' && addsLotsOf(rt) > 0) rt.state = 'averaging';
  if (rt.state === 'averaging' && addsLotsOf(rt) === 0 && rt.hedgeLots === 0) rt.state = 'monitoring';
  return result;
}

// ---------- операции с ногами (эмиссия ордеров) ----------

/**
 * Закрыть N лот добавок (FIFO), эмитировать ордер, вернуть реализованный P&L, пункты.
 * Для лонг-позиции закрытие = продажа (short), для шорт-позиции = покупка (long).
 */
function closeAdds(
  cfg: RescueConfig,
  rt: RescueRuntime,
  price: number,
  result: RescueTickResult,
  lots: number,
  reason: string,
): number {
  const dirSign = cfg.targetDirection === 'long' ? 1 : -1;
  const closeDir: Direction = dirSign > 0 ? 'short' : 'long';
  const requested = Math.min(lots, addsLotsOf(rt));
  let left = requested;
  let pnl = 0;
  while (left > 0 && rt.adds.length > 0) {
    const a = rt.adds[0];
    const take = Math.min(left, a.lots);
    pnl += (price - a.price) * dirSign * take;
    a.lots -= take;
    left -= take;
    if (a.lots <= 0) rt.adds.shift();
  }
  if (requested > 0) {
    result.actions.push({ direction: closeDir, lots: requested, reason, pnl });
  }
  return pnl;
}

/** Снять офсетный хедж полностью (обратный вход по рынку), вернуть снятые лоты */
function closeHedge(
  cfg: RescueConfig,
  rt: RescueRuntime,
  price: number,
  result: RescueTickResult,
  reason: string,
): number {
  if (rt.hedgeLots <= 0) return 0;
  const dirSign = cfg.targetDirection === 'long' ? 1 : -1;
  // Хедж — офсетная нога: для лонг-позиции это шорт (снятие = покупка) и наоборот
  const unwindDir: Direction = dirSign > 0 ? 'long' : 'short';
  const pnl = (rt.hedgeAvgPrice - price) * dirSign * rt.hedgeLots;
  result.actions.push({ direction: unwindDir, lots: rt.hedgeLots, reason, pnl });
  const lots = rt.hedgeLots;
  rt.hedgeLots = 0;
  rt.hedgeAvgPrice = 0;
  return lots;
}

/**
 * Возврат плеча: сначала снять хедж (восстановить экспозицию), затем закрыть
 * все добавки робота. Исходную позицию пользователя НЕ трогаем.
 * Порядок важен при неттинге: unwind хеджа возвращает нетто к позиции, после
 * чего продажа добавок оставляет ровно исходный объём пользователя.
 */
function closeRobotLeverage(
  cfg: RescueConfig,
  rt: RescueRuntime,
  price: number,
  result: RescueTickResult,
  reason: string,
): number {
  let closed = closeHedge(cfg, rt, price, result, `${reason}: снятие хеджа`);
  const adds = addsLotsOf(rt);
  if (adds > 0) {
    closeAdds(cfg, rt, price, result, adds, reason);
    closed += adds;
  }
  return closed;
}

// ---------- снапшот для UI ----------

/** Снимок состояния rescue-робота для карточки/деталей */
export interface RescueStatusSnapshot {
  state: RescueState;
  verdict: RescueVerdict;
  confidence: number;
  reasoning: string[];
  /** План спасения с done-флагами */
  plan: RescueStep[];
  /** Суммарно добавленных роботом лотов (живые добавки) */
  addsLots: number;
  /** Офсетный хедж, лотов */
  hedgeLots: number;
  /** Доля отыгранной просадки 0..1 */
  recoveredPct: number;
  /** Средневзвешенная цена всей позиции */
  weightedAvg: number;
  /** Просадка исходной позиции, доля (≥0 — убыток) */
  drawdownPct: number | null;
  /** Маржинальный дедлайн дня, ms */
  marginDeadline: number | null;
  /** мс до дедлайна (отрицательное — дедлайн пройден) */
  msToDeadline: number | null;
  marginLevel: MarginLevel | null;
  marginUtilization: number | null;
  lastEventText: string | null;
}

export function getRescueSnapshot(rt: RescueRuntime, cfg: RescueConfig, nowMs: number): RescueStatusSnapshot {
  return {
    state: rt.state,
    verdict: rt.verdict,
    confidence: rt.confidence,
    reasoning: [...rt.reasoning],
    plan: rt.plan.map((s) => ({ ...s })),
    addsLots: addsLotsOf(rt),
    hedgeLots: rt.hedgeLots,
    recoveredPct: rt.recoveredPct,
    weightedAvg: weightedAvg(cfg, rt),
    drawdownPct: rt.analysis?.drawdownPct ?? null,
    marginDeadline: rt.marginDeadlineAt,
    msToDeadline: rt.marginDeadlineAt !== null ? rt.marginDeadlineAt - nowMs : null,
    marginLevel: rt.lastMargin?.level ?? null,
    marginUtilization: rt.lastMargin?.utilization ?? null,
    lastEventText: rt.lastEventText,
  };
}
