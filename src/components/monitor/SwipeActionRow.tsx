// Свайп строки влево (mobile): карточка едет за пальцем, подложка действия проявляется
// с 30% прогресса, порог 40% ширины — действие + haptic 15мс (monitor.md §3, journal.md §3).
import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { cn } from '@/lib/utils';

export interface SwipeActionRowProps {
  /** Текст действия на подложке («Закрыть», «Отменить», «Подробнее») */
  actionLabel: string;
  /** Цвет подложки: красная (опасное) или жёлтая (инфо) */
  tone: 'danger' | 'accent';
  onAction: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export default function SwipeActionRow({ actionLabel, tone, onAction, children, className, disabled }: SwipeActionRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  // порог измеряется в момент начала свайпа (ref нельзя читать при рендере)
  const [threshold, setThreshold] = useState(144);

  const progress = Math.min(1, Math.abs(dx) / threshold);

  const onStart = (e: TouchEvent) => {
    if (disabled) return;
    if (ref.current) setThreshold(ref.current.offsetWidth * 0.4);
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    setSwiping(true);
  };

  const onMove = (e: TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0];
    const ddx = t.clientX - start.current.x;
    const ddy = t.clientY - start.current.y;
    // вертикальный скролл важнее — отменяем свайп
    if (Math.abs(ddy) > Math.abs(ddx) && Math.abs(ddy) > 8) {
      start.current = null;
      setDx(0);
      setSwiping(false);
      return;
    }
    if (ddx < 0) setDx(Math.max(ddx, -threshold * 1.15));
    else setDx(Math.min(ddx * 0.2, 12)); // лёгкое сопротивление вправо
  };

  const onEnd = () => {
    if (!start.current && !swiping) return;
    const fired = Math.abs(dx) >= threshold;
    start.current = null;
    setSwiping(false);
    setDx(0);
    if (fired) {
      navigator.vibrate?.(15);
      onAction();
    }
  };

  return (
    <div ref={ref} className={cn('relative overflow-hidden rounded-xl', className)}>
      {/* Подложка действия (справа) */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-end rounded-xl pr-5 text-sm font-bold',
          tone === 'danger' ? 'bg-short text-white' : 'bg-yellow text-app',
        )}
        style={{ width: '100%', opacity: progress >= 0.3 ? 1 : progress / 0.3 * 0.6 }}
        aria-hidden
      >
        {actionLabel}
      </div>
      {/* Контент, едущий за пальцем */}
      <div
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: swiping ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
