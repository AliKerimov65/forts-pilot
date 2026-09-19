// Статус regime-робота («Регламент MOEX · Hedge») для карточки и деталей:
// фаза стратегии + обратный отсчёт до события регламента, виртуальные ноги L/S,
// индикатор маржи (ok/warn/reduce/emergency), последнее решение, таймлайн сессии.
// Данные — снапшот движка getRegimeStatus (поллинг 3с для активных роботов).
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import { REGIME_PHASE_LABELS, type RegimeConfig } from '@/lib/robots/config';
import { defaultFortsPlan } from '@/lib/robots/schedule';
import type { RegimeStatusSnapshot } from '@/lib/robots/regime';
import type { MarginLevel } from '@/lib/robots/marginGuard';
import { useRegimeStatus } from './utils';

// ---------- хуки ----------

/** Раз-секундный тик для обратного отсчёта */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------- маржа ----------

const MARGIN_STYLE: Record<MarginLevel, { chip: string; dot: string; label: string }> = {
  ok: { chip: 'bg-long-dim text-long', dot: 'bg-long', label: 'норма' },
  warn: { chip: 'bg-yellow-glow text-yellow', dot: 'bg-yellow', label: 'внимание' },
  reduce: { chip: 'bg-[rgba(245,165,36,0.12)] text-warn', dot: 'bg-warn', label: 'сокращение' },
  emergency: { chip: 'bg-short-dim text-short', dot: 'bg-short', label: 'авария' },
};

export function RegimeMarginChip({ level, utilization }: { level: MarginLevel | null; utilization: number | null }) {
  const lv: MarginLevel = level ?? 'ok';
  const st = MARGIN_STYLE[lv];
  return (
    <span
      className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold leading-none', st.chip)}
      title={`Утилизация маржи — ${st.label}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', st.dot, lv !== 'ok' && 'pulse-dot')} />
      Маржа <span className="mono">{utilization != null ? `${Math.round(utilization * 100)}%` : '—'}</span>
    </span>
  );
}

// ---------- панель статуса (карточка) ----------

export function RegimeStatusPanel({ robotId, running }: { robotId: string; running: boolean }) {
  const snap = useRegimeStatus(robotId, running);
  const now = useNow(running && snap?.nextEventAt != null);

  if (!snap) {
    return (
      <div className="mt-3 rounded-lg border border-subtle bg-inset px-3 py-2 text-xs text-fg-muted">
        Ожидание регламента — робот ещё не работал в этой сессии
      </div>
    );
  }

  const msLeft = snap.nextEventAt != null ? snap.nextEventAt - now : null;
  const net = snap.netLots;

  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-subtle bg-inset px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex h-[22px] items-center rounded-full bg-yellow-glow px-2 text-[11px] font-semibold leading-none text-yellow">
          {REGIME_PHASE_LABELS[snap.state] ?? snap.state}
        </span>
        {msLeft != null && (
          <span className="mono text-xs text-fg-secondary">
            до события <span className="font-bold text-fg">{formatCountdown(msLeft)}</span>
          </span>
        )}
      </div>

      <div className="mono flex items-center gap-3 text-xs text-fg-secondary">
        <span>
          L<span className="font-semibold text-long">{snap.legs.longLots}</span>
          <span className="mx-1 text-fg-muted">/</span>S
          <span className="font-semibold text-short">{snap.legs.shortLots}</span>
        </span>
        <span>
          нетто{' '}
          <span className={cn('font-semibold', net > 0 ? 'text-long' : net < 0 ? 'text-short' : 'text-fg')}>
            {net > 0 ? '+' : ''}
            {net} лот
          </span>
        </span>
        <RegimeMarginChip level={snap.marginLevel} utilization={snap.marginUtilization} />
      </div>

      {snap.lastEventText && <div className="truncate text-[11px] leading-4 text-fg-muted">{snap.lastEventText}</div>}
    </div>
  );
}

// ---------- таймлайн сессии (детали) ----------

interface Mark {
  t: number;
  label: string;
  color: string;
}

/** Горизонтальная шкала дня: открытие → клиринги 14:00/18:45 → флэт → закрытие */
export function RegimeSessionTimeline({
  snap,
  config,
  running,
}: {
  snap: RegimeStatusSnapshot | null;
  config: RegimeConfig;
  running: boolean;
}) {
  const now = useNow(running);
  const plan = defaultFortsPlan('FORTS', new Date(now));
  const open = snap?.sessionOpen ?? plan.sessionOpen.getTime();
  const close = snap?.dayClose ?? plan.dayClose.getTime();
  const flatAt = snap?.flatAt ?? null;
  const span = Math.max(1, close - open);
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - open) / span) * 100));

  // Дневной клиринг — из дефолтного плана FORTS; рисуем, только если попадает
  // внутрь отображаемой сессии (план движка может прийти из API/мока с иными границами)
  const dayClearing = plan.clearings.find((c) => c.kind === 'day');
  const clearingT = dayClearing?.start.getTime();
  const showClearing = clearingT != null && clearingT > open && clearingT < close;
  const marks: Mark[] = [
    { t: open, label: 'Открытие', color: 'bg-yellow' },
    ...(showClearing && clearingT != null ? [{ t: clearingT, label: 'Клиринг', color: 'bg-info' }] : []),
    ...(flatAt != null ? [{ t: flatAt, label: 'Флэт', color: 'bg-short' }] : []),
    { t: close, label: 'Закрытие', color: 'bg-fg-muted' },
  ];

  // Окно флэта (когда точный момент ещё не выбран движком)
  const flatFrom = close - config.flatBeforeCloseMaxMin * 60_000;
  const flatTo = close - config.flatBeforeCloseMinMin * 60_000;
  const inDay = now >= open && now <= close;

  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-panel-raised">
        {/* окно принудительного флэта */}
        <div
          className="absolute top-0 h-full rounded-full bg-short/25"
          style={{ left: `${pos(flatFrom)}%`, width: `${Math.max(1, pos(flatTo) - pos(flatFrom))}%` }}
          title={`Окно флэта: за ${config.flatBeforeCloseMinMin}–${config.flatBeforeCloseMaxMin} мин до закрытия`}
        />
        {/* текущее положение */}
        {inDay && (
          <motion.span
            className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full bg-yellow"
            initial={false}
            animate={{ left: `${pos(now)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        )}
      </div>
      {/* маркеры */}
      <div className="relative mt-1.5 h-9">
        {marks.map((m, i) => (
          <div
            key={m.label}
            className={cn(
              'absolute flex flex-col items-center',
              i === 0 ? 'items-start' : i === marks.length - 1 ? '-translate-x-full items-end' : '-translate-x-1/2',
            )}
            style={{ left: `${pos(m.t)}%` }}
          >
            <span className={cn('h-2 w-[2px] rounded-full', m.color)} />
            <span className="mono mt-0.5 whitespace-nowrap text-[9px] leading-3 text-fg-muted">{formatTime(m.t)}</span>
            <span className="whitespace-nowrap text-[9px] leading-3 text-fg-secondary">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="mono mt-1 text-[10px] text-fg-muted">
        Флэт {formatTime(flatFrom)}–{formatTime(flatTo)}
        {flatAt != null && ` · сегодня в ${formatTime(flatAt)}`}
        {snap?.direction && ` · план дня: ${snap.direction === 'long' ? 'лонг' : snap.direction === 'short' ? 'шорт' : 'пропуск'}`}
        {snap?.confidence != null && ` (${Math.round(snap.confidence * 100)}%)`}
      </div>
    </div>
  );
}
