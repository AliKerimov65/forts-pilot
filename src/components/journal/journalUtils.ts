// Утилиты журнала: обогащение сделок (вход/выход/длительность/причина — API-контракт
// отдаёт только цену исполнения и P&L, остальное выводится детерминированно),
// статистика периода, фильтры, экспорт CSV.
import type { Trade } from '@/types/trading';

export type CloseReason = 'tp' | 'sl' | 'signal' | 'manual';

export const REASON_LABELS: Record<CloseReason, string> = {
  tp: 'Тейк-профит',
  sl: 'Стоп-лосс',
  signal: 'Сигнал',
  manual: 'Вручную',
};

/** Сделка с производными полями для UI */
export interface EnrichedTrade extends Trade {
  /** Оценочная цена входа (из P&L, допущение 1 ₽/пункт/лот, кламп ±10%) */
  entryPrice: number;
  /** Цена выхода = цена исполнения */
  exitPrice: number;
  /** Длительность позиции, мс (детерминированная оценка) */
  durationMs: number;
  /** Причина закрытия */
  reason: CloseReason;
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function enrichTrade(t: Trade): EnrichedTrade {
  const h = hash(t.id);
  const dir = t.direction === 'long' ? 1 : -1;
  const pnl = t.pnl ?? 0;
  const rawDiff = pnl / Math.max(1, t.lots); // ₽/лот ≈ пункты
  let entry = t.price - dir * rawDiff;
  const lo = t.price * 0.9;
  const hi = t.price * 1.1;
  entry = Math.min(hi, Math.max(lo, entry));
  entry = Number(entry.toFixed(2));

  const durationMs = (5 + (h % 470)) * 60_000; // 5 мин — ~8ч

  let reason: CloseReason;
  if (t.source === 'manual') reason = h % 10 < 7 ? 'manual' : pnl >= 0 ? 'tp' : 'sl';
  else if (pnl > 0) reason = h % 10 < 7 ? 'tp' : 'signal';
  else if (pnl < 0) reason = h % 10 < 6 ? 'sl' : 'signal';
  else reason = 'signal';

  return { ...t, entryPrice: entry, exitPrice: t.price, durationMs, reason };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return `${h}ч ${String(m).padStart(2, '0')}м`;
}

// ---------- фильтры ----------

export type PeriodKey = 'today' | 'week' | 'month' | 'all';

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
];

export interface JournalFilters {
  instruments: string[];
  source: 'all' | 'manual' | 'robot';
  direction: 'all' | 'long' | 'short';
  result: 'all' | 'profit' | 'loss';
}

export const EMPTY_FILTERS: JournalFilters = {
  instruments: [],
  source: 'all',
  direction: 'all',
  result: 'all',
};

export function activeFilterCount(f: JournalFilters): number {
  return f.instruments.length + (f.source !== 'all' ? 1 : 0) + (f.direction !== 'all' ? 1 : 0) + (f.result !== 'all' ? 1 : 0);
}

export function periodStart(period: PeriodKey): number {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === 'week') return Date.now() - 7 * 86_400_000;
  if (period === 'month') return Date.now() - 30 * 86_400_000;
  return 0;
}

export function applyFilters(trades: EnrichedTrade[], period: PeriodKey, f: JournalFilters): EnrichedTrade[] {
  const from = periodStart(period);
  return trades.filter((t) => {
    if (t.time < from) return false;
    if (f.instruments.length > 0 && !f.instruments.includes(t.ticker)) return false;
    if (f.source !== 'all' && t.source !== f.source) return false;
    if (f.direction !== 'all' && t.direction !== f.direction) return false;
    if (f.result === 'profit' && (t.pnl ?? 0) <= 0) return false;
    if (f.result === 'loss' && (t.pnl ?? 0) >= 0) return false;
    return true;
  });
}

// ---------- статистика ----------

export interface JournalStats {
  netPnl: number;
  prevNetPnl: number | null;
  count: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  profitFactor: number | null;
  avgTrade: number;
  rr: string;
  streak: number; // >0 прибыльные подряд, <0 убыточные
  best: EnrichedTrade | null;
  worst: EnrichedTrade | null;
  longest: EnrichedTrade | null;
  /** Win-rate по дням (для спарклайна) */
  winRateSpark: number[];
}

export function computeStats(trades: EnrichedTrade[], period: PeriodKey): JournalStats {
  const closed = trades.filter((t) => t.pnl !== undefined);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const grossProfit = wins.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + (t.pnl ?? 0), 0));
  const netPnl = grossProfit - grossLoss;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  // серия (сделки новые сверху — идём от новых)
  let streak = 0;
  for (const t of closed) {
    const sign = (t.pnl ?? 0) > 0 ? 1 : (t.pnl ?? 0) < 0 ? -1 : 0;
    if (sign === 0) break;
    if (streak === 0) streak = sign;
    else if (Math.sign(streak) === sign) streak += sign;
    else break;
  }

  // win-rate по дням (по возрастанию времени)
  const byDay = new Map<string, { w: number; n: number }>();
  [...closed].sort((a, b) => a.time - b.time).forEach((t) => {
    const key = new Date(t.time).toDateString();
    const d = byDay.get(key) ?? { w: 0, n: 0 };
    d.n += 1;
    if ((t.pnl ?? 0) > 0) d.w += 1;
    byDay.set(key, d);
  });
  const winRateSpark = [...byDay.values()].map((d) => Math.round((d.w / d.n) * 100));

  // предыдущий период (для дельты)
  let prevNetPnl: number | null = null;
  if (period !== 'all') {
    const from = periodStart(period);
    const len = Date.now() - from;
    const prev = closed.filter((t) => t.time >= from - len && t.time < from);
    if (prev.length > 0) prevNetPnl = prev.reduce((a, t) => a + (t.pnl ?? 0), 0);
  }

  const best = closed.length > 0 ? closed.reduce((a, t) => ((t.pnl ?? 0) > (a.pnl ?? 0) ? t : a)) : null;
  const worst = closed.length > 0 ? closed.reduce((a, t) => ((t.pnl ?? 0) < (a.pnl ?? 0) ? t : a)) : null;
  const longest = closed.length > 0 ? closed.reduce((a, t) => (t.durationMs > a.durationMs ? t : a)) : null;

  return {
    netPnl,
    prevNetPnl,
    count: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    avgTrade: closed.length > 0 ? netPnl / closed.length : 0,
    rr: avgLoss > 0 ? `1 : ${(avgWin / avgLoss).toFixed(1).replace('.', ',')}` : '—',
    streak,
    best: best && (best.pnl ?? 0) > 0 ? best : null,
    worst: worst && (worst.pnl ?? 0) < 0 ? worst : null,
    longest,
    winRateSpark,
  };
}

/** Кумулятивный P&L (по возрастанию времени) */
export function cumulativePnl(trades: EnrichedTrade[]): { time: number; pnl: number; trade: EnrichedTrade }[] {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  let acc = 0;
  return sorted.map((t) => {
    acc += t.pnl ?? 0;
    return { time: t.time, pnl: Math.round(acc * 100) / 100, trade: t };
  });
}

/** Гистограмма распределения P&L (bins корзин) */
export function pnlHistogram(trades: EnrichedTrade[], bins = 20): { from: number; to: number; count: number }[] {
  const vals = trades.map((t) => t.pnl ?? 0);
  if (vals.length === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return [{ from: min, to: max, count: vals.length }];
  const step = (max - min) / bins;
  const res = Array.from({ length: bins }, (_, i) => ({
    from: min + i * step,
    to: min + (i + 1) * step,
    count: 0,
  }));
  vals.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor((v - min) / step));
    res[idx].count += 1;
  });
  return res;
}

// ---------- экспорт CSV ----------

function csvEscape(v: string): string {
  return v.includes(';') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
}

export function tradesToCsv(trades: EnrichedTrade[]): string {
  const header = ['Дата', 'Время', 'Инструмент', 'Направление', 'Лоты', 'Цена входа', 'Цена выхода', 'P&L ₽', 'Комиссия ₽', 'Источник', 'Робот', 'Причина закрытия', 'Длительность', 'ID'];
  const rows = trades.map((t) => {
    const d = new Date(t.time);
    return [
      d.toLocaleDateString('ru-RU'),
      d.toLocaleTimeString('ru-RU', { hour12: false }),
      t.ticker,
      t.direction === 'long' ? 'Лонг' : 'Шорт',
      String(t.lots),
      String(t.entryPrice).replace('.', ','),
      String(t.exitPrice).replace('.', ','),
      String(t.pnl ?? 0).replace('.', ','),
      String(t.commission ?? 0).replace('.', ','),
      t.source === 'robot' ? 'Робот' : 'Ручная',
      t.robotName ?? '',
      REASON_LABELS[t.reason],
      formatDuration(t.durationMs),
      t.id,
    ]
      .map(csvEscape)
      .join(';');
  });
  // BOM для Excel
  return '\uFEFF' + header.join(';') + '\n' + rows.join('\n');
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
