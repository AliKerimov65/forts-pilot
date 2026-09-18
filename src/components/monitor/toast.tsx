// Мини-тосты (design.md §5 Toast): иконка + заголовок + mono-детали,
// автоскрытие 4с, slide-in сверху 24px + fade. Desktop — сверху справа, mobile — сверху по центру.
// Вызов — через showToast() из './toastBus'.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, Info, OctagonX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeToasts, type ToastItem, type ToastVariant } from './toastBus';

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof Info; iconClass: string }> = {
  success: { icon: CircleCheck, iconClass: 'text-long' },
  error: { icon: OctagonX, iconClass: 'text-short' },
  info: { icon: Info, iconClass: 'text-info' },
};

const TOAST_TTL = 4000;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const unsubscribe = subscribeToasts((t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      timers.set(
        t.id,
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== t.id));
          timers.delete(t.id);
        }, TOAST_TTL),
      );
    });
    return () => {
      unsubscribe();
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[110] flex w-[calc(100%-24px)] max-w-sm -translate-x-1/2 flex-col items-center gap-2 md:left-auto md:right-4 md:top-4 md:translate-x-0 md:items-end">
      <AnimatePresence>
        {items.map((t) => {
          const { icon: Icon, iconClass } = VARIANT_STYLE[t.variant];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-subtle bg-panel-raised px-3.5 py-3 shadow-lg shadow-black/40"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-5 text-fg">{t.title}</div>
                {t.description && <div className="mono mt-0.5 truncate text-xs text-fg-secondary">{t.description}</div>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default ToastHost;
