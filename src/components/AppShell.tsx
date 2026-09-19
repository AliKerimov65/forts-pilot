// AppShell v2 — каркас приложения (design-v2.md §1, v2-shell.md)
// Desktop: Sidebar 248px (сворачиваемый до 68px) с ГРУППАМИ навигации и живыми бейджами + TopBar 56px с breadcrumb.
// Mobile: TopBar 52px + строка чипов + Bottom TabBar 68px (5 табов, «Ещё» → sheet с группами и блоком счёта).
// Единая структура NAV_GROUPS — источник для sidebar / tabbar / sheet / breadcrumb.
// Бейджи — ТОЛЬКО чтение сторов (robots / trading / risk / connection), сторы не меняются.
// Контент через <Outlet/> (вложенные роуты в App.tsx).
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Bot,
  CandlestickChart,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  Menu,
  NotebookText,
  ShieldAlert,
  Wallet,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnectionStore, selectIsConnected } from '@/store/connection';
import { useMarketStore } from '@/store/market';
import { useRobotsStore } from '@/store/robots';
import { useTradingStore } from '@/store/trading';
import { useRiskStore } from '@/store/risk';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import NavBadge from '@/components/NavBadge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/* ============================= Навигация (единый источник) ============================= */

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Группы навигации v2 (design-v2.md §1.1). Порядок групп и пунктов фиксирован. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Торговля',
    items: [
      { to: '/', label: 'Дашборд', icon: LayoutDashboard },
      { to: '/terminal', label: 'Терминал', icon: CandlestickChart },
      { to: '/positions', label: 'Позиции', icon: Layers },
    ],
  },
  {
    label: 'Автоматика',
    items: [{ to: '/robots', label: 'Роботы', icon: Bot }],
  },
  {
    label: 'Учёт и риски',
    items: [
      { to: '/journal', label: 'Журнал', icon: NotebookText },
      { to: '/risk', label: 'Риски', icon: ShieldAlert },
    ],
  },
  {
    label: 'Система',
    items: [{ to: '/connect', label: 'Подключение', icon: KeyRound }],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
/** Группы основного потока sidebar (без «Системы» — она прижата к низу) */
const FLOW_GROUPS = NAV_GROUPS.slice(0, 3);
const SYSTEM_GROUP = NAV_GROUPS[3];
/** Mobile tabbar (design-v2.md §1.1): Дашборд, Терминал, Роботы, Позиции */
const TAB_ITEMS: NavItem[] = [ALL_ITEMS[0], ALL_ITEMS[1], ALL_ITEMS[3], ALL_ITEMS[2]];
/** Группы внутри sheet «Ещё» */
const MORE_GROUPS = NAV_GROUPS.slice(2);
const MORE_ITEMS = MORE_GROUPS.flatMap((g) => g.items);

/** Контекст страницы для breadcrumb topbar: (группа, страница). На «/» — без группы. */
export function getNavContext(pathname: string): { group: string | null; page: string } {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const match = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
      if (match) return { group: item.to === '/' ? null : group.label, page: item.label };
    }
  }
  return { group: null, page: 'Дашборд' };
}

/* ============================= Бейджи навигации (только чтение сторов) ============================= */

type BadgeSpec =
  | { kind: 'count'; count: number; variant: 'accent' | 'neutral' }
  | { kind: 'dot'; level: 'critical' | 'warn' | 'error' }
  | null;

/** Живые бейджи пунктов навигации (design-v2.md §1.2) */
function useNavBadges(): Record<string, BadgeSpec> {
  const runningRobots = useRobotsStore((s) => s.robots.reduce((n, r) => n + (r.status === 'running' ? 1 : 0), 0));
  const positionsCount = useTradingStore((s) => s.positions.length);
  const dayPnl = useRiskStore((s) => s.currentDayPnl);
  const marginPct = useRiskStore((s) => s.currentMarginPct);
  const limits = useRiskStore((s) => s.limits);
  const connStatus = useConnectionStore((s) => s.status);

  // Риски: critical — сработал дневной стоп; warn — маржа > 80% лимита
  const riskCritical = limits.dailyStopRub > 0 && dayPnl <= -limits.dailyStopRub;
  const riskWarn = !riskCritical && limits.maxMarginPct > 0 && marginPct >= limits.maxMarginPct * 0.8;

  return {
    '/robots': runningRobots > 0 ? { kind: 'count', count: runningRobots, variant: 'accent' } : null,
    '/positions': positionsCount > 0 ? { kind: 'count', count: positionsCount, variant: 'neutral' } : null,
    '/risk': riskCritical ? { kind: 'dot', level: 'critical' } : riskWarn ? { kind: 'dot', level: 'warn' } : null,
    '/connect':
      connStatus === 'error'
        ? { kind: 'dot', level: 'error' }
        : connStatus === 'connecting'
          ? { kind: 'dot', level: 'warn' }
          : null,
  };
}

/** Самый «горячий» цвет бейджа для точки в свёрнутом sidebar / на табе (red > warn > yellow > neutral) */
function badgeDotClass(badge: BadgeSpec): string | null {
  if (!badge) return null;
  if (badge.kind === 'dot') {
    if (badge.level === 'critical' || badge.level === 'error') return 'bg-short';
    return 'bg-warn';
  }
  return badge.variant === 'accent' ? 'bg-yellow' : 'bg-fg-muted';
}

/** Текст тултипа свёрнутого пункта: «Роботы · 3» */
function badgeTooltipSuffix(badge: BadgeSpec): string {
  if (!badge) return '';
  if (badge.kind === 'count') return ` · ${badge.count}`;
  return badge.level === 'warn' ? ' · внимание' : ' · алерт';
}

/* ============================= Общие мелкие компоненты shell ============================= */

/** Точка статуса соединения + подпись */
function ConnectionDot({ withLabel = false }: { withLabel?: boolean }) {
  const status = useConnectionStore((s) => s.status);
  const latencyMs = useConnectionStore((s) => s.latencyMs);
  const demoMode = useConnectionStore((s) => s.demoMode);
  const token = useConnectionStore((s) => s.token);

  const state = demoMode && !token ? 'demo' : status;
  const dotClass =
    state === 'online'
      ? 'bg-long pulse-dot'
      : state === 'demo'
        ? 'bg-info'
        : state === 'connecting'
          ? 'bg-warn animate-pulse'
          : state === 'error'
            ? 'bg-short'
            : 'bg-fg-muted';
  const label =
    state === 'online'
      ? `API • подключено${latencyMs !== null ? `, ${latencyMs}мс` : ''}`
      : state === 'demo'
        ? 'Демо-режим'
        : state === 'connecting'
          ? 'Подключение…'
          : state === 'error'
            ? 'Ошибка API'
            : 'Оффлайн';

  return (
    <span className="flex items-center gap-2" title={label}>
      <span className={cn('h-2 w-2 rounded-full', dotClass)} />
      {withLabel && <span className="mono text-xs text-fg-secondary">{label}</span>}
    </span>
  );
}

/** Компактный статус соединения для статус-блока sidebar: точка + mono-значение */
function ConnectionInline() {
  const status = useConnectionStore((s) => s.status);
  const latencyMs = useConnectionStore((s) => s.latencyMs);
  const demoMode = useConnectionStore((s) => s.demoMode);
  const token = useConnectionStore((s) => s.token);

  const state = demoMode && !token ? 'demo' : status;
  const dotClass =
    state === 'online'
      ? 'bg-long pulse-dot'
      : state === 'demo'
        ? 'bg-info'
        : state === 'connecting'
          ? 'bg-warn animate-pulse'
          : state === 'error'
            ? 'bg-short'
            : 'bg-fg-muted';
  const text =
    state === 'online'
      ? latencyMs !== null
        ? `${latencyMs}мс`
        : 'online'
      : state === 'demo'
        ? 'демо'
        : state === 'connecting'
          ? '…'
          : state === 'error'
            ? 'ошибка'
            : token
              ? 'оффлайн'
              : 'нет токена';

  return (
    <>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
      <span className="mono truncate text-[11px] text-fg-secondary">{text}</span>
    </>
  );
}

/** Бегущая строка индексов (desktop topbar, видна от ≥1280px — v2-shell §3.1) */
function IndexMarquee() {
  const instruments = useMarketStore((s) => s.instruments);
  const quotes = useMarketStore((s) => s.quotes);
  const items = instruments.slice(0, 6);
  if (items.length === 0) return null;

  const renderItems = (keyPrefix: string) =>
    items.map((ins) => {
      const q = quotes[ins.uid];
      const pct = q?.changePct ?? 0;
      return (
        <span key={`${keyPrefix}-${ins.uid}`} className="mono mx-4 inline-flex items-center gap-2 text-xs">
          <span className="font-semibold uppercase text-fg-secondary">{ins.ticker}</span>
          {q && <span className="text-fg">{q.price.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>}
          {q && (
            <span className={pct >= 0 ? 'text-long' : 'text-short'}>
              {pct >= 0 ? '+' : ''}
              {pct.toFixed(2)}%
            </span>
          )}
        </span>
      );
    });

  return (
    <div className="relative hidden min-w-0 flex-1 overflow-hidden xl:block" aria-hidden>
      <div className="marquee-track inline-flex whitespace-nowrap">
        {renderItems('a')}
        {renderItems('b')}
      </div>
    </div>
  );
}

/** Тогл режима Песочница/Боевой + бейдж */
function ModeToggle() {
  const mode = useConnectionStore((s) => s.mode);
  const setMode = useConnectionStore((s) => s.setMode);
  const [confirmLive, setConfirmLive] = useState(false);

  const switchMode = (next: 'sandbox' | 'live') => {
    if (next === mode) return;
    if (next === 'live') setConfirmLive(true);
    else setMode('sandbox');
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
          mode === 'live' ? 'bg-yellow text-app' : 'bg-info/15 text-info',
        )}
      >
        {mode === 'live' ? 'Боевой режим' : 'Песочница'}
      </span>
      <div className="flex rounded-full border border-subtle bg-inset p-0.5">
        {(['sandbox', 'live'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-[120ms]',
              mode === m
                ? m === 'live'
                  ? 'bg-yellow text-app'
                  : 'bg-info text-white'
                : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {m === 'sandbox' ? 'Песочница' : 'Боевой'}
          </button>
        ))}
      </div>
      <ConfirmDangerModal
        open={confirmLive}
        onOpenChange={setConfirmLive}
        title="Включить боевой режим?"
        description="Ордера будут исполняться на реальном счёте с реальными деньгами. Убедитесь, что риск-лимиты настроены."
        confirmLabel="Удерживайте для боевого режима"
        onConfirm={() => setMode('live')}
      />
    </div>
  );
}

/** Селектор счёта */
function AccountSelector({ compact = false }: { compact?: boolean }) {
  const accounts = useConnectionStore((s) => s.accounts);
  const accountId = useConnectionStore((s) => s.accountId);
  const setAccount = useConnectionStore((s) => s.setAccount);
  const current = accounts.find((a) => a.id === accountId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-2 rounded-[10px] border border-subtle bg-panel px-3 text-sm text-fg transition-colors duration-[120ms] hover:border-strong',
          compact ? 'h-8' : 'h-9',
        )}
      >
        <Wallet className="h-4 w-4 text-fg-muted" />
        <span className="max-w-[160px] truncate">
          {current ? `${current.name} •…${current.id.slice(-4)}` : 'Счёт не выбран'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {accounts.length === 0 && <DropdownMenuItem disabled>Нет счетов</DropdownMenuItem>}
        {accounts.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onClick={() => setAccount(a.id)}
            className={cn('cursor-pointer', a.id === accountId && 'text-yellow')}
          >
            {a.name} <span className="mono ml-1 text-xs text-fg-muted">•…{a.id.slice(-4)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Logo({ size = 32 }: { size?: number }) {
  return <img src="/logo.svg" alt="FORTS PILOT" width={size} height={size} className="shrink-0" />;
}

/* ============================= Topbar: breadcrumb и колокольчик ============================= */

/** Breadcrumb «Группа › Страница» (v2-shell §3.1); анимация смены страницы translateY+fade */
function Breadcrumb() {
  const { pathname } = useLocation();
  const ctx = getNavContext(pathname);
  return (
    <nav aria-label="breadcrumb" className="flex h-5 min-w-[200px] flex-none items-center gap-1.5">
      {ctx.group && (
        <>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">{ctx.group}</span>
          <ChevronRight className="h-3 w-3 text-fg-muted" aria-hidden />
        </>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="truncate text-sm font-semibold text-fg"
        >
          {ctx.page}
        </motion.span>
      </AnimatePresence>
    </nav>
  );
}

/** Колокольчик уведомлений с бейджем непрочитанных (v2-shell §3.3).
 *  Источник «непрочитанных» — срабатывания риск-лимитов за последние 24ч (risk store, только чтение). */
function BellButton() {
  const unread = useRiskStore((s) => s.events.reduce((n, e) => n + (e.time > Date.now() - 24 * 3600 * 1000 ? 1 : 0), 0));
  return (
    <button
      type="button"
      title="Уведомления"
      className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-subtle text-fg-secondary transition-colors duration-[120ms] hover:border-strong hover:text-fg"
    >
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="mono absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-short px-0.5 text-[9px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

/* ============================= Клавиатурные шорткаты «G + буква» (v2-shell §8) ============================= */

const GO_MAP: Record<string, string> = {
  d: '/',
  t: '/terminal',
  r: '/robots',
  p: '/positions',
  j: '/journal',
  k: '/risk',
  c: '/connect',
};
// Русская раскладка: п=G, в=D, е=T, к=R, з=P, о=J, л=K, с=C
const RU_GO_MAP: Record<string, string> = { в: 'd', е: 't', к: 'r', з: 'p', о: 'j', л: 'k', с: 'c' };

const GO_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'G D', label: 'Дашборд' },
  { keys: 'G T', label: 'Терминал' },
  { keys: 'G R', label: 'Роботы' },
  { keys: 'G P', label: 'Позиции' },
  { keys: 'G J', label: 'Журнал' },
  { keys: 'G K', label: 'Риски' },
  { keys: 'G C', label: 'Подключение' },
];

function useGoShortcuts(onArm: () => void) {
  const navigate = useNavigate();
  const armedRef = useRef(false);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      const key = e.key.toLowerCase();
      if (!armedRef.current && (key === 'g' || key === 'п')) {
        armedRef.current = true;
        onArm();
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          armedRef.current = false;
        }, 1000);
        return;
      }
      if (armedRef.current) {
        armedRef.current = false;
        window.clearTimeout(timerRef.current);
        const to = GO_MAP[key] ?? GO_MAP[RU_GO_MAP[key] ?? ''];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timerRef.current);
    };
  }, [navigate, onArm]);
}

/** Модалка со списком шорткатов (пункт «?» внизу sidebar) */
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-fg">Горячие клавиши</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
            Навигация
          </div>
          {GO_SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex h-9 items-center justify-between rounded-lg px-2 hover:bg-panel-raised">
              <span className="text-sm text-fg-secondary">{s.label}</span>
              <kbd className="mono rounded-md border border-subtle bg-inset px-2 py-0.5 text-[11px] font-semibold text-fg">
                {s.keys}
              </kbd>
            </div>
          ))}
          <div className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
            Терминал (когда фокус в терминале)
          </div>
          {[
            { keys: 'B / S', label: 'Купить / Продать' },
            { keys: '/', label: 'Поиск инструмента' },
            { keys: '1 / 5 / 15 / H / D', label: 'Таймфреймы' },
          ].map((s) => (
            <div key={s.keys} className="flex h-9 items-center justify-between rounded-lg px-2 hover:bg-panel-raised">
              <span className="text-sm text-fg-secondary">{s.label}</span>
              <kbd className="mono rounded-md border border-subtle bg-inset px-2 py-0.5 text-[11px] font-semibold text-fg">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============================= AppShell ============================= */

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [goHint, setGoHint] = useState(false);
  const goHintTimer = useRef<number>(0);
  const connected = useConnectionStore(selectIsConnected);
  const mode = useConnectionStore((s) => s.mode);
  const location = useLocation();
  const navigate = useNavigate();
  const badges = useNavBadges();

  const isDisabled = (to: string) => !connected && to !== '/connect';
  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));

  // Подсказка шорткатов при нажатии «G» (v2-shell §8), 2.5с
  const showGoHint = useCallback(() => {
    setGoHint(true);
    window.clearTimeout(goHintTimer.current);
    goHintTimer.current = window.setTimeout(() => setGoHint(false), 2500);
  }, []);
  useGoShortcuts(showGoHint);
  useEffect(() => () => window.clearTimeout(goHintTimer.current), []);

  /** Пункт навигации sidebar (NavItem v2, v2-shell §2.4): 40px, бейджи, tooltip в collapsed/disabled */
  const renderItem = (item: NavItem) => {
    const disabled = isDisabled(item.to);
    const active = isActive(item.to);
    const badge = badges[item.to] ?? null;
    const dot = badgeDotClass(badge);
    const link = (
      <NavLink
        to={disabled ? '#' : item.to}
        onClick={(e) => disabled && e.preventDefault()}
        aria-disabled={disabled || undefined}
        className={cn(
          'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium',
          'transition-colors duration-[120ms]',
          active ? 'bg-yellow-glow text-yellow' : 'text-fg-secondary hover:bg-panel-raised hover:text-fg',
          disabled && 'cursor-not-allowed opacity-40',
          collapsed && 'justify-center px-0',
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-yellow" />
        )}
        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2 : 1.8} />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && badge && (
          <span className="ml-auto">
            <NavBadge {...badge} />
          </span>
        )}
        {collapsed && dot && (
          <span className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
        )}
      </NavLink>
    );
    const tip = disabled
      ? 'Сначала подключите API-токен'
      : collapsed
        ? `${item.label}${badgeTooltipSuffix(badge)}`
        : null;
    if (!tip) return <Fragment key={item.to}>{link}</Fragment>;
    return (
      <Tooltip key={item.to}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {tip}
        </TooltipContent>
      </Tooltip>
    );
  };

  // Точка-алерт на табе «Ещё»: самый «горячий» статус внутри (Риски/Подключение)
  const moreDot = (() => {
    const list = ['/risk', '/connect'].map((to) => badges[to]).filter((b): b is NonNullable<BadgeSpec> => !!b);
    if (list.some((b) => b.kind === 'dot' && (b.level === 'critical' || b.level === 'error'))) return 'bg-short';
    if (list.length > 0) return 'bg-warn';
    return null;
  })();
  const moreActive = MORE_ITEMS.some((i) => isActive(i.to));

  return (
    <div className="min-h-[100dvh] bg-app">
      {/* Skip-link — первый фокусируемый элемент (v2-shell §8) */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-strong focus:bg-overlay focus:px-4 focus:py-2 focus:text-sm focus:text-fg focus:shadow-overlay"
      >
        Перейти к контенту
      </a>

      {/* ===== Desktop Sidebar (248 / 68px) ===== */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-subtle bg-panel transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[68px]' : 'w-[248px]',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center gap-2.5 border-b border-subtle px-4',
            collapsed && 'justify-center px-0',
          )}
        >
          <Logo />
          {!collapsed && (
            <span className="overflow-hidden whitespace-nowrap text-sm font-extrabold tracking-tight text-fg">
              FORTS <span className="text-yellow">PILOT</span>
            </span>
          )}
        </div>

        {/* Группы основного потока: Торговля / Автоматика / Учёт и риски */}
        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Основная навигация">
          {FLOW_GROUPS.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? 'mt-4' : 'mt-1'}>
              {!collapsed && (
                <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                  {group.label}
                </div>
              )}
              {collapsed && gi > 0 && <div className="mx-3 my-2 h-px bg-subtle" />}
              <div className="space-y-0.5">{group.items.map(renderItem)}</div>
            </div>
          ))}
        </nav>

        {/* Низ sidebar: группа «Система» + статус-блок + шорткаты + сворачивание (v2-shell §2.6) */}
        <div className="mt-auto border-t border-subtle">
          <div className="px-3 pt-2">
            {!collapsed && (
              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                {SYSTEM_GROUP.label}
              </div>
            )}
            {SYSTEM_GROUP.items.map(renderItem)}
          </div>

          {/* Статус-блок: соединение + режим одной строкой */}
          {!collapsed && (
            <div className="mx-3 my-2 flex h-10 items-center gap-2 rounded-lg bg-inset px-3 shadow-inset">
              <ConnectionInline />
              <span
                className={cn(
                  'ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
                  mode === 'live' ? 'bg-yellow text-app' : 'bg-info/15 text-info',
                )}
              >
                {mode === 'live' ? 'Бой' : 'Песочница'}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            title="Горячие клавиши"
            className={cn(
              'flex h-10 w-full items-center gap-3 text-fg-muted transition-colors duration-[120ms] hover:text-fg',
              collapsed ? 'justify-center' : 'px-6',
            )}
          >
            <Keyboard className="h-4 w-4" />
            {!collapsed && <span className="text-xs font-medium">Шорткаты</span>}
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-10 w-full items-center justify-center border-t border-subtle text-fg-muted transition-colors duration-[120ms] hover:text-fg"
            title={collapsed ? 'Развернуть' : 'Свернуть'}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* ===== Desktop TopBar (56px): breadcrumb + marquee (≥xl) + контролы ===== */}
      <header
        className={cn(
          'fixed left-0 right-0 top-0 z-30 hidden h-14 items-center gap-3 border-b border-subtle bg-panel/90 px-4 backdrop-blur lg:flex',
          collapsed ? 'lg:left-[68px]' : 'lg:left-[248px]',
        )}
        // жёлтая кромка 2px снизу в боевом режиме
        style={mode === 'live' ? { boxShadow: '0 2px 0 0 var(--accent-yellow)' } : undefined}
      >
        <Breadcrumb />
        <IndexMarquee />
        <div className="ml-auto flex flex-none items-center gap-2">
          <AccountSelector />
          <span className="mx-1 h-5 w-px bg-subtle" aria-hidden />
          <ModeToggle />
          <ConnectionDot withLabel />
          <BellButton />
        </div>
      </header>

      {/* ===== Mobile TopBar (52px + чипы 40px) ===== */}
      <header className="fixed inset-x-0 top-0 z-30 lg:hidden">
        <div className="flex h-[52px] items-center justify-between border-b border-subtle bg-panel/90 px-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Logo size={28} />
            <span className="text-sm font-extrabold tracking-tight text-fg">
              FORTS <span className="text-yellow">PILOT</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionDot />
            <BellButton />
          </div>
        </div>
        {/* Строка чипов: счёт (реальные данные) + режим + соединение → sheet «Ещё» */}
        <div className="flex gap-2 overflow-x-auto border-b border-subtle bg-app/95 px-3 py-2 backdrop-blur">
          <AccountChip onClick={() => setMoreOpen(true)} />
          <ModeChipInline onClick={() => setMoreOpen(true)} />
          <ConnectionChip />
        </div>
      </header>

      {/* ===== Контент ===== */}
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'min-h-[100dvh] transition-[padding] duration-200',
          // mobile: 92px под tabbar 68px, 100px под topbar+чипы
          'pb-[92px] pt-[100px] lg:pb-8 lg:pt-14',
          collapsed ? 'lg:pl-[68px]' : 'lg:pl-[248px]',
        )}
      >
        <div className="mx-auto w-full max-w-[1440px] px-3 py-4 md:px-6 lg:py-5">
          <Outlet />
        </div>
      </main>

      {/* ===== Mobile Bottom TabBar (68px) ===== */}
      <nav
        aria-label="Навигация"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] items-stretch border-t border-subtle bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {TAB_ITEMS.map((item) => {
          const disabled = isDisabled(item.to);
          const active = isActive(item.to);
          const badge = badges[item.to] ?? null;
          return (
            <button
              key={item.to}
              type="button"
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (disabled) {
                  // Тап по disabled-табу → sheet «Ещё» с пунктом «Подключение» (design-v2 §1.10)
                  setMoreOpen(true);
                  return;
                }
                navigator.vibrate?.(10);
                // Повторный тап по активному табу → скролл наверх (design-v2 §1.6)
                if (active) window.scrollTo({ top: 0, behavior: 'smooth' });
                else navigate(item.to);
              }}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors duration-[120ms]',
                active ? 'text-yellow' : 'text-fg-muted',
                disabled && 'opacity-40',
              )}
            >
              {active && <span className="absolute top-0 h-0.5 w-4 rounded-b-full bg-yellow" aria-hidden />}
              <span className="relative">
                <item.icon className="h-5 w-5" strokeWidth={active ? 2 : 1.8} />
                {badge && badge.kind === 'count' && (
                  <NavBadge
                    kind="count"
                    count={badge.count}
                    variant={badge.variant}
                    className="absolute -right-2.5 -top-1.5 h-4 min-w-4 px-0.5 text-[9px]"
                  />
                )}
              </span>
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            navigator.vibrate?.(10);
            setMoreOpen(true);
          }}
          className={cn(
            'relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors duration-[120ms]',
            moreActive ? 'text-yellow' : 'text-fg-muted',
          )}
        >
          {moreActive && <span className="absolute top-0 h-0.5 w-4 rounded-b-full bg-yellow" aria-hidden />}
          <span className="relative">
            <Menu className="h-5 w-5" strokeWidth={moreActive ? 2 : 1.8} />
            {moreDot && (
              <span className={cn('absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full', moreDot)} aria-hidden />
            )}
          </span>
          Ещё
        </button>
      </nav>

      {/* ===== Sheet «Ещё» (mobile) v2: группы IA + блок счёта ===== */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="gap-0 border-subtle bg-overlay px-4 pb-8">
          <div className="mx-auto mb-3 mt-1 h-1 w-8 rounded-full bg-strong" />
          <SheetHeader className="p-0">
            <SheetTitle className="text-left text-fg">Ещё</SheetTitle>
          </SheetHeader>

          {MORE_GROUPS.map((group) => (
            <div key={group.label} className="mt-3">
              <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                {group.label}
              </div>
              <div className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const disabled = isDisabled(item.to);
                  const active = isActive(item.to);
                  const badge = badges[item.to] ?? null;
                  return (
                    <button
                      key={item.to}
                      type="button"
                      aria-disabled={disabled || undefined}
                      onClick={() => {
                        if (disabled) return;
                        setMoreOpen(false);
                        navigate(item.to);
                      }}
                      className={cn(
                        'relative flex h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-[120ms]',
                        active ? 'text-yellow' : 'text-fg-secondary hover:bg-panel-raised hover:text-fg',
                        disabled && 'opacity-40',
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-yellow" />
                      )}
                      <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2 : 1.8} />
                      {item.label}
                      <span className="ml-auto flex items-center gap-2">
                        {disabled && <span className="text-[10px] text-fg-muted">нужен токен</span>}
                        {badge && <NavBadge {...badge} />}
                        <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Блок «Счёт и режим» — как в v1 */}
          <div className="mt-4 space-y-3 border-t border-subtle pt-4">
            <AccountSelector compact />
            <ModeToggle />
            <ConnectionDot withLabel />
          </div>

          <div className="mono mt-6 text-center text-[10px] text-fg-muted">FORTS PILOT v2.0</div>
        </SheetContent>
      </Sheet>

      {/* Модалка шорткатов + тост-подсказка «G» (desktop) */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AnimatePresence>
        {goHint && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mono fixed bottom-6 left-1/2 z-[80] hidden -translate-x-1/2 rounded-lg border border-strong bg-overlay px-4 py-2 text-xs text-fg-secondary shadow-overlay lg:block"
          >
            G D — Дашборд · G T — Терминал · G R — Роботы · G P — Позиции · G J — Журнал · G K — Риски · G C —
            Подключение
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================= Mobile-чипы ============================= */

/** Чип счёта с реальными данными (v2-shell §4): Wallet + «•…4821» mono */
function AccountChip({ onClick }: { onClick: () => void }) {
  const accounts = useConnectionStore((s) => s.accounts);
  const accountId = useConnectionStore((s) => s.accountId);
  const current = accounts.find((a) => a.id === accountId);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-subtle bg-panel px-3 py-1.5 text-xs font-medium text-fg"
    >
      <Wallet className="h-3.5 w-3.5 text-fg-muted" />
      <span className="mono">{current ? `•…${current.id.slice(-4)}` : 'Счёт'}</span>
    </button>
  );
}

/** Чип соединения: точка + latency mono (v2-shell §4) */
function ConnectionChip() {
  const status = useConnectionStore((s) => s.status);
  const latencyMs = useConnectionStore((s) => s.latencyMs);
  const demoMode = useConnectionStore((s) => s.demoMode);
  const token = useConnectionStore((s) => s.token);
  const state = demoMode && !token ? 'demo' : status;
  const dotClass =
    state === 'online'
      ? 'bg-long pulse-dot'
      : state === 'demo'
        ? 'bg-info'
        : state === 'connecting'
          ? 'bg-warn animate-pulse'
          : state === 'error'
            ? 'bg-short'
            : 'bg-fg-muted';
  const text =
    state === 'online' && latencyMs !== null
      ? `${latencyMs}мс`
      : state === 'demo'
        ? 'демо'
        : state === 'connecting'
          ? '…'
          : state === 'error'
            ? 'ошибка'
            : 'оффлайн';
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-subtle bg-panel px-3 py-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      <span className="mono text-[11px] text-fg-secondary">{text}</span>
    </span>
  );
}

/** Чип режима (mobile, в строке чипов); тап → sheet «Ещё» с блоком счёта и режима */
function ModeChipInline({ onClick }: { onClick?: () => void }) {
  const mode = useConnectionStore((s) => s.mode);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide',
        mode === 'live' ? 'bg-yellow text-app' : 'bg-info/15 text-info',
      )}
    >
      {mode === 'live' ? 'Боевой' : 'Песочница'}
    </button>
  );
}
