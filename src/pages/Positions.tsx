// Позиции и ордера — /positions (monitor.md)
// Реалтайм-мониторинг: полоса маржи, позиции (поллинг 5с, флэши P&L, свайп «Закрыть»),
// активные ордера (поллинг 5с, свайп «Отменить»), карта рисков, лента исполнений,
// аварийное «Закрыть всё» через ConfirmDangerModal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { CircleX } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Position } from '@/types/trading';
import { useConnectionStore, selectIsConnected } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { useRiskStore } from '@/store/risk';
import { cancelOrder, getOrders, getPortfolio, postOrder } from '@/lib/tinvest/services';
import {
  mockGetFutures,
  mockGetJournalEvents,
  mockGetLastPrices,
  mockGetPortfolio,
  mockGetPositions,
  mockGetTrades,
} from '@/lib/tinvest/mock';
import { POLLING_DEFAULTS, usePolling } from '@/lib/tinvest/polling';
import { formatNumber, formatSignedRub, formatTime } from '@/lib/format';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import PageHeader from '@/components/PageHeader';
import MarginBar from '@/components/monitor/MarginBar';
import PositionsTable from '@/components/monitor/PositionsTable';
import OrdersSection from '@/components/monitor/OrdersSection';
import RiskMap from '@/components/monitor/RiskMap';
import ExecutionsFeed from '@/components/monitor/ExecutionsFeed';
import SlTpModal from '@/components/monitor/SlTpModal';
import ConfirmModal from '@/components/monitor/ConfirmModal';
import { ToastHost } from '@/components/monitor/toast';
import { showToast } from '@/components/monitor/toastBus';
import {
  approxPnl,
  effectiveSlTp,
  mockMonitorOrders,
  positionSource,
  toMonitorOrder,
  useSlTpStore,
  type MonitorOrder,
} from '@/components/monitor/monitorData';

type SourceFilter = 'all' | 'robot' | 'manual';
type MobileTab = 'positions' | 'orders' | 'feed';

export default function Positions() {
  const navigate = useNavigate();
  const token = useConnectionStore((s) => s.token);
  const mode = useConnectionStore((s) => s.mode);
  const connStatus = useConnectionStore((s) => s.status);
  const useMock = !token;
  const connected = useConnectionStore(selectIsConnected);

  const positions = useTradingStore((s) => s.positions);
  const orders = useTradingStore((s) => s.orders);
  const portfolio = useTradingStore((s) => s.portfolio);
  const trades = useTradingStore((s) => s.trades);
  const seeded = useTradingStore((s) => s.seeded);

  const [demoOrders, setDemoOrders] = useState<MonitorOrder[]>(() => mockMonitorOrders());
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [streamLost, setStreamLost] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [mobileTab, setMobileTab] = useState<MobileTab>('positions');
  const [slTpTarget, setSlTpTarget] = useState<Position | null>(null);
  const [closeTarget, setCloseTarget] = useState<Position | null>(null);
  const [closeAllOpen, setCloseAllOpen] = useState(false);
  const [busyCloseAll, setBusyCloseAll] = useState(false);

  // Локальные демо-настройки (refs, чтобы поллинг видел свежие значения)
  const closedIdsRef = useRef<Set<string>>(new Set());
  const closedLotsRef = useRef<Record<string, number>>({});
  const extraPositionsRef = useRef<Position[]>([]);
  const [, forceRender] = useState(0);

  // ----- первичный seed (демо) -----
  useEffect(() => {
    if (seeded) return;
    if (useMock) {
      useMarketStore.getState().setInstruments(mockGetFutures());
      useTradingStore.getState().setTrades(mockGetTrades());
      mockGetJournalEvents().forEach((e) =>
        useTradingStore.getState().addEvent({ type: e.type, text: e.text, amount: e.amount, time: e.time }),
      );
      useTradingStore.getState().markSeeded();
    }
  }, [seeded, useMock]);

  // ----- поллинг позиций + портфеля (5с) -----
  const fetchPositions = useCallback(async () => {
    const t = useTradingStore.getState();
    if (useMock) {
      // дрейф цен
      const uids = new Set<string>(['mock-uid-si', 'mock-uid-br', 'mock-uid-imoexf', 'mock-uid-rtsi', 'mock-uid-gazp']);
      extraPositionsRef.current.forEach((p) => uids.add(p.instrumentId));
      const quotes = mockGetLastPrices([...uids]);
      useMarketStore.getState().updateQuotes(quotes);
      const priceByUid = new Map(quotes.map((q) => [q.instrumentId, q.price]));

      const base = mockGetPositions()
        .filter((p) => !closedIdsRef.current.has(p.instrumentId))
        .map((p) => {
          const closed = closedLotsRef.current[p.instrumentId] ?? 0;
          const lots = p.lots - closed;
          return { ...p, lots };
        })
        .filter((p) => p.lots > 0)
        .map((p) => ({ ...p, pnl: approxPnl(p) }));
      const extra = extraPositionsRef.current.map((p) => {
        const cur = priceByUid.get(p.instrumentId) ?? p.currentPrice;
        const upd = { ...p, currentPrice: cur };
        return { ...upd, pnl: approxPnl(upd) };
      });
      t.setPositions([...base, ...extra]);

      const p = mockGetPortfolio();
      const jitter = (Math.random() - 0.5) * 300;
      const positionsMargin = [...base, ...extra].reduce((a, x) => a + (x.margin ?? 0), 0);
      const blocked = Math.max(positionsMargin, p.blockedMargin * 0.6);
      t.setPortfolio({ ...p, blockedMargin: blocked, totalAmount: p.totalAmount + jitter, dayPnl: p.dayPnl + jitter });
      useRiskStore.getState().setCurrents(p.dayPnl + jitter, (blocked / p.totalAmount) * 100);
      setStreamLost(false);
      setLastUpdated(Date.now());
      return;
    }
    try {
      const pf = await getPortfolio();
      const list = pf.positions.length > 0 ? pf.positions : [];
      const ins = useMarketStore.getState().instruments;
      const byUid = new Map(ins.map((i) => [i.uid, i]));
      const enriched = list.map((p) => {
        const meta = byUid.get(p.instrumentId);
        return {
          ...p,
          ticker: meta?.ticker ?? (p.ticker || p.instrumentId.slice(0, 8)),
          name: p.name ?? meta?.name,
        };
      });
      t.setPortfolio(pf);
      t.setPositions(enriched);
      useRiskStore
        .getState()
        .setCurrents(pf.dayPnl, pf.totalAmount > 0 ? (pf.blockedMargin / pf.totalAmount) * 100 : 0);
      setStreamLost(false);
      setLastUpdated(Date.now());
    } catch {
      setStreamLost(true);
    }
  }, [useMock]);

  // ----- поллинг ордеров (5с) -----
  const fetchOrders = useCallback(async () => {
    if (useMock) {
      // демо-ордера живут локально (мутируются отменой)
      return;
    }
    try {
      const list = await getOrders();
      useTradingStore.getState().setOrders(list);
      setStreamLost(false);
      setLastUpdated(Date.now());
    } catch {
      setStreamLost(true);
    }
  }, [useMock]);

  usePolling(fetchPositions, { intervalMs: POLLING_DEFAULTS.positions, enabled: connected });
  usePolling(fetchOrders, { intervalMs: POLLING_DEFAULTS.positions, enabled: connected && !useMock });

  // ----- объединённый список ордеров -----
  const monitorOrders: MonitorOrder[] = useMemo(() => {
    if (useMock) return demoOrders;
    return orders
      .filter((o) => o.status === 'new' || o.status === 'partially_filled')
      .map(toMonitorOrder);
  }, [useMock, demoOrders, orders]);

  // ----- фильтр по источнику -----
  const filteredPositions = useMemo(
    () =>
      positions.filter((p) =>
        sourceFilter === 'all' ? true : sourceFilter === 'robot' ? positionSource(p).source === 'robot' : positionSource(p).source === 'manual',
      ),
    [positions, sourceFilter],
  );
  const filteredOrders = useMemo(
    () => monitorOrders.filter((o) => (sourceFilter === 'all' ? true : sourceFilter === 'robot' ? o.source === 'robot' : o.source === 'manual')),
    [monitorOrders, sourceFilter],
  );

  const tradesToday = useMemo(
    () => trades.filter((t) => new Date(t.time).toDateString() === new Date().toDateString()).length,
    [trades],
  );

  const unrealizedPnl = positions.reduce((a, p) => a + p.pnl, 0);
  const offline = connStatus === 'offline' || connStatus === 'error' || streamLost;

  // ----- действия -----
  /** Исполнить закрытие позиции (по рынку) */
  const executeClose = useCallback(
    async (p: Position, lots?: number) => {
      const closeLots = lots ?? p.lots;
      const opposite = p.direction === 'long' ? ('short' as const) : ('long' as const);
      if (useMock) {
        await new Promise((r) => setTimeout(r, 250)); // имитация сети
        const fullClose = closeLots >= p.lots;
        if (fullClose) {
          closedIdsRef.current.add(p.instrumentId);
          delete closedLotsRef.current[p.instrumentId];
        } else {
          closedLotsRef.current[p.instrumentId] = (closedLotsRef.current[p.instrumentId] ?? 0) + closeLots;
        }
        useTradingStore.getState().addTrade({
          id: `close-${Date.now()}`,
          instrumentId: p.instrumentId,
          ticker: p.ticker,
          direction: opposite,
          lots: closeLots,
          price: p.currentPrice,
          pnl: Math.round((p.pnl / Math.max(1, p.lots)) * closeLots),
          source: 'manual',
          time: Date.now(),
        });
        forceRender((x) => x + 1);
        void fetchPositions();
        navigator.vibrate?.(10);
        showToast({
          variant: 'success',
          title: `Позиция ${p.ticker} закрыта`,
          description: `${closeLots} лот по рынку ≈ ${formatSignedRub(Math.round((p.pnl / Math.max(1, p.lots)) * closeLots))}`,
        });
        return;
      }
      try {
        const res = await postOrder({
          instrumentId: p.instrumentId,
          direction: opposite,
          lots: closeLots,
          orderType: 'market',
        });
        navigator.vibrate?.(10);
        showToast({
          variant: 'success',
          title: `Позиция ${p.ticker} закрыта`,
          description: `${res.lotsExecuted}/${res.lotsRequested} лот${res.executedPrice ? ` по ${formatNumber(res.executedPrice)}` : ' по рынку'}`,
        });
        void fetchPositions();
      } catch (e) {
        showToast({ variant: 'error', title: `Не удалось закрыть ${p.ticker}`, description: String(e instanceof Error ? e.message : e) });
      }
    },
    [useMock, fetchPositions],
  );

  const requestClose = useCallback((p: Position) => setCloseTarget(p), []);

  const handleTrailStop = useCallback(
    (p: Position) => {
      const map = useSlTpStore.getState().map;
      const eff = effectiveSlTp(p, map);
      const dir = p.direction === 'long' ? 1 : -1;
      // подтягиваем стоп к безубытку (или ближе к текущей, если позиция в минусе)
      const target = pnlPositive(p) ? p.avgPrice : Number((p.currentPrice * (1 - dir * 0.005)).toFixed(2));
      const better = dir > 0 ? Math.max(eff.sl, target) : Math.min(eff.sl, target);
      useSlTpStore.getState().setSlTp(p.instrumentId, { ...eff, sl: Number(better.toFixed(2)) });
      showToast({ variant: 'success', title: `Стоп по ${p.ticker} подтянут`, description: `SL ${formatNumber(Number(better.toFixed(2)))}` });
    },
    [],
  );

  const handleFlip = useCallback(
    (p: Position) => {
      if (useMock) {
        closedIdsRef.current.add(p.instrumentId);
        delete closedLotsRef.current[p.instrumentId];
        const flipped: Position = {
          ...p,
          direction: p.direction === 'long' ? 'short' : 'long',
          avgPrice: p.currentPrice,
          pnl: 0,
        };
        extraPositionsRef.current = [...extraPositionsRef.current.filter((x) => x.instrumentId !== p.instrumentId), flipped];
        useTradingStore.getState().addTrade({
          id: `flip-${Date.now()}`,
          instrumentId: p.instrumentId,
          ticker: p.ticker,
          direction: p.direction === 'long' ? 'short' : 'long',
          lots: p.lots,
          price: p.currentPrice,
          pnl: p.pnl,
          source: 'manual',
          time: Date.now(),
        });
        forceRender((x) => x + 1);
        void fetchPositions();
        showToast({ variant: 'info', title: `${p.ticker}: позиция перевернута`, description: `Теперь ${flipped.direction === 'long' ? 'лонг' : 'шорт'} ${p.lots} лот` });
        return;
      }
      void postOrder({
        instrumentId: p.instrumentId,
        direction: p.direction === 'long' ? 'short' : 'long',
        lots: p.lots * 2,
        orderType: 'market',
      })
        .then(() => {
          showToast({ variant: 'success', title: `${p.ticker}: позиция перевернута` });
          void fetchPositions();
        })
        .catch((e) => showToast({ variant: 'error', title: 'Переворот не выполнен', description: String(e instanceof Error ? e.message : e) }));
    },
    [useMock, fetchPositions],
  );

  const handleCancelOrder = useCallback(
    (o: MonitorOrder) => {
      navigator.vibrate?.(10);
      setCancellingIds((prev) => new Set(prev).add(o.orderId));
      if (useMock) {
        setTimeout(() => {
          setDemoOrders((prev) => prev.filter((x) => x.orderId !== o.orderId));
          setCancellingIds((prev) => {
            const next = new Set(prev);
            next.delete(o.orderId);
            return next;
          });
          showToast({
            variant: 'success',
            title: 'Ордер отменён',
            description: `${o.ticker} · ${o.lotsRequested} лот по ${o.price !== undefined ? formatNumber(o.price) : 'рынку'}`,
          });
        }, 250);
        return;
      }
      cancelOrder(o.orderId)
        .then(() => {
          useTradingStore.getState().removeOrder(o.orderId);
          showToast({ variant: 'success', title: 'Ордер отменён', description: `${o.ticker} · ${o.lotsRequested} лот` });
        })
        .catch((e) => showToast({ variant: 'error', title: 'Отмена не удалась', description: String(e instanceof Error ? e.message : e) }))
        .finally(() =>
          setCancellingIds((prev) => {
            const next = new Set(prev);
            next.delete(o.orderId);
            return next;
          }),
        );
    },
    [useMock],
  );

  /** Аварийное «Закрыть всё»: отмена всех ордеров + рыночное закрытие позиций */
  const handleCloseAll = useCallback(async () => {
    if (busyCloseAll) return;
    setBusyCloseAll(true);
    navigator.vibrate?.(15);
    let cancelled = 0;
    let closed = 0;
    const totalPnl = positions.reduce((a, p) => a + p.pnl, 0);
    try {
      if (useMock) {
        await new Promise((r) => setTimeout(r, 400));
        cancelled = demoOrders.length;
        closed = positions.length;
        setDemoOrders([]);
        const now = Date.now();
        positions.forEach((p, i) => {
          closedIdsRef.current.add(p.instrumentId);
          useTradingStore.getState().addTrade({
            id: `closeall-${now}-${i}`,
            instrumentId: p.instrumentId,
            ticker: p.ticker,
            direction: p.direction === 'long' ? 'short' : 'long',
            lots: p.lots,
            price: p.currentPrice,
            pnl: p.pnl,
            source: 'manual',
            time: now,
          });
        });
        extraPositionsRef.current = [];
        closedLotsRef.current = {};
        forceRender((x) => x + 1);
        void fetchPositions();
      } else {
        await Promise.allSettled(monitorOrders.map((o) => cancelOrder(o.orderId).then(() => {
          cancelled += 1;
          useTradingStore.getState().removeOrder(o.orderId);
        })));
        await Promise.allSettled(
          positions.map((p) =>
            postOrder({
              instrumentId: p.instrumentId,
              direction: p.direction === 'long' ? 'short' : 'long',
              lots: p.lots,
              orderType: 'market',
            }).then(() => {
              closed += 1;
            }),
          ),
        );
        await fetchPositions();
      }
      showToast({
        variant: 'success',
        title: 'Все позиции закрыты',
        description: `Позиций: ${closed} · ордеров отменено: ${cancelled} · P&L ≈ ${formatSignedRub(Math.round(totalPnl))}`,
      });
    } catch (e) {
      showToast({ variant: 'error', title: 'Закрытие завершилось с ошибками', description: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusyCloseAll(false);
    }
  }, [busyCloseAll, useMock, demoOrders.length, positions, monitorOrders, fetchPositions]);

  const totalPositionsPnl = positions.reduce((a, p) => a + p.pnl, 0);

  // ===== render =====
  const header = (
    <PageHeader
      group="Торговля"
      title="Позиции и ордера"
      subtitle={
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', offline ? 'animate-pulse bg-warn' : 'pulse-dot bg-long')} />
          {lastUpdated ? (
            <>
              Обновлено <span className="mono">{formatTime(lastUpdated)}</span>
            </>
          ) : (
            'Загрузка…'
          )}
          <span className="text-fg-muted">·</span>
          <span className={offline ? 'text-warn' : 'text-long'}>{offline ? 'переподключение…' : 'поток активен'}</span>
        </span>
      }
      actions={
        <>
          {/* Фильтр источника */}
          <div className="flex rounded-[10px] bg-inset p-0.5">
            {(
              [
                ['all', 'Все'],
                ['robot', 'Роботы'],
                ['manual', 'Ручные'],
              ] as [SourceFilter, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setSourceFilter(v)}
                className={cn(
                  'relative rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                  sourceFilter === v ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
                )}
              >
                {sourceFilter === v && (
                  <motion.span
                    layoutId="src-filter"
                    className="absolute inset-0 rounded-lg border-b-2 border-yellow bg-panel-raised"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCloseAllOpen(true)}
            disabled={positions.length === 0 && monitorOrders.length === 0}
            className="hidden h-10 items-center gap-2 rounded-[10px] border border-short/50 px-4 text-sm font-semibold text-short transition-colors hover:border-short hover:bg-short-dim disabled:opacity-45 md:flex"
          >
            <CircleX className="h-4 w-4" />
            Закрыть все позиции
          </button>
        </>
      }
    />
  );

  const marginBar = (
    <MarginBar
      totalAmount={portfolio?.totalAmount ?? 0}
      blockedMargin={portfolio?.blockedMargin ?? 0}
      freeMargin={portfolio?.freeMargin ?? 0}
      unrealizedPnl={unrealizedPnl}
    />
  );

  const positionsSection = (
    <PositionsTable
      positions={filteredPositions}
      onClose={requestClose}
      onOpenSlTp={setSlTpTarget}
      onTrailStop={handleTrailStop}
      onFlip={handleFlip}
      onPartialClose={(p, lots) => {
        if (lots >= p.lots) setCloseTarget(p);
        else void executeClose(p, lots);
      }}
      onOpenTerminal={() => navigate('/terminal')}
    />
  );

  const ordersSection = <OrdersSection orders={filteredOrders} onCancel={handleCancelOrder} cancellingIds={cancellingIds} />;

  const feedSection = <ExecutionsFeed />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="space-y-4 lg:space-y-5"
    >
      {header}

      {/* Баннер потери стрима (v2 §2.5.3: 40px, warn-гамма для переподключения) */}
      {offline && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex h-10 items-center gap-2 rounded-[10px] border border-warn/40 bg-[rgba(245,165,36,0.1)] px-4 text-[13px] font-medium text-warn"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-warn" />
          Потеряно соединение с потоком — переподключение…
        </motion.div>
      )}

      {marginBar}

      {/* ===== Desktop: сетка 8/4 ===== */}
      <div className="hidden gap-5 lg:grid lg:grid-cols-12">
        <div className="col-span-8 space-y-5">
          {positionsSection}
          {ordersSection}
        </div>
        <div className="col-span-4 space-y-5">
          <RiskMap positions={positions} tradesToday={tradesToday} />
          {feedSection}
        </div>
      </div>

      {/* ===== Tablet: две колонки без табов ===== */}
      <div className="hidden space-y-4 md:block lg:hidden">
        {positionsSection}
        <div className="grid grid-cols-2 gap-4">
          <RiskMap positions={positions} tradesToday={tradesToday} />
          {feedSection}
        </div>
        {ordersSection}
      </div>

      {/* ===== Mobile: табы ===== */}
      <div className="md:hidden">
        <div className="mb-3 grid grid-cols-3 rounded-[10px] bg-inset p-0.5">
          {(
            [
              ['positions', `Позиции (${filteredPositions.length})`],
              ['orders', `Ордера (${filteredOrders.length})`],
              ['feed', 'Лента'],
            ] as [MobileTab, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMobileTab(v)}
              className={cn(
                'relative rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors',
                mobileTab === v ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {mobileTab === v && (
                <motion.span
                  layoutId="mobile-mon-tab"
                  className="absolute inset-0 rounded-lg border-b-2 border-yellow bg-panel-raised"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
        {mobileTab === 'positions' && (
          <div className="space-y-4">
            {positionsSection}
            <RiskMap positions={positions} tradesToday={tradesToday} />
          </div>
        )}
        {mobileTab === 'orders' && ordersSection}
        {mobileTab === 'feed' && feedSection}
      </div>

      {/* FAB «Закрыть всё» (mobile, extended: иконка + подпись; spring-появление 0→≥1 позиций, v2 §5.4.7) */}
      {positions.length > 0 && (
        <motion.button
          type="button"
          onClick={() => setCloseAllOpen(true)}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          className="fixed bottom-[92px] right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-short px-4 text-sm font-bold text-white shadow-lg shadow-black/50 transition-transform active:scale-95 md:hidden"
        >
          <CircleX className="h-5 w-5" />
          Закрыть всё
        </motion.button>
      )}

      {/* Подтверждение закрытия одной позиции */}
      {mode === 'live' ? (
        <ConfirmDangerModal
          open={closeTarget !== null}
          onOpenChange={(o) => !o && setCloseTarget(null)}
          title={`Закрыть ${closeTarget?.ticker ?? ''}?`}
          description={
            closeTarget
              ? `Закрыть ${closeTarget.lots} лот ${closeTarget.ticker} по рынку ≈ ${formatSignedRub(closeTarget.pnl)}? Боевой режим — ордер исполнится на реальном счёте.`
              : undefined
          }
          confirmLabel="Удерживайте для закрытия"
          onConfirm={() => closeTarget && void executeClose(closeTarget)}
        />
      ) : (
        <ConfirmModal
          open={closeTarget !== null}
          onOpenChange={(o) => !o && setCloseTarget(null)}
          title={`Закрыть ${closeTarget?.ticker ?? ''}?`}
          description={
            closeTarget && (
              <span>
                Закрыть <span className="mono">{closeTarget.lots} лот {closeTarget.ticker}</span> по рынку ≈{' '}
                <span className={cn('mono font-semibold', closeTarget.pnl >= 0 ? 'text-long' : 'text-short')}>
                  {formatSignedRub(closeTarget.pnl)}
                </span>
                ?
              </span>
            )
          }
          confirmLabel="Закрыть по рынку"
          onConfirm={() => closeTarget && void executeClose(closeTarget)}
        />
      )}

      {/* Аварийное закрытие всех позиций */}
      <ConfirmDangerModal
        open={closeAllOpen}
        onOpenChange={setCloseAllOpen}
        title="Закрыть все позиции и отменить ордера?"
        description={`Позиций: ${positions.length} · активных ордеров: ${monitorOrders.length} · суммарный нереализ. P&L ≈ ${formatSignedRub(
          Math.round(totalPositionsPnl),
        )}. Все позиции будут закрыты по рынку, все ордера отменены.`}
        confirmLabel={busyCloseAll ? 'Выполняется…' : 'Удерживайте — закрыть всё'}
        onConfirm={() => void handleCloseAll()}
      />

      {/* +SL/TP мини-модалка */}
      <SlTpModal position={slTpTarget} onOpenChange={(o) => !o && setSlTpTarget(null)} />

      <ToastHost />
    </motion.div>
  );
}

function pnlPositive(p: Position): boolean {
  return p.pnl > 0;
}
