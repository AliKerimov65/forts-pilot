// Стор риск-менеджмента: лимиты, защитные автоматики, история срабатываний
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RiskLimits {
  /** Дневной стоп-лосс по счёту, ₽ (0 = выключен) */
  dailyStopRub: number;
  /** Максимальный размер позиции в лотах на инструмент */
  maxPositionLots: number;
  /** Максимальная загрузка маржи, % (0..100) */
  maxMarginPct: number;
  /** Максимум одновременно работающих роботов */
  maxActiveRobots: number;
}

export interface RiskAutomations {
  /** Остановить всех роботов при дневном стопе */
  stopRobotsOnDailyStop: boolean;
  /** Закрыть позиции при дневном стопе */
  closePositionsOnDailyStop: boolean;
  /** Блокировать новые ордера при превышении маржи */
  blockOrdersOnMargin: boolean;
  /** Требовать подтверждение боевых ордеров */
  confirmLiveOrders: boolean;
}

export interface RiskEvent {
  id: string;
  /** Что сработало: 'daily_stop' | 'margin' | 'position_limit' | 'robots_limit' */
  kind: 'daily_stop' | 'margin' | 'position_limit' | 'robots_limit';
  text: string;
  /** unix ms */
  time: number;
}

/** Ручное отключение рисков по конкретному счёту */
export interface AccountRiskOverride {
  /** true — глобальный daily-stop НЕ останавливает роботов этого счёта */
  disabled: boolean;
  /** ISO-дата установки/снятия флага */
  disabledAt?: string;
  /** Произвольная заметка пользователя («на период отпуска» и т.п.) */
  note?: string;
}

export interface RiskState {
  limits: RiskLimits;
  automations: RiskAutomations;
  /** История срабатываний (новые сверху) */
  events: RiskEvent[];
  /** Текущий дневной P&L, ₽ (обновляется из trading-стора) */
  currentDayPnl: number;
  /** Текущая загрузка маржи, % */
  currentMarginPct: number;
  /** Ручные отключения рисков по счетам (ключ — accountId) */
  accountOverrides: Record<string, AccountRiskOverride>;

  setLimits: (patch: Partial<RiskLimits>) => void;
  setAutomations: (patch: Partial<RiskAutomations>) => void;
  addEvent: (event: Omit<RiskEvent, 'id' | 'time'>) => void;
  setCurrents: (dayPnl: number, marginPct: number) => void;
  /** Достигнут ли дневной стоп */
  isDailyStopHit: () => boolean;
  /** Включить/выключить ручное отключение рисков для счёта */
  setAccountRiskOverride: (accountId: string, disabled: boolean, note?: string) => void;
  /** Отключены ли риски (daily-stop) для счёта вручную */
  isRiskDisabledFor: (accountId: string) => boolean;
}

let riskSeq = 0;

export const useRiskStore = create<RiskState>()(
  persist(
    (set, get) => ({
      limits: {
        dailyStopRub: 10_000,
        maxPositionLots: 5,
        maxMarginPct: 50,
        maxActiveRobots: 3,
      },
      automations: {
        stopRobotsOnDailyStop: true,
        closePositionsOnDailyStop: false,
        blockOrdersOnMargin: true,
        confirmLiveOrders: true,
      },
      events: [],
      currentDayPnl: 0,
      currentMarginPct: 0,
      accountOverrides: {},

      setLimits: (patch) => set((s) => ({ limits: { ...s.limits, ...patch } })),
      setAutomations: (patch) => set((s) => ({ automations: { ...s.automations, ...patch } })),
      addEvent: (event) =>
        set((s) => ({
          events: [{ ...event, id: `risk-${Date.now()}-${riskSeq++}`, time: Date.now() }, ...s.events].slice(0, 100),
        })),
      setCurrents: (currentDayPnl, currentMarginPct) => set({ currentDayPnl, currentMarginPct }),

      isDailyStopHit: () => {
        const { limits, currentDayPnl } = get();
        return limits.dailyStopRub > 0 && currentDayPnl <= -limits.dailyStopRub;
      },

      setAccountRiskOverride: (accountId, disabled, note) =>
        set((s) => ({
          accountOverrides: {
            ...s.accountOverrides,
            [accountId]: {
              disabled,
              disabledAt: new Date().toISOString(),
              ...(note !== undefined ? { note } : { note: s.accountOverrides[accountId]?.note }),
            },
          },
        })),

      isRiskDisabledFor: (accountId) => get().accountOverrides[accountId]?.disabled === true,
    }),
    {
      name: 'forts-pilot-risk',
      partialize: (s) => ({
        limits: s.limits,
        automations: s.automations,
        events: s.events,
        accountOverrides: s.accountOverrides,
      }),
    },
  ),
);
