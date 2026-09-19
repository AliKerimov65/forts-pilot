// Поиск инструмента для конструктора робота по ВСЕМ торговым классам Т-Инвестиций
// (findInstrumentAll): акции, фьючерсы, ETF, валюты, ОФЗ (+опционы).
// Индексы исключены — они неторгуемые (только котировки, бриф §4).
// Группировка по классу с бейджами, «только лонг» для shortEnabled=false.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, ChevronDown } from 'lucide-react';
import type { Instrument, InstrumentType } from '@/types/market';
import Badge from '@/components/Badge';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { findInstrumentAll, getLastPrices } from '@/lib/tinvest/services';
import { isTradable, instrumentTypeLabel, searchInstrumentsLocal } from '@/lib/tinvest/instruments';
import { isCatalogStale, warmUpMarketData } from '@/components/connect/warmup';
import { mockFindInstrumentAll, mockGetAllInstruments, mockGetLastPrices } from '@/lib/tinvest/mock';
import { cn } from '@/lib/utils';

/** Заголовки групп по классам (порядок = порядок групп в дропдауне) */
const GROUP_LABELS: Array<[InstrumentType, string]> = [
  ['stock', 'Акции'],
  ['future', 'Фьючерсы'],
  ['etf', 'ETF'],
  ['currency', 'Валюта'],
  ['bond', 'ОФЗ'],
  ['option', 'Опционы'],
];

/** В выборку робота идут только торгуемые классы (индексы — только котировки) */
function selectable(ins: Instrument): boolean {
  return ins.type !== 'index' && isTradable(ins);
}

export default function InstrumentPicker({
  value,
  onChange,
}: {
  value: Instrument | null;
  onChange: (instrument: Instrument, lastPrice: number | null) => void;
}) {
  const token = useConnectionStore((s) => s.token);
  const instruments = useMarketStore((s) => s.instruments);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Дозагрузка из API (только когда локально < 5 совпадений); loading: remote.q !== query
  const [remote, setRemote] = useState<{ q: string; items: Instrument[] }>({ q: '', items: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  // При открытии: прогреть каталог, если он пуст/устарел (>30 мин)
  useEffect(() => {
    if (open && isCatalogStale()) void warmUpMarketData().catch(() => {});
  }, [open]);

  // Мгновенный локальный поиск по предзагруженному каталогу (без дебаунса)
  const localResults = useMemo(() => {
    const pool = instruments.length > 0 ? instruments : token ? [] : mockGetAllInstruments();
    const q = query.trim();
    const base = q ? searchInstrumentsLocal(pool, q) : pool;
    return base.filter(selectable).slice(0, 40);
  }, [instruments, query, token]);

  // Удалённый findInstrumentAll — дозагрузка, если локально найдено < 5 (дебаунс 150мс)
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q || localResults.length >= 5) {
      setRemote({ q, items: [] });
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      const req = token ? findInstrumentAll(q) : Promise.resolve(mockFindInstrumentAll(q));
      Promise.resolve(req)
        .then((list) => {
          if (alive) setRemote({ q, items: list.filter(selectable) });
        })
        .catch(() => {
          if (alive) setRemote({ q, items: [] });
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, query, token, localResults.length]);

  // Локальные результаты + дозагруженные (дедуп по uid)
  const results = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const i of localResults) map.set(i.uid, i);
    for (const i of remote.items) if (!map.has(i.uid)) map.set(i.uid, i);
    return [...map.values()].slice(0, 40);
  }, [localResults, remote]);
  const loading = query.trim().length > 0 && localResults.length < 5 && remote.q !== query.trim();

  // Закрытие по клику вне
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const grouped = useMemo(() => {
    const map = new Map<InstrumentType, Instrument[]>();
    for (const ins of results) {
      if (!map.has(ins.type)) map.set(ins.type, []);
      map.get(ins.type)!.push(ins);
    }
    return GROUP_LABELS.filter(([t]) => map.has(t)).map(([t, label]) => ({ group: label, items: map.get(t)! }));
  }, [results]);

  const pick = async (ins: Instrument) => {
    setOpen(false);
    setQuery('');
    let price: number | null = null;
    try {
      const quotes = token ? await getLastPrices([ins.uid]) : mockGetLastPrices([ins.uid]);
      price = quotes[0]?.price ?? null;
    } catch {
      price = mockGetLastPrices([ins.uid])[0]?.price ?? null;
    }
    onChange(ins, price);
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border bg-inset px-3 py-2.5 text-left transition-colors',
          open ? 'border-strong' : 'border-subtle hover:border-strong',
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-fg-muted" />
        {value ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="mono shrink-0 text-sm font-semibold uppercase text-fg">{value.ticker}</span>
            <Badge variant="neutral" size="compact" className="shrink-0">
              {instrumentTypeLabel(value.type)}
            </Badge>
            <span className="truncate text-xs text-fg-secondary">{value.name}</span>
          </span>
        ) : (
          <span className="flex-1 text-sm text-fg-muted">Выберите инструмент…</span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-subtle bg-panel-raised shadow-xl"
          >
            <div className="border-b border-subtle p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск: SBER, Si, TMOS, ОФЗ, USD…"
                className="w-full rounded-lg bg-inset px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {query.trim() && (
                <div className="mono px-2 pb-1 pt-1 text-[10px] text-fg-muted">
                  Найдено: {results.length}
                  {loading && ' · догружаем из API…'}
                </div>
              )}
              {loading && results.length === 0 && (
                <div className="space-y-1 p-1">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="shimmer h-8 rounded-lg" />
                  ))}
                </div>
              )}
              {!loading && results.length === 0 && (
                <div className="p-3 text-center text-xs text-fg-muted">Ничего не найдено</div>
              )}
              {grouped.map((g) => (
                <div key={g.group}>
                  <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                    {g.group}
                  </div>
                  {g.items.map((ins) => (
                    <button
                      key={ins.uid}
                      type="button"
                      onClick={() => void pick(ins)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel"
                    >
                      <span className="mono w-16 shrink-0 truncate text-sm font-semibold uppercase text-fg">{ins.ticker}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{ins.name}</span>
                      {ins.shortEnabled === false && (
                        <span className="shrink-0 rounded-full bg-[rgba(245,165,36,0.12)] px-1.5 text-[10px] font-semibold leading-4 text-warn">
                          только лонг
                        </span>
                      )}
                      <span className="mono shrink-0 text-[10px] text-fg-muted">лот {ins.lot}</span>
                    </button>
                  ))}
                </div>
              ))}
              <div className="px-2 pb-1 pt-2 text-[10px] leading-4 text-fg-muted">
                Индексы (IMOEX, RTSI…) не торгуются — доступны только их котировки в терминале.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
