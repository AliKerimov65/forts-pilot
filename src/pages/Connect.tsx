// Подключение — /connect (connection.md)
// Состояние A (не подключён): hero + 3-шаговый степпер (токен → счёт → режим) + демо-вход.
// Состояние B (подключён): статус API, счета, режим, безопасность (PIN), журнал соединения.
// Офлайн: /offline.svg + «Повторить».
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Coins,
  Download,
  FlaskConical,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/tinvest/client';
import { getAccounts, openSandboxAccount, sandboxPayIn } from '@/lib/tinvest/services';
import { useConnectionStore, maskedToken, selectIsConnected } from '@/store/connection';
import type { AppMode } from '@/types/account';
import Badge from '@/components/Badge';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import InstallPrompt from '@/components/InstallPrompt';
import AccountPicker from '@/components/connect/AccountPicker';
import ModeCards from '@/components/connect/ModeCards';
import OfflineScreen from '@/components/connect/OfflineScreen';
import PinSettings from '@/components/connect/PinSettings';
import TokenStep from '@/components/connect/TokenStep';
import ToastHost from '@/components/connect/ToastHost';
import { toast } from '@/components/connect/toast';
import { formatTime } from '@/lib/format';

const PAGE_TRANSITION = { duration: 0.22, ease: 'easeOut' as const };

/** Понятный текст ошибки API для пользователя */
function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403)
      return 'Токен отклонён: проверьте права (нужен доступ к счетам и торговле)';
    if (e.status === 0) return 'Нет соединения с сервером API — проверьте интернет и повторите';
    if (e.status === 429) return 'Слишком много запросов — подождите минуту и повторите';
    if (e.status >= 500) return 'API не отвечает, повторите попытку позже';
    return `Ошибка API (${e.status})${e.description ? `: ${e.description}` : ''}`;
  }
  return 'Нет соединения с сервером API — проверьте интернет и повторите';
}

/** Обновить список счетов для текущего режима (лучшее усилие) */
async function refreshAccounts(selectFirstIfMissing: boolean): Promise<void> {
  const s = useConnectionStore.getState();
  if (!s.token) return;
  try {
    const accs = await getAccounts();
    s.setAccounts(accs);
    if (selectFirstIfMissing && !accs.some((a) => a.id === s.accountId)) {
      s.setAccount(accs[0]?.id ?? null);
    }
  } catch {
    /* контур может быть недоступен для токена — не мешаем пользователю */
  }
}

// ======================= Состояние A: онбординг =======================

const STEPS = [
  { n: 1, title: 'API-токен', hint: 'Ключ доступа T-Invest API' },
  { n: 2, title: 'Выбор счёта', hint: 'Куда будут выставляться ордера' },
  { n: 3, title: 'Режим работы', hint: 'Песочница или боевой счёт' },
];

function WizardView() {
  const navigate = useNavigate();
  const token = useConnectionStore((s) => s.token);
  const accounts = useConnectionStore((s) => s.accounts);
  const accountId = useConnectionStore((s) => s.accountId);
  const mode = useConnectionStore((s) => s.mode);

  const [step, setStep] = useState(1);
  const [confirmLive, setConfirmLive] = useState(false);
  const [creatingSandbox, setCreatingSandbox] = useState(false);
  const [modeRefreshing, setModeRefreshing] = useState(false);

  /** Шаг 1: реальная проверка токена через GetAccounts */
  const verify = useCallback(async (t: string): Promise<string | null> => {
    const s = useConnectionStore.getState();
    s.setToken(t);
    try {
      const accs = await getAccounts();
      s.setAccounts(accs);
      s.setStatus('online');
      s.setAccount(accs[0]?.id ?? null);
      setStep(2);
      toast('Токен действителен', {
        details: accs.length > 0 ? `Найдено счетов: ${accs.length}` : 'Счета не найдены',
        variant: 'success',
      });
      return null;
    } catch (e) {
      useConnectionStore.getState().setStatus('error');
      useConnectionStore.getState().setToken(null);
      return apiErrorText(e);
    }
  }, []);

  /** Шаг 2: создать счёт песочницы, если счетов нет */
  const createSandboxAccount = async () => {
    setCreatingSandbox(true);
    try {
      const id = await openSandboxAccount('FORTS PILOT');
      const accs = await getAccounts();
      const s = useConnectionStore.getState();
      s.setAccounts(accs);
      s.setAccount(id || accs[0]?.id || null);
      toast('Счёт песочницы создан', { variant: 'success' });
    } catch (e) {
      toast('Не удалось создать счёт', { details: apiErrorText(e), variant: 'error' });
    } finally {
      setCreatingSandbox(false);
    }
  };

  /** Шаг 3: выбор режима + обновление счетов под контур */
  const selectMode = async (m: AppMode) => {
    if (m === useConnectionStore.getState().mode) return;
    useConnectionStore.getState().setMode(m);
    setModeRefreshing(true);
    await refreshAccounts(true);
    setModeRefreshing(false);
  };

  const finish = () => {
    if (!accountId) {
      toast('Выберите счёт для продолжения', { variant: 'warn' });
      return;
    }
    if (mode === 'live') {
      setConfirmLive(true);
      return;
    }
    toast('Подключено', { details: 'Песочница · виртуальные деньги', variant: 'success' });
    navigate('/');
  };

  const enterDemo = () => {
    useConnectionStore.getState().setDemoMode(true);
    toast('Демо-режим включён', { details: 'Mock-данные, без реального API', variant: 'info' });
    navigate('/');
  };

  const stepDone = (n: number) => (n === 1 ? Boolean(token) : step > n);

  return (
    <div className="mx-auto w-full max-w-[560px] px-1 py-4 sm:py-8">
      {/* Hero */}
      <motion.img
        src="/connect-hero.svg"
        alt="Подключение к бирже"
        className="mx-auto h-[240px] w-auto"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      />
      <h1 className="mt-2 text-center text-[22px] font-extrabold leading-7 tracking-tight text-fg sm:text-[28px] sm:leading-[34px]">
        {'Подключите Т-Инвестиции'.split(' ').map((w, i) => (
          <motion.span
            key={i}
            className="inline-block"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.05, duration: 0.3 }}
          >
            {w}
            {i === 0 ? ' ' : ''}
          </motion.span>
        ))}
      </h1>
      <motion.p
        className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-fg-secondary"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.3 }}
      >
        Торгуйте фьючерсами FORTS через официальный API. Токен хранится только на вашем устройстве.
      </motion.p>

      {/* Горизонтальный прогресс (mobile) */}
      <div className="mt-5 flex gap-1.5 sm:hidden">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className={cn('h-1 flex-1 rounded-full transition-colors', step >= s.n ? 'bg-yellow' : 'bg-panel-raised')}
          />
        ))}
      </div>

      {/* Степпер */}
      <div className="mt-6">
        {STEPS.map((s, idx) => {
          const done = stepDone(s.n);
          const current = step === s.n;
          const open = current || (done && step >= s.n);
          return (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + idx * 0.12, duration: 0.3 }}
              className="relative"
            >
              {/* соединительная линия */}
              {idx < STEPS.length - 1 && (
                <span className="absolute bottom-0 left-[19px] top-10 w-px bg-subtle">
                  <motion.span
                    className="block w-px bg-yellow"
                    initial={{ height: 0 }}
                    animate={{ height: done ? '100%' : 0 }}
                    transition={{ duration: 0.3 }}
                  />
                </span>
              )}
              <button
                type="button"
                onClick={() => done && !current && setStep(s.n)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left',
                  done && !current ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-colors',
                    done
                      ? 'border-yellow bg-yellow text-app'
                      : current
                        ? 'border-yellow text-yellow'
                        : 'border-subtle text-fg-muted',
                  )}
                >
                  {done ? (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.3 }}>
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </motion.span>
                  ) : (
                    s.n
                  )}
                </span>
                <span>
                  <span className={cn('block text-sm font-bold', current || done ? 'text-fg' : 'text-fg-muted')}>
                    {s.title}
                  </span>
                  <span className="block text-xs text-fg-secondary">{s.hint}</span>
                </span>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="pb-6 pl-12 pr-1 pt-1">
                      {s.n === 1 && (current ? <TokenStep verify={verify} /> : (
                        <p className="mono text-xs text-fg-secondary">
                          Токен {maskedToken(token)} · <button type="button" className="text-yellow hover:underline" onClick={() => setStep(1)}>изменить</button>
                        </p>
                      ))}

                      {s.n === 2 &&
                        (current ? (
                          accounts.length === 0 ? (
                            <div className="rounded-[10px] border border-subtle bg-inset p-4 text-center">
                              <p className="text-sm text-fg-secondary">
                                {mode === 'sandbox'
                                  ? 'В песочнице пока нет счетов — создайте первый.'
                                  : 'Откройте счёт в приложении Т-Инвестиции и вернитесь.'}
                              </p>
                              {mode === 'sandbox' && (
                                <button
                                  type="button"
                                  onClick={createSandboxAccount}
                                  disabled={creatingSandbox}
                                  className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-60"
                                >
                                  {creatingSandbox && <Loader2 className="h-4 w-4 animate-spin" />}
                                  {creatingSandbox ? 'Создаём…' : 'Создать счёт песочницы'}
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <AccountPicker
                                accounts={accounts}
                                value={accountId}
                                onChange={(id) => {
                                  useConnectionStore.getState().setAccount(id);
                                  setStep(3);
                                }}
                              />
                            </div>
                          )
                        ) : (
                          <p className="mono text-xs text-fg-secondary">
                            {accounts.find((a) => a.id === accountId)?.name ?? 'Счёт'} •…{accountId?.slice(-4) ?? '—'}
                          </p>
                        ))}

                      {s.n === 3 && current && (
                        <div className="space-y-3">
                          {modeRefreshing && (
                            <p className="flex items-center gap-2 text-xs text-fg-secondary">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Обновляем список счетов…
                            </p>
                          )}
                          <ModeCards value={mode} onChange={selectMode} disabled={modeRefreshing} />
                          <button
                            type="button"
                            onClick={finish}
                            disabled={!accountId || modeRefreshing}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-50"
                          >
                            Подключить и начать
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Демо-вход */}
      <motion.button
        type="button"
        onClick={enterDemo}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-subtle text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
      >
        <FlaskConical className="h-4 w-4 text-info" />
        Войти в демо без токена
      </motion.button>

      {/* Футер доверия */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-fg-muted">
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-yellow-dim" /> Токен хранится локально (шифрование)
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-yellow-dim" /> Соединение TLS
        </span>
        <span className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5 text-yellow-dim" /> Отзыв токена в любой момент
        </span>
      </div>

      <ConfirmDangerModal
        open={confirmLive}
        onOpenChange={setConfirmLive}
        title="Вы включаете торговлю реальными деньгами"
        description="Роботы и ручные ордера будут исполняться на боевом счёте. Убедитесь, что риск-лимиты настроены на странице «Риски»."
        confirmLabel="Удерживайте для боевого режима"
        onConfirm={() => {
          toast('Подключено', { details: 'Боевой режим · реальные деньги', variant: 'warn' });
          navigate('/');
        }}
      />
    </div>
  );
}

// ======================= Состояние B: управление подключением =======================

interface LogEntry {
  id: number;
  time: number;
  text: string;
}

function ConnectedView() {
  const token = useConnectionStore((s) => s.token);
  const accounts = useConnectionStore((s) => s.accounts);
  const accountId = useConnectionStore((s) => s.accountId);
  const mode = useConnectionStore((s) => s.mode);
  const status = useConnectionStore((s) => s.status);
  const latencyMs = useConnectionStore((s) => s.latencyMs);
  const demoMode = useConnectionStore((s) => s.demoMode);

  const [testing, setTesting] = useState(false);
  const [payingIn, setPayingIn] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [revealLeft, setRevealLeft] = useState(0); // сек до скрытия токена
  const [installKey, setInstallKey] = useState(0);
  const [installMounted, setInstallMounted] = useState(false);
  const [log, setLog] = useState<LogEntry[]>(() => [
    { id: Date.now(), time: Date.now(), text: token ? 'Подключено к T-Invest API' : 'Демо-режим активирован' },
  ]);
  const revealTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const addLog = useCallback((text: string) => {
    setLog((l) => [{ id: Date.now() + Math.random(), time: Date.now(), text }, ...l].slice(0, 20));
  }, []);

  useEffect(() => () => clearInterval(revealTimer.current), []);

  const isDemo = demoMode && !token;
  const currentAccount = accounts.find((a) => a.id === accountId);
  const online = status === 'online' || isDemo;

  const retest = async () => {
    setTesting(true);
    const ok = await useConnectionStore.getState().testConnection();
    setTesting(false);
    addLog(ok ? 'Проверка соединения — успешно' : 'Проверка соединения — ошибка API');
    toast(ok ? 'Соединение в норме' : 'API не отвечает', {
      details: ok ? `задержка ${useConnectionStore.getState().latencyMs ?? '—'}мс` : 'проверьте токен и сеть',
      variant: ok ? 'success' : 'error',
    });
  };

  const switchAccount = (id: string) => {
    useConnectionStore.getState().setAccount(id);
    const a = accounts.find((x) => x.id === id);
    addLog(`Счёт изменён: ${a?.name ?? id}`);
    toast('Счёт изменён', { details: `${a?.name ?? ''} •…${id.slice(-4)}`, variant: 'success' });
  };

  const applyMode = async (m: AppMode) => {
    useConnectionStore.getState().setMode(m);
    addLog(m === 'live' ? 'Включён боевой режим' : 'Переключено на песочницу');
    toast(m === 'live' ? 'Включён боевой режим' : 'Переключено на песочницу', {
      details: m === 'live' ? 'Ордера исполняются реальными деньгами' : 'Виртуальные деньги',
      variant: m === 'live' ? 'warn' : 'info',
    });
    await refreshAccounts(true);
  };

  const switchMode = (m: AppMode) => {
    if (m === mode) return;
    if (m === 'live') setConfirmLive(true);
    else void applyMode('sandbox');
  };

  const payIn = async () => {
    if (!accountId) return;
    setPayingIn(true);
    try {
      await sandboxPayIn(accountId, 100_000);
      addLog('Песочница пополнена на 100 000 ₽');
      toast('Песочница пополнена', { details: '+100 000 ₽', variant: 'success' });
    } catch (e) {
      toast('Не удалось пополнить', { details: apiErrorText(e), variant: 'error' });
    } finally {
      setPayingIn(false);
    }
  };

  const revealToken = () => {
    if (revealLeft > 0) return;
    setRevealLeft(10);
    clearInterval(revealTimer.current);
    revealTimer.current = setInterval(() => {
      setRevealLeft((v) => {
        if (v <= 1) {
          clearInterval(revealTimer.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  };

  const reshowInstall = () => {
    try {
      localStorage.removeItem('fp_install_dismissed');
    } catch {
      /* ignore */
    }
    setInstallKey((k) => k + 1);
    setInstallMounted(true);
    toast('Баннер установки запрошен', {
      details: 'Если не появился — приложение уже установлено или браузер не поддерживает установку',
      variant: 'info',
    });
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-2">
      <h1 className="text-[22px] font-extrabold leading-7 tracking-tight text-fg sm:text-[28px] sm:leading-[34px]">
        Подключение
      </h1>

      {/* Карточка статуса */}
      <section className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              'h-3 w-3 shrink-0 rounded-full',
              isDemo ? 'bg-info' : online ? 'bg-long pulse-dot' : status === 'connecting' ? 'bg-warn animate-pulse' : 'bg-short',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-fg">
              {isDemo ? 'Демо-режим (mock-данные)' : online ? 'Подключено к T-Invest API' : 'Нет соединения с API'}
            </div>
            <div className="mono mt-0.5 text-xs text-fg-secondary">
              <AnimatePresence mode="wait">
                <motion.span
                  key={latencyMs ?? 'none'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {isDemo
                    ? 'API не используется · данные генерируются локально'
                    : `задержка ${latencyMs !== null ? `${latencyMs}мс` : '—'} · поток котировок активен · сессия до 23:50`}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
          <Badge variant={mode === 'live' ? 'accent' : 'info'}>{mode === 'live' ? 'Боевой режим' : 'Песочница'}</Badge>
          {currentAccount && (
            <Badge variant="neutral">
              {currentAccount.name} <span className="mono">•…{currentAccount.id.slice(-4)}</span>
            </Badge>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {token && (
            <button
              type="button"
              onClick={retest}
              disabled={testing}
              className="flex h-10 items-center gap-2 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg transition-colors hover:border-strong disabled:opacity-60"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Проверить соединение
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollTo('connect-accounts')}
            className="h-10 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
          >
            Сменить счёт
          </button>
          <button
            type="button"
            onClick={() => scrollTo('connect-mode')}
            className="h-10 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
          >
            Сменить режим
          </button>
          {mode === 'sandbox' && token && (
            <button
              type="button"
              onClick={payIn}
              disabled={payingIn || !accountId}
              className="flex h-10 items-center gap-2 rounded-[10px] border border-info/40 px-4 text-sm font-semibold text-info transition-colors hover:bg-[rgba(59,130,246,0.10)] disabled:opacity-60"
            >
              {payingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              Пополнить песочницу
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="flex h-10 items-center gap-2 rounded-[10px] border border-short px-4 text-sm font-semibold text-short transition-colors hover:bg-short-dim"
          >
            <Unplug className="h-4 w-4" />
            {token ? 'Отключить токен' : 'Выйти из демо'}
          </button>
        </div>
      </section>

      {/* Счета */}
      {token && (
        <section id="connect-accounts" className="scroll-mt-4 rounded-xl border border-subtle bg-panel p-4 sm:p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">Счета</h2>
          {accounts.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Счета не найдены.{' '}
              <button type="button" onClick={retest} className="font-semibold text-yellow hover:underline">
                Обновить
              </button>
            </p>
          ) : (
            <AccountPicker accounts={accounts} value={accountId} onChange={switchAccount} />
          )}
        </section>
      )}

      {/* Режим */}
      <section id="connect-mode" className="scroll-mt-4 rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">Режим</h2>
        <ModeCards value={mode} onChange={switchMode} />
      </section>

      {/* Безопасность */}
      <section className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">Безопасность</h2>
        <div className="space-y-3">
          <PinSettings />
          {token && (
            <div className="rounded-xl border border-subtle bg-inset p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-fg">API-токен</div>
                  <motion.div
                    animate={{ filter: revealLeft > 0 ? 'blur(0px)' : 'blur(8px)' }}
                    transition={{ duration: 0.4 }}
                    className="mono mt-1 select-none break-all text-xs text-fg-secondary"
                  >
                    {revealLeft > 0 ? token : maskedToken(token)}
                  </motion.div>
                  {revealLeft > 0 && (
                    <div className="mono mt-1 text-[11px] text-warn">скроется через {revealLeft}с</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={revealToken}
                  disabled={revealLeft > 0}
                  className="h-10 shrink-0 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg disabled:opacity-50"
                >
                  Показать токен
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="h-10 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
          >
            Перевыпустить подключение
          </button>
        </div>
      </section>

      {/* Установка PWA */}
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <img src="/connect-hero.svg" alt="" className="hidden h-20 w-auto sm:block" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-fg">FORTS PILOT как приложение</div>
          <div className="mt-0.5 text-xs text-fg-secondary">
            Мгновенный запуск с экрана «Домой», push-уведомления о сделках, работает как приложение.
          </div>
        </div>
        <button
          type="button"
          onClick={reshowInstall}
          className="flex h-10 items-center gap-2 rounded-[10px] border border-subtle px-4 text-sm font-semibold text-fg-secondary transition-colors hover:border-strong hover:text-fg"
        >
          <Download className="h-4 w-4" />
          Показать баннер установки
        </button>
      </section>

      {/* Журнал соединения */}
      <section className="rounded-xl border border-subtle bg-panel p-4 sm:p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-fg-secondary">
          Журнал соединения
        </h2>
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {log.map((e) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-baseline gap-3 text-sm"
              >
                <span className="mono shrink-0 text-xs text-fg-muted">{formatTime(e.time)}</span>
                <span className="text-fg-secondary">{e.text}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>

      <ConfirmDangerModal
        open={confirmLive}
        onOpenChange={setConfirmLive}
        title="Включить боевой режим?"
        description="Ордера будут исполняться на реальном счёте с реальными деньгами. Убедитесь, что риск-лимиты настроены."
        confirmLabel="Удерживайте для боевого режима"
        onConfirm={() => void applyMode('live')}
      />
      <ConfirmDangerModal
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={token ? 'Отключить API-токен?' : 'Выйти из демо-режима?'}
        description="Роботы будут остановлены, ордера отменены. Токен будет удалён с этого устройства."
        confirmLabel="Удерживайте для отключения"
        onConfirm={() => {
          useConnectionStore.getState().disconnect();
          toast('Подключение сброшено', { variant: 'info' });
        }}
      />

      {installMounted && <InstallPrompt key={installKey} />}
    </div>
  );
}

// ======================= Страница =======================

export default function Connect() {
  const connected = useConnectionStore(selectIsConnected);
  const token = useConnectionStore((s) => s.token);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const retry = useCallback(async () => {
    if (!navigator.onLine) {
      toast('Соединения по-прежнему нет', { variant: 'warn' });
      return false;
    }
    setOnline(true);
    if (token) await useConnectionStore.getState().testConnection();
    return true;
  }, [token]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={PAGE_TRANSITION}
      className="pb-6"
    >
      <ToastHost />
      {!online ? <OfflineScreen onRetry={retry} /> : connected ? <ConnectedView /> : <WizardView />}
    </motion.div>
  );
}
