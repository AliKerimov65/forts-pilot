// Панель фильтров журнала (journal.md §1): чипы-фильтры (инструмент — мультиселект,
// источник, направление, результат), активные — жёлтые чипы с ✕, кнопка «Сбросить».
// Mobile — кнопка «Фильтры (N)» + bottom-sheet.
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { activeFilterCount, EMPTY_FILTERS, type JournalFilters } from './journalUtils';

interface ChipProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function Chip({ active, label, onClick }: ChipProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={false}
      animate={{ scale: active ? [0.8, 1.05, 1] : 1 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
        active
          ? 'border-yellow/60 bg-yellow-glow text-yellow'
          : 'border-subtle bg-inset text-fg-secondary hover:border-strong hover:text-fg',
      )}
    >
      {label}
      {active && <X className="h-3 w-3" />}
    </motion.button>
  );
}

function FilterControls({
  filters,
  tickers,
  onChange,
}: {
  filters: JournalFilters;
  tickers: string[];
  onChange: (f: JournalFilters) => void;
}) {
  const [search, setSearch] = useState('');
  const shownTickers = tickers.filter((t) => t.toLowerCase().includes(search.toLowerCase()));

  const toggleInstrument = (t: string) => {
    const has = filters.instruments.includes(t);
    onChange({ ...filters, instruments: has ? filters.instruments.filter((x) => x !== t) : [...filters.instruments, t] });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Инструмент — мультиселект */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
            filters.instruments.length > 0
              ? 'border-yellow/60 bg-yellow-glow text-yellow'
              : 'border-subtle bg-inset text-fg-secondary hover:border-strong hover:text-fg',
          )}
        >
          Инструмент{filters.instruments.length > 0 && `: ${filters.instruments.length}`}
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 border-subtle bg-panel-raised p-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск тикера…"
            className="mono mb-2 h-8 w-full rounded-lg border border-subtle bg-inset px-2.5 text-xs text-fg outline-none focus:border-strong"
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="max-h-48 overflow-y-auto">
            {shownTickers.map((t) => {
              const active = filters.instruments.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleInstrument(t)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-panel',
                    active ? 'text-yellow' : 'text-fg-secondary',
                  )}
                >
                  <span className="mono font-semibold uppercase">{t}</span>
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
            {shownTickers.length === 0 && <div className="px-2.5 py-2 text-xs text-fg-muted">Ничего не найдено</div>}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Источник */}
      <Chip active={filters.source === 'manual'} label="Ручные" onClick={() => onChange({ ...filters, source: filters.source === 'manual' ? 'all' : 'manual' })} />
      <Chip active={filters.source === 'robot'} label="Роботы" onClick={() => onChange({ ...filters, source: filters.source === 'robot' ? 'all' : 'robot' })} />

      {/* Направление */}
      <Chip active={filters.direction === 'long'} label="Лонг" onClick={() => onChange({ ...filters, direction: filters.direction === 'long' ? 'all' : 'long' })} />
      <Chip active={filters.direction === 'short'} label="Шорт" onClick={() => onChange({ ...filters, direction: filters.direction === 'short' ? 'all' : 'short' })} />

      {/* Результат */}
      <Chip active={filters.result === 'profit'} label="Прибыльные" onClick={() => onChange({ ...filters, result: filters.result === 'profit' ? 'all' : 'profit' })} />
      <Chip active={filters.result === 'loss'} label="Убыточные" onClick={() => onChange({ ...filters, result: filters.result === 'loss' ? 'all' : 'loss' })} />

      <AnimatePresence>
        {activeFilterCount(filters) > 0 && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={() => onChange(EMPTY_FILTERS)}
            className="flex h-8 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-fg-muted transition-colors hover:text-fg"
          >
            <RotateCcw className="h-3 w-3" />
            Сбросить
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface FilterBarProps {
  filters: JournalFilters;
  tickers: string[];
  onChange: (f: JournalFilters) => void;
  foundCount: number;
}

export default function FilterBar({ filters, tickers, onChange, foundCount }: FilterBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const count = activeFilterCount(filters);

  return (
    <>
      {/* Desktop: панель 48px */}
      <div className="hidden items-center justify-between gap-3 rounded-xl border border-subtle bg-panel px-4 py-2 md:flex">
        <FilterControls filters={filters} tickers={tickers} onChange={onChange} />
        <span className="mono shrink-0 text-xs text-fg-muted">Найдено {foundCount}</span>
      </div>

      {/* Mobile: кнопка + активные чипы строкой */}
      <div className="flex items-center gap-2 overflow-x-auto md:hidden">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
            count > 0 ? 'border-yellow/60 bg-yellow-glow text-yellow' : 'border-subtle bg-inset text-fg-secondary',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Фильтры{count > 0 && ` (${count})`}
        </button>
        {filters.instruments.map((t) => (
          <Chip key={t} active label={t} onClick={() => onChange({ ...filters, instruments: filters.instruments.filter((x) => x !== t) })} />
        ))}
        {count > 0 && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="shrink-0 text-xs font-semibold text-fg-muted">
            Сбросить
          </button>
        )}
        <span className="mono ml-auto shrink-0 text-xs text-fg-muted">{foundCount}</span>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="border-subtle bg-panel-raised">
          <SheetHeader>
            <SheetTitle className="text-fg">Фильтры</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-8">
            <FilterControls
              filters={filters}
              tickers={tickers}
              onChange={(f) => {
                onChange(f);
              }}
            />
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="mt-4 h-11 w-full rounded-[10px] bg-yellow text-sm font-bold text-app"
            >
              Показать {foundCount} сделок
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
