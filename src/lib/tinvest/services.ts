// Обёртки над T-Invest API (по брифу tinvest-api-brief.md)
// - Автоматический выбор sandbox/prod контура по режиму из стора подключения
// - Торговые операции в песочнице идут через SandboxService/* (бриф §4)
// - Все ответы нормализованы: Quotation/MoneyValue → number

import type { Account } from '@/types/account';
import type { Candle, CandleInterval, Instrument, InstrumentType, OrderBook, Quote } from '@/types/market';
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
  isin?: string;
  name?: string;
  basicAsset?: string;
  lot?: number;
  currency?: string;
  minPriceIncrement?: Quotation;
  expirationDate?: string;
  dlong?: Quotation;
  dshort?: Quotation;
  apiTradeAvailableFlag?: boolean;
  buyAvailableFlag?: boolean;
  sellAvailableFlag?: boolean;
  shortEnabledFlag?: boolean;
  forQualInvestorFlag?: boolean;
  weekendFlag?: boolean;
  tradingStatus?: string;
}

/** Маппинг enum InstrumentType API → InstrumentType приложения (бриф §2: BOND=1, SHARE=2, CURRENCY=3, ETF=4, FUTURES=5, OPTION=7, INDEX=9) */
export function mapInstrumentKind(kind?: string): InstrumentType {
  switch (kind) {
    case 'INSTRUMENT_TYPE_SHARE':
      return 'stock';
    case 'INSTRUMENT_TYPE_CURRENCY':
      return 'currency';
    case 'INSTRUMENT_TYPE_ETF':
      return 'etf';
    case 'INSTRUMENT_TYPE_OPTION':
      return 'option';
    case 'INSTRUMENT_TYPE_BOND':
      return 'bond';
    case 'INSTRUMENT_TYPE_INDEX':
    case 'INSTRUMENT_TYPE_COMMODITY':
      return 'index';
    case 'INSTRUMENT_TYPE_FUTURES':
    default:
      return 'future';
  }
}

function mapInstrument(raw: RawInstrument, type: InstrumentType = 'future'): Instrument {
  const apiTradeAvailable = raw.apiTradeAvailableFlag ?? true;
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
    type,
    apiTradeAvailable,
    tradable: type !== 'index' && apiTradeAvailable,
    buyAvailable: raw.buyAvailableFlag,
    sellAvailable: raw.sellAvailableFlag,
    shortEnabled: raw.shortEnabledFlag,
    forQualInvestor: raw.forQualInvestorFlag,
    weekendFlag: raw.weekendFlag,
    tradingStatus: raw.tradingStatus,
    isin: raw.isin,
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

/** Маржинальные показатели счёта (UsersService/GetMarginAttributes, ₽) */
export interface MarginAttributes {
  /** Ликвидный портфель */
  liquidPortfolio: number;
  /** Начальная маржа */
  startingMargin: number;
  /** Минимальная маржа */
  minimalMargin: number;
  /** Уровень достаточности средств */
  fundsSufficiencyLevel: number;
  /** Нехватка средств (0 — всё в порядке) */
  amountOfMissingFunds: number;
  /** Скорректированная маржа */
  correctedMargin: number;
}

/** Маржа по счёту целиком — UsersService/GetMarginAttributes (НЕ InstrumentsService, бриф §4) */
export async function getMarginAttributes(): Promise<MarginAttributes> {
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const res = await callApi<{
    liquidPortfolio?: MoneyValue;
    startingMargin?: MoneyValue;
    minimalMargin?: MoneyValue;
    fundsSufficiencyLevel?: Quotation;
    amountOfMissingFunds?: MoneyValue;
    correctedMargin?: MoneyValue;
  }>('UsersService', 'GetMarginAttributes', { accountId }, { token, sandbox });
  return {
    liquidPortfolio: quotationToNumber(res.liquidPortfolio),
    startingMargin: quotationToNumber(res.startingMargin),
    minimalMargin: quotationToNumber(res.minimalMargin),
    fundsSufficiencyLevel: quotationToNumber(res.fundsSufficiencyLevel),
    amountOfMissingFunds: quotationToNumber(res.amountOfMissingFunds),
    correctedMargin: quotationToNumber(res.correctedMargin),
  };
}

// ---------- InstrumentsService ----------

/** Общий вызов списка инструментов класса (Shares/Etfs/Currencies/Futures/Bonds — одинаковый InstrumentsRequest, бриф §1) */
async function getInstrumentsOfClass(method: string, type: InstrumentType): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: RawInstrument[] }>(
    'InstrumentsService',
    method,
    { instrumentStatus: 'INSTRUMENT_STATUS_BASE' },
    { token, sandbox, timeoutMs: 15_000 },
  );
  return (res.instruments ?? []).map((raw) => mapInstrument(raw, type));
}

/** Список фьючерсов, доступных к торговле (INSTRUMENT_STATUS_BASE) */
export async function getFutures(): Promise<Instrument[]> {
  return getInstrumentsOfClass('Futures', 'future');
}

/** Список акций, доступных к торговле */
export async function getShares(): Promise<Instrument[]> {
  return getInstrumentsOfClass('Shares', 'stock');
}

/** Список ETF/БПИФ, доступных к торговле */
export async function getEtfs(): Promise<Instrument[]> {
  return getInstrumentsOfClass('Etfs', 'etf');
}

/** Список биржевых валютных пар, доступных к торговле */
export async function getCurrencies(): Promise<Instrument[]> {
  return getInstrumentsOfClass('Currencies', 'currency');
}

/** Список облигаций, доступных к торговле (цена — в % от номинала!) */
export async function getBonds(): Promise<Instrument[]> {
  return getInstrumentsOfClass('Bonds', 'bond');
}

/**
 * Список опционов по базовому активу (InstrumentsService/OptionsBy, бриф §1).
 * Старый метод Options(InstrumentsRequest) — deprecated; фильтр по basicAssetUid ОБЯЗАТЕЛЕН,
 * список «всех опционов» без фильтра получить нельзя.
 */
export async function getOptionsBy(basicAssetUid: string): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: RawInstrument[] }>(
    'InstrumentsService',
    'OptionsBy',
    { basicAssetUid },
    { token, sandbox, timeoutMs: 15_000 },
  );
  return (res.instruments ?? []).map((raw) => mapInstrument(raw, 'option'));
}

/**
 * Индексы и товары — InstrumentsService/Indicatives (бриф §1.1).
 * Запрос без параметров. Индексы НЕ торгуются через API: tradable=false, apiTradeAvailable=false —
 * только котировки (GetCandles/GetLastPrices). UI обязан блокировать ордера.
 */
export async function getIndices(): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: RawInstrument[] }>(
    'InstrumentsService',
    'Indicatives',
    {},
    { token, sandbox, timeoutMs: 15_000 },
  );
  return (res.instruments ?? []).map((raw) => ({
    ...mapInstrument(raw, 'index'),
    apiTradeAvailable: false,
    tradable: false,
  }));
}

/** Поиск инструмента по строке (тикер/название) — только фьючерсы (legacy-поведение) */
export async function findInstrument(query: string): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: RawInstrument[] }>(
    'InstrumentsService',
    'FindInstrument',
    { query, instrumentKind: 'INSTRUMENT_TYPE_FUTURES', apiTradeAvailableFlag: true },
    { token, sandbox },
  );
  return (res.instruments ?? []).map((raw) => mapInstrument(raw, 'future'));
}

/**
 * Поиск по ВСЕМ классам сразу (FindInstrument без instrumentKind, бриф §2).
 * Ответ — InstrumentShort: instrumentKind → type, apiTradeAvailableFlag, lot.
 */
export async function findInstrumentAll(query: string): Promise<Instrument[]> {
  const { token, sandbox } = conn();
  const res = await callApi<{ instruments?: Array<RawInstrument & { instrumentKind?: string }> }>(
    'InstrumentsService',
    'FindInstrument',
    { query },
    { token, sandbox },
  );
  return (res.instruments ?? []).map((raw) => mapInstrument(raw, mapInstrumentKind(raw.instrumentKind)));
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

/** Торговый день одной площадки (TradingSchedules, бриф §7) */
export interface TradingScheduleDay {
  date: string;
  isTradingDay: boolean;
  startTime?: string;
  endTime?: string;
  eveningStartTime?: string;
  eveningEndTime?: string;
}

export interface TradingSchedule {
  exchange: string;
  days: TradingScheduleDay[];
}

/**
 * Расписание торгов (InstrumentsService/TradingSchedules).
 * exchange — необязателен (без него — все площадки); from/to — UTC.
 */
export async function getTradingSchedules(from: Date, to: Date, exchange?: string): Promise<TradingSchedule[]> {
  const { token, sandbox } = conn();
  const body: Record<string, unknown> = { from: from.toISOString(), to: to.toISOString() };
  if (exchange) body.exchange = exchange;
  const res = await callApi<{
    exchanges?: Array<{
      exchange?: string;
      days?: Array<{
        date?: string;
        isTradingDay?: boolean;
        startTime?: string;
        endTime?: string;
        eveningStartTime?: string;
        eveningEndTime?: string;
      }>;
    }>;
  }>('InstrumentsService', 'TradingSchedules', body, { token, sandbox });
  return (res.exchanges ?? []).map((e) => ({
    exchange: e.exchange ?? '',
    days: (e.days ?? []).map((d) => ({
      date: d.date ?? '',
      isTradingDay: d.isTradingDay ?? false,
      startTime: d.startTime,
      endTime: d.endTime,
      eveningStartTime: d.eveningStartTime,
      eveningEndTime: d.eveningEndTime,
    })),
  }));
}

// ---------- MarketDataService ----------

/** Торговый статус инструмента (MarketDataService/GetTradingStatus, бриф §7) */
export interface TradingStatusInfo {
  instrumentId: string;
  /** SecurityTradingStatus, напр. SECURITY_TRADING_STATUS_NORMAL_TRADING */
  tradingStatus: string;
  /** Доступны лимитные заявки */
  limitOrderAvailable: boolean;
  /** Доступны рыночные заявки */
  marketOrderAvailable: boolean;
  /** Доступны заявки «лучшая цена» (ORDER_TYPE_BESTPRICE) */
  bestpriceOrderAvailable: boolean;
  /** true → только BESTPRICE (торговля по выходным/режим дилера) */
  onlyBestPrice: boolean;
  /** Торгуется ли сейчас (NORMAL_TRADING или DEALER_NORMAL_TRADING) */
  tradingNow: boolean;
}

/** Текущий торговый статус + доступные типы заявок */
export async function getTradingStatus(instrumentId: string): Promise<TradingStatusInfo> {
  const { token, sandbox } = conn();
  const res = await callApi<{
    tradingStatus?: string;
    limitOrderAvailableFlag?: boolean;
    marketOrderAvailableFlag?: boolean;
    bestpriceOrderAvailableFlag?: boolean;
    onlyBestPrice?: boolean;
  }>('MarketDataService', 'GetTradingStatus', { instrumentId }, { token, sandbox });
  const status = res.tradingStatus ?? '';
  return {
    instrumentId,
    tradingStatus: status,
    limitOrderAvailable: res.limitOrderAvailableFlag ?? false,
    marketOrderAvailable: res.marketOrderAvailableFlag ?? false,
    bestpriceOrderAvailable: res.bestpriceOrderAvailableFlag ?? false,
    onlyBestPrice: res.onlyBestPrice ?? false,
    tradingNow:
      status === 'SECURITY_TRADING_STATUS_NORMAL_TRADING' ||
      status === 'SECURITY_TRADING_STATUS_DEALER_NORMAL_TRADING',
  };
}

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
  /** Количество лотов (НЕ штук — одинаково для всех классов, бриф §6) */
  lots: number;
  orderType: 'limit' | 'market' | 'bestprice';
  /** Цена за 1 инструмент (обязательна для limit; для фьючерсов/облигаций — в пунктах/%) */
  price?: number;
  /** Клиентский orderId для идемпотентности; если не передан — генерируется UUID v4 */
  orderId?: string;
  /**
   * Инструмент (для валидации и выбора priceType). Если передан:
   * - неторгуемый (индекс и пр.) → ошибка ДО вызова API;
   * - priceType: фьючерсы/облигации → PRICE_TYPE_POINT, остальные → PRICE_TYPE_CURRENCY.
   */
  instrument?: Instrument;
  /** Явный priceType (переопределяет вывод из instrument) */
  priceType?: 'point' | 'currency';
  /** Подтверждение маржинальной сделки (confirmMarginTrade) */
  confirmMarginTrade?: boolean;
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

function mapOrderType(t: PostOrderParams['orderType']): string {
  switch (t) {
    case 'market':
      return 'ORDER_TYPE_MARKET';
    case 'bestprice':
      return 'ORDER_TYPE_BESTPRICE';
    default:
      return 'ORDER_TYPE_LIMIT';
  }
}

/** Валидация перед вызовом PostOrder (общая для Orders/Sandbox) */
function validatePostOrder(params: PostOrderParams): void {
  const ins = params.instrument;
  if (ins) {
    if (!ins.tradable) {
      throw new Error(
        ins.type === 'index'
          ? `Индекс ${ins.ticker} не торгуется — только котировки (используйте фьючерс или ETF на индекс)`
          : `Инструмент ${ins.ticker} не торгуется через API`,
      );
    }
    if (!ins.apiTradeAvailable) throw new Error(`Инструмент ${ins.ticker} недоступен для торговли через API`);
    if (params.direction === 'long' && ins.buyAvailable === false)
      throw new Error(`Покупка ${ins.ticker} недоступна`);
    if (params.direction === 'short' && ins.sellAvailable === false)
      throw new Error(`Продажа ${ins.ticker} недоступна`);
  }
  if (params.orderType === 'limit' && params.price === undefined) {
    throw new Error('Для лимитной заявки нужна цена');
  }
}

function buildPostOrderBody(params: PostOrderParams, accountId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    instrumentId: params.instrumentId,
    quantity: String(params.lots),
    direction: params.direction === 'long' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
    accountId,
    orderType: mapOrderType(params.orderType),
    orderId: params.orderId ?? newOrderId(),
  };
  if (params.confirmMarginTrade) body.confirmMarginTrade = true;
  if (params.orderType === 'limit' && params.price !== undefined) {
    body.price = numberToQuotation(params.price);
    // PRICE_TYPE_POINT — только фьючерсы/облигации; акции/ETF/валюты — PRICE_TYPE_CURRENCY (бриф §6)
    const priceType =
      params.priceType ??
      (params.instrument && params.instrument.type !== 'future' && params.instrument.type !== 'bond'
        ? 'currency'
        : 'point');
    body.priceType = priceType === 'currency' ? 'PRICE_TYPE_CURRENCY' : 'PRICE_TYPE_POINT';
    body.timeInForce = 'TIME_IN_FORCE_DAY';
  }
  return body;
}

/** Выставить заявку (в песочнице — SandboxService/PostSandboxOrder) */
export async function postOrder(params: PostOrderParams): Promise<PostOrderResult> {
  validatePostOrder(params);
  const { token, sandbox } = conn();
  const accountId = requireAccount();
  const service = ordersService();
  const method = sandbox ? 'PostSandboxOrder' : 'PostOrder';
  const body = buildPostOrderBody(params, accountId);
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
  validatePostOrder(params);
  const { token } = conn();
  const body = buildPostOrderBody(params, accountId);
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
