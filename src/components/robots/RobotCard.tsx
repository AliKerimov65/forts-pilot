// RobotCard — карточка живого робота (design.md robots §2):
// статус-точка, имя, бейджи, метрики 2×2, мини-график, управление,
// inline-accordion с деталями, статусные плашки ошибок/риск-стопа.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  ChartColumn,
  ChevronDown,
  Pencil,
  Pause,
  Play,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Robot } from '@/types/robot';
import Badge from '@/components/Badge';
import PriceTicker from '@/components/PriceTicker';
import RobotStatusDot from '@/components/RobotStatusDot';
import ConfirmDangerModal from '@/components/ConfirmDangerModal';
import Sparkline from '@/components/Sparkline';
import { formatRub, formatSignedRub, formatTime } from '@/lib/format';
import { synthPnlSeries } from './utils';
import { useRobotsStore } from '@/store/robots';
import { useRiskStore } from '@/store/risk';
import { useTradingStore } from '@/store/trading';
import { getRobotExposure } from '@/lib/robots/engine';
import { getExtConfig, useRobotsExtStore } from '@/lib/robots/config';
import RobotMiniChart from './RobotMiniChart';
import ConfirmModal from './ConfirmModal';
import RobotStatsModal from './RobotStatsModal';
import { ToggleSwitch } from './controls';

function formatUptime(fromMs?: number): string {
  if (!fromMs) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - fromMs) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

export default function RobotCard({
  robot,
  index = 0,
  onEdit,
}: {
  robot: Robot;
  index?: number;
  onEdit: (robot: Robot) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const setStatus = useRobotsStore((s) => s.setStatus);
  const removeRobot = useRobotsStore((s) => s.removeRobot);
  const removeConfig = useRobotsExtStore((s) => s.removeConfig);
  const dailyStopHit = useRiskStore((s) => s.limits.dailyStopRub > 0 && s.currentDayPnl <= -s.limits.dailyStopRub);
  const robotTrades = useTradingStore((s) => s.trades);
  const orders = useTradingStore((s) => s.orders);

  const ext = getExtConfig(robot);
  const running = robot.status === 'running';
  const dimmed = robot.status === 'paused' || robot.status === 'off';

  const lastTrades = useMemo(() => robotTrades.filter((t) => t.robotId === robot.id).slice(0, 5), [robotTrades, robot.id]);
  const robotOrders = useMemo(
    () => orders.filter((o) => o.instrumentId === robot.instrumentId && (o.status === 'new' || o.status === 'partially_filled')).slice(0, 5),
    [orders, robot.instrumentId],
  );
  // Синтетический P&L-спарклайн робота за 30д (детерминированный по id)
  const pnlSpark = useMemo(() => synthPnlSeries(robot.id, robot.stats.totalPnl, 30), [robot.id, robot.stats.totalPnl]);

  const directionLabel =
    robot.strategy === 'signal'
      ? ext.signal?.direction === 'long'
        ? 'Long'
        : ext.signal?.direction === 'short'
          ? 'Short'
          : 'Long/Short'
      : null;

  const toggleRunning = (next: boolean) => {
    if (next) {
      navigator.vibrate?.(10);
      setStatus(robot.id, 'running');
    } else {
      setStopConfirm(true);
    }
  };

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
      className={cn(
        'group overflow-hidden rounded-xl border border-subtle bg-panel transition-colors hover:border-strong',
        dimmed && 'opacity-75',
      )}
    >
      {/* Плашка остановки риск-менеджментом / ошибки */}
      {robot.status === 'error' && (
        <div className="flex items-center gap-2 border-b border-short/30 bg-short-dim px-4 py-2 text-xs font-medium text-short">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Ошибка: {robot.errorMessage ?? 'неизвестная'}</span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-short/40 px-2 py-0.5 text-[11px] hover:bg-short-dim"
            onClick={() => setStatus(robot.id, 'off')}
          >
            Сбросить
          </button>
        </div>
      )}
      {robot.status !== 'error' && dailyStopHit && !running && (
        <div className="flex items-center gap-2 border-b border-short/30 bg-short-dim px-4 py-2 text-xs font-medium text-short">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Остановлен: дневной лимит убытка</span>
          <Link to="/risk" className="shrink-0 rounded-md border border-short/40 px-2 py-0.5 text-[11px] hover:bg-short-dim">
            Сбросить лимит
          </Link>
        </div>
      )}

      <button type="button" className="block w-full cursor-pointer text-left" onClick={() => setExpanded((v) => !v)}>
        {/* Шапка */}
        <div className="flex items-center gap-2 px-4 pt-4">
          <RobotStatusDot status={robot.status} />
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-fg">{robot.name}</h3>
          <Badge variant={robot.strategy === 'grid' ? 'accent' : 'info'}>
            {robot.strategy === 'grid' ? 'GRID' : 'СИГНАЛ'}
          </Badge>
          <Badge variant={ext.mode === 'live' ? 'accent' : 'neutral'}>{ext.mode === 'live' ? 'Боевой' : 'Песочница'}</Badge>
        </div>
        <div className="mt-1 flex items-center gap-2 px-4 text-xs text-fg-secondary">
          <span className="mono font-semibold uppercase text-fg">{robot.ticker}</span>
          {directionLabel && <span>· {directionLabel}</span>}
          <ChevronDown className={cn('ml-auto h-4 w-4 text-fg-muted transition-transform', expanded && 'rotate-180')} />
        </div>

        {/* Метрики 2×2 */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 px-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">P&L за день</div>
            <PriceTicker
              value={robot.stats.dayPnl}
              signed
              format={(v) => formatSignedRub(v, 0)}
              className={cn('mono text-sm font-bold', robot.stats.dayPnl >= 0 ? 'text-long' : 'text-short')}
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Сделки / win-rate</div>
            <div className="mono text-sm font-semibold text-fg">
              {robot.stats.trades} · {(robot.stats.winRate * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Uptime</div>
            <div className="mono text-sm font-semibold text-fg">{formatUptime(robot.stats.lastStartedAt)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Экспозиция</div>
            <div className="truncate text-sm font-medium text-fg">{getRobotExposure(robot)}</div>
          </div>
        </div>

        {/* Мини-визуал */}
        <div className="mt-3 px-4 transition-opacity duration-200 group-hover:opacity-100" style={{ opacity: 0.85 }}>
          <RobotMiniChart robot={robot} />
        </div>
      </button>

      {/* Inline-детали (accordion) */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-subtle px-4 py-3">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-fg-muted">P&L робота за 30д</div>
            <Sparkline data={pnlSpark} width={240} height={40} positive={robot.stats.totalPnl >= 0} />
            <div className={cn('mono mt-1 text-sm font-bold', robot.stats.totalPnl >= 0 ? 'text-long' : 'text-short')}>
              {formatSignedRub(robot.stats.totalPnl, 0)} всего
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-fg-muted">Последние сделки</div>
            {lastTrades.length === 0 ? (
              <div className="text-xs text-fg-muted">Сделок пока нет</div>
            ) : (
              <ul className="space-y-1">
                {lastTrades.map((t) => (
                  <li key={t.id} className="flex items-center justify-between text-xs">
                    <span className={cn('font-medium', t.direction === 'long' ? 'text-long' : 'text-short')}>
                      {t.direction === 'long' ? 'Покупка' : 'Продажа'} {t.lots} лот
                    </span>
                    <span className="mono text-fg-secondary">{formatRub(t.price, 2)}</span>
                    <span className="mono text-fg-muted">{formatTime(t.time)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {robotOrders.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-fg-muted">Активные ордера</div>
              <ul className="space-y-1">
                {robotOrders.map((o) => (
                  <li key={o.orderId} className="flex items-center justify-between text-xs">
                    <span className={cn('font-medium', o.direction === 'long' ? 'text-long' : 'text-short')}>
                      {o.direction === 'long' ? 'Buy' : 'Sell'} {o.lotsRequested} лот
                    </span>
                    <span className="mono text-fg-secondary">{o.price ? formatRub(o.price, 2) : 'market'}</span>
                    <span className="text-fg-muted">{o.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Футер — управление */}
      <div className="mt-3 flex items-center gap-1 border-t border-subtle px-4 py-3">
        <ToggleSwitch checked={running} onChange={toggleRunning} label="Работает" />
        <span className="ml-1.5 text-xs font-medium text-fg-secondary">{running ? 'Работает' : 'Остановлен'}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconBtn
            title={robot.status === 'paused' ? 'Снять с паузы' : 'Пауза'}
            onClick={() => setStatus(robot.id, robot.status === 'paused' ? 'running' : 'paused')}
          >
            {robot.status === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </IconBtn>
          <IconBtn title="Редактировать" onClick={() => onEdit(robot)}>
            <Pencil className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Статистика" onClick={() => setStatsOpen(true)}>
            <ChartColumn className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Удалить" danger onClick={() => setDeleteConfirm(true)}>
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {/* Модалки */}
      <ConfirmModal
        open={stopConfirm}
        onOpenChange={setStopConfirm}
        title={`Остановить «${robot.name}»?`}
        description="Активные триггеры робота будут сняты. Открытая позиция останется на счёте — закройте её вручную на странице «Позиции»."
        confirmLabel="Остановить"
        onConfirm={() => setStatus(robot.id, 'off')}
      />
      <ConfirmDangerModal
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={`Удалить робота «${robot.name}»?`}
        description="Робот будет остановлен и удалён без возможности восстановления. Открытые позиции не закрываются."
        confirmLabel="Удерживайте для удаления"
        onConfirm={() => {
          removeConfig(robot.id);
          removeRobot(robot.id);
        }}
      />
      <RobotStatsModal robot={robot} open={statsOpen} onOpenChange={setStatsOpen} />
    </motion.article>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-fg-muted transition-colors',
        danger ? 'hover:border-short/40 hover:bg-short-dim hover:text-short' : 'hover:border-subtle hover:bg-panel-raised hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
