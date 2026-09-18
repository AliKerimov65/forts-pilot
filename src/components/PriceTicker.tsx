// PriceTicker / MoneyDelta — число с флэш-подложкой и пружинным переходом (design.md §5)
import { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface PriceTickerProps {
  value: number;
  /** Форматтер значения (по умолчанию ru-RU, 2 знака) */
  format?: (v: number) => string;
  /** Направление изменения; если не передано — вычисляется из предыдущего значения */
  delta?: number;
  className?: string;
  /** Показывать знак +/- автоматически */
  signed?: boolean;
}

const defaultFormat = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PriceTicker({ value, format, delta, className, signed }: PriceTickerProps) {
  const fmt = format ?? defaultFormat;
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<'long' | 'short' | null>(null);
  const spring = useSpring(value, { stiffness: 300, damping: 30 });
  const display = useTransform(spring, (v) => (signed && v > 0 ? `+${fmt(v)}` : fmt(v)));

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => {
    const dir = delta ?? value - prevRef.current;
    if (dir !== 0 && prevRef.current !== value) {
      setFlash(dir > 0 ? 'long' : 'short');
      const t = setTimeout(() => setFlash(null), 420);
      prevRef.current = value;
      return () => clearTimeout(t);
    }
    prevRef.current = value;
  }, [value, delta]);

  return (
    <motion.span
      className={cn(
        'mono inline-block rounded px-1 -mx-1 transition-colors',
        flash === 'long' && 'flash-long',
        flash === 'short' && 'flash-short',
        className,
      )}
    >
      {display}
    </motion.span>
  );
}
