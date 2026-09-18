// LockScreen — PIN-блокировка при сворачивании приложения (design.md §8)
// PIN хранится в localStorage; по умолчанию выключена. Экран с жёлтым замком.
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

const PIN_KEY = 'fp_lock_pin';
const ENABLED_KEY = 'fp_lock_enabled';
const PIN_LENGTH = 4;

/** Включена ли блокировка */
export function isLockEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1' && Boolean(localStorage.getItem(PIN_KEY));
  } catch {
    return false;
  }
}

/** Установить/снять PIN (null — выключить блокировку) */
export function setLockPin(pin: string | null): void {
  try {
    if (pin) {
      localStorage.setItem(PIN_KEY, pin);
      localStorage.setItem(ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(PIN_KEY);
      localStorage.setItem(ENABLED_KEY, '0');
    }
  } catch {
    /* ignore */
  }
}

function getStoredPin(): string | null {
  try {
    return localStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

export default function LockScreen() {
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  // Блокируем при сворачивании, если включено
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && isLockEnabled()) {
        setLocked(true);
        setPin('');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const tryUnlock = useCallback((candidate: string) => {
    if (candidate === getStoredPin()) {
      navigator.vibrate?.(10);
      setLocked(false);
      setPin('');
      setError(false);
    } else {
      setError(true);
      setPin('');
      setTimeout(() => setError(false), 600);
    }
  }, []);

  const press = (digit: string) => {
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) tryUnlock(next);
  };

  const backspace = () => setPin((p) => p.slice(0, -1));

  return (
    <AnimatePresence>
      {locked && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-app px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.img
            src="/auth-lock.svg"
            alt="Заблокировано"
            width={120}
            height={120}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          />
          <div className="text-center">
            <h2 className="text-lg font-bold text-fg">FORTS PILOT заблокирован</h2>
            <p className="mt-1 text-sm text-fg-secondary">Введите PIN-код для продолжения</p>
          </div>

          {/* Точки PIN */}
          <motion.div
            className="flex gap-3"
            animate={error ? { x: [0, -8, 8, -6, 6, 0] } : undefined}
            transition={{ duration: 0.4 }}
          >
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-3.5 w-3.5 rounded-full border transition-colors',
                  i < pin.length ? 'border-yellow bg-yellow' : 'border-strong bg-transparent',
                  error && 'border-short bg-short',
                )}
              />
            ))}
          </motion.div>

          {/* Цифровая клавиатура */}
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
              k === '' ? (
                <span key="empty" />
              ) : k === 'del' ? (
                <button
                  key="del"
                  type="button"
                  onClick={backspace}
                  className="flex h-16 w-16 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-panel-raised"
                  aria-label="Стереть"
                >
                  <Delete className="h-5 w-5" />
                </button>
              ) : (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className="mono flex h-16 w-16 items-center justify-center rounded-full border border-subtle bg-panel text-xl font-semibold text-fg transition-transform active:scale-95"
                >
                  {k}
                </button>
              ),
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
