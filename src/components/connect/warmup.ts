// Параллельный прогрев данных после установки соединения:
// счета + каталоги инструментов грузятся заранее, чтобы терминал
// открылся мгновенно, без спиннера каталогов. Лучшее усилие:
// частичные ошибки (напр. Indicatives недоступны в песочнице) игнорируются.
import type { Instrument } from '@/types/market';
import { getAccounts, getFutures, getIndices, getShares } from '@/lib/tinvest/services';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';

/** Дедупликация по uid, порядок: фьючерсы → акции → индексы */
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

/** Прогрев: Promise.allSettled([getAccounts, getFutures, getShares, getIndices]) → сторы */
export async function warmUpMarketData(): Promise<void> {
  const [accounts, futures, shares, indices] = await Promise.allSettled([
    getAccounts(),
    getFutures(),
    getShares(),
    getIndices(),
  ]);

  if (accounts.status === 'fulfilled') {
    useConnectionStore.getState().setAccounts(accounts.value);
  }

  const instruments = mergeInstruments(
    [futures, shares, indices].map((r) => (r.status === 'fulfilled' ? r.value : [])),
  );
  if (instruments.length > 0) {
    useMarketStore.getState().setInstruments(instruments);
  }
}
