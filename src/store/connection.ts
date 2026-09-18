// Стор подключения к T-Invest API (zustand + persist в localStorage)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account, AppMode, ConnectionStatus } from '@/types/account';
import { callApi, maskToken, setLatencyListener } from '@/lib/tinvest/client';

interface RawAccount {
  id: string;
  type?: string;
  name?: string;
  status?: string;
  openedDate?: string;
  accessLevel?: string;
}

export interface ConnectionState {
  /** API-токен (persist) */
  token: string | null;
  /** Выбранный счёт (persist) */
  accountId: string | null;
  /** Список счетов */
  accounts: Account[];
  /** Режим: песочница / боевой (persist) */
  mode: AppMode;
  /** Статус соединения */
  status: ConnectionStatus;
  /** Latency последнего запроса, мс */
  latencyMs: number | null;
  /** Демо-режим без токена (mock-данные, persist) */
  demoMode: boolean;

  // Действия
  setToken: (token: string | null) => void;
  setAccount: (accountId: string | null) => void;
  setAccounts: (accounts: Account[]) => void;
  setMode: (mode: AppMode) => void;
  setStatus: (status: ConnectionStatus) => void;
  setLatency: (latencyMs: number | null) => void;
  setDemoMode: (on: boolean) => void;
  /** Проверить соединение: GetAccounts; при успехе обновляет список счетов и статус */
  testConnection: () => Promise<boolean>;
  /** Полный сброс подключения */
  disconnect: () => void;
}

/** Маскированный токен для отображения */
export function maskedToken(token: string | null): string {
  return token ? maskToken(token) : '';
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      token: null,
      accountId: null,
      accounts: [],
      mode: 'sandbox',
      status: 'offline',
      latencyMs: null,
      demoMode: false,

      setToken: (token) => set({ token, ...(token ? {} : { accountId: null, accounts: [], status: 'offline' as const }) }),
      setAccount: (accountId) => set({ accountId }),
      setAccounts: (accounts) => set({ accounts }),
      setMode: (mode) => set({ mode }),
      setStatus: (status) => set({ status }),
      setLatency: (latencyMs) => set({ latencyMs }),
      setDemoMode: (demoMode) => set({ demoMode }),

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
          const accounts: Account[] = (res.accounts ?? []).map((a) => ({
            id: a.id,
            name: a.name || `Счёт •…${a.id.slice(-4)}`,
            type: a.type ?? '',
            status: a.status ?? '',
            openedDate: a.openedDate,
            accessLevel: a.accessLevel,
          }));
          const { accountId } = get();
          set({
            accounts,
            status: 'online',
            // если выбранный счёт исчез — берём первый
            accountId: accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? null),
          });
          return true;
        } catch {
          set({ status: 'error' });
          return false;
        }
      },

      disconnect: () =>
        set({ token: null, accountId: null, accounts: [], status: 'offline', latencyMs: null, demoMode: false }),
    }),
    {
      name: 'forts-pilot-connection',
      partialize: (s) => ({ token: s.token, accountId: s.accountId, mode: s.mode, demoMode: s.demoMode }),
    },
  ),
);

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
