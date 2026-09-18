// ConfirmDangerModal — подтверждение опасных действий удержанием кнопки 1.5с (design.md §5)
// press-and-hold с круговым прогрессом; mobile — bottom sheet, desktop — центр.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmDangerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Текст кнопки удержания, напр. "Удерживайте для запуска" */
  confirmLabel?: string;
  /** Время удержания, мс (по умолчанию 1500) */
  holdMs?: number;
  onConfirm: () => void;
}

const CIRCLE_R = 26;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;

export default function ConfirmDangerModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Удерживайте для подтверждения',
  holdMs = 1500,
  onConfirm,
}: ConfirmDangerModalProps) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);

  const stopHold = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (!doneRef.current) setProgress(0);
  }, []);

  const startHold = useCallback(() => {
    doneRef.current = false;
    startRef.current = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        doneRef.current = true;
        navigator.vibrate?.(10); // haptic (design.md §8)
        onConfirm();
        onOpenChange(false);
        setProgress(0);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [holdMs, onConfirm, onOpenChange]);

  useEffect(() => {
    if (!open) {
      stopHold();
      setProgress(0);
    }
  }, [open, stopHold]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(4,6,10,0.7)] backdrop-blur-[8px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            className={cn(
              'w-full max-w-[480px] rounded-t-2xl border border-subtle bg-panel-raised p-5 sm:rounded-xl',
            )}
            initial={{ opacity: 0, y: 40, scale: 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* handle bottom sheet (mobile) */}
            <div className="mx-auto mb-4 h-1 w-8 rounded-full bg-strong sm:hidden" />

            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-short-dim">
                <TriangleAlert className="h-5 w-5 text-short" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-fg">{title}</h3>
                {description && <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{description}</p>}
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                className="h-11 flex-1 rounded-[10px] border border-subtle text-sm font-medium text-fg-secondary transition-colors hover:bg-panel"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </button>

              {/* press-and-hold с круговым прогрессом */}
              <button
                type="button"
                className="relative flex h-11 flex-1 select-none items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-short text-sm font-semibold text-short transition-colors hover:bg-short-dim active:bg-short-dim"
                onPointerDown={startHold}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                onContextMenu={(e) => e.preventDefault()}
              >
                <svg width="20" height="20" viewBox="0 0 60 60" className="shrink-0 -rotate-90">
                  <circle cx="30" cy="30" r={CIRCLE_R} fill="none" stroke="var(--short-dim)" strokeWidth="6" />
                  <circle
                    cx="30"
                    cy="30"
                    r={CIRCLE_R}
                    fill="none"
                    stroke="var(--short)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
                  />
                </svg>
                {progress > 0 ? 'Не отпускайте…' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
