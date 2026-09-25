// Стор подключения к T-Invest API (zustand; токен — в credvault, persist только настройки)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account, AppMode, ConnectionStatus } from '@/types/account';
import { ApiError, callApi, maskToken, setLatencyListener, warmUpConnection } from '@/lib/tinvest/client';
import { clearCredentials, loadCredentials, loadCredentialsSync, saveCredentials } from '@/lib/credvault';
import { toast } from '@/components/connect/toast';

interface RawAccount {
  id: string;
  type?: string;
  name?: string;
  status?: string;
  openedDate?: string;
  accessLevel?: string;
}

export interface ConnectionState {
  /** API-токен (persist, только если rememberMe) */
  token: string | null;
  /** Выбранный счёт (persist, только если rememberMe) */
  accountId: string | null;
  /** Список счетов */
  accounts: Account[];
  /** Режим: песочница / боевой (persist) */
  mode: AppMode;
  /** Статус соединения */
  status: ConnectionStatus;
  /** Latency последнего запроса, мс */
  latencyMs: number | null;
  /** Задержка последнего ping()-замера, мс */
  lastLatencyMs: number | null;
  /** Время последнего ping()-замера (timestamp) */
  lastPingAt: number | null;
  /** Демо-режим без токена (mock-данные, persist) */
  demoMode: boolean;
  /** «Запомнить на этом устройстве»: false — токен живёт только в памяти сессии, без persist */
  rememberMe: boolean;
  /** Идёт фоновое восстановление сессии (silent reconnect при загрузке) */
  reconnecting: boolean;

  // Действия
  setToken: (token: string | null) => void;
  setAccount: (accountId: string | null) => void;
  setAccounts: (accounts: Account[]) => void;
  setMode: (mode: AppMode) => void;
  setStatus: (status: ConnectionStatus) => void;
  setLatency: (latencyMs: number | null) => void;
  setDemoMode: (on: boolean) => void;
  setRememberMe: (on: boolean) => void;
  /** Проверить соединение: GetAccounts; при успехе обновляет список счетов и статус */
  testConnection: () => Promise<boolean>;
  /**
   * Фоновое восстановление сессии при загрузке приложения: проверка токена без
   * блокировки UI. При 401/403 — статус error + мягкий toast, токен НЕ стирается.
   */
  silentReconnect: () => Promise<void>;
  /** Лёгкий замер задержки до API (GetAccounts). Возвращает мс или null при ошибке. */
  ping: () => Promise<number | null>;
  /** Полный сброс подключения */
  disconnect: () => void;
}

/** Маскированный токен для отображения */
export function maskedToken(token: string | null): string {
  return token ? maskToken(token) : '';
}

/** Маска «t.••••последние4» для карточки сохранённого токена */
export function savedTokenMask(token: string | null): string {
  if (!token) return '';
  return `t.••••${token.slice(-4)}`;
}

function mapAccounts(raw: RawAccount[] | undefined): Account[] {
  return (raw ?? []).map((a) => ({
    id: a.id,
    name: a.name || `Счёт •…${a.id.slice(-4)}`,
    type: a.type ?? '',
    status: a.status ?? '',
    openedDate: a.openedDate,
    accessLevel: a.accessLevel,
  }));
}

/** Прогрев после успешного подключения: TLS-сессия + параллельная предзагрузка каталогов */
function scheduleWarmUp(): void {
  warmUpConnection();
  // Динамический импорт: разрываем цикл connection → services → connection
  void import('@/components/connect/warmup')
    .then((m) => m.warmUpMarketData())
    .catch(() => {
      /* прогрев — лучшее усилие, ошибки не критичны */
    });
}

// Гидратация из хранилища ДО создания стора: токен выживает перезагрузку гарантированно
const bootCredentials = loadCredentialsSync();

/** Записать текущую сессию в хранилище (единственная точка записи — явная, не реактивная) */
function persistSession(state: { token: string | null; accountId: string | null; mode: AppMode; rememberMe: boolean }): void {
  if (!state.token) return;
  if (!state.rememberMe) {
    clearCredentials();
    return;
  }
  saveCredentials({ token: state.token, accountId: state.accountId, mode: state.mode, savedAt: Date.now() });
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      token: bootCredentials?.token ?? null,
      accountId: bootCredentials?.accountId ?? null,
      accounts: [],
      mode: 'sandbox',
      status: 'offline',
      latencyMs: null,
      lastLatencyMs: null,
      lastPingAt: null,
      demoMode: false,
      rememberMe: true,
      reconnecting: false,

      setToken: (token) => {
        set({ token, ...(token ? {} : { accountId: null, accounts: [], status: 'offline' as const }) });
        if (!token) clearCredentials();
        else persistSession(get());
      },
      setAccount: (accountId) => {
        set({ accountId });
        persistSession(get());
      },
      setAccounts: (accounts) => set({ accounts }),
      setMode: (mode) => set({ mode }),
      setStatus: (status) => set({ status }),
      setLatency: (latencyMs) => set({ latencyMs }),
      setDemoMode: (demoMode) => set({ demoMode }),
      setRememberMe: (rememberMe) => {
        set({ rememberMe });
        // Выключили «запоминать» — хранилище очищаем; включили — пишем текущую сессию
        if (!rememberMe) clearCredentials();
        else persistSession(get());
      },

      testConnection: async () => {
        const { token, mode } = get();
        if (!token) {
          set({ status: 'offline' });
          return false;
        }
        set({ status: 'connecting' });
        try {
          const res = await callApi<{ accounts?: RawAccount[] }>('UsersService', 'GetAccounts', {}, {
            token,
            sandbox: mode === 'sandbox',
          });
          const accounts = mapAccounts(res.accounts);
          const { accountId } = get();
          set({
            accounts,
            status: 'online',
            // если выбранный счёт исчез — берём первый
            accountId: accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? null),
          });
          persistSession(get());
          scheduleWarmUp();
          return true;
        } catch {
          set({ status: 'error' });
          return false;
        }
      },

      silentReconnect: async () => {
        const { token, mode, reconnecting } = get();
        if (!token || reconnecting) return;
        set({ reconnecting: true });
        try {
          const res = await callApi<{ accounts?: RawAccount[] }>('UsersService', 'GetAccounts', {}, {
            token,
            sandbox: mode === 'sandbox',
            retries: 0,
          });
          const accounts = mapAccounts(res.accounts);
          const { accountId } = get();
          set({
            accounts,
            status: 'online',
            accountId: accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? null),
          });
          scheduleWarmUp();
        } catch (e) {
          set({ status: 'error' });
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            // Токен не стираем — пользователь сам решает на странице «Подключение»
            toast('Сессия истекла — проверьте токен', {
              details: 'Токен сохранён на устройстве: переподключитесь или смените его',
              variant: 'warn',
            });
          }
        } finally {
          set({ reconnecting: false });
        }
      },

      ping: async () => {
        const { token, mode } = get();
        if (!token) return null;
        const started = performance.now();
        try {
          await callApi('UsersService', 'GetAccounts', {}, {
            token,
            sandbox: mode === 'sandbox',
            timeoutMs: 5_000,
            retries: 0,
          });
          const ms = Math.max(1, Math.round(performance.now() - started));
          set({ lastLatencyMs: ms, lastPingAt: Date.now() });
          return ms;
        } catch {
          set({ lastPingAt: Date.now() });
          return null;
        }
      },

      disconnect: () => {
        clearCredentials();
        set({
          token: null,
          accountId: null,
          accounts: [],
          status: 'offline',
          latencyMs: null,
          lastLatencyMs: null,
          lastPingAt: null,
          demoMode: false,
        });
      },
    }),
    {
      name: 'forts-pilot-connection',
      // Токен и счёт хранит credvault (с верификацией записи); здесь — только настройки
      partialize: (s) => ({
        mode: s.mode,
        demoMode: s.demoMode,
        rememberMe: s.rememberMe,
      }),
    },
  ),
);

// Асинхронная догидратация из IndexedDB-фолбэка (если localStorage был недоступен)
void loadCredentials().then((c) => {
  const s = useConnectionStore.getState();
  if (c && !s.token) {
    useConnectionStore.setState({ token: c.token, accountId: c.accountId, mode: c.mode });
  }
});

// Подписка на метрики latency из API-клиента → статус-точка в TopBar
setLatencyListener((latencyMs, ok) => {
  const s = useConnectionStore.getState();
  if (!s.token) return;
  useConnectionStore.setState({ latencyMs: Math.round(latencyMs), status: ok ? 'online' : 'error' });
});

/** Есть ли доступ к торговым роутам (токен или демо) */
export function selectIsConnected(s: ConnectionState): boolean {
  return Boolean(s.token) || s.demoMode;
}
