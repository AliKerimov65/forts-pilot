// Локальные данные/хелперы мониторинга: расширенный ордер (тип заявки + источник),
// mock-ордера для демо-режима (в mock.ts ордеров нет, а lib/tinvest менять нельзя),
// persist-стор SL/TP по инструментам.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Order, Position } from '@/types/trading';
import type { Instrument } from '@/types/market';
import { formatInstrumentPrice } from '@/lib/tinvest/instruments';
import { formatNumber } from '@/lib/format';
import { findInstrumentMeta } from '@/components/dashboard/instrumentMeta';

/** Вид заявки для UI: лимитная / стоп / тейк */
export type OrderKind = 'limit' | 'stop' | 'take';

/** Ордер с UI-полями (тип заявки и источник не приходят из API-контракта) */
export interface MonitorOrder extends Order {
  kind: OrderKind;
  source: 'manual' | 'robot';
  robotName?: string;
}

/** Маппинг API-ордера в UI-ордер (API не отдаёт стопы/источник — считаем лимитными ручными) */
export function toMonitorOrder(o: Order): MonitorOrder {
  return { ...o, kind: o.orderType === 'limit' ? 'limit' : 'stop', source: 'manual' };
}

/** Демо-ордера (активные заявки) */
export function mockMonitorOrders(): MonitorOrder[] {
  const now = Date.now();
  const mk = (
    id: string,
    ticker: string,
    instrumentId: string,
    kind: OrderKind,
    direction: 'long' | 'short',
    price: number,
    lotsRequested: number,
    lotsExecuted: number,
    minAgo: number,
    source: 'manual' | 'robot',
    robotName?: string,
  ): MonitorOrder => ({
    orderId: id,
    accountId: 'demo-account',
    instrumentId,
    ticker,
    direction,
    lotsRequested,
    lotsExecuted,
    price,
    orderType: 'limit',
    status: lotsExecuted > 0 ? 'partially_filled' : 'new',
    time: now - minAgo * 60_000,
    kind,
    source,
    robotName,
  });
  return [
    mk('demo-ord-1', 'Si', 'mock-uid-si', 'limit', 'long', 90_400, 1, 0, 3, 'robot', 'Si Grid Hunter'),
    mk('demo-ord-2', 'Si', 'mock-uid-si', 'limit', 'long', 89_950, 1, 0, 11, 'robot', 'Si Grid Hunter'),
    mk('demo-ord-3', 'Si', 'mock-uid-si', 'stop', 'short', 89_200, 2, 0, 24, 'robot', 'Si Grid Hunter'),
    mk('demo-ord-4', 'BR', 'mock-uid-br', 'limit', 'short', 69.1, 1, 0, 18, 'manual'),
    mk('demo-ord-5', 'IMOEXF', 'mock-uid-imoexf', 'take', 'short', 3_260, 2, 1, 32, 'robot', 'IMOEX Reversal'),
    mk('demo-ord-6', 'GAZP', 'mock-uid-gazp', 'limit', 'long', 17_950, 2, 1, 47, 'manual'),
    mk('demo-ord-7', 'RTSI', 'mock-uid-rtsi', 'stop', 'short', 1_098, 1, 0, 65, 'manual'),
  ];
}

// ---------- SL/TP по позициям (локальный persist-стор) ----------

export interface SlTp {
  sl?: number;
  tp?: number;
}

interface SlTpState {
  map: Record<string, SlTp>;
  setSlTp: (instrumentId: string, v: SlTp) => void;
}

export const useSlTpStore = create<SlTpState>()(
  persist(
    (set) => ({
      map: {},
      setSlTp: (instrumentId, v) => set((s) => ({ map: { ...s.map, [instrumentId]: v } })),
    }),
    { name: 'forts-pilot-sltp' },
  ),
);

function round2(v: number): number {
  return Number(v.toFixed(2));
}

/** Дефолтные защитные уровни, если пользователь не задавал: SL −1,2% / TP +2,5% от средней */
export function defaultSlTp(p: Position): Required<SlTp> {
  const dir = p.direction === 'long' ? 1 : -1;
  return {
    sl: round2(p.avgPrice * (1 - dir * 0.012)),
    tp: round2(p.avgPrice * (1 + dir * 0.025)),
  };
}

/** Эффективные SL/TP позиции: пользовательские либо дефолтные */
export function effectiveSlTp(p: Position, map: Record<string, SlTp>): Required<SlTp> {
  const def = defaultSlTp(p);
  const own = map[p.instrumentId];
  return { sl: own?.sl ?? def.sl, tp: own?.tp ?? def.tp };
}

/** Процент до уровня от текущей цены */
export function pctToLevel(currentPrice: number, level: number): number {
  if (currentPrice === 0) return 0;
  return (Math.abs(level - currentPrice) / currentPrice) * 100;
}

/** Демо-источники позиций (API не отдаёт источник) */
const DEMO_SOURCE: Record<string, { source: 'robot' | 'manual'; robotName?: string }> = {
  'mock-uid-si': { source: 'robot', robotName: 'Si Grid Hunter' },
  'mock-uid-imoexf': { source: 'robot', robotName: 'IMOEX Reversal' },
};

/** Источник позиции для UI (робот/ручная) */
export function positionSource(p: Position): { source: 'robot' | 'manual'; robotName?: string } {
  return DEMO_SOURCE[p.instrumentId] ?? { source: 'manual' };
}

/** Примерный P&L позиции в ₽ (допущение 1 ₽ / пункт / лот — для демо-дрейфа) */
export function approxPnl(p: Position): number {
  const dir = p.direction === 'long' ? 1 : -1;
  return Math.round((p.currentPrice - p.avgPrice) * p.lots * dir);
}

/** Нереализованный P&L позиции в % от средней цены входа */
export function pnlPct(p: Position): number {
  if (p.avgPrice === 0) return 0;
  const dir = p.direction === 'long' ? 1 : -1;
  return ((p.currentPrice - p.avgPrice) / p.avgPrice) * dir * 100;
}

// ---------- Классы инструментов ----------

/** Метаданные инструмента позиции (класс, шаг цены, флаги) по uid */
export function positionInstrument(p: Position): Instrument | undefined {
  return findInstrumentMeta(p.instrumentId);
}

/** Цена позиции с точностью по minPriceIncrement класса (облигации — в % от номинала) */
export function formatPositionPrice(p: Position, v: number): string {
  const meta = positionInstrument(p);
  return meta ? formatInstrumentPrice(meta, v) : formatNumber(v);
}

/** Облигация? Цены облигаций — в % от номинала (бриф §4) */
export function isBondPosition(p: Position): boolean {
  return positionInstrument(p)?.type === 'bond';
}
