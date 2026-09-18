// Дашборд (роут /) — полная реализация по home.md
// Equity-график, 4 StatCards, донат роботов, позиции, лента событий, watchlist FORTS,
// флэши цен, pull-to-refresh на мобильном, Lenis на desktop.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import Lenis from 'lenis';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeftRight, ArrowRight, Bot, Info, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { useRobotsStore } from '@/store/robots';
import { useDashboardData } from '@/hooks/useDashboardData';
import { mockGetCandles, mockGetRobots } from '@/lib/tinvest/mock';
import { formatNumber, formatPct, formatRelative, formatRub, formatSignedRub } from '@/lib/format';
import type { JournalEventType } from '@/types/trading';
import StatCard from '@/components/StatCard';
import Badge from '@/components/Badge';
import PriceTicker from '@/components/PriceTicker';
import RobotStatusDot from '@/components/RobotStatusDot';
import Sparkline from '@/components/Sparkline';
import EmptyState from '@/components/EmptyState';

type EquityPeriod = '1D' | '1W' | '1M' | '3M' | 'ALL';
const PERIOD_LABELS: Record<EquityPeriod, string> = { '1D': '1Д', '1W': '1Н', '1M': '1М', '3M': '3М', ALL: 'Всё' };
const DONUT_COLORS = ['#FFDD2D', '#16C784', '#3B82F6', '#5B6472'];

/** SegmentedControl периодов (design.md §5) */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-[10px] bg-inset p-0.5">
      {options.map((o) => (
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
              layoutId="seg-indicator"
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

/** Приветствие по времени суток */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** Живой обратный отсчёт до конца вечерней сессии (23:50) */
function useSessionCountdown(): string {
  const [text, setText] = useState('');
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 50, 0, 0);
      let diff = end.getTime() - now.getTime();
      if (diff < 0) diff += 86_400_000;
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      setText(`${h} ч ${String(m).padStart(2, '0')} мин`);
    };
    update();
    const t = setInterval(update, 30_000);
    return () => clearInterval(t);
  }, []);
  return text;
}

const EVENT_ICONS: Record<JournalEventType, { icon: typeof Info; className: string }> = {
  trade: { icon: ArrowLeftRight, className: 'bg-panel text-fg-secondary' },
  order: { icon: ArrowLeftRight, className: 'bg-panel text-fg-secondary' },
  sl: { icon: ShieldAlert, className: 'bg-short-dim text-short' },
  tp: { icon: ShieldCheck, className: 'bg-long-dim text-long' },
  robot: { icon: Bot, className: 'bg-yellow-glow text-yellow' },
  risk: { icon: ShieldAlert, className: 'bg-[rgba(245,165,36,0.12)] text-warn' },
  system: { icon: Info, className: 'bg-[rgba(59,130,246,0.12)] text-info' },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { refresh } = useDashboardData();
  const [period, setPeriod] = useState<EquityPeriod>('1D');

  const account = useConnectionStore((s) => s.accounts.find((a) => a.id === s.accountId));
  const mode = useConnectionStore((s) => s.mode);
  const connStatus = useConnectionStore((s) => s.status);
  const demoMode = useConnectionStore((s) => s.demoMode);
  const offline = connStatus === 'offline' || connStatus === 'error';

  const portfolio = useTradingStore((s) => s.portfolio);
  const positions = useTradingStore((s) => s.positions);
  const events = useTradingStore((s) => s.events);
  const trades = useTradingStore((s) => s.trades);
  const equity = useTradingStore((s) => s.equity);
  const instruments = useMarketStore((s) => s.instruments);
  const quotes = useMarketStore((s) => s.quotes);
  const selectInstrument = useMarketStore((s) => s.selectInstrument);

  const storeRobots = useRobotsStore((s) => s.robots);
  const robots = storeRobots.length > 0 ? storeRobots : demoMode ? mockGetRobots() : [];
  const runningRobots = robots.filter((r) => r.status === 'running');

  const countdown = useSessionCountdown();

  // Lenis — плавный скролл только desktop (design.md §6-7)
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

  // ----- производные данные -----
  const equityData = useMemo(() => equity[period] ?? [], [equity, period]);
  const equityUp = equityData.length > 1 ? equityData[equityData.length - 1].equity >= equityData[0].equity : true;
  const pnlSparkline = useMemo(() => (equity['1D'] ?? []).map((p) => p.equity), [equity]);

  const { winRate, profitFactor, tradesCount } = useMemo(() => {
    const closed = trades.filter((t) => t.pnl !== undefined);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
    const grossProfit = wins.reduce((a, t) => a + (t.pnl ?? 0), 0);
    const grossLoss = Math.abs(closed.filter((t) => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0));
    return {
      winRate: closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0,
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2).replace('.', ',') : '—',
      tradesCount: closed.length,
    };
  }, [trades]);

  const todayTrades = useMemo(
    () => trades.filter((t) => new Date(t.time).toDateString() === new Date().toDateString()).length,
    [trades],
  );

  const marginPct = portfolio
    ? Math.round((portfolio.blockedMargin / Math.max(1, portfolio.blockedMargin + portfolio.freeMargin)) * 100)
    : 0;

  const capitalInRobots = useMemo(() => robots.reduce((a, r) => a + r.stats.allocatedCapital, 0), [robots]);
  const capitalPct = portfolio ? Math.round((capitalInRobots / Math.max(1, portfolio.totalAmount)) * 100) : 0;

  // ----- pull-to-refresh (mobile) -----
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 0) touchStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0 && window.scrollY <= 0) setPull(Math.min(dy / 2.2, 90));
  };
  const onTouchEnd = async () => {
    if (pull > 70 && !refreshing) {
      setRefreshing(true);
      navigator.vibrate?.(10);
      await refresh();
      setRefreshing(false);
    }
    setPull(0);
    touchStartY.current = null;
  };

  const showCta = robots.length < 1 || true; // ротационный совет дня — показываем всегда

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* Pull-to-refresh индикатор */}
      <div
        className="pointer-events-none fixed left-1/2 top-[104px] z-20 -translate-x-1/2 lg:hidden"
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

      {/* Баннер потери соединения */}
      {offline && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 flex items-center gap-2 rounded-[10px] border border-yellow/40 bg-yellow-glow px-4 py-2.5 text-sm font-medium text-yellow"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-yellow" />
          Соединение потеряно, переподключение…
        </motion.div>
      )}

      {/* ===== Ряд 1: Hero ===== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="hero-glow flex flex-col gap-4 rounded-xl px-1 py-4 md:flex-row md:items-end md:justify-between"
      >
        <div>
          <h1 className="text-[22px] font-extrabold leading-7 tracking-[-0.02em] text-fg md:text-[28px] md:leading-[34px]">
            {greeting()}, {account?.name?.split(' ')[0] ?? 'трейдер'}
          </h1>
          <p className="mt-1 text-xs font-medium tracking-[0.08em] text-fg-secondary">
            {(mode === 'live' ? 'Боевой счёт' : 'Счёт песочницы') + (account ? ` •…${account.id.slice(-4)}` : '')} · площадка
            FORTS · сессия до 23:50 (<span className="mono">{countdown}</span>)
          </p>
        </div>
        <div className={cn('md:text-right', offline && 'opacity-60')}>
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-fg-secondary">Стоимость портфеля</div>
          <div className="mono mt-1 text-[26px] font-bold leading-none text-fg md:text-[32px]">
            <PriceTicker value={portfolio?.totalAmount ?? 0} format={(v) => formatRub(v)} />
          </div>
          {portfolio && (
            <Badge variant={portfolio.dayPnl >= 0 ? 'long' : 'short'} className="mt-2">
              {formatSignedRub(portfolio.dayPnl)} ({formatPct(portfolio.dayPnlPct)})
            </Badge>
          )}
        </div>
      </motion.section>

      {/* ===== Ряд 2: StatCards ===== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.06 }}
        className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible"
      >
        <div className="w-[70vw] min-w-[220px] shrink-0 snap-start md:w-auto md:min-w-0">
          <StatCard
            label="P&L за день"
            value={<PriceTicker value={portfolio?.dayPnl ?? 0} format={(v) => formatSignedRub(v)} />}
            delta={formatPct(portfolio?.dayPnlPct ?? 0)}
            deltaPositive={(portfolio?.dayPnl ?? 0) >= 0}
            sparkline={pnlSparkline}
          />
        </div>
        <div className="w-[70vw] min-w-[220px] shrink-0 snap-start md:w-auto md:min-w-0">
          <StatCard
            label="Свободная маржа"
            value={formatRub(portfolio?.freeMargin ?? 0, 0)}
            onClick={() => navigate('/risk')}
            footer={
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span>загрузка ГО</span>
                  <span className="mono">{marginPct}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-inset">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      marginPct < 50 ? 'bg-long' : marginPct < 80 ? 'bg-warn' : 'bg-short',
                    )}
                    style={{ width: `${Math.min(100, marginPct)}%` }}
                  />
                </div>
              </div>
            }
          />
        </div>
        <div className="w-[70vw] min-w-[220px] shrink-0 snap-start md:w-auto md:min-w-0">
          <StatCard
            label="Активные роботы"
            value={`${runningRobots.length} из ${robots.length}`}
            onClick={() => navigate('/robots')}
            footer={
              <div className="flex items-center gap-2">
                <span>
                  {robots.filter((r) => r.strategy === 'grid').length} grid ·{' '}
                  {robots.filter((r) => r.strategy === 'signal').length} сигнальных
                </span>
                <span className="ml-auto flex gap-1">
                  {robots.slice(0, 5).map((r) => (
                    <RobotStatusDot key={r.id} status={r.status} size={6} />
                  ))}
                </span>
              </div>
            }
          />
        </div>
        <div className="w-[70vw] min-w-[220px] shrink-0 snap-start md:w-auto md:min-w-0">
          <StatCard
            label="Win-rate 30д"
            value={`${winRate}%`}
            delta={`${tradesCount} сделок · профит-фактор ${profitFactor}`}
            sparkline={pnlSparkline.slice(-14)}
          />
        </div>
      </motion.section>

      {/* ===== Ряд 3: Equity + Роботы ===== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.12 }}
        className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        {/* Equity-график */}
        <div className="rounded-xl border border-subtle bg-panel p-4 md:p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <h2 className="text-base font-semibold text-fg">Динамика портфеля</h2>
              <div className="hidden items-center gap-3 text-[11px] text-fg-muted md:flex">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded bg-yellow" /> Equity
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0 w-4 border-t border-dashed border-fg-muted" /> IMOEXF
                </span>
              </div>
            </div>
            <SegmentedControl
              options={(Object.keys(PERIOD_LABELS) as EquityPeriod[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
              value={period}
              onChange={setPeriod}
            />
          </div>
          <div className="mt-3 h-[220px] md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={equityUp ? 'rgba(22,199,132,0.25)' : 'rgba(234,57,67,0.25)'} />
                    <stop offset="100%" stopColor="transparent" />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tickFormatter={(t: number) =>
                    new Date(t).toLocaleDateString('ru-RU', period === '1D' ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' })
                  }
                  tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                />
                <YAxis
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(v: number) => formatNumber(v / 1000, 0) + 'к'}
                  orientation="right"
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-panel-raised)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    fontSize: 12,
                    fontFamily: 'JetBrains Mono',
                  }}
                  labelFormatter={(t) => new Date(Number(t)).toLocaleString('ru-RU')}
                  formatter={(value: number, name: string) => [formatRub(value), name === 'equity' ? 'Портфель' : 'IMOEXF']}
                />
                <Area
                  type="monotone"
                  dataKey="benchmark"
                  stroke="var(--text-muted)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  fill="none"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="var(--accent-yellow)"
                  strokeWidth={2}
                  fill="url(#eqGrad)"
                  animationDuration={500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-subtle pt-3 text-xs text-fg-secondary">
            <span>
              Макс. просадка <span className="mono text-short">−4,2%</span>
            </span>
            <span>
              Шарп <span className="mono text-fg">1,6</span>
            </span>
            <span>
              Сделок сегодня <span className="mono text-fg">{todayTrades}</span>
            </span>
          </div>
        </div>

        {/* Донат роботов */}
        <div className="rounded-xl border border-subtle bg-panel p-4 md:p-5">
          <h2 className="text-base font-semibold text-fg">Роботы</h2>
          {robots.length === 0 ? (
            <EmptyState
              image="/empty-robots.svg"
              title="Роботов пока нет"
              subtitle="Создайте первого робота и делегируйте рутину"
              actionLabel="Создать робота"
              onAction={() => navigate('/robots')}
            />
          ) : (
            <>
              <div className="relative mx-auto mt-2 h-[140px] w-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={robots.map((r) => ({ name: r.name, value: Math.max(1, r.stats.allocatedCapital) }))}
                      dataKey="value"
                      innerRadius={48}
                      outerRadius={66}
                      paddingAngle={3}
                      strokeWidth={0}
                      animationDuration={700}
                    >
                      {robots.map((r, i) => (
                        <Cell key={r.id} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="mono text-lg font-bold text-fg">{capitalPct}%</span>
                  <span className="max-w-[90px] text-[10px] leading-tight text-fg-muted">капитала в роботах</span>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {robots.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => navigate('/robots')}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel-raised"
                  >
                    <RobotStatusDot status={r.status} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{r.name}</span>
                    <Badge variant={r.strategy === 'grid' ? 'accent' : 'info'}>{r.strategy}</Badge>
                    <span className={cn('mono w-20 text-right text-xs', r.stats.dayPnl >= 0 ? 'text-long' : 'text-short')}>
                      {formatSignedRub(r.stats.dayPnl)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.section>

      {/* ===== Ряд 4: Позиции / Лента / Рынок ===== */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.18 }}
        className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        {/* Открытые позиции */}
        <div className="flex flex-col rounded-xl border border-subtle bg-panel p-4 md:p-5">
          <h2 className="text-base font-semibold text-fg">Открытые позиции</h2>
          {positions.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">Позиций нет. Роботы ждут сигнала.</p>
          ) : (
            <div className="mt-2 flex-1 divide-y divide-subtle">
              {positions.slice(0, 4).map((p) => (
                <div key={p.instrumentId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="mono text-[13px] font-semibold uppercase text-fg">{p.ticker}</div>
                    <Badge variant={p.direction === 'long' ? 'long' : 'short'} className="mt-1">
                      {p.direction === 'long' ? 'Лонг' : 'Шорт'}
                    </Badge>
                  </div>
                  <span className="mono text-xs text-fg-secondary">{p.lots} лот{p.lots > 1 ? 'а' : ''}</span>
                  <span className={cn('mono w-24 text-right text-[13px] font-medium', p.pnl >= 0 ? 'text-long' : 'text-short')}>
                    <PriceTicker value={p.pnl} format={(v) => formatSignedRub(v)} delta={p.pnl} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate('/positions')}
            className="mt-auto flex items-center gap-1 pt-3 text-xs font-semibold text-yellow hover:underline"
          >
            Все позиции <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Лента событий */}
        <div className="rounded-xl border border-subtle bg-panel p-4 md:p-5">
          <h2 className="text-base font-semibold text-fg">Лента событий</h2>
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">Событий пока нет</p>
          ) : (
            <div className="mt-2 space-y-0.5">
              {events.slice(0, 6).map((e) => {
                const conf = EVENT_ICONS[e.type];
                return (
                  <motion.button
                    key={e.id}
                    type="button"
                    layout="position"
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => e.type === 'trade' && navigate('/journal')}
                    className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-panel-raised"
                  >
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', conf.className)}>
                      <conf.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{e.text}</span>
                    <span className="mono shrink-0 text-[11px] text-fg-muted">{formatRelative(e.time)}</span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* Рынок FORTS (watchlist) */}
        <div className="rounded-xl border border-subtle bg-panel p-4 md:p-5">
          <h2 className="text-base font-semibold text-fg">Рынок FORTS</h2>
          <div className="mt-2 space-y-0.5">
            {instruments.slice(0, 6).map((ins) => {
              const q = quotes[ins.uid];
              const spark = mockGetCandles(ins.uid, 'CANDLE_INTERVAL_5_MIN', 20).map((c) => c.close);
              const pct = q?.changePct ?? 0;
              return (
                <button
                  key={ins.uid}
                  type="button"
                  onClick={() => {
                    selectInstrument(ins.uid);
                    navigate(`/terminal?figi=${ins.figi}`);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel-raised',
                    offline && 'opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="mono text-[13px] font-semibold uppercase text-fg">{ins.ticker}</div>
                    <div className="truncate text-[11px] text-fg-muted">{ins.name}</div>
                  </div>
                  <Sparkline data={spark} width={60} height={20} positive={pct >= 0} />
                  <div className="w-24 text-right">
                    <div className={cn('mono text-[13px] font-medium', offline ? 'text-fg-muted' : 'text-fg')}>
                      {q ? (
                        <PriceTicker
                          value={q.price}
                          delta={q.delta}
                          format={(v) => formatNumber(v, ins.minPriceIncrement < 1 ? 2 : 0)}
                        />
                      ) : (
                        '—'
                      )}
                    </div>
                    {q && (
                      <div className={cn('mono text-[11px]', pct >= 0 ? 'text-long' : 'text-short')}>{formatPct(pct)}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* ===== Ряд 5: CTA ===== */}
      {showCta && (
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.4 }}
          className="mt-4 flex flex-col items-start justify-between gap-4 rounded-xl border border-subtle border-l-[3px] border-l-yellow bg-panel-raised p-4 md:flex-row md:items-center md:p-5"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-yellow-glow">
              <TrendingUp className="h-5 w-5 text-yellow" />
            </span>
            <div>
              <div className="text-sm font-bold text-fg">
                {robots.length < 1 ? 'Запустите первого робота' : 'Grid-бот по Si набирает популярность'}
              </div>
              <div className="text-xs text-fg-secondary">
                {robots.length < 1
                  ? 'Grid-стратегия зарабатывает на боковике — идеально для FORTS'
                  : 'Совет дня: сетка 8 уровней с шагом 0,4% показала +4,1% за неделю в песочнице'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/robots')}
            className="h-10 shrink-0 rounded-[10px] bg-yellow px-5 text-sm font-bold text-app transition-shadow hover:glow-accent"
          >
            Создать робота
          </button>
        </motion.section>
      )}
    </div>
  );
}
