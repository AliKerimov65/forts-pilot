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
    ...(robot.strategy === 'grid' ? { grid: defaultGridExt() } : { signal: defaultSignalExt() }),
  };
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    protection: { ...base.protection, ...stored.protection },
    grid: stored.grid ? { ...defaultGridExt(), ...stored.grid } : base.grid,
    signal: stored.signal ? { ...defaultSignalExt(), ...stored.signal } : base.signal,
  };
}
