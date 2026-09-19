// Данные терминала: загрузка инструментов, свечей, поллинг котировок/стакана/ордеров.
// Паттерн useMock = !token (CONTRACT.md): без токена — mock-данные, с токеном — API с fallback на mock.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { useRobotsStore } from '@/store/robots';
import {
  findInstrumentAll,
  getBonds,
  getCandles,
  getCurrencies,
  getEtfs,
  getFutures,
  getFuturesMargin,
  getIndices,
  getLastPrices,
  getOrderBook,
  getOrders,
  getPortfolio,
  getPositions,
  getShares,
  getTradingStatus,
  type TradingStatusInfo,
} from '@/lib/tinvest/services';
import {
  mockFindInstrumentAll,
  mockGetAllInstruments,
  mockGetCandles,
  mockGetLastPrices,
  mockGetOrderBook,
  mockGetPositions,
  mockGetRobots,
  mockGetTradingStatus,
  mockGetTrades,
} from '@/lib/tinvest/mock';
import { POLLING_DEFAULTS, usePolling } from '@/lib/tinvest/polling';
import { searchInstrumentsLocal } from '@/lib/tinvest/instruments';
import { isCatalogStale, warmUpMarketData } from '@/components/connect/warmup';
import type { Candle, Instrument, Quote } from '@/types/market';
import type { Position } from '@/types/trading';
import type { Robot } from '@/types/robot';
import { aggregateCandles, TIMEFRAMES, type Timeframe } from './utils';

const candleCache = new Map<string, Candle[]>();
const marginCache = new Map<string, { buy: number; sell: number }>();

export interface TerminalData {
  useMock: boolean;
  instrument: Instrument | null;
  candles: Candle[];
  candlesLoading: boolean;
  /** Grid-робот выбранного инструмента (или null) */
  gridRobot: Robot | null;
  /** Grid-уровни выбранного инструмента */
  gridLevels: number[];
  /** Диапазон дня по загруженным свечам */
  dayLow?: number;
  dayHigh?: number;
  /** ГО выбранного инструмента (₽/лот), подтянуто через getFuturesMargin если нет в инструменте */
  margin: { buy?: number; sell?: number };
  /** Поиск по API по всем классам (findInstrumentAll) */
  searchRemote: (q: string) => void;
  remoteResults: Instrument[];
  /** Торговый статус выбранного инструмента (getTradingStatus); null пока не загружен */
  tradingStatus: TradingStatusInfo | null;
  /** Ошибка загрузки позиций (боевой режим) — блок «Позиции недоступны» */
  positionsError: boolean;
  /** Повторная загрузка позиций после ошибки */
  retryPositions: () => void;
}

export function useTerminalData(timeframe: Timeframe): TerminalData {
  const token = useConnectionStore((s) => s.token);
  const useMock = !token;

  const instruments = useMarketStore((s) => s.instruments);
  const selectedId = useMarketStore((s) => s.selectedInstrumentId);
  const setInstruments = useMarketStore((s) => s.setInstruments);
  const updateQuotes = useMarketStore((s) => s.updateQuotes);
  const setCandles = useMarketStore((s) => s.setCandles);
  const setOrderBook = useMarketStore((s) => s.setOrderBook);

  const storeRobots = useRobotsStore((s) => s.robots);

  const [candles, setLocalCandles] = useState<Candle[]>([]);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [remoteResults, setRemoteResults] = useState<Instrument[]>([]);
  const [margin, setMargin] = useState<{ buy?: number; sell?: number }>({});
  const [tradingStatus, setTradingStatus] = useState<TradingStatusInfo | null>(null);
  const [positionsError, setPositionsError] = useState(false);

  const instrument = useMemo(
    () => instruments.find((i) => i.uid === selectedId) ?? instruments[0] ?? null,
    [instruments, selectedId],
  );
  const uid = instrument?.uid ?? null;

  // ---------- первичная загрузка инструментов + seed торговли ----------
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    (async () => {
      // каталог всех классов: акции, фьючерсы, ETF, валюты, ОФЗ + индексы (только котировки)
      const current = useMarketStore.getState().instruments;
      const hasAllClasses = current.some((i) => i.type !== 'future'); // миграция со старого списка «только фьючерсы»
      if (current.length > 0 && hasAllClasses && isCatalogStale()) {
        // каталог устарел (>30 мин) — фоновый прогрев, не блокируя терминал
        void warmUpMarketData().catch(() => {});
      }
      if (current.length === 0 || !hasAllClasses) {
        if (useMock) {
          setInstruments(mockGetAllInstruments());
        } else {
          const settled = await Promise.allSettled([
            getFutures(),
            getShares(),
            getEtfs(),
            getCurrencies(),
            getBonds(),
            getIndices(),
          ]);
          const merged: Instrument[] = [];
          const seen = new Set<string>();
          for (const r of settled) {
            if (r.status !== 'fulfilled') continue;
            for (const i of r.value) {
              if (seen.has(i.uid)) continue;
              seen.add(i.uid);
              merged.push(i);
            }
          }
          setInstruments(merged.length > 0 ? merged : mockGetAllInstruments());
        }
      }
      // seed позиций/сделок для демо (аналогично useDashboardData)
      // positions не persist'ятся, а seeded — да: после перезагрузки вкладки демо-позиции
      // пропадали («портфель подключён, но позиций не видно») — пересеиваем, если список пуст
      const trading = useTradingStore.getState();
      if (useMock && (!trading.seeded || trading.positions.length === 0)) {
        trading.setPositions(mockGetPositions());
        trading.setTrades(mockGetTrades());
        trading.markSeeded();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- загрузка свечей при смене инструмента/таймфрейма ----------
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const cacheKey = `${uid}:${timeframe.key}`;
    const cached = candleCache.get(cacheKey);
    if (cached) {
      setLocalCandles(cached);
      setCandles(uid, cached);
      return;
    }
    setCandlesLoading(true);
    (async () => {
      let result: Candle[] = [];
      const to = new Date();
      const from = new Date(to.getTime() - 300 * timeframe.ms);
      if (useMock) {
        result = mockGetCandles(uid, timeframe.apiInterval, 300);
      } else {
        try {
          result = await getCandles(uid, from, to, timeframe.apiInterval, 400);
        } catch {
          result = mockGetCandles(uid, timeframe.apiInterval, 300);
        }
      }
      if (timeframe.ms > 3_600_000 && timeframe.apiInterval === 'CANDLE_INTERVAL_HOUR') {
        result = aggregateCandles(result, timeframe.ms);
      }
      if (cancelled) return;
      candleCache.set(cacheKey, result);
      setLocalCandles(result);
      setCandles(uid, result);
      setCandlesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, timeframe, useMock, setCandles]);

  // ---------- ГО выбранного инструмента (только фьючерсы, getFuturesMargin) ----------
  useEffect(() => {
    if (!uid || !instrument) return;
    if (instrument.type !== 'future') {
      // акции/ETF/валюты/облигации — без ГО (расчёт стоимости в тикете); у опционов премия, маржа — если есть в карточке
      setMargin(
        instrument.marginBuy !== undefined
          ? { buy: instrument.marginBuy, sell: instrument.marginSell }
          : {},
      );
      return;
    }
    if (instrument.marginBuy !== undefined) {
      setMargin({ buy: instrument.marginBuy, sell: instrument.marginSell });
      return;
    }
    const cached = marginCache.get(uid);
    if (cached) {
      setMargin(cached);
      return;
    }
    if (useMock) return;
    let cancelled = false;
    getFuturesMargin(uid)
      .then((m) => {
        marginCache.set(uid, m);
        if (!cancelled) setMargin(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, instrument, useMock]);

  // ---------- поллинг котировок (выбранный + watchlist) ----------
  const quotesFetcher = useCallback(async () => {
    const ids = useMarketStore.getState().instruments.map((i) => i.uid).slice(0, 30);
    if (ids.length === 0) return;
    let quotes: Quote[];
    if (useMock) {
      quotes = mockGetLastPrices(ids);
    } else {
      try {
        quotes = await getLastPrices(ids);
      } catch {
        return; // сохраняем последние известные
      }
    }
    updateQuotes(quotes);
    // демо: «живой» P&L mock-позиций
    if (useMock) {
      const t = useTradingStore.getState();
      const q = useMarketStore.getState().quotes;
      t.setPositions(
        t.positions.map((p) => {
          const cur = q[p.instrumentId]?.price ?? p.currentPrice;
          return {
            ...p,
            currentPrice: cur,
            pnl: Math.round((cur - p.avgPrice) * p.lots * (p.direction === 'long' ? 1 : -1)),
          };
        }),
      );
    }
  }, [useMock, updateQuotes]);
  usePolling(quotesFetcher, { intervalMs: POLLING_DEFAULTS.prices });

  // ---------- поллинг стакана выбранного инструмента (3с) ----------
  // По индексам стакана нет — не запрашиваем (CONTRACT.md: getOrderBook ⚠️ для индексов)
  const bookAvailable = Boolean(instrument && instrument.type !== 'index' && instrument.apiTradeAvailable);
  const bookFetcher = useCallback(async () => {
    if (!uid || !bookAvailable) return;
    if (useMock) {
      setOrderBook(mockGetOrderBook(uid, 10));
      return;
    }
    try {
      setOrderBook(await getOrderBook(uid, 10));
    } catch {
      setOrderBook(mockGetOrderBook(uid, 10));
    }
  }, [uid, bookAvailable, useMock, setOrderBook]);
  usePolling(bookFetcher, { intervalMs: POLLING_DEFAULTS.prices, enabled: Boolean(uid) && bookAvailable });

  // сброс стакана при выборе инструмента без стакана (индекс/недоступен через API)
  useEffect(() => {
    if (instrument && !bookAvailable) setOrderBook(null);
  }, [instrument, bookAvailable, setOrderBook]);

  // ---------- торговый статус выбранного инструмента (getTradingStatus, раз на смену uid) ----------
  useEffect(() => {
    if (!uid || !instrument || instrument.type === 'index') {
      setTradingStatus(null);
      return;
    }
    let cancelled = false;
    const apply = (s: TradingStatusInfo) => {
      if (!cancelled) setTradingStatus(s);
    };
    if (useMock) {
      apply(mockGetTradingStatus(uid));
    } else {
      getTradingStatus(uid).then(apply).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [uid, instrument, useMock]);

  // ---------- поллинг ордеров/позиций (боевой режим, только при подключении) ----------
  const tradingFetcher = useCallback(async () => {
    if (useMock) return;
    const t = useTradingStore.getState();
    try {
      t.setOrders(await getOrders());
    } catch {
      /* ордера: сохраняем последние известные */
    }
    try {
      // Позиции: getPortfolio (все классы + P&L), fallback на getPositions (только фьючерсы)
      let list: Position[];
      try {
        list = (await getPortfolio()).positions;
      } catch {
        list = await getPositions();
      }
      const byUid = new Map(useMarketStore.getState().instruments.map((i) => [i.uid, i]));
      const enriched = list
        .map((p) => {
          const meta = byUid.get(p.instrumentId);
          // Неттинг: quantity из API приходит в ШТУКАХ → лоты = штуки / lot
          const lot = meta && meta.lot > 0 ? meta.lot : 1;
          return {
            ...p,
            lots: Math.max(0, Math.round(p.lots / lot)),
            ticker: meta?.ticker ?? (p.ticker || p.instrumentId.slice(0, 8)),
            name: p.name ?? meta?.name,
          };
        })
        .filter((p) => p.lots > 0);
      t.setPositions(enriched);
      setPositionsError(false);
    } catch {
      // не роняем терминал — блок «Позиции недоступны» с кнопкой повтора
      setPositionsError(true);
    }
  }, [useMock]);
  usePolling(tradingFetcher, { intervalMs: POLLING_DEFAULTS.positions, enabled: !useMock });
  const retryPositions = useCallback(() => {
    void tradingFetcher();
  }, [tradingFetcher]);

  // ---------- удалённый поиск инструментов (только дозагрузка поверх локального) ----------
  // Локальный поиск по каталогу market store выполняется мгновенно в InstrumentList;
  // findInstrumentAll дергаем лишь когда локально найдено < 5 совпадений (дебаунс 150мс).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRemote = useCallback(
    (q: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      const query = q.trim();
      if (query.length < 2) {
        setRemoteResults([]);
        return;
      }
      const localCount = searchInstrumentsLocal(useMarketStore.getState().instruments, query).length;
      if (localCount >= 5) {
        setRemoteResults([]);
        return;
      }
      searchTimer.current = setTimeout(async () => {
        try {
          // поиск по ВСЕМ классам (дебаунс 150ms)
          const res = useMock ? mockFindInstrumentAll(query) : await findInstrumentAll(query);
          setRemoteResults(res);
        } catch {
          /* игнорируем */
        }
      }, 150);
    },
    [useMock],
  );

  // ---------- grid-робот выбранного инструмента ----------
  const robots = useMemo(
    () => (storeRobots.length > 0 ? storeRobots : useMock ? mockGetRobots() : []),
    [storeRobots, useMock],
  );
  const gridRobot = useMemo(
    () =>
      robots.find(
        (r) => r.strategy === 'grid' && r.instrumentId === uid && (r.status === 'running' || r.status === 'paused'),
      ) ?? null,
    [robots, uid],
  );
  const gridLevels = useMemo(() => {
    if (!gridRobot || !('grid' in gridRobot.params)) return [];
    const g = gridRobot.params.grid;
    if (g.levels < 2) return [g.lowerBound];
    return Array.from({ length: g.levels }, (_, i) => g.lowerBound + ((g.upperBound - g.lowerBound) * i) / (g.levels - 1));
  }, [gridRobot]);

  // ---------- диапазон дня ----------
  const { dayLow, dayHigh } = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = candles.filter((c) => c.time >= dayStart.getTime());
    const src = today.length > 0 ? today : candles.slice(-48);
    if (src.length === 0) return {};
    return {
      dayLow: Math.min(...src.map((c) => c.low)),
      dayHigh: Math.max(...src.map((c) => c.high)),
    };
  }, [candles]);

  return {
    useMock,
    instrument,
    candles,
    candlesLoading,
    gridRobot,
    gridLevels,
    dayLow,
    dayHigh,
    margin,
    searchRemote,
    remoteResults,
    tradingStatus,
    positionsError,
    retryPositions,
  };
}

export { TIMEFRAMES };
