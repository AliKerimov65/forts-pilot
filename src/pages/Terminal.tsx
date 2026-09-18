// Терминал — /terminal (terminal.md): график, стакан, тикет, список инструментов, нижние табы.
// Desktop: drag-resizable сетка (react-resizable-panels). Mobile: 4 вкладки + quick Buy/Sell.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { cancelOrder, postOrder } from '@/lib/tinvest/services';
import type { Order, Position, Trade } from '@/types/trading';
import CandleChart from '@/components/terminal/CandleChart';
import CenterTabs from '@/components/terminal/CenterTabs';
import ConfirmModal from '@/components/terminal/ConfirmModal';
import InstrumentList from '@/components/terminal/InstrumentList';
import InstrumentPanel from '@/components/terminal/InstrumentPanel';
import OrderBookPanel from '@/components/terminal/OrderBookPanel';
import SegmentedControl from '@/components/terminal/SegmentedControl';
import TradeTicket, { type TicketState } from '@/components/terminal/TradeTicket';
import { useTerminalData } from '@/components/terminal/useTerminalData';
import { TIMEFRAMES, fmtPrice, futuresLabel, haptic, roundToStep, type Timeframe } from '@/components/terminal/utils';

const FAV_KEY = 'forts-pilot-terminal-favorites';
const LEGEND_KEY = 'forts-pilot-terminal-legend-seen';

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export default function Terminal() {
  const isMobile = useIsMobile();
  const mode = useConnectionStore((s) => s.mode);
  const token = useConnectionStore((s) => s.token);

  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[1]); // 5м
  const data = useTerminalData(timeframe);
  const { instrument, candles, candlesLoading, gridRobot, gridLevels, dayLow, dayHigh, margin, useMock } = data;

  const quotes = useMarketStore((s) => s.quotes);
  const quote = instrument ? quotes[instrument.uid] : undefined;
  const livePrice = quote?.price;
  const trades = useTradingStore((s) => s.trades);
  const orders = useTradingStore((s) => s.orders);
  const upsertOrder = useTradingStore((s) => s.upsertOrder);
  const removeOrder = useTradingStore((s) => s.removeOrder);
  const addTrade = useTradingStore((s) => s.addTrade);
  const setPositions = useTradingStore((s) => s.setPositions);

  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [fullscreen, setFullscreen] = useState(false);
  const [legendSeen, setLegendSeen] = useState(() => {
    try {
      return localStorage.getItem(LEGEND_KEY) === '1';
    } catch {
      return true;
    }
  });
  const [mobileTab, setMobileTab] = useState<'chart' | 'book' | 'ticket' | 'instruments'>('chart');
  const [quickSheet, setQuickSheet] = useState(false);
  const [ticket, setTicket] = useState<TicketState>({
    direction: 'long',
    orderType: 'limit',
    price: null,
    lots: 1,
    slOn: false,
    sl: null,
    tpOn: false,
    tp: null,
  });
  const [priceFlashAt, setPriceFlashAt] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
  const [dragConfirm, setDragConfirm] = useState<{ kind: 'sl' | 'tp'; price: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const patchTicket = useCallback((patch: Partial<TicketState>) => setTicket((t) => ({ ...t, ...patch })), []);

  const toggleFavorite = useCallback((uid: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  // при смене инструмента — сброс цены тикета на рыночную
  const uid = instrument?.uid ?? null;
  useEffect(() => {
    if (!uid) return;
    const q = useMarketStore.getState().quotes[uid];
    if (q) setTicket((t) => ({ ...t, price: roundToStep(q.price, instrument?.minPriceIncrement ?? 1) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // активные ордера выбранного инструмента (оверлей на графике)
  const instrumentOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.instrumentId === uid && (o.status === 'new' || o.status === 'partially_filled'),
      ),
    [orders, uid],
  );
  const instrumentTrades = useMemo(
    () => trades.filter((t) => t.instrumentId === uid).slice(0, 30),
    [trades, uid],
  );

  // ---------- отправка ордера ----------
  const submitOrder = useCallback(async () => {
    if (!instrument || submitting) return;
    const q = useMarketStore.getState().quotes[instrument.uid];
    const book = useMarketStore.getState().orderBook;
    const isBuy = ticket.direction === 'long';
    const execPrice =
      ticket.orderType === 'market'
        ? q?.price
        : ticket.orderType === 'best'
          ? ((isBuy ? book?.asks[0]?.price : book?.bids[0]?.price) ?? q?.price)
          : (ticket.price ?? undefined);
    if (ticket.orderType !== 'market' && execPrice === undefined) return;

    setSubmitting(true);
    const label = futuresLabel(instrument);
    const dirWord = isBuy ? 'Куплено' : 'Продано';
    try {
      if (useMock) {
        // демо-режим: локальная симуляция исполнения
        const marketable =
          ticket.orderType !== 'limit' ||
          execPrice === undefined ||
          (isBuy ? execPrice >= (book?.asks[0]?.price ?? q?.price ?? Infinity) : execPrice <= (book?.bids[0]?.price ?? q?.price ?? 0));
        const oid = `demo-${Date.now()}`;
        if (marketable && execPrice !== undefined) {
          const trade: Trade = {
            id: `demo-trade-${Date.now()}`,
            orderId: oid,
            instrumentId: instrument.uid,
            ticker: instrument.ticker,
            direction: ticket.direction,
            lots: ticket.lots,
            price: execPrice,
            source: 'manual',
            time: Date.now(),
          };
          addTrade(trade);
          // обновить mock-позицию
          const t = useTradingStore.getState();
          const existing = t.positions.find((p) => p.instrumentId === instrument.uid);
          if (existing && existing.direction === ticket.direction) {
            const lots = existing.lots + ticket.lots;
            const avg = (existing.avgPrice * existing.lots + execPrice * ticket.lots) / lots;
            setPositions(t.positions.map((p) => (p.instrumentId === instrument.uid ? { ...p, lots, avgPrice: avg } : p)));
          } else if (!existing) {
            setPositions([
              ...t.positions,
              {
                instrumentId: instrument.uid,
                ticker: instrument.ticker,
                name: instrument.name,
                direction: ticket.direction,
                lots: ticket.lots,
                avgPrice: execPrice,
                currentPrice: execPrice,
                pnl: 0,
              },
            ]);
          }
          toast.success(`Исполнено: ${dirWord.toLowerCase()} ${ticket.lots} лот`, {
            description: `${label} по ${fmtPrice(execPrice, instrument)} · ${ticket.orderType === 'limit' ? 'лимитный' : ticket.orderType === 'best' ? 'лучшая цена' : 'рыночный'}`,
            classNames: { description: 'mono' },
          });
        } else {
          upsertOrder({
            orderId: oid,
            accountId: 'demo',
            instrumentId: instrument.uid,
            ticker: instrument.ticker,
            direction: ticket.direction,
            lotsRequested: ticket.lots,
            lotsExecuted: 0,
            price: execPrice,
            orderType: 'limit',
            status: 'new',
            time: Date.now(),
          });
          toast.info('Лимитный ордер выставлен', {
            description: `${label} · ${ticket.lots} лот по ${execPrice !== undefined ? fmtPrice(execPrice, instrument) : '—'}`,
            classNames: { description: 'mono' },
          });
        }
      } else {
        const res = await postOrder({
          instrumentId: instrument.uid,
          direction: ticket.direction,
          lots: ticket.lots,
          orderType: ticket.orderType === 'market' ? 'market' : 'limit',
          price: ticket.orderType === 'market' ? undefined : execPrice,
        });
        upsertOrder({
          orderId: res.orderId,
          accountId: useConnectionStore.getState().accountId ?? '',
          instrumentId: instrument.uid,
          ticker: instrument.ticker,
          direction: ticket.direction,
          lotsRequested: res.lotsRequested,
          lotsExecuted: res.lotsExecuted,
          price: ticket.orderType === 'market' ? undefined : execPrice,
          orderType: ticket.orderType === 'market' ? 'market' : 'limit',
          status: res.status,
          time: Date.now(),
          message: res.message,
        });
        if (res.lotsExecuted > 0 && res.executedPrice !== undefined) {
          addTrade({
            id: `trade-${res.orderId}`,
            orderId: res.orderId,
            instrumentId: instrument.uid,
            ticker: instrument.ticker,
            direction: ticket.direction,
            lots: res.lotsExecuted,
            price: res.executedPrice,
            commission: res.commission,
            source: 'manual',
            time: Date.now(),
          });
        }
        toast.success(res.status === 'filled' ? 'Ордер исполнен' : 'Ордер отправлен', {
          description: `${label} · ${res.lotsExecuted}/${res.lotsRequested} лот${res.executedPrice !== undefined ? ` по ${fmtPrice(res.executedPrice, instrument)}` : ''}${res.commission !== undefined ? ` · комиссия ${res.commission.toFixed(2)} ₽` : ''}`,
          classNames: { description: 'mono' },
        });
      }
      haptic(); // 10ms (design.md §8)
      setQuickSheet(false);
    } catch (e) {
      toast.error('Ошибка отправки ордера', {
        description: e instanceof Error ? e.message : String(e),
        classNames: { description: 'mono' },
      });
    } finally {
      setSubmitting(false);
    }
  }, [instrument, submitting, ticket, useMock, addTrade, upsertOrder, setPositions]);

  const onSubmitClick = useCallback(() => {
    if (mode === 'live' && token) setConfirmLiveOpen(true);
    else void submitOrder();
  }, [mode, token, submitOrder]);

  // ---------- отмена ордера ----------
  const onCancelOrder = useCallback(
    async (o: Order) => {
      try {
        if (!useMock) await cancelOrder(o.orderId);
        removeOrder(o.orderId);
        toast.success('Ордер отменён', { description: `${o.ticker} · ${o.lotsRequested} лот`, classNames: { description: 'mono' } });
      } catch (e) {
        toast.error('Не удалось отменить ордер', {
          description: e instanceof Error ? e.message : String(e),
          classNames: { description: 'mono' },
        });
      }
    },
    [useMock, removeOrder],
  );

  // ---------- закрытие позиции ----------
  const onClosePosition = useCallback(
    async (p: Position) => {
      const opposite = p.direction === 'long' ? 'short' : 'long';
      try {
        if (useMock) {
          const cur = useMarketStore.getState().quotes[p.instrumentId]?.price ?? p.currentPrice;
          const t = useTradingStore.getState();
          setPositions(t.positions.filter((x) => x.instrumentId !== p.instrumentId));
          addTrade({
            id: `demo-close-${Date.now()}`,
            instrumentId: p.instrumentId,
            ticker: p.ticker,
            direction: opposite,
            lots: p.lots,
            price: cur,
            pnl: Math.round((cur - p.avgPrice) * p.lots * (p.direction === 'long' ? 1 : -1)),
            source: 'manual',
            time: Date.now(),
          });
          toast.success(`Позиция ${p.ticker} закрыта`, {
            description: `${p.lots} лот по ${fmtPrice(cur, instrument)}`,
            classNames: { description: 'mono' },
          });
          haptic();
        } else {
          await postOrder({ instrumentId: p.instrumentId, direction: opposite, lots: p.lots, orderType: 'market' });
          toast.success(`Заявка на закрытие ${p.ticker} отправлена`);
          haptic();
        }
      } catch (e) {
        toast.error('Не удалось закрыть позицию', {
          description: e instanceof Error ? e.message : String(e),
          classNames: { description: 'mono' },
        });
      }
    },
    [useMock, addTrade, setPositions, instrument],
  );

  // ---------- клик по стакану → цена в тикет ----------
  const onBookPriceClick = useCallback(
    (price: number) => {
      if (!instrument) return;
      patchTicket({ orderType: ticket.orderType === 'market' ? 'limit' : ticket.orderType, price: roundToStep(price, instrument.minPriceIncrement || 1) });
      setPriceFlashAt(Date.now());
      if (isMobile) setMobileTab('ticket');
    },
    [instrument, patchTicket, ticket.orderType, isMobile],
  );

  // ---------- drag SL/TP на графике ----------
  const onLineDragEnd = useCallback((kind: 'sl' | 'tp', price: number) => {
    setDragConfirm({ kind, price });
  }, []);

  // ---------- клавиатурные шорткаты (desktop) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'b') patchTicket({ direction: 'long' });
      else if (key === 's') patchTicket({ direction: 'short' });
      else if (key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (key === '1') setTimeframe(TIMEFRAMES[0]);
      else if (key === '5') setTimeframe(TIMEFRAMES[1]);
      else if (key === '3') setTimeframe(TIMEFRAMES[2]);
      else if (key === 'h') setTimeframe(TIMEFRAMES[3]);
      else if (key === '4') setTimeframe(TIMEFRAMES[4]);
      else if (key === 'd') setTimeframe(TIMEFRAMES[5]);
      else if (key === 'escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [patchTicket]);

  // свайп по панели инструмента (mobile): смена инструмента из избранного/списка
  const onSwipeInstrument = useCallback(
    (dir: 1 | -1) => {
      const list = useMarketStore.getState().instruments;
      if (!uid || list.length === 0) return;
      const pool = favorites.size > 0 ? list.filter((i) => favorites.has(i.uid)) : list;
      if (pool.length === 0) return;
      const idx = pool.findIndex((i) => i.uid === uid);
      const next = pool[(idx + dir + pool.length) % pool.length];
      useMarketStore.getState().selectInstrument(next.uid);
    },
    [uid, favorites],
  );

  const hideLegend = () => {
    setLegendSeen(true);
    try {
      localStorage.setItem(LEGEND_KEY, '1');
    } catch {
      /* noop */
    }
  };

  // ---------- общие куски ----------
  const chartBlock = (heightCls: string) => (
    <div className={cn('relative', heightCls)}>
      {candlesLoading && candles.length === 0 ? (
        <div className="shimmer h-full w-full rounded-lg" />
      ) : (
        <CandleChart
          candles={candles}
          instrument={instrument}
          intervalMs={timeframe.ms}
          livePrice={livePrice}
          orders={instrumentOrders}
          slPrice={ticket.slOn ? ticket.sl : null}
          tpPrice={ticket.tpOn ? ticket.tp : null}
          gridLevels={gridLevels}
          trades={instrumentTrades}
          onLineDragEnd={onLineDragEnd}
        />
      )}
      {!legendSeen && (
        <button
          type="button"
          onClick={hideLegend}
          className="absolute inset-x-4 top-3 z-10 rounded-[10px] border border-subtle bg-panel-raised/90 px-3 py-2 text-left text-[11px] text-fg-secondary backdrop-blur"
        >
          Пунктир — ваши ордера · Ромбы/стрелки — сделки · Серые линии — сетка робота. SL/TP можно тянуть мышью.
        </button>
      )}
    </div>
  );

  const timeframeControl = (
    <SegmentedControl
      id="timeframe"
      segments={TIMEFRAMES.map((t) => ({ key: t.key, label: t.label }))}
      value={timeframe.key}
      onChange={(k) => setTimeframe(TIMEFRAMES.find((t) => t.key === k) ?? TIMEFRAMES[1])}
    />
  );

  const ticketBlock = (
    <TradeTicket
      instrument={instrument}
      state={ticket}
      onChange={patchTicket}
      onSubmit={onSubmitClick}
      submitting={submitting}
      priceFlashAt={priceFlashAt}
      marginBuy={margin.buy}
      marginSell={margin.sell}
      className="h-full"
    />
  );

  const headerBlock = instrument ? (
    <InstrumentPanel
      instrument={instrument}
      dayLow={dayLow}
      dayHigh={dayHigh}
      isFavorite={favorites.has(instrument.uid)}
      onToggleFavorite={() => toggleFavorite(instrument.uid)}
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen((f) => !f)}
      onSwipeInstrument={onSwipeInstrument}
      compact={isMobile}
    />
  ) : (
    <div className="flex h-16 items-center border-b border-subtle bg-panel px-4 text-sm text-fg-muted">
      Загрузка инструментов…
    </div>
  );

  // ---------- render ----------
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <Toaster theme="dark" position={isMobile ? 'top-center' : 'top-right'} />

      {/* ===== Desktop ===== */}
      <div className="hidden lg:block" style={{ height: 'calc(100dvh - 120px)' }}>
        <Group orientation="horizontal" className="h-full w-full">
          {/* Список инструментов */}
          <Panel id="instruments" defaultSize="17%" minSize="12%">
            <div className="h-full overflow-hidden rounded-xl border border-subtle bg-panel">
              <InstrumentList
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                searchResults={data.remoteResults}
                onSearchChange={data.searchRemote}
                searchInputRef={searchInputRef}
              />
            </div>
          </Panel>
          <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-yellow/70" />

          {/* Центр */}
          <Panel id="center" defaultSize="58%" minSize="38%">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-subtle bg-panel">
              {headerBlock}
              <div className="flex items-center justify-between gap-2 border-b border-subtle px-3 py-1.5">
                {timeframeControl}
                <span className="mono text-[10px] text-fg-muted">
                  B/S — направление · / — поиск · 1/5/3/H/4/D — таймфрейм
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <Group orientation="vertical" className="h-full w-full">
                  <Panel id="chart" defaultSize="62%" minSize="30%">
                    {chartBlock('h-full')}
                  </Panel>
                  <Separator className="h-1 bg-transparent transition-colors duration-150 hover:bg-yellow/70" />
                  <Panel id="tabs" defaultSize="38%" minSize="15%">
                    <CenterTabs
                      instrument={instrument}
                      gridRobot={gridRobot}
                      onCancelOrder={(o) => void onCancelOrder(o)}
                      onClosePosition={(p) => void onClosePosition(p)}
                      className="h-full bg-panel"
                    />
                  </Panel>
                </Group>
              </div>
            </div>
          </Panel>
          <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-yellow/70" />

          {/* Правая колонка: стакан + тикет */}
          <Panel id="right" defaultSize="25%" minSize="18%">
            <div className="h-full overflow-hidden rounded-xl border border-subtle bg-panel">
              <Group orientation="vertical" className="h-full w-full">
                <Panel id="book" defaultSize="50%" minSize="25%">
                  <div className="h-full bg-inset">
                    <OrderBookPanel instrument={instrument} depth={10} onPriceClick={onBookPriceClick} />
                  </div>
                </Panel>
                <Separator className="h-1 bg-transparent transition-colors duration-150 hover:bg-yellow/70" />
                <Panel id="ticket" defaultSize="50%" minSize="25%">
                  {ticketBlock}
                </Panel>
              </Group>
            </div>
          </Panel>
        </Group>
      </div>

      {/* ===== Mobile ===== */}
      <div className="lg:hidden">
        <SegmentedControl
          id="mobile-tabs"
          className="mb-3 w-full"
          segments={[
            { key: 'chart', label: 'График' },
            { key: 'book', label: 'Стакан' },
            { key: 'ticket', label: 'Тикет' },
            { key: 'instruments', label: 'Инструменты' },
          ]}
          value={mobileTab}
          onChange={(k) => setMobileTab(k as typeof mobileTab)}
        />

        {mobileTab === 'chart' && (
          <div className="overflow-hidden rounded-xl border border-subtle bg-panel">
            {headerBlock}
            <div className="flex gap-1 overflow-x-auto border-b border-subtle px-2 py-1.5">{timeframeControl}</div>
            {chartBlock('h-[45vh]')}
            {/* активные ордера компактно */}
            {instrumentOrders.length > 0 && (
              <div className="border-t border-subtle">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-secondary">
                  Ордера ({instrumentOrders.length})
                </div>
                {instrumentOrders.map((o) => (
                  <div key={o.orderId} className="mono flex items-center gap-2 border-t border-subtle/40 px-3 py-2 text-[12px]">
                    <span className={o.direction === 'long' ? 'text-long' : 'text-short'}>
                      {o.direction === 'long' ? 'Лонг' : 'Шорт'}
                    </span>
                    <span className="text-fg">{o.price !== undefined ? fmtPrice(o.price, instrument) : 'рынок'}</span>
                    <span className="text-fg-muted">×{o.lotsRequested}</span>
                    <button
                      type="button"
                      aria-label="Отменить ордер"
                      onClick={() => void onCancelOrder(o)}
                      className="ml-auto rounded-md bg-short-dim p-1.5 text-short"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mobileTab === 'book' && (
          <div className="overflow-hidden rounded-xl border border-subtle bg-inset" style={{ height: 'calc(100dvh - 260px)' }}>
            <OrderBookPanel instrument={instrument} depth={7} onPriceClick={onBookPriceClick} />
          </div>
        )}

        {mobileTab === 'ticket' && (
          <div className="overflow-hidden rounded-xl border border-subtle bg-panel">{ticketBlock}</div>
        )}

        {mobileTab === 'instruments' && (
          <div className="overflow-hidden rounded-xl border border-subtle bg-panel" style={{ height: 'calc(100dvh - 260px)' }}>
            <InstrumentList
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              searchResults={data.remoteResults}
              onSearchChange={data.searchRemote}
              searchInputRef={searchInputRef}
              compact
              onSelect={() => setMobileTab('chart')}
            />
          </div>
        )}

        {/* Quick Buy/Sell над tabbar (только вкладка График) */}
        {mobileTab === 'chart' && (
          <div className="fixed inset-x-0 bottom-[72px] z-30 flex justify-center pb-[env(safe-area-inset-bottom)]">
            <div className="flex overflow-hidden rounded-full border border-subtle shadow-lg shadow-black/40">
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  patchTicket({ direction: 'long', orderType: ticket.orderType === 'market' ? 'market' : ticket.orderType });
                  setQuickSheet(true);
                }}
                className="bg-long px-7 py-2.5 text-sm font-bold text-app"
              >
                Купить
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  patchTicket({ direction: 'short' });
                  setQuickSheet(true);
                }}
                className="bg-short px-7 py-2.5 text-sm font-bold text-white"
              >
                Продать
              </motion.button>
            </div>
          </div>
        )}

        {/* Тикет bottom-sheet */}
        <Sheet open={quickSheet} onOpenChange={setQuickSheet}>
          <SheetContent side="bottom" className="border-subtle bg-panel-raised p-0">
            <SheetHeader className="border-b border-subtle p-3">
              <SheetTitle className="text-sm">
                {ticket.direction === 'long' ? 'Покупка' : 'Продажа'} {instrument ? futuresLabel(instrument) : ''}
              </SheetTitle>
            </SheetHeader>
            <div className="max-h-[70dvh] overflow-y-auto">{ticketBlock}</div>
          </SheetContent>
        </Sheet>
      </div>

      {/* ===== Fullscreen график ===== */}
      {fullscreen && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-app">
          {headerBlock}
          <div className="flex items-center justify-between gap-2 border-b border-subtle px-3 py-1.5">
            {timeframeControl}
            <span className="mono text-[10px] text-fg-muted">ESC — выход</span>
          </div>
          <div className="min-h-0 flex-1">{chartBlock('h-full')}</div>
        </div>
      )}

      {/* Confirm: боевой ордер (press-and-hold) */}
      <ConfirmDangerModal
        open={confirmLiveOpen}
        onOpenChange={setConfirmLiveOpen}
        title="Ордер будет отправлен на биржу"
        description={
          instrument
            ? `${ticket.direction === 'long' ? 'Покупка' : 'Продажа'} ${ticket.lots} лот ${futuresLabel(instrument)} — боевой режим, реальные деньги.`
            : undefined
        }
        confirmLabel="Удерживайте для отправки"
        onConfirm={() => void submitOrder()}
      />

      {/* Confirm: изменение SL/TP drag на графике */}
      <ConfirmModal
        open={dragConfirm !== null}
        onOpenChange={(open) => !open && setDragConfirm(null)}
        title={dragConfirm?.kind === 'sl' ? 'Изменить стоп-лосс?' : 'Изменить тейк-профит?'}
        description={
          dragConfirm && instrument
            ? `Новое значение: ${fmtPrice(dragConfirm.price, instrument)}`
            : undefined
        }
        confirmLabel="Изменить"
        onConfirm={() => {
          if (!dragConfirm) return;
          patchTicket(
            dragConfirm.kind === 'sl'
              ? { sl: dragConfirm.price, slOn: true }
              : { tp: dragConfirm.price, tpOn: true },
          );
          haptic();
        }}
      />
    </motion.div>
  );
}
