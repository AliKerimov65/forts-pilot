// Стор торговли: позиции, ордера, сделки (журнал), дневной P&L, лента событий
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EquityPoint, JournalEvent, Order, PortfolioSummary, Position, Trade } from '@/types/trading';

const MAX_EVENTS = 200;

export interface TradingState {
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  /** Лента событий (журнал), новые сверху */
  events: JournalEvent[];
  /** Сводка портфеля */
  portfolio: PortfolioSummary | null;
  /** Equity-кривая по периодам */
  equity: Record<string, EquityPoint[]>;
  /** Признак: данные загружены хотя бы раз (mock или API) */
  seeded: boolean;

  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
  setTrades: (trades: Trade[]) => void;
  setPortfolio: (portfolio: PortfolioSummary) => void;
  setEquity: (period: string, points: EquityPoint[]) => void;
  /** Добавить сделку и запись в ленту */
  addTrade: (trade: Trade) => void;
  /** Добавить запись в ленту событий */
  addEvent: (event: Omit<JournalEvent, 'id' | 'time'> & { time?: number }) => void;
  /** Добавить/обновить ордер в списке */
  upsertOrder: (order: Order) => void;
  /** Удалить ордер (исполнен/отменён) */
  removeOrder: (orderId: string) => void;
  markSeeded: () => void;
  reset: () => void;
}

let eventSeq = 0;

export const useTradingStore = create<TradingState>()(
  persist(
    (set) => ({
      positions: [],
      orders: [],
      trades: [],
      events: [],
      portfolio: null,
      equity: {},
      seeded: false,

      setPositions: (positions) => set({ positions }),
      setOrders: (orders) => set({ orders }),
      setTrades: (trades) => set({ trades }),
      setPortfolio: (portfolio) => set({ portfolio }),
      setEquity: (period, points) => set((s) => ({ equity: { ...s.equity, [period]: points } })),

      addTrade: (trade) =>
        set((s) => ({
          trades: [trade, ...s.trades],
          events: [
            {
              id: `ev-${Date.now()}-${eventSeq++}`,
              type: 'trade' as const,
              text: `${trade.source === 'robot' && trade.robotName ? `${trade.robotName}: ` : ''}${
                trade.direction === 'long' ? 'Куплено' : 'Продано'
              } ${trade.lots} лот${trade.lots > 1 ? 'а' : ''} ${trade.ticker} по ${trade.price.toLocaleString('ru-RU')}`,
              amount: trade.pnl,
              instrumentId: trade.instrumentId,
              robotId: trade.robotId,
              time: trade.time,
            },
            ...s.events,
          ].slice(0, MAX_EVENTS),
        })),

      addEvent: (event) =>
        set((s) => ({
          events: [
            { id: `ev-${Date.now()}-${eventSeq++}`, time: event.time ?? Date.now(), ...event },
            ...s.events,
          ].slice(0, MAX_EVENTS),
        })),

      upsertOrder: (order) =>
        set((s) => {
          const idx = s.orders.findIndex((o) => o.orderId === order.orderId);
          if (idx === -1) return { orders: [order, ...s.orders] };
          const orders = [...s.orders];
          orders[idx] = order;
          return { orders };
        }),

      removeOrder: (orderId) => set((s) => ({ orders: s.orders.filter((o) => o.orderId !== orderId) })),
      markSeeded: () => set({ seeded: true }),
      reset: () => set({ positions: [], orders: [], trades: [], events: [], portfolio: null, equity: {}, seeded: false }),
    }),
    {
      name: 'forts-pilot-trading',
      partialize: (s) => ({ trades: s.trades, events: s.events.slice(0, 50), equity: s.equity, seeded: s.seeded }),
    },
  ),
);
