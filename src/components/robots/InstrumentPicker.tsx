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
import { findInstrumentAll, getLastPrices } from '@/lib/tinvest/services';
import { isTradable, instrumentTypeLabel } from '@/lib/tinvest/instruments';
import { mockFindInstrumentAll, mockGetLastPrices } from '@/lib/tinvest/mock';
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // loading выводится: fetched.q !== query (без синхронных setState в эффекте)
  const [fetched, setFetched] = useState<{ q: string; items: Instrument[] }>({ q: '', items: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // Пустой запрос: в демо отдаём весь каталог, в боевом — стартовую выборку по «S»
    const req = token ? findInstrumentAll(query || 'S') : Promise.resolve(mockFindInstrumentAll(query));
    Promise.resolve(req)
      .then((list) => {
        if (alive) setFetched({ q: query, items: list.filter(selectable).slice(0, 40) });
      })
      .catch(() => {
        if (alive) setFetched({ q: query, items: mockFindInstrumentAll(query).filter(selectable) });
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
