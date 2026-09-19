// Карточка сделки (journal.md §2.4): drawer справа (desktop) / bottom-sheet (mobile).
// Шапка с тикером и P&L, мини-график вход→выход, детали-таблица, копирование ID,
// блок «Контекст робота» для робо-сделок.
import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Bot, Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/Badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDateShort, formatNumber, formatRub, formatSignedRub, formatTime } from '@/lib/format';
import { showToast } from '@/components/monitor/toastBus';
import { formatDuration, REASON_LABELS, type EnrichedTrade } from './journalUtils';

/** Мини-график: отрезок цены вход→выход с маркерами ▲/▼ */
function TradeMiniChart({ t }: { t: EnrichedTrade }) {
  const W = 320;
  const H = 88;
  const pad = 14;
  const lo = Math.min(t.entryPrice, t.exitPrice);
  const hi = Math.max(t.entryPrice, t.exitPrice);
  const range = Math.max(hi - lo, 1e-9);
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - pad * 2);
  const y1 = y(t.entryPrice);
  const y2 = y(t.exitPrice);
  const profit = (t.pnl ?? 0) >= 0;
  const color = profit ? 'var(--long)' : 'var(--short)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[88px] w-full rounded-lg bg-inset">
      <motion.line
        x1={pad}
        y1={y1}
        x2={W - pad}
        y2={y2}
        stroke={color}
        strokeWidth={1.8}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.15 }}
      />
      {/* вход ▲ */}
      <g transform={`translate(${pad},${y1})`}>
        <path d="M0,-5 L5,4 L-5,4 Z" fill="var(--text-primary)" />
        <text x={8} y={4} fill="var(--text-muted)" fontSize={9} fontFamily="JetBrains Mono">
          вход {formatNumber(t.entryPrice)}
        </text>
      </g>
      {/* выход ▼ */}
      <g transform={`translate(${W - pad},${y2})`}>
        <path d="M0,5 L5,-4 L-5,-4 Z" fill={color} />
        <text x={-8} y={-8} textAnchor="end" fill={color} fontSize={9} fontFamily="JetBrains Mono">
          выход {formatNumber(t.exitPrice)}
        </text>
      </g>
    </svg>
  );
}

function DetailRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  // v2 §5.5.5: колонки label/значение 40%/60%
  return (
    <div className="grid grid-cols-[40%_60%] items-center gap-3 border-b border-subtle/60 py-2 last:border-0">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={cn('mono text-right text-[13px] text-fg', className)}>{value}</span>
    </div>
  );
}

export interface TradeDetailsProps {
  trade: EnrichedTrade | null;
  onOpenChange: (open: boolean) => void;
}

export default function TradeDetails({ trade, onOpenChange }: TradeDetailsProps) {
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    if (!trade) return;
    void navigator.clipboard?.writeText(trade.orderId ?? trade.id).catch(() => undefined);
    setCopied(true);
    showToast({ variant: 'info', title: 'ID скопирован', description: trade.orderId ?? trade.id });
    setTimeout(() => setCopied(false), 1200);
  };

  const t = trade;

  return (
    <Sheet open={trade !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn('overflow-y-auto border-strong bg-overlay shadow-overlay', !isMobile && 'w-[420px] sm:max-w-[420px]')}
      >
        {t && (
          <>
            <SheetHeader className="px-0">
              <SheetTitle className="flex items-center gap-2 text-fg">
                <span className="mono text-lg font-bold uppercase">{t.ticker}</span>
                <Badge variant={t.direction === 'long' ? 'long' : 'short'}>{t.direction === 'long' ? 'Лонг' : 'Шорт'}</Badge>
                <span className={cn('mono ml-auto text-lg font-bold', (t.pnl ?? 0) >= 0 ? 'text-long' : 'text-short')}>
                  {formatSignedRub(Math.round(t.pnl ?? 0))}
                </span>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4">
              <TradeMiniChart t={t} />
            </div>

            <div className="mt-4">
              <DetailRow label="Время открытия" value={`${formatDateShort(t.time - t.durationMs)} ${formatTime(t.time - t.durationMs)}`} />
              <DetailRow label="Время закрытия" value={`${formatDateShort(t.time)} ${formatTime(t.time)}`} />
              <DetailRow label="Длительность" value={formatDuration(t.durationMs)} />
              <DetailRow label="Лоты" value={t.lots} />
              <DetailRow label="Цена входа" value={formatNumber(t.entryPrice)} />
              <DetailRow label="Цена выхода" value={formatNumber(t.exitPrice)} />
              <DetailRow label="Комиссия" value={formatRub(t.commission ?? 0)} />
              <DetailRow
                label="Чистый P&L"
                value={formatSignedRub(Math.round((t.pnl ?? 0) - (t.commission ?? 0)))}
                className={(t.pnl ?? 0) >= 0 ? 'text-long' : 'text-short'}
              />
              <DetailRow
                label="Источник"
                value={
                  t.source === 'robot' ? (
                    <Link to="/robots" className="text-yellow hover:underline">
                      Робот: {t.robotName ?? '—'}
                    </Link>
                  ) : (
                    'Ручная'
                  )
                }
              />
              <DetailRow label="Причина закрытия" value={REASON_LABELS[t.reason]} />
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-fg-muted">ID ордера</span>
                <button
                  type="button"
                  onClick={copyId}
                  className="mono flex items-center gap-1.5 rounded-lg border border-subtle bg-inset px-2 py-1 text-[11px] text-fg-secondary transition-colors hover:border-strong hover:text-fg"
                >
                  <span className="max-w-[180px] truncate">{t.orderId ?? t.id}</span>
                  {copied ? <Check className="h-3 w-3 text-long" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Контекст робота */}
            {t.source === 'robot' && (
              <div className="mt-4 rounded-[10px] border border-yellow/30 bg-yellow-glow p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-yellow">
                  <Bot className="h-3.5 w-3.5" />
                  Контекст робота
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
                  {t.robotName ?? 'Робот'} ·{' '}
                  {t.reason === 'tp'
                    ? 'сработал тейк-профит уровня'
                    : t.reason === 'sl'
                      ? 'сработал стоп-лосс уровня'
                      : t.direction === 'long'
                        ? 'сигнал «MA9 пересекла MA21 вверх»'
                        : 'сигнал «MA9 пересекла MA21 вниз»'}
                </p>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
