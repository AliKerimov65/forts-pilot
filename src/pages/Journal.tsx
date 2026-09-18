// Журнал сделок — /journal (journal.md)
// Сводка (StatCards), кумулятивный P&L-график (recharts area), гистограмма распределения,
// фильтры-чипы, таблица/карточки сделок с карточкой-деталями, экспорт CSV (Blob).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import Lenis from 'lenis';
import { useEffect } from 'react';
import { Bot, CandlestickChart, ChevronDown, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTradingStore } from '@/store/trading';
import { useDashboardData } from '@/hooks/useDashboardData';
import { formatDateShort, formatNumber } from '@/lib/format';
import EmptyState from '@/components/EmptyState';
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

/** SegmentedControl периода (design.md §5) */
function PeriodControl({ value, onChange }: { value: PeriodKey; onChange: (v: PeriodKey) => void }) {
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
              layoutId="journal-period"
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
      downloadCsv(csv, `forts-pilot-journal-${stamp}.csv`);
      setExporting(false);
      showToast({ variant: 'success', title: 'Журнал экспортирован', description: `${filtered.length} строк · CSV` });
    }, 600);
  };

  const hasAnyTrades = enriched.length > 0;

  const analytics = (
    <div className="grid gap-4 lg:grid-cols-12">
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
      className="space-y-4"
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

      {/* Шапка */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold leading-7 tracking-[-0.02em] text-fg md:text-[28px] md:leading-[34px]">
            Журнал сделок
          </h1>
          <p className="mt-1 text-xs font-medium text-fg-secondary">
            Всего <span className="mono">{formatNumber(enriched.length)}</span> сделок
            {firstTradeTime !== null && (
              <>
                {' · с '}
                <span className="mono">{formatDateShort(firstTradeTime)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodControl value={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || filtered.length === 0}
            className="flex h-9 items-center gap-2 rounded-[10px] border border-subtle px-3.5 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg disabled:opacity-40"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Экспорт CSV
          </button>
        </div>
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

          <TradesList trades={filtered} onOpen={setSelected} filtersActive={filtersActive} onResetFilters={() => setFilters(EMPTY_FILTERS)} />
        </>
      )}

      <TradeDetails trade={selected} onOpenChange={(o) => !o && setSelected(null)} />
      <ToastHost />
    </motion.div>
  );
}
