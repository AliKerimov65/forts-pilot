// Поллинг-хук для котировок/позиций (WS не подтверждён — только REST-поллинг, бриф §10.3)
// Пауза, когда вкладка скрыта (document.visibilityState).
import { useEffect, useRef } from 'react';

export interface PollingOptions {
  /** Интервал, мс (дефолты: 3000 цены, 5000 позиции) */
  intervalMs: number;
  /** Включён ли поллинг */
  enabled?: boolean;
  /** Выполнить сразу при монтировании (по умолчанию true) */
  immediate?: boolean;
}

export const POLLING_DEFAULTS = {
  /** Котировки — 3с */
  prices: 3000,
  /** Позиции/портфель — 5с */
  positions: 5000,
} as const;

/**
 * usePolling(fetcher, intervalMs) — периодический вызов async-фетчера.
 * Ошибки фетчера не роняют поллинг (передаются в onError).
 */
export function usePolling(
  fetcher: () => Promise<void> | void,
  options: PollingOptions,
  onError?: (e: unknown) => void,
): void {
  const { intervalMs, enabled = true, immediate = true } = options;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        // вкладка скрыта — пропускаем тик, перепланируем
        timer = setTimeout(tick, intervalMs);
        return;
      }
      if (running) return; // предыдущий запрос ещё идёт
      running = true;
      try {
        await fetcherRef.current();
      } catch (e) {
        onErrorRef.current?.(e);
      } finally {
        running = false;
        if (!cancelled) timer = setTimeout(tick, intervalMs);
      }
    };

    if (immediate) void tick();
    else timer = setTimeout(tick, intervalMs);

    // При возвращении на вкладку — мгновенное обновление
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled, immediate]);
}
