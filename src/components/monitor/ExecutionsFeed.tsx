// Лента исполнений (monitor.md §2.4): последние 20 событий-сделок, новые прилетают сверху.
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Bot, Hand, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTradingStore } from '@/store/trading';
import { formatTime, formatSignedRub } from '@/lib/format';
import EmptyState from '@/components/EmptyState';

export default function ExecutionsFeed() {
  const events = useTradingStore((s) => s.events);
  const items = events.filter((e) => e.type === 'trade' || e.type === 'sl' || e.type === 'tp').slice(0, 20);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-subtle bg-panel p-4 md:p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Activity className="h-4 w-4 text-yellow" />
        Лента исполнений
      </h3>
      {items.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-7 w-7" />}
          title="Исполнений пока нет"
          subtitle="Здесь появятся сделки и срабатывания SL/TP в реальном времени"
          className="py-6"
        />
      ) : (
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto lg:max-h-[520px]">
          <AnimatePresence initial={false}>
            {items.map((e) => {
              const isBuy = e.text.startsWith('Куплено') || e.text.includes('купил');
              const isRobot = Boolean(e.robotId) || e.text.includes('бот') || e.text.includes('Робот');
              return (
                <motion.li
                  key={e.id}
                  layout="position"
                  initial={{ opacity: 0, y: -12, backgroundColor: 'rgba(255,221,45,0.15)' }}
                  animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(255,221,45,0)' }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                >
                  <span className="mono shrink-0 text-[11px] text-fg-muted">{formatTime(e.time)}</span>
                  {isBuy ? (
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-long" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-short" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary" title={e.text}>
                    {e.text}
                  </span>
                  {isRobot ? (
                    <Bot className="h-3.5 w-3.5 shrink-0 text-yellow" />
                  ) : (
                    <Hand className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  )}
                  {e.amount !== undefined && (
                    <span className={cn('mono shrink-0 text-[11px] font-semibold', e.amount >= 0 ? 'text-long' : 'text-short')}>
                      {formatSignedRub(e.amount)}
                    </span>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
