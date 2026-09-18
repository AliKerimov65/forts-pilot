// Аварийная кнопка «СТОП-ВСЁ» Ø96px (risk.md §2.7)
// Press-and-hold 1.5с: кольцо заполняется по окружности, haptic.
// В боевом режиме после удержания дополнительно ConfirmDangerModal.
// Сегмент «Позиции: закрыть/оставить» запоминается в localStorage.
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Power } from 'lucide-react';
import { cn } from '@/lib/utils';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';

const HOLD_MS = 1500;
const RING_R = 58;
const RING_C = 2 * Math.PI * RING_R;
const CLOSE_KEY = 'fp_emergency_close_positions';

export interface EmergencyStopProps {
  /** Боевой режим — дополнительное подтверждение после удержания */
  live: boolean;
  /** Выполнить аварийную остановку; closePositions — выбор сегмента */
  onActivate: (closePositions: boolean) => void;
}

export default function EmergencyStop({ live, onActivate }: EmergencyStopProps) {
  const [progress, setProgress] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closePositions, setClosePositions] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CLOSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(CLOSE_KEY, closePositions ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [closePositions]);

  const stopHold = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (!doneRef.current) setProgress(0);
  }, []);

  const startHold = useCallback(() => {
    doneRef.current = false;
    startRef.current = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / HOLD_MS);
      setProgress(p);
      // нарастающий haptic на mobile
      if (Math.floor(p * 10) !== Math.floor(((now - 16) - startRef.current) / HOLD_MS * 10)) {
        navigator.vibrate?.(10);
      }
      if (p >= 1) {
        doneRef.current = true;
        setProgress(0);
        navigator.vibrate?.(60);
        if (live) setConfirmOpen(true);
        else onActivate(closePositions);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [live, onActivate, closePositions]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div className="flex flex-col items-center gap-4">
      <motion.div
        className="relative"
        whileHover={{ scale: 1.02 }}
        style={{ filter: 'drop-shadow(0 0 0 rgba(234,57,67,0))' }}
      >
        {/* Кольцо прогресса */}
        <svg width="124" height="124" viewBox="0 0 124 124" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90">
          <circle cx="62" cy="62" r={RING_R} fill="none" stroke="var(--short-dim)" strokeWidth="4" />
          <circle
            cx="62"
            cy="62"
            r={RING_R}
            fill="none"
            stroke="var(--short)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
          />
        </svg>
        <button
          type="button"
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            'relative flex h-24 w-24 select-none flex-col items-center justify-center gap-1 rounded-full',
            'border-2 border-short bg-short-dim text-short transition-shadow',
            'hover:shadow-[0_0_32px_rgba(234,57,67,0.45)] active:bg-short active:text-white',
          )}
          aria-label="Аварийная остановка всех роботов — удерживайте"
        >
          <Power className="h-6 w-6" />
          <span className="text-[10px] font-extrabold uppercase tracking-wider">
            {progress > 0 ? 'Держите…' : 'Стоп-всё'}
          </span>
        </button>
      </motion.div>

      <p className="max-w-xs text-center text-xs leading-relaxed text-fg-secondary">
        Мгновенно останавливает всех роботов и отменяет все ордера. Удерживайте кнопку 1,5 секунды.
      </p>

      {/* Сегмент «Позиции: закрыть/оставить» — запоминается */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-secondary">Позиции:</span>
        <div className="flex rounded-[10px] bg-inset p-0.5">
          {([
            { v: true, label: 'Закрыть' },
            { v: false, label: 'Оставить' },
          ] as const).map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setClosePositions(o.v)}
              className={cn(
                'relative rounded-lg px-3 py-1.5 font-semibold transition-colors',
                closePositions === o.v ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {closePositions === o.v && (
                <motion.span
                  layoutId="emergency-seg"
                  className={cn('absolute inset-0 rounded-lg border-b-2 bg-panel-raised', o.v ? 'border-short' : 'border-subtle')}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <ConfirmDangerModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Аварийная остановка на боевом счёте"
        description="Все роботы будут остановлены, активные ордера отменены. Это действие на реальном счёте."
        confirmLabel="Удерживайте: СТОП"
        onConfirm={() => onActivate(closePositions)}
      />
    </div>
  );
}
