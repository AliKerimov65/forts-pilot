// Хелперы по инструментам всех классов (акции, ETF, валюты, фьючерсы, опционы, облигации, индексы)
// По брифу tinvest-instruments-brief.md: индексы — только котировки, ордера запрещены.

import type { Instrument, InstrumentType } from '@/types/market';

/** Русская метка класса инструмента */
export function instrumentTypeLabel(type: InstrumentType): string {
  switch (type) {
    case 'stock':
      return 'Акция';
    case 'future':
      return 'Фьючерс';
    case 'index':
      return 'Индекс';
    case 'etf':
      return 'ETF';
    case 'currency':
      return 'Валюта';
    case 'bond':
      return 'Облигация';
    case 'option':
      return 'Опцион';
  }
}

/**
 * Можно ли торговать инструментом в терминале.
 * Индексы/индикативы — нет (tradable=false). Остальные — по apiTradeAvailableFlag.
 * Дополнительно учитывайте tradingStatus (NORMAL_TRADING / DEALER_NORMAL_TRADING) и флаги GetTradingStatus.
 */
export function isTradable(i: Instrument): boolean {
  return i.tradable && i.apiTradeAvailable;
}

/** Шаг цены инструмента (minPriceIncrement; 1 как безопасный дефолт) */
export function priceStep(i: Instrument): number {
  return i.minPriceIncrement > 0 ? i.minPriceIncrement : 1;
}

/** Лоты → штуки (PostOrder.quantity — в ЛОТАХ для всех классов, бриф §6) */
export function qtyToUnits(i: Instrument, lots: number): number {
  return lots * (i.lot > 0 ? i.lot : 1);
}

/** Штуки → лоты */
export function unitsToQty(i: Instrument, units: number): number {
  const lot = i.lot > 0 ? i.lot : 1;
  return Math.floor(units / lot);
}

/** Количество знаков после запятой, соответствующее шагу цены */
export function priceDigits(i: Instrument): number {
  const step = priceStep(i);
  if (step >= 1) return 0;
  const s = step.toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(s.length - dot - 1, 6);
}

/** Округление цены к шагу minPriceIncrement */
export function roundPriceToStep(i: Instrument, price: number): number {
  const step = priceStep(i);
  return Number((Math.round(price / step) * step).toFixed(6));
}

/** Форматирование цены с точностью по minPriceIncrement (ru-RU, без валюты) */
export function formatInstrumentPrice(i: Instrument, price: number): string {
  return price.toLocaleString('ru-RU', {
    minimumFractionDigits: priceDigits(i),
    maximumFractionDigits: priceDigits(i),
  });
}

/** Торгуется ли инструмент прямо сейчас (по полю tradingStatus; бриф §7) */
export function isTradingNow(i: Instrument): boolean {
  return (
    i.tradingStatus === 'SECURITY_TRADING_STATUS_NORMAL_TRADING' ||
    i.tradingStatus === 'SECURITY_TRADING_STATUS_DEALER_NORMAL_TRADING'
  );
}
