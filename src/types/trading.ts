// Типы торговли: позиции, ордера, сделки, журнал

/** Направление позиции/ордера */
export type Direction = 'long' | 'short';

/** Открытая позиция */
export interface Position {
  instrumentId: string;
  figi?: string;
  ticker: string;
  name?: string;
  direction: Direction;
  /** Количество лотов */
  lots: number;
  /** Средняя цена входа (пункты) */
  avgPrice: number;
  /** Текущая цена (пункты) */
  currentPrice: number;
  /** Нереализованный P&L, ₽ */
  pnl: number;
  /** ГО под позицию, ₽ */
  margin?: number;
}

/** Статус ордера */
export type OrderStatus = 'new' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';

/** Активный/исторический ордер */
export interface Order {
  orderId: string;
  accountId: string;
  instrumentId: string;
  ticker: string;
  direction: Direction;
  /** Лотов запрошено */
  lotsRequested: number;
  /** Лотов исполнено */
  lotsExecuted: number;
  /** Цена (пункты), undefined для рыночной */
  price?: number;
  orderType: 'limit' | 'market';
  status: OrderStatus;
  /** unix ms */
  time: number;
  message?: string;
}

/** Сделка (исполнение) */
export interface Trade {
  id: string;
  orderId?: string;
  instrumentId: string;
  ticker: string;
  direction: Direction;
  lots: number;
  price: number;
  /** Комиссия, ₽ */
  commission?: number;
  /** Реализованный P&L (для закрывающих сделок), ₽ */
  pnl?: number;
  /** Кто инициировал: рука пользователя или робот */
  source: 'manual' | 'robot';
  robotId?: string;
  robotName?: string;
  /** unix ms */
  time: number;
}

/** Типы событий ленты/журнала */
export type JournalEventType =
  | 'trade' // сделка
  | 'order' // выставление/отмена ордера
  | 'sl' // сработал стоп-лосс
  | 'tp' // сработал тейк-профит
  | 'robot' // старт/стоп/ошибка робота
  | 'risk' // срабатывание риск-лимита
  | 'system'; // системное событие

/** Запись ленты событий / журнала */
export interface JournalEvent {
  id: string;
  type: JournalEventType;
  /** Текст, напр. "Grid-бот купил 1 лот Si по 73 412" */
  text: string;
  /** Сумма/P&L события, ₽ (для цветовой подсветки) */
  amount?: number;
  robotId?: string;
  instrumentId?: string;
  /** unix ms */
  time: number;
}

/** Сводка портфеля */
export interface PortfolioSummary {
  /** Полная стоимость портфеля, ₽ */
  totalAmount: number;
  /** Свободные деньги, ₽ */
  cash: number;
  /** Свободная маржа, ₽ */
  freeMargin: number;
  /** Заблокированное ГО, ₽ */
  blockedMargin: number;
  /** P&L за день, ₽ */
  dayPnl: number;
  /** P&L за день, % */
  dayPnlPct: number;
  /** Ожидаемая доходность, % */
  expectedYieldPct?: number;
}

/** Точка equity-кривой */
export interface EquityPoint {
  /** unix ms */
  time: number;
  /** Стоимость портфеля, ₽ */
  equity: number;
  /** Бенчмарк (IMOEXF, нормирован), ₽ */
  benchmark?: number;
}
