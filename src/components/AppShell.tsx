// AppShell — каркас приложения (design.md §4)
// Desktop: Sidebar 232px (сворачиваемый до 64px) + TopBar 56px
// Mobile: TopBar 52px + строка чипов + Bottom TabBar 64px (5 табов, «Ещё» → sheet)
// Контент через <Outlet/> (вложенные роуты в App.tsx).
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Bell,
  Bot,
  CandlestickChart,
  ChevronsLeft,
  ChevronsRight,
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
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/terminal', label: 'Терминал', icon: CandlestickChart },
  { to: '/robots', label: 'Роботы', icon: Bot },
  { to: '/positions', label: 'Позиции', icon: Layers },
  { to: '/journal', label: 'Журнал', icon: NotebookText },
  { to: '/risk', label: 'Риски', icon: ShieldAlert },
  { to: '/connect', label: 'Подключение', icon: KeyRound },
];

const TAB_ITEMS = NAV_ITEMS.slice(0, 4); // Дашборд, Терминал, Роботы, Позиции
const MORE_ITEMS = NAV_ITEMS.slice(4); // Журнал, Риски, Подключение

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

/** Бегущая строка индексов (desktop topbar) */
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
    <div className="relative hidden min-w-0 flex-1 overflow-hidden md:block" aria-hidden>
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
              'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
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
          'flex items-center gap-2 rounded-[10px] border border-subtle bg-panel px-3 text-sm text-fg transition-colors hover:border-strong',
          compact ? 'h-8' : 'h-9',
        )}
      >
        <Wallet className="h-4 w-4 text-fg-muted" />
        <span className="max-w-[160px] truncate">
          {current ? `${current.name} •…${current.id.slice(-4)}` : 'Счёт не выбран'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="border-subtle bg-panel-raised">
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

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const connected = useConnectionStore(selectIsConnected);
  const mode = useConnectionStore((s) => s.mode);
  const location = useLocation();
  const navigate = useNavigate();

  const isDisabled = (to: string) => !connected && to !== '/connect';
  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));

  return (
    <div className="min-h-[100dvh] bg-app">
      {/* ===== Desktop Sidebar ===== */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-subtle bg-panel transition-[width] duration-200 lg:flex',
          collapsed ? 'w-16' : 'w-[232px]',
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-subtle px-4">
          <Logo />
          {!collapsed && (
            <span className="text-sm font-extrabold tracking-tight text-fg">
              FORTS <span className="text-yellow">PILOT</span>
            </span>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => {
            const disabled = isDisabled(item.to);
            const active = isActive(item.to);
            return (
              <NavLink
                key={item.to}
                to={disabled ? '#' : item.to}
                onClick={(e) => disabled && e.preventDefault()}
                title={disabled ? 'Сначала подключите API-токен' : item.label}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active ? 'bg-yellow-glow text-yellow' : 'text-fg-secondary hover:bg-panel-raised hover:text-fg',
                  disabled && 'pointer-events-auto cursor-not-allowed opacity-40',
                )}
              >
                {active && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-yellow" />}
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                {!collapsed && item.label}
              </NavLink>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-10 items-center justify-center border-t border-subtle text-fg-muted transition-colors hover:text-fg"
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* ===== Desktop TopBar ===== */}
      <header
        className={cn(
          'fixed left-0 right-0 top-0 z-30 hidden h-14 items-center gap-4 border-b border-subtle bg-panel/90 px-4 backdrop-blur lg:flex',
          collapsed ? 'lg:left-16' : 'lg:left-[232px]',
        )}
        // жёлтая кромка 2px снизу в боевом режиме
        style={mode === 'live' ? { boxShadow: '0 2px 0 0 var(--accent-yellow)' } : undefined}
      >
        <AccountSelector />
        <IndexMarquee />
        <ModeToggle />
        <ConnectionDot withLabel />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-subtle text-fg-secondary transition-colors hover:border-strong hover:text-fg"
          title="Уведомления"
        >
          <Bell className="h-4 w-4" />
        </button>
      </header>

      {/* ===== Mobile TopBar ===== */}
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
            <button type="button" className="flex h-9 w-9 items-center justify-center text-fg-secondary" title="Уведомления">
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Строка чипов: счёт + режим → sheet */}
        <div className="flex gap-2 overflow-x-auto border-b border-subtle bg-app/95 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-subtle bg-panel px-3 py-1.5 text-xs font-medium text-fg"
          >
            <Wallet className="h-3.5 w-3.5 text-fg-muted" />
            Счёт и режим
          </button>
          <ModeChipInline />
        </div>
      </header>

      {/* ===== Контент ===== */}
      <main
        className={cn(
          'min-h-[100dvh] transition-[padding] duration-200',
          // mobile: отступ под topbar+чипы и tabbar
          'pb-[88px] pt-[100px] lg:pb-8 lg:pt-14',
          collapsed ? 'lg:pl-16' : 'lg:pl-[232px]',
        )}
      >
        <div className="mx-auto w-full max-w-[1440px] px-3 py-4 md:px-6">
          <Outlet />
        </div>
      </main>

      {/* ===== Mobile Bottom TabBar ===== */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-subtle bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {TAB_ITEMS.map((item) => {
          const disabled = isDisabled(item.to);
          const active = isActive(item.to);
          return (
            <button
              key={item.to}
              type="button"
              disabled={disabled}
              onClick={() => {
                navigator.vibrate?.(10);
                navigate(item.to);
              }}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium',
                active ? 'text-yellow' : 'text-fg-muted',
                disabled && 'opacity-40',
              )}
            >
              <item.icon className="h-5 w-5" strokeWidth={1.8} />
              {item.label}
              {active && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-yellow" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'relative flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium',
            MORE_ITEMS.some((i) => isActive(i.to)) ? 'text-yellow' : 'text-fg-muted',
          )}
        >
          <Menu className="h-5 w-5" strokeWidth={1.8} />
          Ещё
          {MORE_ITEMS.some((i) => isActive(i.to)) && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-yellow" />}
        </button>
      </nav>

      {/* Sheet «Ещё» + настройки счёта/режима (mobile) */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="border-subtle bg-panel-raised pb-8">
          <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-strong" />
          <SheetHeader>
            <SheetTitle className="text-fg">Навигация и счёт</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-1">
            {MORE_ITEMS.map((item) => {
              const disabled = isDisabled(item.to);
              return (
                <button
                  key={item.to}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(item.to);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-fg-secondary transition-colors hover:bg-panel hover:text-fg',
                    disabled && 'opacity-40',
                    isActive(item.to) && 'text-yellow',
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  {item.label}
                  {disabled && <span className="ml-auto text-[10px] text-fg-muted">нужен токен</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-3 border-t border-subtle pt-4">
            <AccountSelector compact />
            <ModeToggle />
            <ConnectionDot withLabel />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Чип режима (mobile, в строке чипов) */
function ModeChipInline() {
  const mode = useConnectionStore((s) => s.mode);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide',
        mode === 'live' ? 'bg-yellow text-app' : 'bg-info/15 text-info',
      )}
    >
      {mode === 'live' ? 'Боевой' : 'Песочница'}
    </span>
  );
}
