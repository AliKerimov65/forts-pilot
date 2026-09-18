// Поиск инструмента FORTS для конструктора робота: строка поиска, группировка
// Валюта/Индексы/Товары/Акции, дебаунс, выбор → onChange(instrument, lastPrice).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, ChevronDown } from 'lucide-react';
import type { Instrument } from '@/types/market';
import { useConnectionStore } from '@/store/connection';
import { findInstrument, getLastPrices } from '@/lib/tinvest/services';
import { mockFindInstrument, mockGetLastPrices } from '@/lib/tinvest/mock';
import { cn } from '@/lib/utils';

function groupOf(ins: Instrument): string {
  const a = ins.basicAsset.toUpperCase();
  if (['USD', 'EUR', 'CNY', 'HKD'].some((c) => a.includes(c))) return 'Валюта';
  if (['IMOEX', 'RTSI', 'MOEXOG'].some((c) => a.includes(c))) return 'Индексы';
  if (['BR', 'BRENT', 'GOLD', 'SILV', 'NG', 'LCU'].some((c) => a.includes(c))) return 'Товары';
  return 'Акции';
}

const GROUP_ORDER = ['Валюта', 'Индексы', 'Товары', 'Акции'];

export default function InstrumentPicker({
  value,
  onChange,
}: {
  value: Instrument | null;
  onChange: (instrument: Instrument, lastPrice: number | null) => void;
}) {
  const token = useConnectionStore((s) => s.token);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // loading выводится: fetched.q !== query (без синхронных setState в эффекте)
  const [fetched, setFetched] = useState<{ q: string; items: Instrument[] }>({ q: '', items: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const req = token ? findInstrument(query || 'F') : Promise.resolve(mockFindInstrument(query));
    Promise.resolve(req)
      .then((list) => {
        if (alive) setFetched({ q: query, items: list.slice(0, 30) });
      })
      .catch(() => {
        if (alive) setFetched({ q: query, items: mockFindInstrument(query) });
      });
    return () => {
      alive = false;
    };
  }, [query, token]);

  const results = fetched.items;
  const loading = fetched.q !== query;

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
    const map = new Map<string, Instrument[]>();
    for (const ins of results) {
      const g = groupOf(ins);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(ins);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
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
          <span className="min-w-0 flex-1">
            <span className="mono text-sm font-semibold uppercase text-fg">{value.ticker}</span>
            <span className="ml-2 truncate text-xs text-fg-secondary">{value.name}</span>
          </span>
        ) : (
          <span className="flex-1 text-sm text-fg-muted">Выберите фьючерс FORTS…</span>
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
                placeholder="Поиск: Si, BR, индекс…"
                className="w-full rounded-lg bg-inset px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {loading && results.length === 0 && (
                <div className="p-3 text-center text-xs text-fg-muted">Поиск…</div>
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
                      <span className="mono w-16 shrink-0 text-sm font-semibold uppercase text-fg">{ins.ticker}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{ins.name}</span>
                      <span className="mono shrink-0 text-[10px] text-fg-muted">лот {ins.lot}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
