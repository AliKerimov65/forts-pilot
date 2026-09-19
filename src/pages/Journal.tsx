// Журнал сделок — /journal (journal.md)
// Сводка (StatCards), кумулятивный P&L-график (recharts area), гистограмма распределения,
// фильтры-чипы, таблица/карточки сделок с карточкой-деталями, экспорт CSV (Blob).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import Lenis from 'lenis';
import { useEffect } from 'react';
import { Bot, CandlestickChart, ChevronDown, Download, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTradingStore } from '@/store/trading';
import { useDashboardData } from '@/hooks/useDashboardData';
import { formatDateShort, formatNumber } from '@/lib/format';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import { ToastHost } from '@/components/monitor/toast';
import { showToast } from '@/components/monitor/toastBus';
import JournalSummary from '@/components/journal/JournalSummary';
import PnlChart from '@/components/journal/PnlChart';
import DistributionPanel from '@/components/journal/DistributionPanel';
import FilterBar from '@/components/journal/FilterBar';
import TradesList from '@/components/journal/TradesList';
import TradeDetails from '@/components/journal/TradeDetails';
import {
  activeFilterCount,
  applyFilters,
  computeStats,
  downloadCsv,
  EMPTY_FILTERS,
  enrichTrade,
  PERIOD_OPTIONS,
  tradesToCsv,
  type EnrichedTrade,
  type JournalFilters,
  type PeriodKey,
} from '@/components/journal/journalUtils';

/** Чип активного фильтра в строке «Найдено: …» над таблицей (v2 §5.5.2) */
function ActiveFilterChip({ label, onClear, mono }: { label: string; onClear: () => void; mono?: boolean }) {
  return (
    <span className="flex h-6 items-center gap-1 rounded-full border border-yellow/40 bg-yellow-glow px-2 text-[11px] font-semibold text-yellow">
      <span className={mono ? 'mono uppercase' : undefined}>{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Убрать фильтр ${label}`}
        className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-yellow/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** SegmentedControl периода (design.md §5); layoutId — уникальный на инстанс (desktop + mobile смонтированы одновременно) */
function PeriodControl({ value, onChange, layoutId = 'journal-period' }: { value: PeriodKey; onChange: (v: PeriodKey) => void; layoutId?: string }) {
  return (
    <div className="flex rounded-[10px] bg-inset p-0.5">
      {PERIOD_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
            value === o.value ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-lg border-b-2 border-yellow bg-panel-raised"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative z-10">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function Journal() {
  const navigate = useNavigate();
  const { refresh } = useDashboardData(); // seed + live-поллинг (демо — mock-сделки)
  const rawTrades = useTradingStore((s) => s.trades);

  const [period, setPeriod] = useState<PeriodKey>('month');
  const [filters, setFilters] = useState<JournalFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<EnrichedTrade | null>(null);
  const [exporting, setExporting] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false); // mobile accordion «Статистика»

  // Lenis — плавный скролл desktop (journal.md §3)
  useEffect(() => {
    if (window.innerWidth < 1024) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ duration: 1.0 });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  // ----- pull-to-refresh (mobile) -----
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const enriched = useMemo(() => rawTrades.map(enrichTrade), [rawTrades]);
  const tickers = useMemo(() => [...new Set(enriched.map((t) => t.ticker))].sort(), [enriched]);
  const filtered = useMemo(() => applyFilters(enriched, period, filters), [enriched, period, filters]);
  const stats = useMemo(() => computeStats(filtered, period), [filtered, period]);

  const firstTradeTime = enriched.length > 0 ? Math.min(...enriched.map((t) => t.time)) : null;
  const filtersActive = activeFilterCount(filters) > 0;

  const handleExport = () => {
    if (exporting) return;
    setExporting(true);
    // короткий спиннер (600ms) → файл + тост (journal.md §3)
    setTimeout(() => {
      const csv = tradesToCsv([...filtered].sort((a, b) => a.time - b.time));
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `forts-pilot-journal-${stamp}.csv`;
      downloadCsv(csv, fileName);
      setExporting(false);
      // v2 §5.5.8: честная обратная связь — «Открыть папку» в PWA недоступно
      showToast({ variant: 'success', title: 'Журнал экспортирован', description: `Файл сохранён: ${fileName}` });
    }, 600);
  };

  const hasAnyTrades = enriched.length > 0;

  const analytics = (
    <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
      <div className="lg:col-span-7">
        <PnlChart trades={filtered} best={stats.best} worst={stats.worst} onTradeClick={setSelected} />
      </div>
      <div className="lg:col-span-5">
        <DistributionPanel trades={filtered} stats={stats} onTradeClick={setSelected} />
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="space-y-4 lg:space-y-5"
      onTouchStart={(e) => {
        if (window.scrollY <= 0) touchStartY.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (touchStartY.current === null) return;
        const dy = e.touches[0].clientY - touchStartY.current;
        if (dy > 0 && window.scrollY <= 0) setPull(Math.min(dy / 2.2, 90));
      }}
      onTouchEnd={() => {
        if (pull > 70 && !refreshing) {
          setRefreshing(true);
          navigator.vibrate?.(10);
          void refresh().finally(() => setRefreshing(false));
        }
        setPull(0);
        touchStartY.current = null;
      }}
    >
      {/* Pull-to-refresh индикатор */}
      <div
        className="pointer-events-none fixed left-1/2 top-[104px] z-20 -translate-x-1/2 md:hidden"
        style={{ opacity: pull > 8 || refreshing ? 1 : 0, transition: 'opacity 150ms' }}
      >
        <motion.img
          src="/logo.svg"
          alt=""
          width={36}
          height={36}
          animate={refreshing ? { rotate: 360 } : { rotate: pull * 3 }}
          transition={refreshing ? { repeat: Infinity, duration: 0.9, ease: 'linear' } : { duration: 0 }}
        />
      </div>

      {/* Шапка (PageHeader v2; период — в actions на desktop, скролл-чипы под шапкой на mobile) */}
      <PageHeader
        group="Учёт и риски"
        title="Журнал сделок"
        subtitle={
          <>
            Всего <span className="mono">{formatNumber(enriched.length)}</span> сделок
            {firstTradeTime !== null && (
              <>
                {' · с '}
                <span className="mono">{formatDateShort(firstTradeTime)}</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <div className="hidden md:block">
              <PeriodControl value={period} onChange={setPeriod} />
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || filtered.length === 0}
              className="flex h-10 items-center gap-2 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:bg-panel-raised hover:text-fg disabled:opacity-45"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Экспорт CSV</span>
            </button>
          </>
        }
      />

      {/* Mobile: период — строка скролл-чипов под шапкой (v2 §5.5.1) */}
      <div className="-mx-3 overflow-x-auto px-3 md:hidden">
        <PeriodControl value={period} onChange={setPeriod} layoutId="journal-period-mobile" />
      </div>

      {!hasAnyTrades ? (
        /* Полностью пустой журнал */
        <section className="rounded-xl border border-subtle bg-panel">
          <EmptyState
            image="/empty-journal.svg"
            imageAlt="Пустой журнал"
            title="Сделок пока нет"
            subtitle="Запустите робота или совершите сделку в терминале"
          />
          <div className="flex flex-wrap items-center justify-center gap-3 pb-8">
            <button
              type="button"
              onClick={() => navigate('/terminal')}
              className="flex h-10 items-center gap-2 rounded-[10px] bg-yellow px-4 text-sm font-bold text-app hover:glow-accent"
            >
              <CandlestickChart className="h-4 w-4" />
              Открыть терминал
            </button>
            <button
              type="button"
              onClick={() => navigate('/robots')}
              className="flex h-10 items-center gap-2 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary hover:border-strong hover:text-fg"
            >
              <Bot className="h-4 w-4" />
              Запустить робота
            </button>
          </div>
        </section>
      ) : (
        <>
          <JournalSummary stats={stats} />

          {/* Desktop: аналитика */}
          <div className="hidden md:block">{analytics}</div>

          {/* Mobile: accordion «Статистика» */}
          <div className="rounded-xl border border-subtle bg-panel md:hidden">
            <button
              type="button"
              onClick={() => setStatsOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-fg"
              aria-expanded={statsOpen}
            >
              Статистика
              <ChevronDown className={cn('h-4 w-4 text-fg-muted transition-transform', statsOpen && 'rotate-180')} />
            </button>
            <AnimatePresence initial={false}>
              {statsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-4 px-1 pb-3">{analytics}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <FilterBar filters={filters} tickers={tickers} onChange={setFilters} foundCount={filtered.length} />

          {/* v2 §5.5.2: активные фильтры — отдельной строкой над таблицей */}
          {filtersActive && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-fg-secondary">
                Найдено: <span className="mono font-semibold text-fg">{formatNumber(filtered.length)}</span> сделок
              </span>
              {filters.instruments.map((t) => (
                <ActiveFilterChip
                  key={t}
                  label={t}
                  mono
                  onClear={() => setFilters({ ...filters, instruments: filters.instruments.filter((x) => x !== t) })}
                />
              ))}
              {filters.source !== 'all' && (
                <ActiveFilterChip
                  label={filters.source === 'robot' ? 'От роботов' : 'Ручные'}
                  onClear={() => setFilters({ ...filters, source: 'all' })}
                />
              )}
              {filters.direction !== 'all' && (
                <ActiveFilterChip
                  label={filters.direction === 'long' ? 'Лонг' : 'Шорт'}
                  onClear={() => setFilters({ ...filters, direction: 'all' })}
                />
              )}
              {filters.result !== 'all' && (
                <ActiveFilterChip
                  label={filters.result === 'profit' ? 'Прибыльные' : 'Убыточные'}
                  onClear={() => setFilters({ ...filters, result: 'all' })}
                />
              )}
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="ml-auto text-xs font-semibold text-fg-muted underline-offset-[3px] transition-colors hover:text-fg hover:underline"
              >
                Сбросить
              </button>
            </div>
          )}

          <TradesList
            trades={filtered}
            onOpen={setSelected}
            filtersActive={filtersActive}
            onResetFilters={() => setFilters(EMPTY_FILTERS)}
            footerAction={
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || filtered.length === 0}
                className="flex h-7 items-center gap-1.5 rounded-md border border-subtle px-2.5 text-xs font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg disabled:opacity-45"
              >
                {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Экспорт
              </button>
            }
          />
        </>
      )}

      <TradeDetails trade={selected} onOpenChange={(o) => !o && setSelected(null)} />
      <ToastHost />
    </motion.div>
  );
}
