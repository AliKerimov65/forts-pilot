// Карта рисков (monitor.md §2.3): виджет «До стопа» по каждой позиции +
// кольцевые индикаторы лимитов дня (дневной стоп, сделки, маржа).
import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Position } from '@/types/trading';
import { effectiveSlTp, pctToLevel, useSlTpStore } from './monitorData';
import { useRiskStore } from '@/store/risk';
import { formatNumber } from '@/lib/format';

/** Одна шкала «до стопа»: SL — текущая — TP, маркер скользит spring */
function StopGauge({ position }: { position: Position }) {
  const map = useSlTpStore((s) => s.map);
  const { sl, tp } = effectiveSlTp(position, map);
  const lo = Math.min(sl, tp);
  const hi = Math.max(sl, tp);
  const range = Math.max(hi - lo, 1e-9);
  const markerPct = Math.min(100, Math.max(0, ((position.currentPrice - lo) / range) * 100));
  const toStop = pctToLevel(position.currentPrice, sl);
  const toTarget = pctToLevel(position.currentPrice, tp);
  const danger = toStop < 0.5; // близко к стопу — пульсация

  // для лонга SL слева (красная зона слева от маркера), для шорта — справа
  const isLong = position.direction === 'long';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="mono text-xs font-semibold uppercase text-fg">{position.ticker}</span>
        <span className={cn('mono text-[11px]', danger ? 'text-short' : 'text-fg-secondary')}>
          до стопа {toStop.toFixed(1).replace('.', ',')}%
          {/* v2 §5.4.5: при >50% красной зоны — явная подпись */}
          {danger && ' · близко к стопу'}
        </span>
      </div>
      <div className={cn('relative mt-1.5 h-2 rounded-full bg-inset', danger && 'animate-pulse')}>
        {/* красная зона (к SL) */}
        <div
          className={cn('absolute inset-y-0 rounded-l-full bg-short/35', isLong ? 'left-0' : 'right-0')}
          style={isLong ? { width: `${markerPct}%` } : { width: `${100 - markerPct}%` }}
        />
        {/* зелёная зона (к TP) */}
        <div
          className={cn('absolute inset-y-0 rounded-r-full bg-long/30', isLong ? 'right-0' : 'left-0')}
          style={isLong ? { width: `${100 - markerPct}%` } : { width: `${markerPct}%` }}
        />
        {/* маркер текущей цены */}
        <motion.span
          className="absolute top-1/2 h-3.5 w-1.5 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_6px_rgba(242,244,247,0.6)]"
          animate={{ left: `calc(${markerPct}% - 3px)` }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        />
      </div>
      {/* v2 §5.4.5: масштаб-подписи по краям шкалы (абсолют + % от текущей) */}
      <div className="mono mt-1 flex justify-between text-[10px] text-fg-muted">
        <span className="text-short">
          SL {formatNumber(sl)} · −{toStop.toFixed(1).replace('.', ',')}%
        </span>
        <span className="text-long">
          TP {formatNumber(tp)} · +{toTarget.toFixed(1).replace('.', ',')}%
        </span>
      </div>
    </div>
  );
}

/** Кольцевой индикатор лимита (64px) */
function LimitRing({
  label,
  usedText,
  ratio,
}: {
  label: string;
  usedText: string;
  /** 0..1+ — заполнение к лимиту */
  ratio: number;
}) {
  const pct = Math.min(1, Math.max(0, ratio));
  const r = 26;
  const c = 2 * Math.PI * r;
  const over = ratio >= 1;
  const near = ratio >= 0.8 && !over;
  const stroke = over ? 'var(--short)' : near ? 'var(--warn)' : 'var(--long)';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={cn('relative h-16 w-16', near && 'animate-pulse')}>
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--bg-inset)" strokeWidth="6" />
          <motion.circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - pct) }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </svg>
        <span className="mono absolute inset-0 flex items-center justify-center text-[11px] font-bold text-fg">
          {Math.round(ratio * 100)}%
        </span>
      </div>
      <div className="text-center">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-fg-muted">{label}</div>
        <div className="mono text-[10px] text-fg-secondary">{usedText}</div>
      </div>
    </div>
  );
}

export interface RiskMapProps {
  positions: Position[];
  tradesToday: number;
}

const DAILY_TRADES_LIMIT = 50;

export default function RiskMap({ positions, tradesToday }: RiskMapProps) {
  const limits = useRiskStore((s) => s.limits);
  const currentDayPnl = useRiskStore((s) => s.currentDayPnl);
  const currentMarginPct = useRiskStore((s) => s.currentMarginPct);

  const lossUsed = Math.max(0, -currentDayPnl);
  const stopRatio = limits.dailyStopRub > 0 ? lossUsed / limits.dailyStopRub : 0;
  const tradesRatio = tradesToday / DAILY_TRADES_LIMIT;
  const marginRatio = limits.maxMarginPct > 0 ? currentMarginPct / limits.maxMarginPct : 0;
  const stopHit = limits.dailyStopRub > 0 && lossUsed >= limits.dailyStopRub;
  const marginHit = limits.maxMarginPct > 0 && currentMarginPct >= limits.maxMarginPct;

  return (
    <section className="rounded-xl border border-subtle bg-panel p-4 md:p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <ShieldAlert className="h-4 w-4 text-warn" />
        Карта рисков
      </h3>

      {/* До стопа */}
      <div className="mt-4 space-y-4">
        {positions.length === 0 && <p className="text-xs text-fg-muted">Нет открытых позиций — стопы не активны.</p>}
        {positions.map((p) => (
          <StopGauge key={p.instrumentId} position={p} />
        ))}
      </div>

      {/* Лимиты дня */}
      <div className="mt-5 border-t border-subtle pt-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Лимиты дня</div>
        <div className="mt-3 flex items-start justify-around">
          <LimitRing
            label="Стоп дня"
            usedText={`${formatNumber(lossUsed)} / ${formatNumber(limits.dailyStopRub)} ₽`}
            ratio={stopRatio}
          />
          <LimitRing label="Сделки" usedText={`${tradesToday}/${DAILY_TRADES_LIMIT}`} ratio={tradesRatio} />
          <LimitRing label="Маржа" usedText={`${currentMarginPct.toFixed(0)}% / ${limits.maxMarginPct}%`} ratio={marginRatio} />
        </div>
        {(stopHit || marginHit) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-[10px] border border-short/50 bg-short-dim px-3 py-2.5 text-xs font-semibold text-short"
          >
            Лимит исчерпан: автоторговля приостановлена
          </motion.div>
        )}
      </div>
    </section>
  );
}
