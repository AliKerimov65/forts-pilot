// Общие типы рыночных данных FORTS PILOT

/** Фьючерс FORTS (нормализованный из InstrumentsService/Futures) */
export interface Instrument {
  /** Уникальный идентификатор инструмента (uid) — основной для запросов */
  uid: string;
  /** FIGI (legacy, для фьючерсов необязателен) */
  figi: string;
  /** Тикер, напр. "Si" / "SRU5" */
  ticker: string;
  /** Класс-код, для фьючерсов FORTS обычно "SPBFUT" */
  classCode: string;
  /** Название, напр. "Доллар США / рубль" */
  name: string;
  /** Базовый актив (USD, Brent, IMOEX...) */
  basicAsset: string;
  /** Размер лота */
  lot: number;
  /** Валюта расчётов */
  currency: string;
  /** Шаг цены в пунктах */
  minPriceIncrement: number;
  /** Дата экспирации ISO */
  expirationDate?: string;
  /** ГО покупки/продажи (MoneyValue → number, ₽) */
  marginBuy?: number;
  marginSell?: number;
}

/** Свеча (нормализованная, цены — числа) */
export interface Candle {
  /** Время начала свечи, unix ms */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete: boolean;
}

/** Уровень стакана */
export interface OrderBookLevel {
  price: number;
  /** Количество лотов */
  quantity: number;
}

/** Стакан */
export interface OrderBook {
  instrumentId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice: number;
  limitUp?: number;
  limitDown?: number;
  /** Время снимка, unix ms */
  time: number;
}

/** Котировка последней цены */
export interface Quote {
  instrumentId: string;
  price: number;
  /** Дельта к предыдущей цене (для флэша) */
  delta: number;
  /** Изменение за сессию, % */
  changePct?: number;
  time: number;
}

/** Таймфреймы свечей (CANDLE_INTERVAL_*) */
export type CandleInterval =
  | 'CANDLE_INTERVAL_1_MIN'
  | 'CANDLE_INTERVAL_5_MIN'
  | 'CANDLE_INTERVAL_15_MIN'
  | 'CANDLE_INTERVAL_HOUR'
  | 'CANDLE_INTERVAL_DAY'
  | 'CANDLE_INTERVAL_WEEK';
