// useDashboardData — загрузка и поллинг данных дашборда
// Демо/без токена → mock-данные; с токеном → T-Invest API с fallback на mock при ошибках сети.
import { useCallback, useEffect, useRef } from 'react';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { useRiskStore } from '@/store/risk';
import { getEtfs, getFutures, getIndices, getLastPrices, getPortfolio, getShares } from '@/lib/tinvest/services';
import {
  MOCK_ETFS,
  MOCK_INDICES,
  MOCK_INSTRUMENTS,
  MOCK_SHARES,
  mockGetEquitySeries,
  mockGetJournalEvents,
  mockGetLastPrices,
  mockGetPortfolio,
  mockGetPositions,
  mockGetTrades,
} from '@/lib/tinvest/mock';
import { POLLING_DEFAULTS, usePolling } from '@/lib/tinvest/polling';
import type { Instrument } from '@/types/market';

const EQUITY_PERIODS = ['1D', '1W', '1M', '3M', 'ALL'] as const;

/** Watchlist дашборда покрывает все классы: фьючерсы + индексы (IMOEX/RTSI) + акции + ETF */
const WATCH_INDEX_TICKERS = ['IMOEX', 'RTSI'];
const WATCH_SHARE_TICKERS = ['SBER', 'GAZP', 'LKOH'];
const WATCH_ETF_TICKERS = ['TMOS', 'SBMX'];

function pickByTickers(list: Instrument[], tickers: string[], fallbackCount: number): Instrument[] {
  const picked = tickers
    .map((t) => list.find((i) => i.ticker.toUpperCase() === t))
    .filter((i): i is Instrument => Boolean(i));
  return picked.length > 0 ? picked : list.slice(0, fallbackCount);
}

/** Демо-watchlist: фьючерсы + IMOEX/RTSI + акции + ETF */
function mockWatchlist(): Instrument[] {
  return [
    ...MOCK_INSTRUMENTS,
    ...MOCK_INDICES.filter((i) => WATCH_INDEX_TICKERS.includes(i.ticker)),
    ...MOCK_SHARES.slice(0, 3),
    ...MOCK_ETFS.slice(0, 1),
  ];
}

/** Боевой watchlist: Futures + Indicatives (IMOEX/RTSI) + Shares + Etfs; при сбое класса — mock-фолбэк этого класса */
async function liveWatchlist(): Promise<Instrument[]> {
  const [fut, idx, sh, etf] = await Promise.all([
    getFutures().catch(() => MOCK_INSTRUMENTS),
    getIndices().catch(() => MOCK_INDICES),
    getShares().catch(() => MOCK_SHARES),
    getEtfs().catch(() => MOCK_ETFS),
  ]);
  return [
    ...fut,
    ...pickByTickers(idx, WATCH_INDEX_TICKERS, 2),
    ...pickByTickers(sh, WATCH_SHARE_TICKERS, 3),
    ...pickByTickers(etf, WATCH_ETF_TICKERS, 1),
  ];
}

export function useDashboardData() {
  const token = useConnectionStore((s) => s.token);
  const useMock = !token; // демо-режим или без токена — mock-данные
  const pollingEnabled = useConnectionStore((s) => Boolean(s.token) || s.demoMode);

  const setInstruments = useMarketStore((s) => s.setInstruments);
  const updateQuotes = useMarketStore((s) => s.updateQuotes);

  const setPortfolio = useTradingStore((s) => s.setPortfolio);
  const setPositions = useTradingStore((s) => s.setPositions);
  const setTrades = useTradingStore((s) => s.setTrades);
  const setEquity = useTradingStore((s) => s.setEquity);
  const seeded = useTradingStore((s) => s.seeded);
  const markSeeded = useTradingStore((s) => s.markSeeded);
  const setRiskCurrents = useRiskStore((s) => s.setCurrents);

  const seedingRef = useRef(false);

  /** Первичная загрузка (одноразовая) */
  const seed = useCallback(async () => {
    if (seedingRef.current) return;
    seedingRef.current = true;
    try {
      // Инструменты (все классы: фьючерсы + индексы IMOEX/RTSI + акции + ETF)
      if (useMock) {
        setInstruments(mockWatchlist());
      } else {
        try {
          setInstruments(await liveWatchlist());
        } catch {
          setInstruments(mockWatchlist()); // fallback при ошибке сети
        }
      }
      // Портфель и позиции
      if (useMock) {
        const p = mockGetPortfolio();
        setPortfolio(p);
        setPositions(mockGetPositions());
        setTrades(mockGetTrades());
        setRiskCurrents(p.dayPnl, (p.blockedMargin / (p.blockedMargin + p.freeMargin)) * 100);
        if (!seeded) {
          mockGetJournalEvents().forEach((e) =>
            useTradingStore.getState().addEvent({ type: e.type, text: e.text, amount: e.amount, time: e.time }),
          );
        }
      } else {
        try {
          const p = await getPortfolio();
          setPortfolio(p);
          setPositions(p.positions);
          setRiskCurrents(p.dayPnl, p.totalAmount > 0 ? (p.blockedMargin / p.totalAmount) * 100 : 0);
        } catch {
          const p = mockGetPortfolio();
          setPortfolio(p);
          setPositions(mockGetPositions());
        }
      }
      // Equity-кривая (истории equity в API нет — всегда детерминированный mock)
      EQUITY_PERIODS.forEach((period) => setEquity(period, mockGetEquitySeries(period)));
      markSeeded();
    } finally {
      seedingRef.current = false;
    }
  }, [useMock, seeded, setInstruments, setPortfolio, setPositions, setTrades, setEquity, markSeeded, setRiskCurrents]);

  useEffect(() => {
    void seed();
  }, [seed]);

  /** Поллинг котировок (3с) */
  const fetchQuotes = useCallback(async () => {
    const instruments = useMarketStore.getState().instruments;
    const uids = (instruments.length > 0 ? instruments : MOCK_INSTRUMENTS).map((i) => i.uid);
    if (uids.length === 0) return;
    if (useMock) {
      updateQuotes(mockGetLastPrices(uids));
    } else {
      try {
        updateQuotes(await getLastPrices(uids));
      } catch {
        updateQuotes(mockGetLastPrices(uids));
      }
    }
  }, [useMock, updateQuotes]);

  /** Поллинг портфеля/позиций (5с) */
  const fetchPortfolio = useCallback(async () => {
    if (useMock) {
      const p = mockGetPortfolio();
      // лёгкий дрейф для живости демо
      const jitter = (Math.random() - 0.5) * 400;
      setPortfolio({ ...p, totalAmount: p.totalAmount + jitter, dayPnl: p.dayPnl + jitter });
      setPositions(mockGetPositions());
      return;
    }
    try {
      const p = await getPortfolio();
      setPortfolio(p);
      setPositions(p.positions);
      setRiskCurrents(p.dayPnl, p.totalAmount > 0 ? (p.blockedMargin / p.totalAmount) * 100 : 0);
    } catch {
      /* сохраняем предыдущие данные */
    }
  }, [useMock, setPortfolio, setPositions, setRiskCurrents]);

  usePolling(fetchQuotes, { intervalMs: POLLING_DEFAULTS.prices, enabled: pollingEnabled });
  usePolling(fetchPortfolio, { intervalMs: POLLING_DEFAULTS.positions, enabled: pollingEnabled });

  /** Ручное обновление (pull-to-refresh) */
  const refresh = useCallback(async () => {
    await Promise.all([fetchQuotes(), fetchPortfolio()]);
  }, [fetchQuotes, fetchPortfolio]);

  return { refresh };
}
