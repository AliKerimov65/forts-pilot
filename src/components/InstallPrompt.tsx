// InstallPrompt — кастомный баннер установки PWA (design.md §8)
// Показ после 2-го визита (счётчик в localStorage), bottom sheet,
// iOS — инструкция «Поделиться → На экран Домой», Android — нативный prompt.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Share, X } from 'lucide-react';

const VISITS_KEY = 'fp_visits';
const DISMISSED_KEY = 'fp_install_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Увеличить счётчик визитов; вызывать один раз при старте приложения */
export function trackVisit(): void {
  try {
    const n = Number(localStorage.getItem(VISITS_KEY) ?? '0') + 1;
    localStorage.setItem(VISITS_KEY, String(n));
  } catch {
    /* localStorage недоступен */
  }
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    const visits = Number(localStorage.getItem(VISITS_KEY) ?? '0');
    if (visits < 2 || localStorage.getItem(DISMISSED_KEY)) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    // iOS не шлёт beforeinstallprompt — показываем свою инструкцию
    if (isIos()) {
      const t = setTimeout(() => setVisible(true), 2500);
      return () => {
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        clearTimeout(t);
      };
    }
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') dismiss();
      setDeferred(null);
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-[rgba(4,6,10,0.6)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismiss}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[85] mx-auto w-full max-w-md rounded-t-2xl border border-subtle bg-panel-raised p-5"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-strong" />
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-4 top-4 text-fg-muted transition-colors hover:text-fg"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-start gap-4">
              <img src="/logo.svg" alt="" width={48} height={48} />
              <div>
                <h3 className="text-base font-bold text-fg">Установить на экран «Домой»</h3>
                <p className="mt-1 text-sm text-fg-secondary">
                  FORTS PILOT работает как приложение: быстрый доступ, офлайн-оболочка, уведомления о сделках.
                </p>
              </div>
            </div>

            {isIos() ? (
              <div className="mt-4 rounded-[10px] border border-subtle bg-inset p-3">
                <img src="/install-ios.svg" alt="Инструкция iOS" className="mx-auto h-24 w-auto" />
                <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-sm text-fg-secondary">
                  Нажмите <Share className="h-4 w-4 text-info" /> «Поделиться» →
                  <span className="font-semibold text-fg">«На экран “Домой”»</span>
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={install}
                className="mt-4 h-11 w-full rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent"
              >
                Установить приложение
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
