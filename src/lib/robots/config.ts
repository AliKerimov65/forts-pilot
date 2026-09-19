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

/** Конфиг стратегии 'rescue' — «Спасатель позиции» */
export interface RescueConfig {
  strategy: 'rescue';
  /** uid инструмента убыточной позиции (= instrumentId робота) */
  targetInstrumentId: string;
  /** Направление убыточной позиции пользователя */
  targetDirection: 'long' | 'short';
  /** Лотов в убыточной позиции */
  targetLots: number;
  /** Средняя цена входа убыточной позиции */
  targetAvgPrice: number;
  /** Максимум шагов усреднения (лестница докупок) */
  maxAvgSteps: number; // 3
  /** Шаг усреднения: следующая докупка только при цене лучше предыдущей на stepAtrMult × ATR */
  stepAtrMult: number; // 1.0
  /** Множитель лотов каждой следующей докупки (жёстко ограничен ≤1.5 — анти-мартингейл-кэп) */
  lotMult: number; // 1.3
  /** Максимальная суммарная позиция (исходная + добавки робота), лотов */
  maxTotalLots: number;
  /** Цель выхода: weightedAvg × (1 ± recoverTargetPct) */
  recoverTargetPct: number; // 0.003
  /** true — при достижении цели закрыть всё (включая исходную позицию); false — частичные фиксации добавок шагами */
  recoverCloseAll: boolean; // true
  /** Разрешить офсетный хедж, замораживающий просадку */
  hedgePauseEnabled: boolean; // true
  /** Разрешить принудительное закрытие исходной позиции при просадке > maxDrawdownPct */
  allowStopOut: boolean; // false
  /** Максимальная просадка исходной позиции (доля 0..1) для stop_out */
  maxDrawdownPct: number; // 0.05
  /** Буфер возврата маржи: дедлайн = dayClose − marginReturnBufferMin */
  marginReturnBufferMin: number; // 60
  /** Минимум минут до дедлайна, при котором ещё разрешено новое добавление */
  minActionBeforeDeadlineMin: number; // 10
  /** Пороги утилизации маржи: предупреждение / сокращение / аварийный флэт добавок */
  marginWarn: number;
  marginReduce: number;
  marginEmergency: number; // 0.55/0.70/0.82
}

export const DEFAULT_RESCUE_CONFIG: RescueConfig = {
  strategy: 'rescue',
  targetInstrumentId: '',
  targetDirection: 'long',
  targetLots: 1,
  targetAvgPrice: 0,
  maxAvgSteps: 3,
  stepAtrMult: 1.0,
  lotMult: 1.3,
  maxTotalLots: 6,
  recoverTargetPct: 0.003,
  recoverCloseAll: true,
  hedgePauseEnabled: true,
  allowStopOut: false,
  maxDrawdownPct: 0.05,
  marginReturnBufferMin: 60,
  minActionBeforeDeadlineMin: 10,
  marginWarn: 0.55,
  marginReduce: 0.7,
  marginEmergency: 0.82,
};

/** Русские подписи полей RescueConfig для UI-формы */
export const RESCUE_CONFIG_LABELS: Record<keyof Omit<RescueConfig, 'strategy'>, { label: string; description: string }> = {
  targetInstrumentId: { label: 'Инструмент позиции', description: 'uid убыточной позиции из портфеля, которую спасает робот' },
  targetDirection: { label: 'Направление позиции', description: 'Лонг или шорт убыточной позиции пользователя' },
  targetLots: { label: 'Лотов в позиции', description: 'Размер убыточной позиции на момент запуска спасения' },
  targetAvgPrice: { label: 'Средняя цена позиции', description: 'Средняя цена входа убыточной позиции (из портфеля)' },
  maxAvgSteps: { label: 'Шагов усреднения', description: 'Максимум докупок по лестнице усреднения' },
  stepAtrMult: { label: 'Шаг усреднения × ATR', description: 'Следующая докупка только при цене лучше предыдущей на этот шаг' },
  lotMult: { label: 'Множитель лотов', description: 'Рост размера докупки; жёстко ограничен ≤1.5 (анти-мартингейл)' },
  maxTotalLots: { label: 'Макс. суммарно, лотов', description: 'Потолок позиции с учётом всех добавок робота' },
  recoverTargetPct: { label: 'Цель восстановления, %', description: 'Выход при достижении weightedAvg + этот процент' },
  recoverCloseAll: { label: 'Закрывать всё при цели', description: 'Иначе — частичные фиксации добавок шагами, исходная позиция остаётся' },
  hedgePauseEnabled: { label: 'Хедж-пауза', description: 'Внутридневной офсетный шорт/лонг, замораживающий просадку' },
  allowStopOut: { label: 'Разрешить стоп-аут', description: 'Принудительное закрытие исходной позиции при превышении макс. просадки' },
  maxDrawdownPct: { label: 'Макс. просадка, %', description: 'Порог просадки исходной позиции для stop_out (при allowStopOut)' },
  marginReturnBufferMin: { label: 'Возврат маржи за, мин', description: 'Дедлайн возврата плеча = конец основной сессии − этот буфер' },
  minActionBeforeDeadlineMin: { label: 'Мин. до дедлайна, мин', description: 'Новые добавки запрещены, если до дедлайна осталось меньше' },
  marginWarn: { label: 'Маржа: предупреждение', description: 'Утилизация маржи 0..1 — только индикация и строка в reasoning' },
  marginReduce: { label: 'Маржа: сокращение', description: 'Запрет новых добавок при высокой загрузке маржи' },
  marginEmergency: { label: 'Маржа: авария', description: 'Немедленное закрытие добавок и хеджа (исходная позиция не трогается)' },
};

/** Русские подписи вердиктов rescue-анализатора для UI */
export const RESCUE_VERDICT_LABELS: Record<string, string> = {
  wait: 'Ждём',
  average_down: 'Усреднение',
  hedge_pause: 'Хедж-пауза',
  recover_exit: 'Выход с восстановлением',
  stop_out: 'Стоп-аут',
};

/** Русские названия состояний rescue-робота для UI-бейджей */
export const RESCUE_STATE_LABELS: Record<string, string> = {
  monitoring: 'Мониторинг позиции',
  averaging: 'Усреднение',
  hedged: 'Хедж-пауза',
  recovering: 'Выход с восстановлением',
  returning_margin: 'Возврат плеча',
  stopped: 'Завершён',
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
  rescue?: RescueConfig;
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

export const defaultRescueExt = (): RescueConfig => ({ ...DEFAULT_RESCUE_CONFIG });

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
        : robot.strategy === 'rescue'
          ? { rescue: defaultRescueFromParams(robot) }
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
    rescue: stored.rescue
      ? { ...defaultRescueFromParams(robot), ...stored.rescue }
      : base.rescue,
  };
}

/** Дефолт rescue-конфига с подстановкой целевой позиции из params робота */
function defaultRescueFromParams(robot: Robot): RescueConfig {
  const base = defaultRescueExt();
  if (robot.params.strategy !== 'rescue') return base;
  const p = robot.params.rescue;
  return {
    ...base,
    targetInstrumentId: robot.instrumentId,
    targetDirection: p.targetDirection,
    targetLots: p.targetLots,
    targetAvgPrice: p.targetAvgPrice,
    maxTotalLots: Math.max(base.maxTotalLots, p.maxTotalLots),
  };
}
