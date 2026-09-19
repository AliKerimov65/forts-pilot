// Настройка PIN-блокировки (connection.md — секция «Безопасность»)
// Совместимость с LockScreen: использует его публичные хелперы isLockEnabled/setLockPin,
// сам LockScreen не изменяется. Блокировка срабатывает при сворачивании приложения.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Lock, LockOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isLockEnabled, setLockPin } from '@/components/LockScreen';
import { toast } from '@/components/connect/toast';

const PIN_LENGTH = 4;

function PinInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={PIN_LENGTH}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      placeholder={placeholder}
      className="mono h-11 w-full rounded-[10px] border border-subtle bg-inset px-3 text-center text-lg tracking-[0.5em] text-fg outline-none transition-[border-color,box-shadow] duration-[120ms] placeholder:text-fg-muted hover:border-strong focus:border-strong focus:shadow-[0_0_0_3px_var(--focus-ring)]"
    />
  );
}

export default function PinSettings() {
  const [enabled, setEnabled] = useState(() => isLockEnabled());
  const [setupOpen, setSetupOpen] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');

  const toggle = () => {
    if (enabled) {
      setLockPin(null);
      setEnabled(false);
      setSetupOpen(false);
      setPin1('');
      setPin2('');
      setError('');
      toast('PIN-блокировка выключена', { variant: 'info' });
    } else {
      setSetupOpen(true);
      setError('');
    }
  };

  const savePin = () => {
    if (pin1.length !== PIN_LENGTH) {
      setError('PIN должен состоять из 4 цифр');
      return;
    }
    if (pin1 !== pin2) {
      setError('PIN-коды не совпадают');
      setPin2('');
      return;
    }
    setLockPin(pin1);
    setEnabled(true);
    setSetupOpen(false);
    setPin1('');
    setPin2('');
    setError('');
    navigator.vibrate?.(10);
    toast('PIN-код установлен', {
      details: 'Приложение будет запрашивать PIN при сворачивании',
      variant: 'success',
    });
  };

  return (
    // Вложенная в секцию «Безопасность» панель — уровень L0 inset (design-v2.md §2.1)
    <div className="rounded-xl border border-subtle bg-inset p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              enabled ? 'bg-yellow-glow text-yellow' : 'bg-panel-raised text-fg-muted',
            )}
          >
            {enabled ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
          </span>
          <div>
            <div className="text-sm font-semibold text-fg">PIN-блокировка</div>
            <div className="text-xs text-fg-secondary">
              {enabled ? 'Включена — запрос при входе и сворачивании' : 'Запрашивать PIN при входе и сворачивании'}
            </div>
          </div>
        </div>
        {/* ToggleSwitch 44×24 (design.md §5) */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors',
            enabled ? 'bg-yellow' : 'bg-panel-raised border border-subtle',
          )}
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full',
              enabled ? 'left-[22px] bg-app' : 'left-0.5 bg-fg-muted',
            )}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {(setupOpen || enabled) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            {enabled && !setupOpen ? (
              <div className="mt-4 flex items-center justify-between rounded-[10px] border border-subtle bg-panel px-3 py-2.5">
                <span className="mono text-sm text-fg-secondary">PIN установлен ••••</span>
                <button
                  type="button"
                  onClick={() => {
                    setSetupOpen(true);
                    setError('');
                  }}
                  className="text-xs font-semibold text-yellow hover:underline"
                >
                  Сменить PIN
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                <PinInput value={pin1} onChange={setPin1} placeholder="Придумайте PIN" autoFocus />
                <PinInput value={pin2} onChange={setPin2} placeholder="Повторите PIN" />
                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-1 text-xs font-medium leading-4 text-short"
                    >
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={savePin}
                    disabled={pin1.length !== PIN_LENGTH || pin2.length !== PIN_LENGTH}
                    className="h-10 flex-1 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-40"
                  >
                    Сохранить PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSetupOpen(false);
                      setPin1('');
                      setPin2('');
                      setError('');
                    }}
                    className="h-10 rounded-[10px] border border-subtle px-4 text-sm font-medium text-fg-secondary transition-colors hover:bg-panel-raised"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
