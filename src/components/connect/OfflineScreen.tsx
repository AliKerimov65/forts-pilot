// Офлайн-экран (connection.md §2.3): /offline.svg + кнопка «Повторить»
import { useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { formatTime } from '@/lib/format';

export interface OfflineScreenProps {
  /** Попытаться переподключиться; вызывается по «Повторить» */
  onRetry: () => Promise<boolean> | boolean;
}

export default function OfflineScreen({ onRetry }: OfflineScreenProps) {
  const [checking, setChecking] = useState(false);
  const [lastDataAt] = useState(() => Date.now());

  const retry = async () => {
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 rounded-xl border border-subtle bg-panel p-8 text-center"
    >
      <img src="/offline.svg" alt="Нет соединения" className="h-44 w-auto opacity-90" />
      <div>
        <h1 className="text-xl font-bold text-fg">Нет соединения с интернетом</h1>
        <p className="mono mt-2 text-sm text-fg-secondary">
          Последние данные от {formatTime(lastDataAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={retry}
        disabled={checking}
        className="mt-1 flex h-11 items-center gap-2 rounded-[10px] bg-yellow px-6 text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-60"
      >
        <RefreshCw className={checking ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        {checking ? 'Проверяем…' : 'Повторить'}
      </button>
    </motion.div>
  );
}
