// Мини-модалка «+SL/TP»: два поля с живым расчётом риска/профита (monitor.md §4).
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import type { Position } from '@/types/trading';
import { formatNumber, formatRub } from '@/lib/format';
import { effectiveSlTp, useSlTpStore } from './monitorData';
import { showToast } from './toastBus';

export interface SlTpModalProps {
  position: Position | null;
  onOpenChange: (open: boolean) => void;
}

export default function SlTpModal({ position, onOpenChange }: SlTpModalProps) {
  const open = position !== null;
  const map = useSlTpStore((s) => s.map);
  const setSlTp = useSlTpStore((s) => s.setSlTp);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');

  useEffect(() => {
    if (position) {
      const eff = effectiveSlTp(position, map);
      setSl(String(eff.sl));
      setTp(String(eff.tp));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.instrumentId, open]);

  if (!position) return null;
  const dir = position.direction === 'long' ? 1 : -1;
  const slNum = Number(sl.replace(',', '.'));
  const tpNum = Number(tp.replace(',', '.'));
  const risk = Number.isFinite(slNum) ? Math.max(0, (position.currentPrice - slNum) * dir) * position.lots : 0;
  const reward = Number.isFinite(tpNum) ? Math.max(0, (tpNum - position.currentPrice) * dir) * position.lots : 0;

  const apply = () => {
    if (!position) return;
    setSlTp(position.instrumentId, {
      sl: Number.isFinite(slNum) && slNum > 0 ? slNum : undefined,
      tp: Number.isFinite(tpNum) && tpNum > 0 ? tpNum : undefined,
    });
    showToast({
      variant: 'success',
      title: `SL/TP по ${position.ticker} установлены`,
      description: `SL ${sl || '—'} · TP ${tp || '—'}`,
    });
    navigator.vibrate?.(10);
    onOpenChange(false);
  };

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
            className="w-full max-w-[420px] rounded-t-2xl border border-subtle bg-panel-raised p-5 sm:rounded-xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-8 rounded-full bg-strong sm:hidden" />
            <h3 className="flex items-center gap-2 text-base font-semibold text-fg">
              <ShieldCheck className="h-4 w-4 text-long" />
              Защита позиции {position.ticker}
            </h3>
            <p className="mono mt-1 text-xs text-fg-secondary">
              Текущая цена {formatNumber(position.currentPrice)} · {position.lots} лот
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-short">Стоп-лосс</span>
                <input
                  value={sl}
                  onChange={(e) => setSl(e.target.value)}
                  inputMode="decimal"
                  className="mono mt-1 h-10 w-full rounded-lg border border-subtle bg-inset px-3 text-sm text-fg outline-none focus:border-strong"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-long">Тейк-профит</span>
                <input
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                  inputMode="decimal"
                  className="mono mt-1 h-10 w-full rounded-lg border border-subtle bg-inset px-3 text-sm text-fg outline-none focus:border-strong"
                />
              </label>
            </div>

            <div className="mono mt-3 flex justify-between rounded-lg bg-inset px-3 py-2 text-xs">
              <span className="text-short">Риск ≈ {formatRub(risk, 0)}</span>
              <span className="text-long">Профит ≈ {formatRub(reward, 0)}</span>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                className="h-10 flex-1 rounded-[10px] border border-subtle text-sm font-medium text-fg-secondary hover:bg-panel"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="h-10 flex-1 rounded-[10px] bg-yellow text-sm font-bold text-app hover:glow-accent"
                onClick={apply}
              >
                Установить
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
