// Карточка «Токен сохранён на этом устройстве» — состояние Connect-страницы,
// когда токен есть в локальном хранилище, но соединение не активно
// (например, сессия истекла после silent-reconnect с 401).
import { KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { savedTokenMask, useConnectionStore } from '@/store/connection';

export interface SavedTokenCardProps {
  /** Переподключиться с сохранённым токеном */
  onReconnect: () => void;
  /** Сменить токен (переход к вводу нового) */
  onChangeToken: () => void;
  /** Удалить токен с устройства (через подтверждение) */
  onRemoveToken: () => void;
  /** Идёт проверка соединения */
  busy?: boolean;
}

export default function SavedTokenCard({ onReconnect, onChangeToken, onRemoveToken, busy = false }: SavedTokenCardProps) {
  const token = useConnectionStore((s) => s.token);
  if (!token) return null;

  return (
    <div className="rounded-xl border border-subtle bg-inset p-4 shadow-inset">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-subtle bg-panel-raised">
          <KeyRound className="h-4 w-4 text-yellow" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg">Токен сохранён на этом устройстве</div>
          <div className="mono mt-0.5 text-xs text-fg-secondary">{savedTokenMask(token)}</div>
          <div className="mt-1 text-xs leading-relaxed text-fg-muted">
            Хранится только локально в браузере, никуда не отправляется кроме api.tbank.ru
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onReconnect}
          disabled={busy}
          className="flex h-10 items-center justify-center gap-2 rounded-[10px] bg-yellow px-4 text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Переподключить
        </button>
        <button
          type="button"
          onClick={onChangeToken}
          disabled={busy}
          className="flex h-10 items-center justify-center rounded-[10px] border border-subtle bg-panel px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg disabled:opacity-60"
        >
          Сменить токен
        </button>
        <button
          type="button"
          onClick={onRemoveToken}
          disabled={busy}
          className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-short/50 px-4 text-sm font-semibold text-short transition-colors hover:border-short hover:bg-short-dim disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Удалить токен
        </button>
      </div>
    </div>
  );
}
