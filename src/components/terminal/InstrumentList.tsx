// Список инструментов всех классов Т-Инвестиций: поиск (findInstrumentAll) + табы классов
// со счётчиками (NavBadge) + избранное + бейджи типа/«Квал» (terminal.md §2.1, CONTRACT.md)
import { useMemo, useState, type RefObject } from 'react';
import { Search, SearchX, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import NavBadge from '@/components/NavBadge';
import { useMarketStore } from '@/store/market';
import { instrumentTypeLabel } from '@/lib/tinvest/instruments';
import type { Instrument, InstrumentType } from '@/types/market';
import { fmtPrice, futuresLabel } from './utils';

export interface InstrumentListProps {
  favorites: Set<string>;
  onToggleFavorite: (uid: string) => void;
  /** Доп. результаты внешнего поиска (findInstrumentAll), мержатся к локальным */
  searchResults?: Instrument[];
  onSearchChange?: (q: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  compact?: boolean;
  onSelect?: () => void;
}

/** Табы классов инструментов (CONTRACT.md: instrumentFilter в market store) */
const TABS: Array<{ key: InstrumentType | 'all'; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'stock', label: 'Акции' },
  { key: 'future', label: 'Фьючерсы' },
  { key: 'index', label: 'Индексы' },
  { key: 'etf', label: 'ETF' },
  { key: 'currency', label: 'Валюта' },
  { key: 'bond', label: 'ОФЗ' },
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
  const filter = useMarketStore((s) => s.instrumentFilter);
  const setInstrumentFilter = useMarketStore((s) => s.setInstrumentFilter);
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  // счётчики по классам для табов
  const counts = useMemo(() => {
    const map = new Map<InstrumentType | 'all', number>();
    map.set('all', instruments.length);
    for (const i of instruments) map.set(i.type, (map.get(i.type) ?? 0) + 1);
    return map;
  }, [instruments]);

  const list = useMemo(() => {
    // мержим результаты внешнего поиска (по uid)
    const map = new Map<string, Instrument>();
    for (const i of instruments) map.set(i.uid, i);
    for (const i of searchResults ?? []) if (!map.has(i.uid)) map.set(i.uid, i);
    let arr = [...map.values()];
    const q = query.trim().toLowerCase();
    if (q) {
      // мгновенный локальный поиск по каталогу: тикер / название / figi / isin
      arr = arr.filter(
        (i) =>
          i.ticker.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          (i.figi ?? '').toLowerCase().includes(q) ||
          (i.isin ?? '').toLowerCase().includes(q),
      );
    }
    if (favOnly) arr = arr.filter((i) => favorites.has(i.uid));
    if (filter !== 'all') arr = arr.filter((i) => i.type === filter);
    // избранное сверху
    arr.sort((a, b) => Number(favorites.has(b.uid)) - Number(favorites.has(a.uid)) || a.ticker.localeCompare(b.ticker));
    return arr;
  }, [instruments, searchResults, query, filter, favOnly, favorites]);

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
            placeholder="Поиск: Si, SBER, IMOEX…  ( / )"
            className="h-9 w-full rounded-[8px] border border-subtle bg-inset pl-8 pr-2 text-sm text-fg placeholder:text-fg-muted focus:border-strong focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setInstrumentFilter(t.key)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                filter === t.key && !favOnly ? 'bg-panel-raised text-yellow' : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {t.label}
              <NavBadge kind="count" count={counts.get(t.key) ?? 0} variant={filter === t.key && !favOnly ? 'accent' : 'neutral'} />
            </button>
          ))}
          <button
            key="fav"
            type="button"
            aria-label="Избранное"
            onClick={() => setFavOnly((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
              favOnly ? 'bg-panel-raised text-yellow' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            <Star className="h-3 w-3" fill={favOnly ? 'currentColor' : 'none'} />
            <NavBadge kind="count" count={favorites.size} variant={favOnly ? 'accent' : 'neutral'} />
          </button>
        </div>
        {/* Счётчик локального поиска (v2 §5.5.2 — паттерн «Найдено: N») */}
        {query.trim() && (
          <div className="mono mt-2 text-[11px] text-fg-muted">
            Найдено: {list.length}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* каталог ещё грузится — скелетон строк вместо пустого состояния (v2 §2.5) */}
        {instruments.length === 0 &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-subtle/50 px-3 py-2">
              <div className="shimmer h-3.5 w-3.5 rounded" />
              <div className="min-w-0 flex-1">
                <div className="shimmer h-3 w-16 rounded" />
                <div className="shimmer mt-1 h-2.5 w-24 rounded" />
              </div>
              <div className="shimmer h-3 w-12 rounded" />
            </div>
          ))}
        {instruments.length > 0 && list.length === 0 && (
          <EmptyState
            compact
            icon={<SearchX className="h-6 w-6" strokeWidth={1.5} />}
            title="Ничего не найдено"
            subtitle="Попробуйте другой тикер или сбросьте фильтры"
            secondaryLabel="Сбросить фильтры"
            onSecondary={() => {
              setQuery('');
              setInstrumentFilter('all');
              setFavOnly(false);
              onSearchChange?.('');
            }}
          />
        )}
        {list.map((ins) => {
          const q = quotes[ins.uid];
          const pct = q?.changePct ?? 0;
          const active = ins.uid === selectedId;
          const fav = favorites.has(ins.uid);
          const unavailable = !ins.apiTradeAvailable && ins.tradable;
          return (
            <div
              key={ins.uid}
              title={unavailable ? 'Инструмент недоступен для торговли через API' : undefined}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-2 border-b border-subtle/50 px-3 transition-colors duration-[120ms] hover:bg-panel-raised',
                compact ? 'py-2.5' : 'py-2',
                // v2 §5.2.2: активный инструмент — левая кромка 2px yellow + bg-panel-raised
                active && 'bg-panel-raised shadow-[inset_2px_0_0_var(--accent-yellow)]',
                // недоступные к торговле через API — визуально приглушены
                unavailable && 'opacity-45',
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
                <div className="flex items-center gap-1.5">
                  <span className="mono truncate text-[13px] font-semibold uppercase text-fg">
                    {futuresLabel(ins)}
                  </span>
                  {/* бейдж класса инструмента */}
                  <span className="shrink-0 rounded-[4px] bg-panel-raised px-1 py-px text-[9px] font-semibold uppercase leading-[14px] text-fg-muted">
                    {instrumentTypeLabel(ins.type)}
                  </span>
                  {ins.forQualInvestor && (
                    <span
                      title="Только для квалифицированных инвесторов"
                      className="shrink-0 rounded-[4px] bg-[rgba(245,165,36,0.12)] px-1 py-px text-[9px] font-semibold uppercase leading-[14px] text-warn"
                    >
                      Квал
                    </span>
                  )}
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
