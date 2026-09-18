// Детерминированные mock-данные FORTS (режим «Демо без токена» и fallback при ошибках сети)
// Рандомволк с фиксированным seed — данные стабильны между перезагрузками в пределах сессии.

import type { Candle, CandleInterval, Instrument, OrderBook, OrderBookLevel, Quote } from '@/types/market';
import type { EquityPoint, JournalEvent, PortfolioSummary, Position, Trade } from '@/types/trading';

/** Детерминированный PRNG (mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Хеш строки → seed */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Базовые параметры мок-инструментов */
const MOCK_SPECS: Array<{
  ticker: string;
  name: string;
  basicAsset: string;
  basePrice: number;
  minStep: number;
  lot: number;
  margin: number;
  volatility: number; // относительная волатильность на тик
}> = [
  { ticker: 'Si', name: 'Доллар США / рубль', basicAsset: 'USD', basePrice: 91250, minStep: 1, lot: 1, margin: 14200, volatility: 0.0006 },
  { ticker: 'BR', name: 'Нефть Brent', basicAsset: 'Brent', basePrice: 68.42, minStep: 0.01, lot: 1, margin: 6100, volatility: 0.0011 },
  { ticker: 'IMOEXF', name: 'Индекс МосБиржи', basicAsset: 'IMOEX', basePrice: 3212.5, minStep: 0.5, lot: 1, margin: 5800, volatility: 0.0008 },
  { ticker: 'RTSI', name: 'Индекс РТС', basicAsset: 'RTSI', basePrice: 1124.8, minStep: 0.1, lot: 1, margin: 7300, volatility: 0.001 },
  { ticker: 'GAZP', name: 'Газпром', basicAsset: 'GAZP', basePrice: 18234, minStep: 1, lot: 1, margin: 4100, volatility: 0.0009 },
];

/** Мок-фьючерсы FORTS */
export const MOCK_INSTRUMENTS: Instrument[] = MOCK_SPECS.map((s, i) => ({
  uid: `mock-uid-${s.ticker.toLowerCase()}`,
  figi: `MOCK${String(i + 1).padStart(7, '0')}`,
  ticker: s.ticker,
  classCode: 'SPBFUT',
  name: s.name,
  basicAsset: s.basicAsset,
  lot: s.lot,
  currency: 'rub',
  minPriceIncrement: s.minStep,
  expirationDate: new Date(Date.now() + 45 * 86400000).toISOString(),
  marginBuy: s.margin,
  marginSell: s.margin,
}));

const specByUid = new Map(MOCK_INSTRUMENTS.map((ins, i) => [ins.uid, MOCK_SPECS[i]]));

/** Текущие «живые» цены (мутируются тиком) */
const livePrices = new Map<string, number>(MOCK_INSTRUMENTS.map((ins, i) => [ins.uid, MOCK_SPECS[i].basePrice]));

/** Цены открытия сессии (для дельты за день) */
const sessionOpen = new Map<string, number>(
  MOCK_INSTRUMENTS.map((ins, i) => {
    const rnd = seededRandom(hashCode(ins.ticker));
    const drift = (rnd() - 0.45) * 0.012; // лёгкий сдвиг к базовой цене
    return [ins.uid, MOCK_SPECS[i].basePrice * (1 - drift)];
  }),
);

/** Шаг рандомволка для тиков */
function tickStep(uid: string): number {
  const spec = specByUid.get(uid);
  if (!spec) return 0;
  const rnd = seededRandom(hashCode(uid) + Math.floor(Date.now() / 1000));
  const cur = livePrices.get(uid) ?? spec.basePrice;
  const change = (rnd() - 0.5) * 2 * spec.volatility * cur;
  let next = cur + change;
  // округление к шагу цены
  next = Math.round(next / spec.minStep) * spec.minStep;
  next = Number(next.toFixed(6));
  livePrices.set(uid, next);
  return next;
}

/** Мок: список фьючерсов */
export function mockGetFutures(): Instrument[] {
  return MOCK_INSTRUMENTS;
}

/** Мок: поиск инструмента по строке */
export function mockFindInstrument(query: string): Instrument[] {
  const q = query.toLowerCase();
  return MOCK_INSTRUMENTS.filter(
    (i) => i.ticker.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
  );
}

/** Мок: свечи-рандомволк с seed (детерминированы по uid+interval+count) */
export function mockGetCandles(uid: string, interval: CandleInterval = 'CANDLE_INTERVAL_5_MIN', count = 120): Candle[] {
  const spec = specByUid.get(uid);
  const base = spec?.basePrice ?? 100;
  const step = spec?.minStep ?? 1;
  const vol = spec?.volatility ?? 0.001;
  const intervalMs = intervalToMs(interval);
  const rnd = seededRandom(hashCode(uid + interval + count));
  const now = Date.now();
  const start = now - count * intervalMs;

  const candles: Candle[] = [];
  let price = base;
  for (let i = 0; i < count; i++) {
    const open = price;
    const moves = 4;
    let high = open;
    let low = open;
    for (let m = 0; m < moves; m++) {
      price += (rnd() - 0.5) * 2 * vol * price;
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
    const close = Math.round(price / step) * step;
    const o = Math.round(open / step) * step;
    candles.push({
      time: start + i * intervalMs,
      open: Number(o.toFixed(6)),
      high: Number((Math.round(Math.max(o, close, high) / step) * step).toFixed(6)),
      low: Number((Math.round(Math.min(o, close, low) / step) * step).toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: Math.floor(500 + rnd() * 9500),
      isComplete: true,
    });
    price = close;
  }
  return candles;
}

function intervalToMs(interval: CandleInterval): number {
  switch (interval) {
    case 'CANDLE_INTERVAL_1_MIN':
      return 60_000;
    case 'CANDLE_INTERVAL_5_MIN':
      return 300_000;
    case 'CANDLE_INTERVAL_15_MIN':
      return 900_000;
    case 'CANDLE_INTERVAL_HOUR':
      return 3_600_000;
    case 'CANDLE_INTERVAL_DAY':
      return 86_400_000;
    case 'CANDLE_INTERVAL_WEEK':
      return 604_800_000;
  }
}

/** Мок: стакан вокруг текущей цены */
export function mockGetOrderBook(uid: string, depth = 10): OrderBook {
  const spec = specByUid.get(uid);
  const step = spec?.minStep ?? 1;
  const last = livePrices.get(uid) ?? spec?.basePrice ?? 100;
  const rnd = seededRandom(hashCode(uid + 'book') + Math.floor(Date.now() / 3000));
  const mk = (side: 'bid' | 'ask'): OrderBookLevel[] =>
    Array.from({ length: depth }, (_, i) => ({
      price: Number((last + (side === 'ask' ? 1 : -1) * step * (i + 1)).toFixed(6)),
      quantity: Math.floor(1 + rnd() * 240),
    }));
  return {
    instrumentId: uid,
    bids: mk('bid'),
    asks: mk('ask'),
    lastPrice: last,
    limitUp: Number((last * 1.05).toFixed(6)),
    limitDown: Number((last * 0.95).toFixed(6)),
    time: Date.now(),
  };
}

/** Мок: последние цены (сдвигает рандомволк — вызывать в поллинге) */
export function mockGetLastPrices(uids: string[]): Quote[] {
  return uids.map((uid) => {
    const prev = livePrices.get(uid) ?? 0;
    const price = tickStep(uid);
    const open = sessionOpen.get(uid) ?? price;
    return {
      instrumentId: uid,
      price,
      delta: price - prev,
      changePct: open !== 0 ? ((price - open) / open) * 100 : 0,
      time: Date.now(),
    };
  });
}

/** Мок: позиции */
export function mockGetPositions(): Position[] {
  return [
    {
      instrumentId: 'mock-uid-si',
      figi: 'MOCK0000001',
      ticker: 'Si',
      name: 'Доллар США / рубль',
      direction: 'long',
      lots: 2,
      avgPrice: 90880,
      currentPrice: livePrices.get('mock-uid-si') ?? 91250,
      pnl: 1240,
      margin: 28400,
    },
    {
      instrumentId: 'mock-uid-br',
      figi: 'MOCK0000002',
      ticker: 'BR',
      name: 'Нефть Brent',
      direction: 'short',
      lots: 1,
      avgPrice: 68.9,
      currentPrice: livePrices.get('mock-uid-br') ?? 68.42,
      pnl: -310,
      margin: 6100,
    },
    {
      instrumentId: 'mock-uid-imoexf',
      figi: 'MOCK0000003',
      ticker: 'IMOEXF',
      name: 'Индекс МосБиржи',
      direction: 'long',
      lots: 3,
      avgPrice: 3190,
      currentPrice: livePrices.get('mock-uid-imoexf') ?? 3212.5,
      pnl: 860,
      margin: 17400,
    },
  ];
}

/** Мок: сводка портфеля */
export function mockGetPortfolio(): PortfolioSummary {
  return {
    totalAmount: 1_284_560.35,
    cash: 312_800,
    freeMargin: 312_800,
    blockedMargin: 98_400,
    dayPnl: 12_430,
    dayPnlPct: 0.98,
    expectedYieldPct: 14.2,
  };
}

/** Мок: equity-кривая (рандомволк вверх с seed по периоду) */
export function mockGetEquitySeries(period: '1D' | '1W' | '1M' | '3M' | 'ALL'): EquityPoint[] {
  const conf: Record<string, { points: number; spanMs: number; drift: number }> = {
    '1D': { points: 48, spanMs: 10 * 3_600_000, drift: 0.0008 },
    '1W': { points: 56, spanMs: 7 * 86_400_000, drift: 0.001 },
    '1M': { points: 60, spanMs: 30 * 86_400_000, drift: 0.0012 },
    '3M': { points: 66, spanMs: 90 * 86_400_000, drift: 0.0015 },
    ALL: { points: 72, spanMs: 365 * 86_400_000, drift: 0.002 },
  };
  const { points, spanMs, drift } = conf[period];
  const rnd = seededRandom(hashCode('equity-' + period));
  const end = 1_284_560.35;
  // строим назад от текущего значения
  const values: number[] = [end];
  let v = end;
  for (let i = 1; i < points; i++) {
    v = v / (1 + drift / points + (rnd() - 0.5) * 0.006);
    values.unshift(v);
  }
  const benchStart = values[0];
  const now = Date.now();
  return values.map((equity, i) => {
    const benchRnd = seededRandom(hashCode('bench-' + period) + i);
    const benchDrift = drift * 0.4;
    const t = i / (points - 1);
    return {
      time: now - spanMs + (spanMs * i) / (points - 1),
      equity: Number(equity.toFixed(2)),
      benchmark: Number((benchStart * (1 + benchDrift * t + (benchRnd() - 0.5) * 0.004)).toFixed(2)),
    };
  });
}

/** Мок: история сделок (детерминированная) */
export function mockGetTrades(): Trade[] {
  const rnd = seededRandom(hashCode('trades'));
  const instruments = MOCK_INSTRUMENTS;
  const trades: Trade[] = [];
  let price = 0;
  const now = Date.now();
  for (let i = 0; i < 47; i++) {
    const ins = instruments[Math.floor(rnd() * instruments.length)];
    const spec = specByUid.get(ins.uid)!;
    price = spec.basePrice * (1 + (rnd() - 0.5) * 0.02);
    const isRobot = rnd() > 0.35;
    const dir: 'long' | 'short' = rnd() > 0.5 ? 'long' : 'short';
    trades.push({
      id: `mock-trade-${i}`,
      orderId: `mock-order-${i}`,
      instrumentId: ins.uid,
      ticker: ins.ticker,
      direction: dir,
      lots: 1 + Math.floor(rnd() * 3),
      price: Number((Math.round(price / spec.minStep) * spec.minStep).toFixed(6)),
      commission: Number((rnd() * 4 + 0.4).toFixed(2)),
      pnl: rnd() > 0.32 ? Number((rnd() * 900 + 60).toFixed(2)) : -Number((rnd() * 500 + 40).toFixed(2)),
      source: isRobot ? 'robot' : 'manual',
      robotId: isRobot ? `robot-${(i % 3) + 1}` : undefined,
      robotName: isRobot ? ['Si Grid Hunter', 'BR Momentum', 'IMOEX Reversal'][i % 3] : undefined,
      time: now - Math.floor(rnd() * 30) * 86_400_000 - Math.floor(rnd() * 86_400_000),
    });
  }
  return trades.sort((a, b) => b.time - a.time);
}

/** Мок: стартовая лента событий дашборда */
export function mockGetJournalEvents(): JournalEvent[] {
  const now = Date.now();
  const mk = (minAgo: number, type: JournalEvent['type'], text: string, amount?: number): JournalEvent => ({
    id: `mock-event-${minAgo}`,
    type,
    text,
    amount,
    time: now - minAgo * 60_000,
  });
  return [
    mk(2, 'trade', 'Grid-бот купил 1 лот Si по 91 242', 184),
    mk(9, 'tp', 'Сработал тейк-профит по BR (+312 ₽)', 312),
    mk(17, 'robot', 'Робот «IMOEX Reversal» запущен'),
    mk(26, 'trade', 'Продано 2 лота GAZP по 18 190', -95),
    mk(41, 'sl', 'Стоп-лосс по RTSI (−420 ₽)', -420),
    mk(58, 'system', 'Подключение к API восстановлено (42 мс)'),
    mk(73, 'trade', 'Куплено 3 лота IMOEXF по 3 190', 260),
    mk(95, 'robot', 'Робот «BR Momentum» поставлен на паузу'),
  ];
}

/** Мок: демо-роботы для дашборда (не сохраняются в стор) */
export function mockGetRobots(): import('@/types/robot').Robot[] {
  const now = Date.now();
  return [
    {
      id: 'demo-robot-1',
      name: 'Si Grid Hunter',
      strategy: 'grid',
      instrumentId: 'mock-uid-si',
      ticker: 'Si',
      status: 'running',
      params: { strategy: 'grid', grid: { upperBound: 93000, lowerBound: 89000, levels: 8, lotsPerLevel: 1 } },
      stats: { dayPnl: 4820, totalPnl: 38_400, trades: 132, winRate: 0.71, allocatedCapital: 180_000, lastStartedAt: now - 5 * 3_600_000 },
      createdAt: now - 21 * 86_400_000,
    },
    {
      id: 'demo-robot-2',
      name: 'BR Momentum',
      strategy: 'signal',
      instrumentId: 'mock-uid-br',
      ticker: 'BR',
      status: 'paused',
      params: { strategy: 'signal', signal: { signalType: 'ema_cross', timeframe: '15m', lots: 1, stopLossPts: 0.8, takeProfitPts: 1.6 } },
      stats: { dayPnl: -310, totalPnl: 12_150, trades: 58, winRate: 0.62, allocatedCapital: 90_000, lastStartedAt: now - 26 * 3_600_000 },
      createdAt: now - 40 * 86_400_000,
    },
    {
      id: 'demo-robot-3',
      name: 'IMOEX Reversal',
      strategy: 'signal',
      instrumentId: 'mock-uid-imoexf',
      ticker: 'IMOEXF',
      status: 'running',
      params: { strategy: 'signal', signal: { signalType: 'rsi', timeframe: '5m', lots: 2, stopLossPts: 25, takeProfitPts: 50 } },
      stats: { dayPnl: 1260, totalPnl: 21_780, trades: 74, winRate: 0.66, allocatedCapital: 160_000, lastStartedAt: now - 40 * 60_000 },
      createdAt: now - 14 * 86_400_000,
    },
  ];
}
