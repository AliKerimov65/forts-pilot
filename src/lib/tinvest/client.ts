// Низкоуровневый fetch-клиент T-Invest API (по брифу tinvest-api-brief.md)
// - Базовые URL prod/sandbox (хосты tbank.ru)
// - Все методы POST, Authorization: Bearer <token>
// - Типы Quotation/MoneyValue (units string + nano), конвертация
// - Ошибки 401/429/5xx, таймауты, измерение latency

/** REST-базовые URL (бриф §1) */
export const BASE_PROD = 'https://invest-public-api.tbank.ru/rest';
export const BASE_SANDBOX = 'https://sandbox-invest-public-api.tbank.ru/rest';

/** Префикс контрактов (бриф §1) */
const CONTRACT = 'tinkoff.public.invest.api.contract.v1';

/** Тип Quotation: сумма без валюты (units — int64 строкой!) */
export interface Quotation {
  units: string;
  nano: number;
}

/** MoneyValue = Quotation + currency */
export interface MoneyValue extends Quotation {
  currency: string;
}

/** Quotation/MoneyValue → число: Number(units) + nano/1e9 (бриф §6) */
export function quotationToNumber(q: Quotation | MoneyValue | undefined | null): number {
  if (!q) return 0;
  return Number(q.units) + q.nano / 1e9;
}

/** Число → Quotation */
export function numberToQuotation(value: number): Quotation {
  const units = Math.trunc(value);
  const nano = Math.round((value - units) * 1e9);
  return { units: String(units), nano };
}

/** Число → MoneyValue */
export function numberToMoneyValue(value: number, currency = 'rub'): MoneyValue {
  return { ...numberToQuotation(value), currency };
}

/** Ошибка API */
export class ApiError extends Error {
  /** HTTP-статус (0 — сетевая ошибка/таймаут) */
  status: number;
  /** Тело ответа (code/message/description Т-Инвестиций), если есть */
  code?: number;
  description?: string;
  /** x-tracking-id для диагностики */
  trackingId?: string;

  constructor(message: string, status: number, opts?: { code?: number; description?: string; trackingId?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = opts?.code;
    this.description = opts?.description;
    this.trackingId = opts?.trackingId;
  }
}

/** Метрика последнего запроса — подписывается стор соединения */
export type LatencyListener = (latencyMs: number, ok: boolean) => void;
let latencyListener: LatencyListener | null = null;
export function setLatencyListener(fn: LatencyListener | null): void {
  latencyListener = fn;
}

export interface RequestOptions {
  /** Токен доступа */
  token: string;
  /** sandbox-контур */
  sandbox?: boolean;
  /** Таймаут, мс (по умолчанию 10000) */
  timeoutMs?: number;
  /** Число повторов при 429/5xx (по умолчанию 1) */
  retries?: number;
}

/**
 * Вызов REST-метода T-Invest API.
 * Полный URL: {BASE}/rest/tinkoff.public.invest.api.contract.v1.{Service}/{Method}
 */
export async function callApi<TResponse = unknown>(
  service: string,
  method: string,
  body: Record<string, unknown>,
  opts: RequestOptions,
): Promise<TResponse> {
  const base = opts.sandbox ? BASE_SANDBOX : BASE_PROD;
  const url = `${base}/${CONTRACT}.${service}/${method}`;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = (opts.retries ?? 1) + 1;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // backoff перед повтором при 429/5xx
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        // keepalive: запрос завершится даже при выгрузке страницы (PWA-фон)
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.token}`,
          'x-app-name': 'forts_pilot_pwa',
        },
        body: JSON.stringify(body),
      });
      const latency = performance.now() - started;

      if (!response.ok) {
        latencyListener?.(latency, false);
        let errBody: { code?: number; message?: string; description?: string } = {};
        try {
          errBody = await response.json();
        } catch {
          /* тело не JSON */
        }
        const trackingId = response.headers.get('x-tracking-id') ?? undefined;
        const err = new ApiError(
          errBody.message || `HTTP ${response.status}`,
          response.status,
          { code: errBody.code, description: errBody.description, trackingId },
        );
        // 401 — токен невалиден, повтор бессмысленен; 429/5xx — повторяем
        if (response.status !== 429 && response.status < 500) throw err;
        lastError = err;
        continue;
      }

      latencyListener?.(latency, true);
      return (await response.json()) as TResponse;
    } catch (e) {
      if (e instanceof ApiError) {
        lastError = e;
        if (e.status !== 429 && e.status < 500) throw e;
        continue;
      }
      // Таймаут / сетевая ошибка
      const err = new ApiError(
        e instanceof DOMException && e.name === 'AbortError' ? 'Превышен таймаут запроса' : 'Сетевая ошибка',
        0,
      );
      latencyListener?.(performance.now() - started, false);
      lastError = err;
      // сетевые ошибки тоже повторяем один раз
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Прогрев соединения с API-хостами: лёгкий no-cors запрос устанавливает
 * TLS/HTTP2-сессию заранее, чтобы первый боевой вызов не платил за handshake.
 * Ошибки игнорируются — это чисто оптимизация.
 */
export function warmUpConnection(): void {
  for (const base of [BASE_PROD, BASE_SANDBOX]) {
    // origin без /rest — достаточно для установки TLS-сессии к хосту
    fetch(new URL(base).origin, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', keepalive: true }).catch(
      () => {},
    );
  }
}

/** Генерация UUID v4 для orderId (идемпотентность, бриф §10.4) */
export function newOrderId(): string {
  return crypto.randomUUID();
}

/** Маскирование токена для отображения: t.abc…xyz */
export function maskToken(token: string): string {
  if (token.length <= 8) return '••••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
