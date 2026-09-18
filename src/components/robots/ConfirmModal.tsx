// Простая confirm-модалка (не опасные действия: пауза/остановка, сохранение правок).
// Для опасных — ConfirmDangerModal из shared.
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(4,6,10,0.7)] backdrop-blur-[8px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            className="w-full max-w-[420px] rounded-t-2xl border border-subtle bg-panel-raised p-5 sm:rounded-xl"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 32 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            {description && <div className="mt-2 text-sm text-fg-secondary">{description}</div>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-10 flex-1 rounded-[10px] border border-subtle text-sm font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
                className="h-10 flex-1 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent"
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
