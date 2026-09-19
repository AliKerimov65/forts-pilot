// Типы торговых роботов (движок исполнения стратегий — отдельный агент, здесь только данные)

/** Стратегия робота */
export type RobotStrategy = 'grid' | 'signal' | 'regime' | 'rescue';

/** Статус робота */
export type RobotStatus = 'off' | 'running' | 'paused' | 'error';

/** Параметры grid-стратегии */
export interface GridParams {
  /** Верхняя граница сетки, пункты */
  upperBound: number;
  /** Нижняя граница сетки, пункты */
  lowerBound: number;
  /** Число уровней сетки */
  levels: number;
  /** Лотов на уровень */
  lotsPerLevel: number;
}

/** Параметры сигнальной стратегии */
export interface SignalParams {
  /** Источник сигнала, напр. "ema_cross" | "rsi" */
  signalType: string;
  /** Таймфрейм сигнала */
  timeframe: string;
  /** Размер позиции в лотах */
  lots: number;
  /** Стоп-лосс, пункты */
  stopLossPts?: number;
  /** Тейк-профит, пункты */
  takeProfitPts?: number;
}

/** Параметры regime-стратегии (создание; расширенные настройки — RegimeConfig в lib/robots/config) */
export interface RegimeParams {
  /** Размер позиции в лотах (базовая нога) */
  lots: number;
  /** Максимальная суммарная позиция, лотов */
  maxPositionLots: number;
}

/** Параметры rescue-стратегии «Спасатель позиции» (снимок убыточной позиции на момент создания) */
export interface RescueParams {
  /** Направление убыточной позиции пользователя */
  targetDirection: 'long' | 'short';
  /** Лотов в убыточной позиции */
  targetLots: number;
  /** Средняя цена входа убыточной позиции */
  targetAvgPrice: number;
  /** Максимальная суммарная позиция с добавками робота, лотов */
  maxTotalLots: number;
}

/** Параметры робота (union по стратегии) */
export type RobotParams =
  | { strategy: 'grid'; grid: GridParams }
  | { strategy: 'signal'; signal: SignalParams }
  // regime: поле `signal` — обязательная оболочка совместимости: текущий UI-визард
  // сужает «не grid» к форме signal (править UI нельзя). Движок читает только `regime`;
  // UI-агент при создании regime-робота заполняет signal заглушкой {signalType:'regime',
  // timeframe:'5m', lots} до появления нативного шага визарда.
  | { strategy: 'regime'; regime: RegimeParams; signal: SignalParams }
  // rescue: поле `signal` — та же обязательная оболочка совместимости с UI-визардом,
  // что и у regime (заполняется заглушкой). Движок читает только `rescue`
  // + полный RescueConfig из ext-стора (getExtConfig(robot).rescue).
  // instrumentId робота = uid спасаемого инструмента (= targetInstrumentId).
  | { strategy: 'rescue'; rescue: RescueParams; signal: SignalParams };

/** Статистика робота */
export interface RobotStats {
  /** P&L за сегодня, ₽ */
  dayPnl: number;
  /** P&L за всё время, ₽ */
  totalPnl: number;
  /** Число сделок */
  trades: number;
  /** Win-rate, 0..1 */
  winRate: number;
  /** Выделено капитала, ₽ */
  allocatedCapital: number;
  /** Время последнего запуска, unix ms */
  lastStartedAt?: number;
}

/** Торговый робот */
export interface Robot {
  id: string;
  name: string;
  strategy: RobotStrategy;
  /** Инструмент (uid), на котором работает */
  instrumentId: string;
  /** Тикер для отображения */
  ticker: string;
  status: RobotStatus;
  /** Описание ошибки при status='error' */
  errorMessage?: string;
  params: RobotParams;
  stats: RobotStats;
  /** unix ms создания */
  createdAt: number;
}
