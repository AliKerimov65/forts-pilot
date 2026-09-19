// Параллельный прогрев данных после установки соединения:
// счета + каталоги инструментов грузятся заранее, чтобы терминал
// открылся мгновенно, без спиннера каталогов. Лучшее усилие:
// частичные ошибки (напр. Indicatives недоступны в песочнице) игнорируются.
import type { Instrument } from '@/types/market';
import {
  getAccounts,
  getBonds,
  getCurrencies,
  getEtfs,
  getFutures,
  getIndices,
  getShares,
} from '@/lib/tinvest/services';
import { mockGetAllInstruments } from '@/lib/tinvest/mock';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';

/** Каталог считается устаревшим через 30 минут — терминал при маунте догружает его фоново */
export const CATALOG_STALE_MS = 30 * 60 * 1000;

/** true, если каталог пуст или загружен более 30 минут назад */
export function isCatalogStale(): boolean {
  const { instruments, catalogsLoadedAt } = useMarketStore.getState();
  return instruments.length === 0 || !catalogsLoadedAt || Date.now() - catalogsLoadedAt > CATALOG_STALE_MS;
}

/** Дедупликация по uid, порядок: фьючерсы → акции → ETF → валюты → облигации → индексы */
function mergeInstruments(lists: Instrument[][]): Instrument[] {
  const seen = new Set<string>();
  const out: Instrument[] = [];
  for (const list of lists) {
    for (const ins of list) {
      if (!ins.uid || seen.has(ins.uid)) continue;
      seen.add(ins.uid);
      out.push(ins);
    }
  }
  return out;
}

/** Прогрев: Promise.allSettled([getAccounts, getFutures, getShares, getEtfs, getCurrencies, getBonds, getIndices]) → сторы */
export async function warmUpMarketData(): Promise<void> {
  // Демо-режим (нет токена): каталог из mock-данных, чтобы локальный поиск работал офлайн
  if (!useConnectionStore.getState().token) {
    useMarketStore.getState().setInstruments(mockGetAllInstruments());
    return;
  }

  const [accounts, futures, shares, etfs, currencies, bonds, indices] = await Promise.allSettled([
    getAccounts(),
    getFutures(),
    getShares(),
    getEtfs(),
    getCurrencies(),
    getBonds(),
    getIndices(),
  ]);

  if (accounts.status === 'fulfilled') {
    useConnectionStore.getState().setAccounts(accounts.value);
  }

  const instruments = mergeInstruments(
    [futures, shares, etfs, currencies, bonds, indices].map((r) => (r.status === 'fulfilled' ? r.value : [])),
  );
  if (instruments.length > 0) {
    useMarketStore.getState().setInstruments(instruments);
  }
}
