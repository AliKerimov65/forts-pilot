// Общие типы рыночных данных FORTS PILOT

/** Класс инструмента (маппинг из InstrumentType API: SHARE/CURRENCY/ETF/FUTURES/OPTION/BOND/INDEX) */
export type InstrumentType = 'stock' | 'future' | 'etf' | 'currency' | 'bond' | 'option' | 'index';

/** Инструмент (нормализованный из InstrumentsService: Shares/Etfs/Currencies/Futures/Bonds/OptionsBy/Indicatives/FindInstrument) */
export interface Instrument {
  /** Уникальный идентификатор инструмента (uid) — основной для запросов */
  uid: string;
  /** FIGI (legacy, для фьючерсов необязателен) */
  figi: string;
  /** Тикер, напр. "Si" / "SBER" / "IMOEX" */
  ticker: string;
  /** Класс-код ("SPBFUT", "TQBR", "CETS"... — брать из API, не хардкодить) */
  classCode: string;
  /** Название, напр. "Доллар США / рубль" */
  name: string;
  /** Базовый актив (для фьючерсов/опционов: USD, Brent, IMOEX...) */
  basicAsset: string;
  /** Размер лота (бумаг в лоте; ордера и объёмы кратны lot) */
  lot: number;
  /** Валюта расчётов (ISO: rub, usd...) */
  currency: string;
  /** Шаг цены (в пунктах для фьючерсов, в % от номинала для облигаций) */
  minPriceIncrement: number;
  /** Класс инструмента */
  type: InstrumentType;
  /** Доступен для торговли через T-Invest API (apiTradeAvailableFlag) */
  apiTradeAvailable: boolean;
  /** Торгуемый ли вообще в терминале: false для индексов (только котировки, ордера запрещены) */
  tradable: boolean;
  /** Доступность покупки/продажи (buyAvailableFlag/sellAvailableFlag) */
  buyAvailable?: boolean;
  sellAvailable?: boolean;
  /** Доступность шорта (shortEnabledFlag; false → блокировать SELL без покрытия) */
  shortEnabled?: boolean;
  /** Только для квалифицированных инвесторов (forQualInvestorFlag) */
  forQualInvestor?: boolean;
  /** Режим торгов (SecurityTradingStatus, напр. SECURITY_TRADING_STATUS_NORMAL_TRADING) */
  tradingStatus?: string;
  /** Торгуется по выходным / режим дилера (weekendFlag) */
  weekendFlag?: boolean;
  /** ISIN (акции/облигации/ETF) */
  isin?: string;
  /** Дата экспирации ISO (фьючерсы/опционы) */
  expirationDate?: string;
  /** ГО покупки/продажи (MoneyValue → number, ₽) — фьючерсы */
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
