// Обёртки над T-Invest API (по брифу tinvest-api-brief.md)
// - Автоматический выбор sandbox/prod контура по режиму из стора подключения
// - Торговые операции в песочнице идут через SandboxService/* (бриф §4)
// - Все ответы нормализованы: Quotation/MoneyValue → number

import type { Account } from '@/types/account';
import type { Candle, CandleInterval, Instrument, OrderBook, Quote } from '@/types/market';
import type { Direction, Order, OrderStatus, PortfolioSummary, Position } from '@/types/trading';
import {
  callApi,
  newOrderId,
  numberToQuotation,
  quotationToNumber,
  type MoneyValue,
  type Quotation,
} from './client';
import { useConnectionStore } from '@/store/connection';

// ---------- внутренние хелперы ----------

function conn() {
  const s = useConnectionStore.getState();
  if (!s.token) throw new Error('Нет API-токена — включите демо-режим или подключите токен');
  return { token: s.token, sandbox: s.mode === 'sandbox', accountId: s.accountId };
}

function requireAccount(): string {
  const { accountId } = conn();
  if (!accountId) throw new Error('Не выбран счёт');
  return accountId;
}

/** Торговый сервис по режиму: sandbox → SandboxService, live → OrdersService (бриф §4) */
function ordersService(): 'OrdersService' | 'SandboxService' {
  return useConnectionStore.getState().mode === 'sandbox' ? 'SandboxService' : 'OrdersService';
}

function opsMethod(base: string): string {
  // GetSandboxPortfolio / GetSandboxPositions / GetSandboxOrders vs GetPortfolio / GetPositions / GetOrders
  return useConnectionStore.getState().mode === 'sandbox' ? `GetSandbox${base}` : `Get${base}`;
}

// ---------- сырые типы ответов (минимально необходимые поля) ----------

interface RawInstrument {
  figi?: string;
  uid?: string;
  ticker?: string;
  classCode?: string;
  name?: string;
  basicAsset?: string;
  lot?: number;
  currency?: string;
  minPriceIncrement?: Quotation;
  expirationDate?: string;
  dlong?: Quotation;
  dshort?: Quotation;
  apiTradeAvailableFlag?: boolean;
}

function mapInstrument(raw: RawInstrument): Instrument {
  return {
    uid: raw.uid ?? '',
    figi: raw.figi ?? '',
    ticker: raw.ticker ?? '',
    classCode: raw.classCode ?? '',
    name: raw.name ?? raw.ticker ?? '',
    basicAsset: raw.basicAsset ?? '',
    lot: raw.lot ?? 1,
    currency: raw.currency ?? 'rub',
    minPriceIncrement: quotationToNumber(raw.minPriceIncrement) || 1,
    expirationDate: raw.expirationDate,
  };
}

// ---------- UsersService ----------

/** Список счетов */
export async function getAccounts(): Promise<Account[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ accounts?: Array<{ id: string; type?: string; name?: string; status?: string; openedDate?: string; accessLevel?: string }> }>(
    'UsersService',
    'GetAccounts',
    {},
    { token, sandbox },
  );
  return (res.accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name || `Счёт •…${a.id.slice(-4)}`,
    type: a.type ?? '',
    status: a.status ?? '',
    openedDate: a.openedDate,
    accessLevel: a.accessLevel,
  }));
}

// ---------- InstrumentsService ----------

/** Список фьючерсов, доступных к торговле (INSTRUMENT_STATUS_BASE) */
export async function getFutures(): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: RawInstrument[] }>(
    'InstrumentsService',
    'Futures',
    { instrumentStatus: 'INSTRUMENT_STATUS_BASE' },
    { token, sandbox, timeoutMs: 15_000 },
  );
  return (res.instruments ?? []).map(mapInstrument);
}

/** Поиск инструмента по строке (тикер/название) */
export async function findInstrument(query: string): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: RawInstrument[] }>(
    'InstrumentsService',
    'FindInstrument',
    { query, instrumentKind: 'INSTRUMENT_TYPE_FUTURES', apiTradeAvailableFlag: true },
    { token, sandbox },
  );
  return (res.instruments ?? []).map(mapInstrument);
}

/** ГО фьючерса (GetFuturesMargin) → { buy, sell } в ₽ */
export async function getFuturesMargin(instrumentId: string): Promise<{ buy: number; sell: number }> {
  const { token, sandbox } = conn();
  const res = await callApi<{ initialMarginOnBuy?: MoneyValue; initialMarginOnSell?: MoneyValue }>(
    'InstrumentsService',
    'GetFuturesMargin',
    { instrumentId },
    { token, sandbox },
  );
  return { buy: quotationToNumber(res.initialMarginOnBuy), sell: quotationToNumber(res.initialMarginOnSell) };
}

// ---------- MarketDataService ----------

/** Исторические свечи */
export async function getCandles(
  instrumentId: string,
  from: Date,
  to: Date,
  interval: CandleInterval,
  limit?: number,
): Promise<Candle[]> {
  const { token, sandbox } = conn();
  const body: Record<string, unknown> = {
    instrumentId,
    from: from.toISOString(),
    to: to.toISOString(),
    interval,
  };
  if (limit) body.limit = limit;
  const res = await callApi<{
    candles?: Array<{ open: Quotation; high: Quotation; low: Quotation; close: Quotation; volume?: string; time: string; isComplete?: boolean }>;
  }>('MarketDataService', 'GetCandles', body, { token, sandbox });
  return (res.candles ?? []).map((c) => ({
    time: new Date(c.time).getTime(),
    open: quotationToNumber(c.open),
    high: quotationToNumber(c.high),
    low: quotationToNumber(c.low),
    close: quotationToNumber(c.close),
    volume: Number(c.volume ?? 0),
    isComplete: c.isComplete ?? true,
  }));
}

/** Стакан */
export async function getOrderBook(instrumentId: string, depth = 20): Promise<OrderBook> {
  const { token, sandbox } = conn();
  const res = await callApi<{
    bids?: Array<{ price: Quotation; quantity: string }>;
    asks?: Array<{ price: Quotation; quantity: string }>;
    lastPrice?: Quotation;
    limitUp?: Quotation;
    limitDown?: Quotation;
  }>('MarketDataService', 'GetOrderBook', { instrumentId, depth }, { token, sandbox });
  const mapLevel = (l: { price: Quotation; quantity: string }) => ({
    price: quotationToNumber(l.price),
    quantity: Number(l.quantity),
  });
  return {
    instrumentId,
    bids: (res.bids ?? []).map(mapLevel),
    asks: (res.asks ?? []).map(mapLevel),
    lastPrice: quotationToNumber(res.lastPrice),
    limitUp: res.limitUp ? quotationToNumber(res.limitUp) : undefined,
    limitDown: res.limitDown ? quotationToNumber(res.limitDown) : undefined,
    time: Date.now(),
  };
}

/** Цены последних сделок (для поллинга котировок, лимит 150/мин) */
export async function getLastPrices(instrumentIds: string[]): Promise<Quote[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{
    lastPrices?: Array<{ figi?: string; instrumentUid?: string; price: Quotation; time: string }>;
  }>('MarketDataService', 'GetLastPrices', { instrumentId: instrumentIds }, { token, sandbox });
  return (res.lastPrices ?? []).map((p) => ({
    instrumentId: p.instrumentUid ?? p.figi ?? '',
    price: quotationToNumber(p.price),
    delta: 0,
    time: new Date(p.time).getTime(),
  }));
}

// ---------- OrdersService / SandboxService ----------

export interface PostOrderParams {
  instrumentId: string;
  direction: Direction;
  /** Количество лотов */
  lots: number;
  orderType: 'limit' | 'market';
  /** Цена в пунктах (обязательна для limit) */
  price?: number;
  /** Клиентский orderId для идемпотентности; если не передан — генерируется UUID v4 */
  orderId?: string;
}

export interface PostOrderResult {
  orderId: string;
  status: OrderStatus;
  lotsRequested: number;
  lotsExecuted: number;
  executedPrice?: number;
  commission?: number;
  message?: string;
}

function mapExecutionStatus(s?: string): OrderStatus {
  switch (s) {
    case 'EXECUTION_REPORT_STATUS_FILL':
      return 'filled';
    case 'EXECUTION_REPORT_STATUS_PARTIALLYFILL':
      return 'partially_filled';
    case 'EXECUTION_REPORT_STATUS_REJECTED':
      return 'rejected';
    case 'EXECUTION_REPORT_STATUS_CANCELLED':
      return 'cancelled';
    default:
      return 'new';
  }
}

/** Выставить заявку (в песочнице — SandboxService/PostSandboxOrder) */
export async function postOrder(params: PostOrderParams): Promise<PostOrderResult> {
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const service = ordersService();
  const method = sandbox ? 'PostSandboxOrder' : 'PostOrder';
  const body: Record<string, unknown> = {
    instrumentId: params.instrumentId,
    quantity: String(params.lots),
    direction: params.direction === 'long' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
    accountId,
    orderType: params.orderType === 'limit' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
    orderId: params.orderId ?? newOrderId(),
  };
  if (params.orderType === 'limit' && params.price !== undefined) {
    body.price = numberToQuotation(params.price);
    body.priceType = 'PRICE_TYPE_POINT'; // FORTS: цена в пунктах (бриф §6)
    body.timeInForce = 'TIME_IN_FORCE_DAY';
  }
  const res = await callApi<{
    orderId?: string;
    executionReportStatus?: string;
    lotsRequested?: string;
    lotsExecuted?: string;
    executedOrderPrice?: MoneyValue;
    executedCommission?: MoneyValue;
    message?: string;
  }>(service, method, body, { token, sandbox });
  return {
    orderId: res.orderId ?? '',
    status: mapExecutionStatus(res.executionReportStatus),
    lotsRequested: Number(res.lotsRequested ?? params.lots),
    lotsExecuted: Number(res.lotsExecuted ?? 0),
    executedPrice: res.executedOrderPrice ? quotationToNumber(res.executedOrderPrice) : undefined,
    commission: res.executedCommission ? quotationToNumber(res.executedCommission) : undefined,
    message: res.message,
  };
}

/** Отменить заявку */
export async function cancelOrder(orderId: string): Promise<void> {
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const method = sandbox ? 'CancelSandboxOrder' : 'CancelOrder';
  await callApi(ordersService(), method, { accountId, orderId }, { token, sandbox });
}

/** Активные заявки */
export async function getOrders(): Promise<Order[]> {
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const res = await callApi<{
    orders?: Array<{
      orderId: string;
      figi?: string;
      instrumentUid?: string;
      direction?: string;
      lotsRequested?: string;
      lotsExecuted?: string;
      orderType?: string;
      executionReportStatus?: string;
      orderDate?: string;
      message?: string;
      initialSecurityPricePt?: Quotation;
      initialOrderPricePt?: Quotation;
    }>;
  }>(ordersService(), opsMethod('Orders'), { accountId }, { token, sandbox });
  return (res.orders ?? []).map((o) => ({
    orderId: o.orderId,
    accountId,
    instrumentId: o.instrumentUid ?? o.figi ?? '',
    ticker: o.instrumentUid ?? o.figi ?? '',
    direction: o.direction === 'ORDER_DIRECTION_SELL' ? 'short' : 'long',
    lotsRequested: Number(o.lotsRequested ?? 0),
    lotsExecuted: Number(o.lotsExecuted ?? 0),
    price: quotationToNumber(o.initialOrderPricePt ?? o.initialSecurityPricePt) || undefined,
    orderType: o.orderType === 'ORDER_TYPE_MARKET' ? 'market' : 'limit',
    status: mapExecutionStatus(o.executionReportStatus),
    time: o.orderDate ? new Date(o.orderDate).getTime() : Date.now(),
    message: o.message,
  }));
}

// ---------- OperationsService / SandboxService ----------

/** Портфель: сводка + позиции */
export async function getPortfolio(): Promise<PortfolioSummary & { positions: Position[] }> {
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const res = await callApi<{
    totalAmountPortfolio?: MoneyValue;
    totalAmountCurrencies?: MoneyValue;
    expectedYield?: Quotation;
    positions?: Array<{
      figi?: string;
      instrumentUid?: string;
      instrumentType?: string;
      quantity?: Quotation;
      averagePositionPrice?: MoneyValue;
      currentPrice?: MoneyValue;
      expectedYield?: Quotation;
      varMargin?: MoneyValue;
      blockedLots?: Quotation;
    }>;
  }>(
    sandbox ? 'SandboxService' : 'OperationsService',
    opsMethod('Portfolio'),
    { accountId },
    { token, sandbox },
  );
  const total = quotationToNumber(res.totalAmountPortfolio);
  const positions: Position[] = (res.positions ?? [])
    .filter((p) => p.instrumentType === 'futures' || p.instrumentType === 'FUTURES' || p.instrumentType === undefined)
    .map((p) => {
      const qty = quotationToNumber(p.quantity);
      const avg = quotationToNumber(p.averagePositionPrice);
      return {
        instrumentId: p.instrumentUid ?? p.figi ?? '',
        figi: p.figi,
        ticker: p.figi ?? '',
        direction: qty >= 0 ? ('long' as const) : ('short' as const),
        lots: Math.abs(Math.round(qty)),
        avgPrice: avg,
        currentPrice: quotationToNumber(p.currentPrice) || avg,
        pnl: quotationToNumber(p.expectedYield),
        margin: p.varMargin ? quotationToNumber(p.varMargin) : undefined,
      };
    });
  const blocked = positions.reduce((acc, p) => acc + (p.margin ?? 0), 0);
  const cash = quotationToNumber(res.totalAmountCurrencies);
  return {
    totalAmount: total,
    cash,
    freeMargin: Math.max(0, cash - 0),
    blockedMargin: blocked,
    dayPnl: positions.reduce((acc, p) => acc + p.pnl, 0),
    dayPnlPct: total > 0 ? (positions.reduce((acc, p) => acc + p.pnl, 0) / total) * 100 : 0,
    expectedYieldPct: quotationToNumber(res.expectedYield),
    positions,
  };
}

/** Позиции (OperationsService/GetPositions: futures[] + money[]) */
export async function getPositions(): Promise<Position[]> {
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const res = await callApi<{
    futures?: Array<{ figi?: string; instrumentUid?: string; balance?: string; blocked?: string; currentPrice?: Quotation; averagePositionPrice?: Quotation; varMargin?: MoneyValue }>;
  }>(
    sandbox ? 'SandboxService' : 'OperationsService',
    opsMethod('Positions'),
    { accountId },
    { token, sandbox },
  );
  return (res.futures ?? []).map((f) => {
    const balance = Number(f.balance ?? 0);
    const avg = quotationToNumber(f.averagePositionPrice);
    return {
      instrumentId: f.instrumentUid ?? f.figi ?? '',
      figi: f.figi,
      ticker: f.figi ?? '',
      direction: balance >= 0 ? ('long' as const) : ('short' as const),
      lots: Math.abs(balance),
      avgPrice: avg,
      currentPrice: quotationToNumber(f.currentPrice) || avg,
      pnl: 0,
      margin: f.varMargin ? quotationToNumber(f.varMargin) : undefined,
    };
  });
}

// ---------- SandboxService (только sandbox-контур) ----------

/** Открыть счёт песочницы → accountId */
export async function openSandboxAccount(name?: string): Promise<string> {
  const { token } = conn();
  const res = await callApi<{ accountId?: string }>(
    'SandboxService',
    'OpenSandboxAccount',
    name ? { name } : {},
    { token, sandbox: true },
  );
  return res.accountId ?? '';
}

/** Пополнить счёт песочницы, ₽ */
export async function sandboxPayIn(accountId: string, amountRub: number): Promise<void> {
  const { token } = conn();
  await callApi(
    'SandboxService',
    'SandboxPayIn',
    { accountId, amount: { currency: 'rub', ...numberToQuotation(amountRub) } },
    { token, sandbox: true },
  );
}

/** Выставить заявку в песочнице (явный вызов, вне зависимости от текущего режима) */
export async function postSandboxOrder(accountId: string, params: PostOrderParams): Promise<PostOrderResult> {
  const { token } = conn();
  const body: Record<string, unknown> = {
    instrumentId: params.instrumentId,
    quantity: String(params.lots),
    direction: params.direction === 'long' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
    accountId,
    orderType: params.orderType === 'limit' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
    orderId: params.orderId ?? newOrderId(),
  };
  if (params.orderType === 'limit' && params.price !== undefined) {
    body.price = numberToQuotation(params.price);
    body.priceType = 'PRICE_TYPE_POINT';
    body.timeInForce = 'TIME_IN_FORCE_DAY';
  }
  const res = await callApi<{ orderId?: string; executionReportStatus?: string; lotsRequested?: string; lotsExecuted?: string; message?: string }>(
    'SandboxService',
    'PostSandboxOrder',
    body,
    { token, sandbox: true },
  );
  return {
    orderId: res.orderId ?? '',
    status: mapExecutionStatus(res.executionReportStatus),
    lotsRequested: Number(res.lotsRequested ?? params.lots),
    lotsExecuted: Number(res.lotsExecuted ?? 0),
    message: res.message,
  };
}
