// Утилиты страницы Терминала: таймфреймы, формат цен, агрегация свечей
import type { Candle, CandleInterval, Instrument } from '@/types/market';

export interface Timeframe {
  key: string;
  label: string;
  /** Интервал для API/мока (4ч собирается агрегацией часовых) */
  apiInterval: CandleInterval;
  /** Длительность свечи в мс (для live-обновления последней свечи) */
  ms: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { key: '1m', label: '1м', apiInterval: 'CANDLE_INTERVAL_1_MIN', ms: 60_000 },
  { key: '5m', label: '5м', apiInterval: 'CANDLE_INTERVAL_5_MIN', ms: 300_000 },
  { key: '15m', label: '15м', apiInterval: 'CANDLE_INTERVAL_15_MIN', ms: 900_000 },
  { key: '1h', label: '1ч', apiInterval: 'CANDLE_INTERVAL_HOUR', ms: 3_600_000 },
  { key: '4h', label: '4ч', apiInterval: 'CANDLE_INTERVAL_HOUR', ms: 4 * 3_600_000 },
  { key: '1d', label: '1д', apiInterval: 'CANDLE_INTERVAL_DAY', ms: 86_400_000 },
];

/** Количество знаков после запятой из шага цены */
export function priceDigits(minPriceIncrement: number): number {
  if (minPriceIncrement >= 1) return 0;
  const s = minPriceIncrement.toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(s.length - dot - 1, 6);
}

/** Округление к шагу цены */
export function roundToStep(price: number, step: number): number {
  if (step <= 0) return price;
  const d = priceDigits(step);
  return Number((Math.round(price / step) * step).toFixed(d));
}

/** Формат цены инструмента: "73 412,5" */
export function fmtPrice(value: number, ins?: Instrument | null): string {
  const d = ins ? priceDigits(ins.minPriceIncrement) : 2;
  return value.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Тикер с экспирацией: Si + 2025-12-15 → "Si-12.25" */
export function futuresLabel(ins: Instrument): string {
  if (!ins.expirationDate) return ins.ticker;
  const d = new Date(ins.expirationDate);
  if (Number.isNaN(d.getTime())) return ins.ticker;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${ins.ticker}-${mm}.${yy}`;
}

export type InstrumentCategory = 'all' | 'index' | 'currency' | 'commodity' | 'fav';

const INDEX_RE = /IMOEX|RTS|индекс/i;
const CURRENCY_RE = /Si$|USD|EUR|CNY|юан|евро|доллар/i;
const COMMODITY_RE = /BR$|GOLD|SILV|NG$|нефт|золот|серебр|газ/i;

export function categoryOf(ins: Instrument): 'index' | 'currency' | 'commodity' | 'other' {
  const s = `${ins.ticker} ${ins.name} ${ins.basicAsset}`;
  if (INDEX_RE.test(s)) return 'index';
  if (CURRENCY_RE.test(s)) return 'currency';
  if (COMMODITY_RE.test(s)) return 'commodity';
  return 'other';
}

/** Агрегация свечей в крупный таймфрейм (для 4ч из часовых) */
export function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (bucketMs <= 0) return candles;
  const map = new Map<number, Candle>();
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketMs) * bucketMs;
    const ex = map.get(bucket);
    if (!ex) {
      map.set(bucket, { ...c, time: bucket });
    } else {
      ex.high = Math.max(ex.high, c.high);
      ex.low = Math.min(ex.low, c.low);
      ex.close = c.close;
      ex.volume += c.volume;
      ex.isComplete = c.isComplete;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Haptic feedback 10ms (design.md §8) */
export function haptic(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* noop */
  }
}
