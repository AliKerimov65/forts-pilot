// Простая confirm-модалка (desktop — центр, mobile — bottom sheet) для не-Live подтверждений.
// Для боевого режима используется общий ConfirmDangerModal (press-and-hold).
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  confirmTone?: 'danger' | 'primary';
  onConfirm: () => void;
}

export default function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Подтвердить',
  confirmTone = 'danger',
  onConfirm,
}: ConfirmModalProps) {
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
            className="w-full max-w-[480px] rounded-t-2xl border border-subtle bg-panel-raised p-5 sm:rounded-xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-8 rounded-full bg-strong sm:hidden" />
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            {description && <div className="mt-1 text-sm leading-relaxed text-fg-secondary">{description}</div>}
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                className="h-11 flex-1 rounded-[10px] border border-subtle text-sm font-medium text-fg-secondary transition-colors hover:bg-panel"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className={
                  confirmTone === 'danger'
                    ? 'h-11 flex-1 rounded-[10px] border border-short text-sm font-semibold text-short transition-colors hover:bg-short-dim'
                    : 'h-11 flex-1 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent'
                }
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
