// Шина тостов (design.md §5 Toast): модульный API showToast(...) — вызывается из любого места,
// рендерится компонентом <ToastHost/> (см. toast.tsx).

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

let toastSeq = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** Показать тост (до монтирования ToastHost вызовы игнорируются) */
export function showToast(toast: Omit<ToastItem, 'id'>) {
  const item: ToastItem = { ...toast, id: ++toastSeq };
  listeners.forEach((l) => l(item));
}

/** Подписка на новые тосты (используется ToastHost) */
export function subscribeToasts(listener: (t: ToastItem) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
