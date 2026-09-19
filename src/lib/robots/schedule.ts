// Регламент торгов Мосбиржи (FORTS) — план сессий дня, фазы, окна клиринга.
// Время — МСК. Europe/Moscow = фиксированный UTC+3 (переходы на летнее время в РФ
// отменены с 2014), поэтому считаем без внешних таймзон-библиотек: сдвигаем epoch
// на +3ч и читаем UTC-поля даты.
// При боевом токене план уточняется через getTradingSchedules (кэш на сутки),
// при ошибке/демо — встроенный дефолт FORTS.
import type { TradingSchedule, TradingScheduleDay } from '@/lib/tinvest/services';

/** Смещение МСК от UTC, мс (фиксированное +3:00) */
export const MSK_OFFSET_MS = 3 * 3_600_000;

const DAY_MS = 86_400_000;
const PLAN_CACHE_TTL_MS = 24 * 3_600_000; // кэш на сутки

// ---------- МСК-календарь ----------

export interface MskParts {
  y: number;
  mo: number; // 0..11
  d: number;
  hh: number;
  mi: number;
  ss: number;
  /** День недели МСК: 0 = воскресенье */
  dow: number;
}

/** Компоненты даты/времени в МСК */
export function mskParts(date: Date): MskParts {
  const t = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth(),
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mi: t.getUTCMinutes(),
    ss: t.getUTCSeconds(),
    dow: t.getUTCDay(),
  };
}

/** Ключ дня МСК вида 'YYYY-MM-DD' */
export function mskDateKey(date: Date): string {
  const p = mskParts(date);
  const mm = String(p.mo + 1).padStart(2, '0');
  const dd = String(p.d).padStart(2, '0');
  return `${p.y}-${mm}-${dd}`;
}

/** Момент времени МСК (hh:mm) в заданный МСК-день → Date (абсолютное время) */
export function mskAt(day: { y: number; mo: number; d: number }, hh: number, mi: number): Date {
  return new Date(Date.UTC(day.y, day.mo, day.d, hh, mi, 0) - MSK_OFFSET_MS);
}

// ---------- План сессий ----------

/** Окно клиринга (промклиринг / вечерний клиринг) */
export interface ClearingWindow {
  kind: 'day' | 'evening';
  start: Date;
  end: Date;
}

/** План торгового дня (все времена — абсолютные Date, границы по МСК) */
export interface SessionPlan {
  exchange: string;
  /** Ключ МСК-дня, на который построен план */
  dateKey: string;
  isTradingDay: boolean;
  /** Открытие основной сессии (дефолт 09:00 МСК) */
  sessionOpen: Date;
  /** Конец основной сессии = начало вечернего клиринга (дефолт 18:45) */
  dayClose: Date;
  /** Открытие вечерней сессии (дефолт 19:05) */
  eveningOpen: Date;
  /** Закрытие вечерней сессии (дефолт 23:50) */
  eveningClose: Date;
  /** Окна клиринга: day 14:00–14:05, evening 18:45–19:00 (если API дал иное — из плана) */
  clearings: ClearingWindow[];
  /** Источник плана */
  source: 'api' | 'default';
}

/** Встроенный дефолт FORTS: основная 09:00–18:45 (промклиринг 14:00–14:05), вечерняя 19:05–23:50, выходные сб/вс */
export function defaultFortsPlan(exchange: string, date: Date): SessionPlan {
  const p = mskParts(date);
  const day = { y: p.y, mo: p.mo, d: p.d };
  const isTradingDay = p.dow !== 0 && p.dow !== 6;
  const sessionOpen = mskAt(day, 9, 0);
  const dayClose = mskAt(day, 18, 45);
  const eveningOpen = mskAt(day, 19, 5);
  const eveningClose = mskAt(day, 23, 50);
  return {
    exchange,
    dateKey: mskDateKey(date),
    isTradingDay,
    sessionOpen,
    dayClose,
    eveningOpen,
    eveningClose,
    clearings: [
      { kind: 'day', start: mskAt(day, 14, 0), end: mskAt(day, 14, 5) },
      { kind: 'evening', start: dayClose, end: mskAt(day, 19, 0) },
    ],
    source: 'default',
  };
}

/** План из расписания API (TradingSchedules): маппинг интервалов, клиринги — дефолтные вокруг конца основной сессии */
export function planFromApi(exchange: string, date: Date, days: TradingScheduleDay[]): SessionPlan {
  const fallback = defaultFortsPlan(exchange, date);
  const key = fallback.dateKey;
  // API отдаёт день как UTC-полночь той же календарной даты МСК — сравниваем по префиксу даты
  const row = days.find((d) => d.date.slice(0, 10) === key);
  if (!row) return fallback;
  if (!row.isTradingDay || !row.startTime || !row.endTime) {
    return { ...fallback, isTradingDay: false, source: 'api' };
  }
  const p = mskParts(date);
  const day = { y: p.y, mo: p.mo, d: p.d };
  const sessionOpen = new Date(row.startTime);
  const dayClose = new Date(row.endTime);
  const eveningOpen = row.eveningStartTime ? new Date(row.eveningStartTime) : fallback.eveningOpen;
  const eveningClose = row.eveningEndTime ? new Date(row.eveningEndTime) : fallback.eveningClose;
  return {
    exchange,
    dateKey: key,
    isTradingDay: true,
    sessionOpen,
    dayClose,
    eveningOpen,
    eveningClose,
    clearings: [
      // Промклиринг API не отдаёт — держим стандартное окно 14:00–14:05 МСК
      { kind: 'day', start: mskAt(day, 14, 0), end: mskAt(day, 14, 5) },
      // Вечерний клиринг: конец основной сессии + 15 минут (18:45–19:00 при дефолте)
      { kind: 'evening', start: dayClose, end: new Date(dayClose.getTime() + 15 * 60_000) },
    ],
    source: 'api',
  };
}

// ---------- Кэш планов (на сутки) ----------

interface PlanCacheEntry {
  plan: SessionPlan;
  fetchedAt: number;
}
const planCache = new Map<string, PlanCacheEntry>();

/** Сбросить кэш планов (тесты/принудительное обновление) */
export function resetSessionPlanCache(): void {
  planCache.clear();
}

/**
 * План сессий на день. При переданном `api` (боевой токен) пробует
 * getTradingSchedules и мапит интервалы; при ошибке/отсутствии api (демо) — дефолт.
 * Кэш: ключ exchange+МСК-день, TTL сутки.
 */
export async function getSessionPlan(
  exchange: string,
  date: Date,
  api?: (exchange: string, from: Date, to: Date) => Promise<TradingSchedule[]>,
): Promise<SessionPlan> {
  const key = `${exchange}:${mskDateKey(date)}`;
  const cached = planCache.get(key);
  if (cached && cached.plan.dateKey === mskDateKey(date) && date.getTime() - cached.fetchedAt < PLAN_CACHE_TTL_MS) {
    return cached.plan;
  }

  let plan = defaultFortsPlan(exchange, date);
  if (api) {
    try {
      // Запрашиваем с запасом ±1 день, чтобы поймать праздники/переносы
      const from = new Date(date.getTime() - DAY_MS);
      const to = new Date(date.getTime() + DAY_MS);
      const schedules = await api(exchange, from, to);
      const sched =
        schedules.find((s) => s.exchange.toUpperCase().includes(exchange.toUpperCase())) ?? schedules[0];
      if (sched) plan = planFromApi(sched.exchange || exchange, date, sched.days);
    } catch {
      // Ошибка API — работаем по встроенному регламенту
      plan = defaultFortsPlan(exchange, date);
    }
  }

  planCache.set(key, { plan, fetchedAt: date.getTime() });
  return plan;
}

// ---------- Фазы сессии ----------

export type SessionPhase = 'pre_open' | 'main' | 'clearing_day' | 'clearing_evening' | 'evening' | 'closed';

export interface SessionPhaseInfo {
  phase: SessionPhase;
  /** Ближайшая граница смены фазы */
  nextEventAt: Date;
  /** мс до nextEventAt */
  msToNext: number;
  sessionOpen: Date;
  dayClose: Date;
}

/** Открытие основной сессии ближайшего следующего торгового дня (по дефолтному регламенту) */
function nextTradingOpen(after: Date): Date {
  for (let i = 1; i <= 7; i++) {
    const candidate = defaultFortsPlan('MOEX', new Date(after.getTime() + i * DAY_MS));
    if (candidate.isTradingDay) return candidate.sessionOpen;
  }
  return new Date(after.getTime() + DAY_MS);
}

/** Текущая фаза сессии по плану + обратный отсчёт до следующей границы */
export function getSessionPhase(now: Date, plan: SessionPlan): SessionPhaseInfo {
  const base = { sessionOpen: plan.sessionOpen, dayClose: plan.dayClose };
  const t = now.getTime();

  const finish = (phase: SessionPhase, nextEventAt: Date): SessionPhaseInfo => ({
    phase,
    nextEventAt,
    msToNext: Math.max(0, nextEventAt.getTime() - t),
    ...base,
  });

  if (!plan.isTradingDay) {
    return finish('closed', nextTradingOpen(now));
  }

  const dayClearing = plan.clearings.find((c) => c.kind === 'day');

  if (t < plan.sessionOpen.getTime()) return finish('pre_open', plan.sessionOpen);

  if (dayClearing && t >= dayClearing.start.getTime() && t < dayClearing.end.getTime()) {
    return finish('clearing_day', dayClearing.end);
  }

  if (t < plan.dayClose.getTime()) {
    // Основная сессия: до промклиринга или после него
    const next =
      dayClearing && t < dayClearing.start.getTime() ? dayClearing.start : plan.dayClose;
    return finish('main', next);
  }

  if (t < plan.eveningOpen.getTime()) {
    return finish('clearing_evening', plan.eveningOpen);
  }

  if (t < plan.eveningClose.getTime()) {
    return finish('evening', plan.eveningClose);
  }

  return finish('closed', nextTradingOpen(now));
}

/**
 * Окно клиринга рядом (за watchMin минут до начала или после конца) — для клиринг-детектора.
 * Возвращает окно или null.
 */
export function nearClearingWindow(plan: SessionPlan, now: Date, watchMin: number): ClearingWindow | null {
  const watchMs = watchMin * 60_000;
  const t = now.getTime();
  for (const c of plan.clearings) {
    if (t >= c.start.getTime() - watchMs && t <= c.end.getTime() + watchMs) return c;
  }
  return null;
}
