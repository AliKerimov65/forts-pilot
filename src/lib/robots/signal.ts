// Сигнальная стратегия: EMA fast/slow cross + RSI-фильтр, либо чистый RSI-разворот.
// Вход/выход рыночными ордерами, обязательные SL/TP в пунктах, один активный вход.
// Чистая логика (индикаторы и оценка сигналов) — без API.
import type { Candle, CandleInterval } from '@/types/market';
import type { Direction } from '@/types/trading';
import type { SignalParams } from '@/types/robot';
import type { SignalExtConfig } from './config';

// ---------- Индикаторы ----------

/** EMA по массиву значений (seed = SMA первых period значений) */
export function emaSeries(values: number[], period: number): number[] {
  const p = Math.max(1, Math.round(period));
  if (values.length === 0) return [];
  const k = 2 / (p + 1);
  const out: number[] = [];
  let ema = values[0];
  // Прогрев: SMA на первом полном окне
  if (values.length >= p) {
    let sum = 0;
    for (let i = 0; i < p; i++) sum += values[i];
    ema = sum / p;
    for (let i = 0; i < p - 1; i++) out.push(values[i]);
    out.push(ema);
    for (let i = p; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      out.push(ema);
    }
    return out;
  }
  // Мало данных — экспоненциально с первого значения
  out.push(ema);
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

/** RSI (Wilder) — последнее значение */
export function rsiLast(values: number[], period = 14): number {
  const p = Math.max(2, Math.round(period));
  if (values.length < p + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  for (let i = p + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (p - 1) + Math.max(d, 0)) / p;
    avgLoss = (avgLoss * (p - 1) + Math.max(-d, 0)) / p;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** ATR — последнее значение */
export function atrLast(candles: Candle[], period = 14): number {
  const p = Math.max(2, Math.round(period));
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const window = trs.slice(-p);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

// ---------- Таймфреймы ----------

export const TIMEFRAMES = ['1m', '5m', '15m', '1h'] as const;
export type SignalTimeframe = (typeof TIMEFRAMES)[number];

export function timeframeToInterval(tf: string): CandleInterval {
  switch (tf) {
    case '1m':
      return 'CANDLE_INTERVAL_1_MIN';
    case '15m':
      return 'CANDLE_INTERVAL_15_MIN';
    case '1h':
      return 'CANDLE_INTERVAL_HOUR';
    case '5m':
    default:
      return 'CANDLE_INTERVAL_5_MIN';
  }
}

export function timeframeToMs(tf: string): number {
  switch (tf) {
    case '1m':
      return 60_000;
    case '15m':
      return 900_000;
    case '1h':
      return 3_600_000;
    case '5m':
    default:
      return 300_000;
  }
}

// ---------- Рантайм ----------

export interface SignalPosition {
  direction: Direction;
  lots: number;
  entryPrice: number;
}

export interface SignalRuntime {
  candles: Candle[];
  intervalMs: number;
  position: SignalPosition | null;
  /** Ключ свечи, на которой уже брали вход (один вход на свечу) */
  lastEntryCandle: number | null;
}

export function initSignalRuntime(candles: Candle[], timeframe: string): SignalRuntime {
  return { candles, intervalMs: timeframeToMs(timeframe), position: null, lastEntryCandle: null };
}

/** Обновить историю тиком: дописать в формирующуюся свечу или открыть новую. true — свеча закрылась. */
export function applyTick(rt: SignalRuntime, price: number, now: number): boolean {
  const last = rt.candles[rt.candles.length - 1];
  if (!last) {
    rt.candles.push({ time: now, open: price, high: price, low: price, close: price, volume: 0, isComplete: false });
    return false;
  }
  const candleStart = Math.floor(now / rt.intervalMs) * rt.intervalMs;
  if (candleStart > last.time) {
    last.isComplete = true;
    rt.candles.push({ time: candleStart, open: last.close, high: price, low: price, close: price, volume: 0, isComplete: false });
    if (rt.candles.length > 300) rt.candles.splice(0, rt.candles.length - 300);
    return true;
  }
  last.close = price;
  last.high = Math.max(last.high, price);
  last.low = Math.min(last.low, price);
  last.isComplete = false;
  return false;
}

export type SignalAction =
  | { type: 'enter'; direction: Direction; lots: number; reason: string }
  | { type: 'exit'; direction: Direction; lots: number; reason: 'sl' | 'tp' | 'signal'; pnl: number };

export type ExitAction = Extract<SignalAction, { type: 'exit' }>;

/** Проверка SL/TP и встречного сигнала для открытой позиции — на каждом тике */
export function evaluateExit(
  rt: SignalRuntime,
  params: SignalParams,
  ext: SignalExtConfig,
  price: number,
): ExitAction | null {
  const pos = rt.position;
  if (!pos) return null;
  const dir = pos.direction === 'long' ? 1 : -1;
  const diff = (price - pos.entryPrice) * dir;

  if (params.stopLossPts && params.stopLossPts > 0 && diff <= -params.stopLossPts) {
    return { type: 'exit', direction: pos.direction, lots: pos.lots, reason: 'sl', pnl: diff * pos.lots };
  }
  if (params.takeProfitPts && params.takeProfitPts > 0 && diff >= params.takeProfitPts) {
    return { type: 'exit', direction: pos.direction, lots: pos.lots, reason: 'tp', pnl: diff * pos.lots };
  }

  // Встречный EMA-cross — выход по сигналу
  if (params.signalType === 'ema_cross') {
    const cross = detectEmaCross(rt.candles, ext.emaFast, ext.emaSlow);
    if ((pos.direction === 'long' && cross === 'down') || (pos.direction === 'short' && cross === 'up')) {
      return { type: 'exit', direction: pos.direction, lots: pos.lots, reason: 'signal', pnl: diff * pos.lots };
    }
  }
  return null;
}

/** Оценка входа — когда позиции нет */
export function evaluateEntry(
  rt: SignalRuntime,
  params: SignalParams,
  ext: SignalExtConfig,
): SignalAction | null {
  if (rt.position) return null;
  const closes = rt.candles.map((c) => c.close);
  if (closes.length < Math.max(ext.emaSlow, ext.rsiPeriod) + 2) return null;

  const lastCandleTime = rt.candles[rt.candles.length - 1]?.time ?? 0;
  if (rt.lastEntryCandle === lastCandleTime) return null; // уже входили на этой свече

  const lots = Math.max(1, Math.min(params.lots, ext.maxPositionLots));
  const rsi = rsiLast(closes, ext.rsiPeriod);

  let dir: Direction | null = null;
  let reason = '';

  if (params.signalType === 'rsi') {
    // RSI-разворот: перепроданность → лонг, перекупленность → шорт
    if (rsi <= ext.rsiOversold) {
      dir = 'long';
      reason = `RSI ${rsi.toFixed(0)} ≤ ${ext.rsiOversold} — перепроданность`;
    } else if (rsi >= ext.rsiOverbought) {
      dir = 'short';
      reason = `RSI ${rsi.toFixed(0)} ≥ ${ext.rsiOverbought} — перекупленность`;
    }
  } else {
    // EMA-cross (+ опциональный RSI-фильтр)
    const cross = detectEmaCross(rt.candles, ext.emaFast, ext.emaSlow);
    if (cross === 'up' && (!ext.useRsiFilter || rsi < ext.rsiOverbought)) {
      dir = 'long';
      reason = `EMA${ext.emaFast} пересекла EMA${ext.emaSlow} снизу вверх`;
    } else if (cross === 'down' && (!ext.useRsiFilter || rsi > ext.rsiOversold)) {
      dir = 'short';
      reason = `EMA${ext.emaFast} пересекла EMA${ext.emaSlow} сверху вниз`;
    }
  }

  if (!dir) return null;
  if (ext.direction !== 'both' && dir !== ext.direction) return null;

  rt.lastEntryCandle = lastCandleTime;
  return { type: 'enter', direction: dir, lots, reason };
}

/** Пересечение EMA на двух последних значениях: 'up' | 'down' | null */
function detectEmaCross(candles: Candle[], fast: number, slow: number): 'up' | 'down' | null {
  const closes = candles.map((c) => c.close);
  if (closes.length < Math.max(fast, slow) + 2) return null;
  const emaF = emaSeries(closes, fast);
  const emaS = emaSeries(closes, slow);
  const n = closes.length;
  const curF = emaF[n - 1];
  const curS = emaS[n - 1];
  const prevF = emaF[n - 2];
  const prevS = emaS[n - 2];
  if (prevF <= prevS && curF > curS) return 'up';
  if (prevF >= prevS && curF < curS) return 'down';
  return null;
}
