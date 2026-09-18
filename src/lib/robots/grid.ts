// Grid-стратегия: сетка уровней между lowerBound и upperBound.
// Модель исполнения — триггерная: цена пересекает уровень → рыночный ордер
// (эквивалент лимитной сетки по марк-цене; лимитные заявки не держим на бирже,
// чтобы не управлять их жизненным циклом). Чистая логика, без API — тестируемо.
import type { GridParams } from '@/types/robot';

export interface GridLevel {
  price: number;
  /** По этому уровню куплено (ждём продажи выше) */
  holding: boolean;
}

/** Рантайм-состояние grid-робота (живёт в памяти движка) */
export interface GridRuntime {
  levels: GridLevel[];
  /** Открытые лоты сетки (лонг-инвентарь) */
  positionLots: number;
  /** Средняя цена входа инвентаря */
  avgEntry: number;
  /** Цена предыдущего тика (для детекции пересечений) */
  lastPrice: number | null;
}

export interface GridAction {
  type: 'buy' | 'sell';
  lots: number;
  /** Цена уровня-триггера */
  levelPrice: number;
  reason: string;
  /** Реализованный P&L (только для sell), пункты ≈ ₽ на лот */
  pnl?: number;
}

export interface GridTickResult {
  actions: GridAction[];
  /** Сетка была перестроена (цена ушла за границы) */
  rebuilt: boolean;
  /** Новые границы после перестройки (для записи в робота) */
  bounds?: { lowerBound: number; upperBound: number };
}

/** Равномерные уровни сетки от lower до upper включительно */
export function buildGridLevels(lowerBound: number, upperBound: number, count: number): number[] {
  const n = Math.max(2, Math.round(count));
  const lo = Math.min(lowerBound, upperBound);
  const hi = Math.max(lowerBound, upperBound);
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => lo + step * i);
}

/** Шаг сетки (расстояние между соседними уровнями) */
export function gridStep(params: GridParams): number {
  if (params.levels < 2) return 0;
  return Math.abs(params.upperBound - params.lowerBound) / (params.levels - 1);
}

export function initGridRuntime(params: GridParams, currentPrice: number): GridRuntime {
  return {
    levels: buildGridLevels(params.lowerBound, params.upperBound, params.levels).map((price) => ({
      price,
      holding: false,
    })),
    positionLots: 0,
    avgEntry: 0,
    lastPrice: currentPrice,
  };
}

/**
 * Тик grid-стратегии.
 * - Цена пересекла уровень вниз → покупка lotsPerLevel (уровень помечается holding).
 * - Цена пересекла уровень вверх и есть инвентарь → продажа lotsPerLevel (FIFO: снимаем
 *   самый нижний holding-уровень), P&L от средней входа.
 * - Цена за границами: rebuild=true → сдвиг сетки (центр = текущая цена, ширина прежняя),
 *   инвентарь сохраняется; rebuild=false → ждём возврата.
 */
export function gridTick(
  rt: GridRuntime,
  params: GridParams,
  price: number,
  opts: { rebuild: boolean },
): GridTickResult {
  const result: GridTickResult = { actions: [], rebuilt: false };
  const prev = rt.lastPrice;
  rt.lastPrice = price;
  if (prev === null || prev === price) return result;

  const lo = Math.min(params.lowerBound, params.upperBound);
  const hi = Math.max(params.lowerBound, params.upperBound);

  // Выход за границы — авто-сдвиг сетки
  if (price < lo || price > hi) {
    if (opts.rebuild) {
      const width = hi - lo;
      const half = width / 2;
      const newLo = price - half;
      const newHi = price + half;
      rt.levels = buildGridLevels(newLo, newHi, rt.levels.length).map((p) => ({ price: p, holding: false }));
      result.rebuilt = true;
      result.bounds = { lowerBound: newLo, upperBound: newHi };
    }
    return result;
  }

  const lots = Math.max(1, params.lotsPerLevel);

  for (let i = 0; i < rt.levels.length; i++) {
    const level = rt.levels[i];
    const crossedDown = prev > level.price && price <= level.price;
    const crossedUp = prev < level.price && price >= level.price;

    if (crossedDown && !level.holding) {
      // Покупка на просадке до уровня
      level.holding = true;
      rt.avgEntry =
        rt.positionLots > 0
          ? (rt.avgEntry * rt.positionLots + level.price * lots) / (rt.positionLots + lots)
          : level.price;
      rt.positionLots += lots;
      result.actions.push({
        type: 'buy',
        lots,
        levelPrice: level.price,
        reason: `Уровень сетки ${formatPts(level.price)}`,
      });
    } else if (crossedUp && rt.positionLots >= lots) {
      // Продажа на отскоке: закрываем самую нижнюю удерживаемую покупку
      const idx = rt.levels.findIndex((l) => l.holding);
      if (idx !== -1) {
        rt.levels[idx].holding = false;
        rt.positionLots -= lots;
        const pnl = (level.price - rt.avgEntry) * lots;
        if (rt.positionLots === 0) rt.avgEntry = 0;
        result.actions.push({
          type: 'sell',
          lots,
          levelPrice: level.price,
          pnl,
          reason: `Уровень сетки ${formatPts(level.price)}`,
        });
      }
    }
  }
  return result;
}

/** Стоп/тейк по инвентарю сетки (в % от средней входа). null — не сработало. */
export function gridInventoryGuard(
  rt: GridRuntime,
  price: number,
  stopLossPct?: number,
  takeProfitPct?: number,
): GridAction | null {
  if (rt.positionLots <= 0 || rt.avgEntry <= 0) return null;
  const changePct = ((price - rt.avgEntry) / rt.avgEntry) * 100;
  if (stopLossPct && stopLossPct > 0 && changePct <= -stopLossPct) {
    const lots = rt.positionLots;
    const pnl = (price - rt.avgEntry) * lots;
    rt.levels.forEach((l) => (l.holding = false));
    rt.positionLots = 0;
    rt.avgEntry = 0;
    return { type: 'sell', lots, levelPrice: price, pnl, reason: `Стоп-лосс сетки ${stopLossPct}%` };
  }
  if (takeProfitPct && takeProfitPct > 0 && changePct >= takeProfitPct) {
    const lots = rt.positionLots;
    const pnl = (price - rt.avgEntry) * lots;
    rt.levels.forEach((l) => (l.holding = false));
    rt.positionLots = 0;
    rt.avgEntry = 0;
    return { type: 'sell', lots, levelPrice: price, pnl, reason: `Тейк-профит сетки ${takeProfitPct}%` };
  }
  return null;
}

function formatPts(v: number): string {
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
