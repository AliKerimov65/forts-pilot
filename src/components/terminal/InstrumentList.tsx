// Список инструментов FORTS: поиск + табы категорий + избранное (terminal.md §2.1)
import { useMemo, useState, type RefObject } from 'react';
import { Search, SearchX, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import { useMarketStore } from '@/store/market';
import type { Instrument } from '@/types/market';
import { categoryOf, fmtPrice, futuresLabel, type InstrumentCategory } from './utils';

export interface InstrumentListProps {
  favorites: Set<string>;
  onToggleFavorite: (uid: string) => void;
  /** Доп. результаты внешнего поиска (findInstrument), мержатся к локальным */
  searchResults?: Instrument[];
  onSearchChange?: (q: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  compact?: boolean;
  onSelect?: () => void;
}

const TABS: Array<{ key: InstrumentCategory; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'index', label: 'Индексы' },
  { key: 'currency', label: 'Валюта' },
  { key: 'commodity', label: 'Товары' },
  { key: 'fav', label: '★' },
];

export default function InstrumentList({
  favorites,
  onToggleFavorite,
  searchResults,
  onSearchChange,
  searchInputRef,
  compact,
  onSelect,
}: InstrumentListProps) {
  const instruments = useMarketStore((s) => s.instruments);
  const quotes = useMarketStore((s) => s.quotes);
  const selectedId = useMarketStore((s) => s.selectedInstrumentId);
  const selectInstrument = useMarketStore((s) => s.selectInstrument);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<InstrumentCategory>('all');

  const list = useMemo(() => {
    // мержим результаты внешнего поиска (по uid)
    const map = new Map<string, Instrument>();
    for (const i of instruments) map.set(i.uid, i);
    for (const i of searchResults ?? []) if (!map.has(i.uid)) map.set(i.uid, i);
    let arr = [...map.values()];
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (i) => i.ticker.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
      );
    }
    if (tab === 'fav') arr = arr.filter((i) => favorites.has(i.uid));
    else if (tab !== 'all') arr = arr.filter((i) => categoryOf(i) === tab);
    // избранное сверху
    arr.sort((a, b) => Number(favorites.has(b.uid)) - Number(favorites.has(a.uid)) || a.ticker.localeCompare(b.ticker));
    return arr;
  }, [instruments, searchResults, query, tab, favorites]);

  return (
    <div className="flex h-full flex-col">
      {/* Шапка списка (поиск + табы) — не скроллится вместе со строками (v2 §5.2.2) */}
      <div className="shrink-0 border-b border-subtle p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onSearchChange?.(e.target.value);
            }}
            placeholder="Поиск: Si, Brent…  ( / )"
            className="h-9 w-full rounded-[8px] border border-subtle bg-inset pl-8 pr-2 text-sm text-fg placeholder:text-fg-muted focus:border-strong focus:outline-none"
          />
        </div>
        <div className="mt-2 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                tab === t.key ? 'bg-panel-raised text-yellow' : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 && (
          <EmptyState
            compact
            icon={<SearchX className="h-6 w-6" strokeWidth={1.5} />}
            title="Ничего не найдено"
            subtitle="Попробуйте другой тикер или сбросьте фильтры"
            secondaryLabel="Сбросить фильтры"
            onSecondary={() => {
              setQuery('');
              setTab('all');
              onSearchChange?.('');
            }}
          />
        )}
        {list.map((ins) => {
          const q = quotes[ins.uid];
          const pct = q?.changePct ?? 0;
          const active = ins.uid === selectedId;
          const fav = favorites.has(ins.uid);
          return (
            <div
              key={ins.uid}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-2 border-b border-subtle/50 px-3 transition-colors duration-[120ms] hover:bg-panel-raised',
                compact ? 'py-2.5' : 'py-2',
                // v2 §5.2.2: активный инструмент — левая кромка 2px yellow + bg-panel-raised
                active && 'bg-panel-raised shadow-[inset_2px_0_0_var(--accent-yellow)]',
              )}
              onClick={() => {
                selectInstrument(ins.uid);
                onSelect?.();
              }}
            >
              <button
                type="button"
                aria-label="Избранное"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(ins.uid);
                }}
                className={cn(
                  'shrink-0 rounded p-0.5 transition-colors',
                  fav ? 'text-yellow' : 'text-fg-muted opacity-0 hover:text-yellow group-hover:opacity-100',
                )}
              >
                <Star className="h-3.5 w-3.5" fill={fav ? 'currentColor' : 'none'} />
              </button>
              <div className="min-w-0 flex-1 text-left">
                <div className="mono truncate text-[13px] font-semibold uppercase text-fg">
                  {futuresLabel(ins)}
                </div>
                <div className="truncate text-[11px] text-fg-muted">{ins.name}</div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  key={q?.time ?? 0}
                  className={cn(
                    'mono text-[13px] font-medium text-fg',
                    q && q.delta > 0 && 'flash-long rounded',
                    q && q.delta < 0 && 'flash-short rounded',
                  )}
                >
                  {q ? fmtPrice(q.price, ins) : '—'}
                </div>
                {q && (
                  <div className={cn('mono text-[11px]', pct >= 0 ? 'text-long' : 'text-short')}>
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
