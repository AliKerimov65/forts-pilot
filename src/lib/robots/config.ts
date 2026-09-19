// Расширенные настройки роботов — параметры, которых нет в RobotParams из CONTRACT.
// Обвязка в зоне page-агента: стор и типы не редактируются, конфиг хранится отдельным
// persist-стором, ключ — id робота. Движок и UI читают через getExtConfig (с дефолтами).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Robot } from '@/types/robot';

export type SignalDirection = 'long' | 'short' | 'both';
export type GridStepType = 'abs' | 'pct';

/** Доп. параметры grid-стратегии */
export interface GridExtConfig {
  /** Тип шага сетки: абсолютный (пункты) или % — используется конструктором */
  stepType: GridStepType;
  /** Перестраивать сетку при выходе цены за границы */
  rebuild: boolean;
  /** Стоп на инвентарь сетки, % от средней входа (0/undefined — выкл) */
  stopLossPct?: number;
  /** Тейк на инвентарь сетки, % (0/undefined — выкл) */
  takeProfitPct?: number;
}

/** Доп. параметры сигнальной стратегии */
export interface SignalExtConfig {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  /** RSI-фильтр для EMA-cross (не входить против перекупленности/перепроданности) */
  useRsiFilter: boolean;
  /** Разрешённые направления входа */
  direction: SignalDirection;
  /** Максимальная позиция, лотов */
  maxPositionLots: number;
}

/** Конфиг стратегии 'regime' — «Регламент MOEX · Hedge» */
export interface RegimeConfig {
  strategy: 'regime';
  /** За сколько минут до открытия основной сессии запускать премаркет-анализ */
  entryOffsetMin: number; // 10
  /** Флэт не позднее чем за N мин до закрытия дня (нижняя граница окна) */
  flatBeforeCloseMinMin: number; // 25
  /** Флэт не раньше чем за N мин до закрытия дня (верхняя граница окна) */
  flatBeforeCloseMaxMin: number; // 38
  /** Хедж-режим: держать виртуальные ноги long/short */
  hedgeEnabled: boolean; // true
  /** Доля противоположной ноги от основной (0..1) */
  baseHedgeRatio: number; // 0.5
  /** Окно наблюдения вокруг клиринга, мин (до и после) */
  clearingWatchMin: number; // 5
  /** Порог z-score 1-мин доходности для детекции клиринг-скачка */
  jumpZThreshold: number; // 2.5
  /** Тейк-профит от средней входа, в шагах цены */
  takeProfitPts: number;
  /** Доля позиции, закрываемая на тейке (0..1) */
  tpClosePct: number; // 0.5
  /** Откат от хода для переоткрытия после TP (0..1) */
  reentryRetracePct: number; // 0.3
  /** Трейлинг после первого TP */
  trailingEnabled: boolean; // true
  /** Минимальная уверенность премаркет-анализа для входа (0..1) */
  minConfidence: number; // 0.55
  /** Пороги утилизации маржи: предупреждение / сокращение / аварийный флэт */
  marginWarn: number;
  marginReduce: number;
  marginEmergency: number; // 0.55/0.70/0.82
  /** Максимальная суммарная позиция (обе ноги), лотов */
  maxPositionLots: number;
  /** Базовый размер ноги при входе, лотов */
  lots: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  strategy: 'regime',
  entryOffsetMin: 10,
  flatBeforeCloseMinMin: 25,
  flatBeforeCloseMaxMin: 38,
  hedgeEnabled: true,
  baseHedgeRatio: 0.5,
  clearingWatchMin: 5,
  jumpZThreshold: 2.5,
  takeProfitPts: 120,
  tpClosePct: 0.5,
  reentryRetracePct: 0.3,
  trailingEnabled: true,
  minConfidence: 0.55,
  marginWarn: 0.55,
  marginReduce: 0.7,
  marginEmergency: 0.82,
  maxPositionLots: 6,
  lots: 2,
};

/** Русские подписи полей RegimeConfig для UI-формы */
export const REGIME_CONFIG_LABELS: Record<keyof Omit<RegimeConfig, 'strategy'>, { label: string; description: string }> = {
  entryOffsetMin: { label: 'Анализ до открытия, мин', description: 'За сколько минут до основной сессии оценивать гэп, стакан и волатильность' },
  flatBeforeCloseMinMin: { label: 'Флэт до закрытия, мин (мин)', description: 'Ближняя граница окна принудительного закрытия перед концом дня' },
  flatBeforeCloseMaxMin: { label: 'Флэт до закрытия, мин (макс)', description: 'Дальняя граница окна; момент выбирается детерминированно по дате' },
  hedgeEnabled: { label: 'Хедж-режим', description: 'Держать виртуальные ноги long/short; в API уходит только изменение нетто' },
  baseHedgeRatio: { label: 'Базовая доля хеджа', description: 'Размер противоположной ноги от основной при низкой уверенности' },
  clearingWatchMin: { label: 'Наблюдение за клирингом, мин', description: 'Окно до/после промклиринга и вечернего клиринга для детекции скачков' },
  jumpZThreshold: { label: 'Порог скачка (z-score)', description: 'Z-score 1-мин доходности + всплеск объёма = клиринг-скачок' },
  takeProfitPts: { label: 'Тейк-профит, шагов цены', description: 'Ход от средней входа для частичной фиксации' },
  tpClosePct: { label: 'Доля фиксации на TP', description: 'Какую часть ноги закрыть при достижении тейк-профита' },
  reentryRetracePct: { label: 'Откат для переоткрытия', description: 'Доля от хода до TP: ждём возврата цены для входа в лучшей точке' },
  trailingEnabled: { label: 'Трейлинг после TP', description: 'Подтягивать защитный уровень за ценой после первой фиксации' },
  minConfidence: { label: 'Мин. уверенность входа', description: 'Ниже порога премаркет-вход пропускается или хеджируется' },
  marginWarn: { label: 'Маржа: предупреждение', description: 'Утилизация маржи 0..1 — только индикация' },
  marginReduce: { label: 'Маржа: сокращение', description: 'Запрет новых входов и сокращение нетто-позиции' },
  marginEmergency: { label: 'Маржа: авария', description: 'Полный флэт всех ног и автостоп робота' },
  maxPositionLots: { label: 'Макс. позиция, лотов', description: 'Суммарный лимит обеих ног' },
  lots: { label: 'Базовая нога, лотов', description: 'Размер позиции при входе по премаркет-сигналу' },
};

/** Русские названия фаз regime-робота для UI-бейджей */
export const REGIME_PHASE_LABELS: Record<string, string> = {
  idle: 'Ожидание',
  analyzing: 'Премаркет-анализ',
  entering: 'Вход в позицию',
  positioned: 'В позиции',
  tp_waiting_reentry: 'Ждём откат для переоткрытия',
  flat_for_close: 'Флэт до завтра',
  emergency_stopped: 'Аварийный стоп (маржа)',
};

/** Защитные лимиты робота */
export interface ProtectionConfig {
  /** Макс. убыток робота в день, ₽ (0 — выкл) */
  dailyLossLimit: number;
  /** Макс. сделок в день (0 — выкл) */
  maxTradesPerDay: number;
  /** Стоп после серии убыточных сделок подряд (0 — выкл) */
  stopAfterLossStreak: number;
}

/** Полный расширенный конфиг робота */
export interface RobotExtConfig {
  /** Режим, выбранный при создании (бейдж на карточке) */
  mode: 'sandbox' | 'live';
  grid?: GridExtConfig;
  signal?: SignalExtConfig;
  regime?: RegimeConfig;
  protection: ProtectionConfig;
}

export const defaultProtection = (): ProtectionConfig => ({
  dailyLossLimit: 5_000,
  maxTradesPerDay: 50,
  stopAfterLossStreak: 5,
});

export const defaultGridExt = (): GridExtConfig => ({
  stepType: 'pct',
  rebuild: true,
  stopLossPct: 0,
  takeProfitPct: 0,
});

export const defaultSignalExt = (): SignalExtConfig => ({
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  useRsiFilter: true,
  direction: 'both',
  maxPositionLots: 3,
});

export const defaultRegimeExt = (): RegimeConfig => ({ ...DEFAULT_REGIME_CONFIG });

interface RobotsExtState {
  configs: Record<string, RobotExtConfig>;
  /** Демо-роботы уже посеяны в robots-стор */
  demoSeeded: boolean;
  setConfig: (robotId: string, config: RobotExtConfig) => void;
  removeConfig: (robotId: string) => void;
  markDemoSeeded: () => void;
}

export const useRobotsExtStore = create<RobotsExtState>()(
  persist(
    (set) => ({
      configs: {},
      demoSeeded: false,
      setConfig: (robotId, config) =>
        set((s) => ({ configs: { ...s.configs, [robotId]: config } })),
      removeConfig: (robotId) =>
        set((s) => {
          const next = { ...s.configs };
          delete next[robotId];
          return { configs: next };
        }),
      markDemoSeeded: () => set({ demoSeeded: true }),
    }),
    { name: 'forts-pilot-robots-ext' },
  ),
);

/** Конфиг робота с дефолтами по стратегии */
export function getExtConfig(robot: Robot): RobotExtConfig {
  const stored = useRobotsExtStore.getState().configs[robot.id];
  const base: RobotExtConfig = {
    mode: 'sandbox',
    protection: defaultProtection(),
    ...(robot.strategy === 'grid'
      ? { grid: defaultGridExt() }
      : robot.strategy === 'regime'
        ? { regime: defaultRegimeExt() }
        : { signal: defaultSignalExt() }),
  };
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    protection: { ...base.protection, ...stored.protection },
    grid: stored.grid ? { ...defaultGridExt(), ...stored.grid } : base.grid,
    signal: stored.signal ? { ...defaultSignalExt(), ...stored.signal } : base.signal,
    regime: stored.regime ? { ...defaultRegimeExt(), ...stored.regime } : base.regime,
  };
}
