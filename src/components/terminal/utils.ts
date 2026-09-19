// Утилиты страницы Терминала: таймфреймы, формат цен, агрегация свечей
import { formatInstrumentPrice } from '@/lib/tinvest/instruments';
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

/** Формат цены инструмента: "73 412,5" — шаг цены по minPriceIncrement (formatInstrumentPrice) */
export function fmtPrice(value: number, ins?: Instrument | null): string {
  if (ins) return formatInstrumentPrice(ins, value);
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Символ валюты инструмента (ISO → знак) */
export function currencySymbol(currency: string): string {
  switch (currency.toLowerCase()) {
    case 'rub':
      return '₽';
    case 'usd':
      return '$';
    case 'eur':
      return '€';
    case 'cny':
      return '¥';
    default:
      return currency.toUpperCase();
  }
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

/** Плюрализация «лот»: 1 лот · 2 лота · 5 лотов */
export function lotsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'лот';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'лота';
  return 'лотов';
}

/** Нереализованный P&L позиции в % от средней цены входа */
export function positionPnlPct(p: { avgPrice: number; currentPrice: number; direction: 'long' | 'short' }): number {
  if (p.avgPrice === 0) return 0;
  const dir = p.direction === 'long' ? 1 : -1;
  return ((p.currentPrice - p.avgPrice) / p.avgPrice) * dir * 100;
}

/** Формат P&L в ₽ со знаком: "+1 240 ₽" / "−310 ₽" */
export function fmtPnlRub(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('ru-RU')} ₽`;
}
