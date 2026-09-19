// Стор рыночных данных: выбранный инструмент, котировки, свечи, стакан
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Candle, Instrument, InstrumentType, OrderBook, Quote } from '@/types/market';

export interface QuoteState {
  price: number;
  /** Дельта к предыдущему тику (для флэша цены) */
  delta: number;
  /** Изменение за сессию, % */
  changePct: number;
  time: number;
}

export interface MarketState {
  /** Список доступных инструментов (watchlist FORTS) */
  instruments: Instrument[];
  /** Выбранный инструмент (uid) для терминала */
  selectedInstrumentId: string | null;
  /** Котировки: instrumentId → цена+дельта */
  quotes: Record<string, QuoteState>;
  /** Свечи выбранного инструмента */
  candles: Record<string, Candle[]>;
  /** Стакан выбранного инструмента */
  orderBook: OrderBook | null;
  /** Фильтр списка инструментов по классу ('all' — все классы) */
  instrumentFilter: InstrumentType | 'all';
  /** Время последней загрузки каталога инструментов (ms); null — каталог ещё не загружался */
  catalogsLoadedAt: number | null;

  setInstruments: (instruments: Instrument[]) => void;
  selectInstrument: (instrumentId: string) => void;
  /** Установить фильтр класса инструментов */
  setInstrumentFilter: (filter: InstrumentType | 'all') => void;
  /** Обновить котировки массивом Quote (delta сохраняется из ответа) */
  updateQuotes: (quotes: Quote[]) => void;
  /** Обновить одну котировку точечно */
  updateQuote: (instrumentId: string, price: number, changePct?: number) => void;
  setCandles: (instrumentId: string, candles: Candle[]) => void;
  setOrderBook: (orderBook: OrderBook | null) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      instruments: [],
      selectedInstrumentId: null,
      quotes: {},
      candles: {},
      orderBook: null,
      instrumentFilter: 'all' as const,
      catalogsLoadedAt: null,

      setInstruments: (instruments) =>
        set((s) => ({
          instruments,
          catalogsLoadedAt: Date.now(),
          selectedInstrumentId: s.selectedInstrumentId ?? instruments[0]?.uid ?? null,
        })),

      selectInstrument: (instrumentId) => set({ selectedInstrumentId: instrumentId }),

      setInstrumentFilter: (filter) => set({ instrumentFilter: filter }),

      updateQuotes: (quotes) => {
        const prev = get().quotes;
        const next = { ...prev };
        for (const q of quotes) {
          const old = prev[q.instrumentId];
          next[q.instrumentId] = {
            price: q.price,
            delta: q.delta !== 0 ? q.delta : old ? q.price - old.price : 0,
            changePct: q.changePct ?? old?.changePct ?? 0,
            time: q.time,
          };
        }
        set({ quotes: next });
      },

      updateQuote: (instrumentId, price, changePct) => {
        const prev = get().quotes[instrumentId];
        set((s) => ({
          quotes: {
            ...s.quotes,
            [instrumentId]: {
              price,
              delta: prev ? price - prev.price : 0,
              changePct: changePct ?? prev?.changePct ?? 0,
              time: Date.now(),
            },
          },
        }));
      },

      setCandles: (instrumentId, candles) => set((s) => ({ candles: { ...s.candles, [instrumentId]: candles } })),
      setOrderBook: (orderBook) => set({ orderBook }),
    }),
    {
      name: 'forts-pilot-market',
      // persist только выбор инструмента, фильтр и список — котировки/свечи всегда свежие
      partialize: (s) => ({ selectedInstrumentId: s.selectedInstrumentId, instruments: s.instruments, instrumentFilter: s.instrumentFilter, catalogsLoadedAt: s.catalogsLoadedAt }),
    },
  ),
);
