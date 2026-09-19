// Резолв метаданных инструмента (класс, шаг цены, флаги) по uid.
// Источники: маркет-стор (живой/демо каталог) → mock-каталог всех классов (фолбэк для демо-uid).
// Общий хелпер страниц Дашборд/Позиции/Роботы (src/lib менять нельзя).
import { useMemo } from 'react';
import type { Instrument, InstrumentType } from '@/types/market';
import { useMarketStore } from '@/store/market';
import { MOCK_ALL_INSTRUMENTS } from '@/lib/tinvest/mock';

const MOCK_BY_UID = new Map(MOCK_ALL_INSTRUMENTS.map((i) => [i.uid, i]));

/** Нереактивный поиск инструмента по uid (стор → mock-каталог) */
export function findInstrumentMeta(uid: string): Instrument | undefined {
  return useMarketStore.getState().instruments.find((i) => i.uid === uid) ?? MOCK_BY_UID.get(uid);
}

/** Реактивная карта uid → Instrument: стор поверх mock-каталога (mock — фолбэк) */
export function useInstrumentMetaMap(): Map<string, Instrument> {
  const instruments = useMarketStore((s) => s.instruments);
  return useMemo(() => {
    const map = new Map(MOCK_BY_UID);
    for (const i of instruments) map.set(i.uid, i);
    return map;
  }, [instruments]);
}

/** Класс инструмента по uid (null — инструмент неизвестен каталогу) */
export function instrumentTypeOf(uid: string): InstrumentType | null {
  return findInstrumentMeta(uid)?.type ?? null;
}
