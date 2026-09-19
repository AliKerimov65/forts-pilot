// Страница «Торговые роботы» (/robots) — каталог живых роботов, шаблоны стратегий,
// конструктор (wizard). Движок исполнения монтируется здесь (useRobotsEngine).
// Design: /mnt/agents/output/design/robots.md
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { NotebookText, Plus } from 'lucide-react';
import type { Robot, RobotStrategy } from '@/types/robot';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import SectionTitle from '@/components/SectionTitle';
import StatCard from '@/components/StatCard';
import { cn } from '@/lib/utils';
import { formatRub, formatSignedRub } from '@/lib/format';
import { useRobotsStore } from '@/store/robots';
import { useRiskStore } from '@/store/risk';
import { useTradingStore } from '@/store/trading';
import { useConnectionStore } from '@/store/connection';
import { mockGetRobots } from '@/lib/tinvest/mock';
import { useRobotsEngine } from '@/lib/robots/useRobotsEngine';
import { useRobotsExtStore } from '@/lib/robots/config';
import RobotCard from '@/components/robots/RobotCard';
import TemplateCard from '@/components/robots/TemplateCard';
import RobotWizard from '@/components/robots/RobotWizard';
import { SegmentedControl } from '@/components/robots/controls';

type MobileTab = 'active' | 'all' | 'templates';

export default function Robots() {
  const navigate = useNavigate();
  const robots = useRobotsStore((s) => s.robots);
  const addRobot = useRobotsStore((s) => s.addRobot);
  const demoSeeded = useRobotsExtStore((s) => s.demoSeeded);
  const markDemoSeeded = useRobotsExtStore((s) => s.markDemoSeeded);
  const token = useConnectionStore((s) => s.token);
  const portfolio = useTradingStore((s) => s.portfolio);
  const riskLimits = useRiskStore((s) => s.limits);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editRobot, setEditRobot] = useState<Robot | null>(null);
  const [initialStrategy, setInitialStrategy] = useState<RobotStrategy>('grid');
  const [tab, setTab] = useState<MobileTab>('active');

  // Движок исполнения стратегий (поллинг 3с, сигналы, ордера, риск-стопы)
  useRobotsEngine();

  // Демо-роботы из CONTRACT (mockGetRobots) — один раз, только в демо-режиме
  useEffect(() => {
    if (!demoSeeded && robots.length === 0 && !token) {
      mockGetRobots().forEach((r) => {
        addRobot({
          name: r.name,
          strategy: r.strategy,
          instrumentId: r.instrumentId,
          ticker: r.ticker,
          status: r.status,
          params: r.params,
          stats: r.stats,
        });
      });
      markDemoSeeded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => robots.filter((r) => r.status === 'running'), [robots]);
  const inactive = useMemo(() => robots.filter((r) => r.status !== 'running'), [robots]);

  // Сводка
  const summary = useMemo(() => {
    const dayPnl = robots.reduce((a, r) => a + r.stats.dayPnl, 0);
    const tradesToday = robots.reduce((a, r) => a + r.stats.trades, 0);
    const best = robots.length
      ? robots.reduce((a, b) => (a.stats.dayPnl >= b.stats.dayPnl ? a : b))
      : null;
    const capital = robots.reduce((a, r) => a + r.stats.allocatedCapital, 0);
    const total = portfolio?.totalAmount ?? 500_000;
    const capitalPct = total > 0 ? (capital / total) * 100 : 0;
    return { dayPnl, tradesToday, best, capital, capitalPct };
  }, [robots, portfolio]);

  const openWizard = (strategy: RobotStrategy = 'grid', robot: Robot | null = null) => {
    setEditRobot(robot);
    setInitialStrategy(robot?.strategy ?? strategy);
    setWizardOpen(true);
  };

  const showActiveSection = tab === 'active' || tab === 'all';
  // v2 §5.3.8: при пустом каталоге шаблоны видны сразу под empty-state (даже на mobile-табе «Активные»)
  const showTemplates = tab === 'templates' || tab === 'all' || robots.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="space-y-4 lg:space-y-5"
    >
      {/* ===== Шапка (PageHeader v2) ===== */}
      <PageHeader
        group="Автоматика"
        title="Торговые роботы"
        subtitle={
          <>
            <span className="mono">{active.length}</span> активных · <span className="mono">{inactive.length}</span>{' '}
            на паузе/выключено
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate('/journal')}
              className="hidden h-10 items-center gap-2 rounded-[10px] border border-subtle px-4 text-sm font-medium text-fg-secondary transition-colors hover:border-strong hover:bg-panel-raised hover:text-fg md:flex"
            >
              <NotebookText className="h-4 w-4" />
              Журнал роботов
            </button>
            <button
              type="button"
              onClick={() => openWizard('grid')}
              className="hidden h-10 items-center gap-2 rounded-[10px] bg-yellow px-4 text-sm font-bold text-app transition-[box-shadow,filter] hover:glow-accent hover:brightness-[1.06] md:flex"
            >
              <Plus className="h-4 w-4" />
              Создать робота
            </button>
            {/* Mobile: primary остаётся круглой кнопкой в шапке */}
            <button
              type="button"
              onClick={() => openWizard('grid')}
              aria-label="Создать робота"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-yellow text-app transition-shadow hover:glow-accent md:hidden"
            >
              <Plus className="h-5 w-5" />
            </button>
          </>
        }
      />

      {/* ===== Сводка (mobile — карусель) ===== */}
      <section className="flex snap-x gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:pb-0 lg:gap-5">
        <motion.div
          className="min-w-[220px] snap-start md:min-w-0"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0 }}
        >
          <StatCard
            label="P&L роботов за день"
            value={formatSignedRub(summary.dayPnl, 0)}
            delta={summary.dayPnl >= 0 ? 'прибыль' : 'убыток'}
            deltaPositive={summary.dayPnl >= 0}
          />
        </motion.div>
        <motion.div
          className="min-w-[220px] snap-start md:min-w-0"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          <StatCard
            label="Лучший робот"
            value={summary.best ? summary.best.name : '—'}
            delta={summary.best ? formatSignedRub(summary.best.stats.dayPnl, 0) : undefined}
            deltaPositive={summary.best ? summary.best.stats.dayPnl >= 0 : undefined}
          />
        </motion.div>
        <motion.div
          className="min-w-[220px] snap-start md:min-w-0"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
        >
          <StatCard label="Сделок сегодня" value={String(summary.tradesToday)} />
        </motion.div>
        <motion.div
          className="min-w-[220px] snap-start md:min-w-0"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.24 }}
        >
          <StatCard
            label="Капитал в роботах"
            value={formatRub(summary.capital, 0)}
            footer={
              <div className="w-full">
                <div className="mono mb-1 flex justify-between text-[10px] text-fg-muted">
                  <span>{summary.capitalPct.toFixed(1)}% портфеля</span>
                  <span>лимит маржи {riskLimits.maxMarginPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-inset">
                  <motion.div
                    className={cn('h-full rounded-full', summary.capitalPct <= riskLimits.maxMarginPct ? 'bg-yellow' : 'bg-short')}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (summary.capitalPct / Math.max(1, riskLimits.maxMarginPct)) * 100)}%` }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                  />
                </div>
              </div>
            }
          />
        </motion.div>
      </section>

      {/* ===== Mobile-табы ===== */}
      <div className="md:hidden">
        <SegmentedControl
          options={[
            { value: 'active' as const, label: `Активные (${active.length})` },
            { value: 'all' as const, label: `Все (${robots.length})` },
            { value: 'templates' as const, label: 'Шаблоны' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {robots.length === 0 ? (
        /* v2 §5.3.8: пустая страница продаёт шаблоны — CTA-кнопки заменены витриной ниже */
        <EmptyState
          image="/empty-robots.svg"
          imageAlt="Нет роботов"
          title="У вас пока нет роботов"
          subtitle="Создайте первого робота из шаблона — grid для боковика или сигнальный для тренда."
          className="rounded-xl border border-dashed border-subtle py-12"
        />
      ) : (
        <>
          {/* ===== Активные ===== */}
          <section className={cn(showActiveSection ? 'block' : 'hidden', 'md:block')}>
            <SectionTitle title="Активные" count={active.length} className="mt-0" />
            {active.length === 0 ? (
              <div className="rounded-xl border border-dashed border-subtle p-6 text-center text-sm text-fg-muted">
                Нет работающих роботов — запустите любого из списка ниже
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {active.map((r, i) => (
                    <RobotCard key={r.id} robot={r} index={i} onEdit={(robot) => openWizard(robot.strategy, robot)} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* ===== На паузе / выключенные ===== */}
          {inactive.length > 0 && (
            <section className={cn(tab === 'all' ? 'block' : 'hidden', 'md:block')}>
              <SectionTitle title="На паузе / выключенные" count={inactive.length} />
              <div className="grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {inactive.map((r, i) => (
                    <RobotCard key={r.id} robot={r} index={i} onEdit={(robot) => openWizard(robot.strategy, robot)} />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}
        </>
      )}

      {/* ===== Шаблоны стратегий ===== */}
      <section className={cn(showTemplates ? 'block' : 'hidden', 'md:block')}>
        <SectionTitle title="Шаблоны стратегий" />
        <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
          <TemplateCard strategy="grid" index={0} onUse={(s) => openWizard(s)} />
          <TemplateCard strategy="signal" index={1} onUse={(s) => openWizard(s)} />
        </div>
      </section>

      {/* ===== Конструктор ===== */}
      <RobotWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editRobot={editRobot}
        initialStrategy={initialStrategy}
      />
    </motion.div>
  );
}
