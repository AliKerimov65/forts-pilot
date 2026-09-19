// Хост локальных toast-уведомлений (design.md §5 — Toast)
// Сверху справа (desktop) / сверху по центру (mobile), автоскрытие 4с, slide-in сверху.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeToasts, type ToastItem, type ToastVariant } from '@/components/connect/toast';

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof Info; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-long' },
  error: { icon: XCircle, iconClass: 'text-short' },
  warn: { icon: TriangleAlert, iconClass: 'text-warn' },
  info: { icon: Info, iconClass: 'text-info' },
};

function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  const { icon: Icon, iconClass } = VARIANT_STYLE[item.variant];
  useEffect(() => {
    const t = setTimeout(() => onClose(item.id), 4000);
    return () => clearTimeout(t);
  }, [item.id, onClose]);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-strong bg-overlay px-3.5 py-3 shadow-overlay"
      role="status"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel-raised">
        <Icon className={cn('h-4 w-4', iconClass)} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{item.title}</div>
        {item.details && <div className="mono mt-0.5 truncate text-xs text-fg-secondary">{item.details}</div>}
      </div>
      <button
        type="button"
        onClick={() => onClose(item.id)}
        className="text-fg-muted transition-colors hover:text-fg"
        aria-label="Закрыть уведомление"
      >
        ×
      </button>
    </motion.div>
  );
}

/** Хост уведомлений — монтировать один раз на странице */
export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(
    () => subscribeToasts((t) => setItems((xs) => [...xs.slice(-2), t])),
    [],
  );

  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end sm:px-0">
      <AnimatePresence>
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={close} />
        ))}
      </AnimatePresence>
    </div>
  );
}
