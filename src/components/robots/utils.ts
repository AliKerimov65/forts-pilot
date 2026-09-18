// Демо-генераторы для визуалов роботов (детерминированные, чистые — вне компонентов).
import { seededRandom } from '@/lib/tinvest/mock';

function seedOf(key: string): number {
  return [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
}

/** Синтетическая серия P&L робота (детерминирована по seed-ключу) */
export function synthPnlSeries(seedKey: string, magnitude: number, length: number, drift = 0.44): number[] {
  const rnd = seededRandom(seedOf(seedKey));
  const k = Math.abs(magnitude || 1000);
  const deltas = Array.from({ length }, () => (rnd() - drift) * k * 0.04);
  return deltas.map((_, i) => deltas.slice(0, i + 1).reduce((a, b) => a + b, 0));
}

export interface ConfettiPiece {
  x: number;
  w: number;
  h: number;
  delay: number;
  color: string;
  rotate: number;
}

/** Конфетти-свечи для экрана успеха (детерминированные) */
export function confettiPieces(count = 26): ConfettiPiece[] {
  const rnd = seededRandom(20250);
  return Array.from({ length: count }, (_, i) => ({
    x: (i / count) * 100 + rnd() * 3,
    w: 5 + rnd() * 7,
    h: 10 + rnd() * 22,
    delay: rnd() * 0.3,
    color: i % 3 === 0 ? 'var(--short)' : 'var(--long)',
    rotate: rnd() * 360,
  }));
}
