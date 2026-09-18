// useDashboardData — загрузка и поллинг данных дашборда
// Демо/без токена → mock-данные; с токеном → T-Invest API с fallback на mock при ошибках сети.
import { useCallback, useEffect, useRef } from 'react';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { useRiskStore } from '@/store/risk';
import { getFutures, getLastPrices, getPortfolio } from '@/lib/tinvest/services';
import {
  MOCK_INSTRUMENTS,
  mockGetEquitySeries,
  mockGetFutures,
  mockGetJournalEvents,
  mockGetLastPrices,
  mockGetPortfolio,
  mockGetPositions,
  mockGetTrades,
} from '@/lib/tinvest/mock';
import { POLLING_DEFAULTS, usePolling } from '@/lib/tinvest/polling';

const EQUITY_PERIODS = ['1D', '1W', '1M', '3M', 'ALL'] as const;

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
      // Инструменты
      if (useMock) {
        setInstruments(mockGetFutures());
      } else {
        try {
          setInstruments(await getFutures());
        } catch {
          setInstruments(mockGetFutures()); // fallback при ошибке сети
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
