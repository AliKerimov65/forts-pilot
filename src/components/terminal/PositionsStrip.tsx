// Блок «Открытые позиции» в Терминале (UX v2): компактная секция левой колонки над списком
// инструментов. Данные — trading store (демо: mock с живым P&L; боевой: getPortfolio/getPositions,
// поллинг 5с в useTerminalData). Клик по позиции → выбрать инструмент в терминале.
import { AlertTriangle, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import SectionTitle from '@/components/SectionTitle';
import { useMarketStore } from '@/store/market';
import { useTradingStore } from '@/store/trading';
import { instrumentTypeLabel } from '@/lib/tinvest/instruments';
import { fmtPnlRub, fmtPrice, futuresLabel, lotsWord, positionPnlPct } from './utils';

export interface PositionsStripProps {
  /** Ошибка загрузки позиций (боевой режим) — показать «Позиции недоступны» */
  error?: boolean;
  onRetry?: () => void;
  /** Колбэк после выбора инструмента (mobile: переключить вкладку) */
  onSelect?: () => void;
  className?: string;
}

export default function PositionsStrip({ error, onRetry, onSelect, className }: PositionsStripProps) {
  const positions = useTradingStore((s) => s.positions);
  const instruments = useMarketStore((s) => s.instruments);
  const selectedId = useMarketStore((s) => s.selectedInstrumentId);
  const selectInstrument = useMarketStore((s) => s.selectInstrument);

  return (
    <section className={cn('shrink-0 border-b border-strong bg-panel-raised', className)} aria-label="Открытые позиции">
      <SectionTitle
        title="Открытые позиции"
        count={positions.length}
        className="mb-0 mt-0 px-3 pt-2.5"
      />
      {error ? (
        // Ошибка API — не роняем терминал: панель-заглушка с повтором (v2 §2.5.2)
        <div className="flex items-center gap-2 px-3 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
          <span className="flex-1 text-[12px] text-fg-secondary">Позиции недоступны</span>
          <button
            type="button"
            onClick={onRetry}
            className="h-8 shrink-0 rounded-md border border-subtle px-3 text-[12px] font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg"
          >
            Повторить
          </button>
        </div>
      ) : positions.length === 0 ? (
        <EmptyState
          compact
          icon={<Briefcase className="h-6 w-6" strokeWidth={1.5} />}
          title="Нет открытых позиций"
          subtitle="Откройте сделку — позиция появится здесь"
        />
      ) : (
        <div className="max-h-[164px] overflow-y-auto pb-1 pt-1">
          {positions.map((p) => {
            const meta = instruments.find((i) => i.uid === p.instrumentId);
            const pct = positionPnlPct(p);
            const up = p.pnl >= 0;
            const active = p.instrumentId === selectedId;
            return (
              <button
                key={p.instrumentId}
                type="button"
                onClick={() => {
                  selectInstrument(p.instrumentId);
                  onSelect?.();
                }}
                className={cn(
                  'flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors duration-[120ms] hover:bg-panel',
                  active && 'bg-panel shadow-[inset_2px_0_0_var(--accent-yellow)]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="mono shrink-0 text-[12px] font-semibold uppercase text-fg">
                      {meta ? futuresLabel(meta) : p.ticker}
                    </span>
                    {meta && (
                      <span className="shrink-0 rounded-[4px] bg-panel px-1 py-px text-[9px] font-semibold uppercase leading-[14px] text-fg-muted">
                        {instrumentTypeLabel(meta.type)}
                      </span>
                    )}
                  </div>
                  <div className="mono mt-0.5 truncate text-[10px] text-fg-muted">
                    <span className={cn('font-semibold', p.direction === 'long' ? 'text-long' : 'text-short')}>
                      {p.direction === 'long' ? 'Лонг' : 'Шорт'} · {p.lots} {lotsWord(p.lots)}
                    </span>
                    <span>
                      {' '}
                      · {fmtPrice(p.avgPrice, meta)} → {fmtPrice(p.currentPrice, meta)}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn('mono text-[12px] font-semibold', up ? 'text-long' : 'text-short')}>
                    {fmtPnlRub(p.pnl)}
                  </div>
                  <div className={cn('mono text-[10px]', up ? 'text-long' : 'text-short')}>
                    {pct >= 0 ? '+' : ''}
                    {pct.toFixed(2)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
