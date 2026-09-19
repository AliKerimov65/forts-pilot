// Защита от маржин-колла для роботов: оценка загрузки маржи по счёту,
// уровни тревоги и расчёт допустимого числа лотов.
// Чистая логика (без API) — тестируемо. Атрибуты маржи приходят из
// getMarginAttributes (боевой контур) или demoMarginAttributes (демо).
import type { MarginAttributes } from '@/lib/tinvest/services';

/** Уровень маржинальной нагрузки */
export type MarginLevel = 'ok' | 'warn' | 'reduce' | 'emergency';

/** Пороги утилизации маржи (доли 0..1) */
export interface MarginGuardConfig {
  /** Предупреждение (дефолт 0.55) */
  warn: number;
  /** Сокращение позиции (дефолт 0.70) */
  reduce: number;
  /** Аварийный флэт + автостоп (дефолт 0.82) */
  emergency: number;
}

export const DEFAULT_MARGIN_GUARD: MarginGuardConfig = {
  warn: 0.55,
  reduce: 0.7,
  emergency: 0.82,
};

export interface MarginAssessment {
  /** Утилизация маржи 0..1 (заблокированная начальная маржа / ликвидный портфель) */
  utilization: number;
  level: MarginLevel;
  /** Свободная маржа, ₽ (сколько ещё можно заблокировать) */
  freeMargin: number;
}

/**
 * Оценка маржи: utilization = startingMargin / liquidPortfolio.
 * Если портфель нечислящийся, но есть нехватка средств — считаем утилизацию полной.
 */
export function assessMargin(attrs: MarginAttributes, cfg: MarginGuardConfig = DEFAULT_MARGIN_GUARD): MarginAssessment {
  const liquid = Math.max(0, attrs.liquidPortfolio);
  const blocked = Math.max(0, attrs.startingMargin);
  let utilization: number;
  if (liquid > 0) {
    utilization = blocked / liquid;
  } else {
    utilization = attrs.amountOfMissingFunds > 0 ? 1 : 0;
  }
  utilization = Math.min(1, Math.max(0, utilization));

  let level: MarginLevel = 'ok';
  if (utilization >= cfg.emergency) level = 'emergency';
  else if (utilization >= cfg.reduce) level = 'reduce';
  else if (utilization >= cfg.warn) level = 'warn';

  // Свободная маржа — из amountOfMarginFunds («запас маржи»); фолбэк — liquid − blocked
  const freeMargin = Number.isFinite(attrs.amountOfMarginFunds)
    ? Math.max(0, attrs.amountOfMarginFunds)
    : Math.max(0, liquid - blocked);
  return { utilization, level, freeMargin };
}

/**
 * Сколько лотов можно открыть, не нарушая порог: freeMargin * safety / ГО на лот.
 * safety — запас прочности (0..1), чтобы не упираться в границу.
 */
export function maxLotsByMargin(freeMargin: number, initialMarginPerLot: number, safety = 0.8): number {
  if (initialMarginPerLot <= 0 || freeMargin <= 0) return 0;
  const s = Math.min(1, Math.max(0, safety));
  return Math.max(0, Math.floor((freeMargin * s) / initialMarginPerLot));
}

/**
 * Лестница комиссии Т-Инвестиций за перенос непокрытой позиции (маржинальное
 * плечо) через конец торгового дня. Возвращает ₽/день.
 * <5000 ₽ → 0; далее фиксированные ступени; свыше 10 млн — ~0.07%/день.
 * Чистая функция — используется rescue-стратегией для решений до маржинального дедлайна.
 */
export function estimateCarryFee(uncoveredRub: number): number {
  const v = Math.max(0, uncoveredRub);
  if (v < 5_000) return 0;
  if (v <= 50_000) return 40;
  if (v <= 100_000) return 80;
  if (v <= 250_000) return 190;
  if (v <= 500_000) return 375;
  if (v <= 1_000_000) return 750;
  if (v <= 2_500_000) return 1_850;
  if (v <= 5_000_000) return 3_700;
  if (v <= 10_000_000) return 7_200;
  return Math.round(v * 0.0007);
}

/**
 * Демо-атрибуты маржи (демо-режим без токена): ликвидный портфель и заблокированная
 * маржа с заданной утилизацией — для проверки уровней warn/reduce/emergency.
 */
export function demoMarginAttributes(utilization = 0.35): MarginAttributes {
  const liquidPortfolio = 1_284_560.35;
  const u = Math.min(1, Math.max(0, utilization));
  const startingMargin = Math.round(liquidPortfolio * u * 100) / 100;
  return {
    liquidPortfolio,
    startingMargin,
    minimalMargin: startingMargin / 2,
    fundsSufficiencyLevel: u >= 1 ? 0 : (liquidPortfolio - startingMargin) / Math.max(1, startingMargin),
    amountOfMissingFunds: 0,
    amountOfMarginFunds: Math.max(0, liquidPortfolio - startingMargin),
    correctedMargin: startingMargin * 0.98,
  };
}
