// Логика локальных toast-уведомлений (без JSX — см. ToastHost.tsx)
// Позиция/стиль: design.md §5 — Toast.

export type ToastVariant = 'success' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: number;
  title: string;
  details?: string;
  variant: ToastVariant;
}

let seq = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Подписка хоста на новые уведомления */
export function subscribeToasts(listener: (t: ToastItem) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Показать toast. details — mono-строка с деталями (сумма, тикер и т.п.) */
export function toast(title: string, opts?: { details?: string; variant?: ToastVariant }): void {
  const item: ToastItem = { id: ++seq, title, details: opts?.details, variant: opts?.variant ?? 'info' };
  listeners.forEach((l) => l(item));
}
