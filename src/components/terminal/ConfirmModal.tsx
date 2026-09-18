// ConfirmModal — лёгкое подтверждение (drag SL/TP на графике), desktop — центр, mobile — bottom sheet
import { AnimatePresence, motion } from 'framer-motion';

export interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export default function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Подтвердить',
  onConfirm,
}: ConfirmModalProps) {
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
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-8 rounded-full bg-strong sm:hidden" />
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            {description && <p className="mono mt-1 text-sm text-fg-secondary">{description}</p>}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="h-10 flex-1 rounded-[10px] border border-subtle text-sm font-medium text-fg-secondary transition-colors hover:bg-panel"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="h-10 flex-1 rounded-[10px] bg-yellow text-sm font-bold text-app transition-[filter] hover:brightness-110"
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
