// Карточки шаблонов стратегий (design.md robots §3): витрина с живым мини-визуалом
// (SVG, точки сделок появляются последовательно, loop 3с) и кнопкой «Создать из шаблона».
import { motion } from 'framer-motion';
import { Grid3x3, Activity, ArrowRight, Scale } from 'lucide-react';
import type { RobotStrategy } from '@/types/robot';
import { cn } from '@/lib/utils';

const VW = 560;
const VH = 120;

/** Пила в канале + уровни + точки сделок (grid-витрина) */
function GridPreviewArt() {
  const saw =
    'M0,84 L40,64 L80,84 L120,44 L160,70 L200,38 L240,66 L280,34 L320,60 L360,30 L400,58 L440,26 L480,54 L520,22 L560,46';
  const levels = [26, 46, 66, 86];
  const dots: Array<{ x: number; y: number; side: 'long' | 'short' }> = [
    { x: 80, y: 84, side: 'long' },
    { x: 120, y: 44, side: 'short' },
    { x: 200, y: 38, side: 'long' },
    { x: 280, y: 34, side: 'short' },
    { x: 360, y: 30, side: 'long' },
    { x: 440, y: 26, side: 'short' },
    { x: 520, y: 22, side: 'long' },
  ];
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={{ width: '100%', height: VH }}>
      {/* Канал */}
      <rect x={0} y={18} width={VW} height={76} fill="var(--yellow-glow)" opacity={0.35} rx={6} />
      {levels.map((y) => (
        <line key={y} x1={0} x2={VW} y1={y} y2={y} stroke="var(--border-strong)" strokeDasharray="5 4" strokeWidth={1} />
      ))}
      <path d={saw} fill="none" stroke="var(--text-secondary)" strokeWidth={1.6} />
      {dots.map((d, i) => (
        <motion.circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={3.4}
          fill={d.side === 'long' ? 'var(--long)' : 'var(--short)'}
          initial={{ opacity: 0.25, scale: 0.8 }}
          animate={{ opacity: [0.25, 1, 1, 0.25], scale: [0.8, 1.25, 1, 0.8] }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
        />
      ))}
    </svg>
  );
}

/** Линия цены + две EMA + маркеры входа/выхода (signal-витрина) */
function SignalPreviewArt() {
  const price = 'M0,90 C60,86 90,60 140,64 C190,68 210,88 260,80 C310,72 330,40 380,42 C430,44 460,70 510,58 L560,44';
  const emaFast = 'M0,92 C60,88 95,64 140,66 C190,70 215,86 260,80 C310,73 335,44 380,44 C430,46 462,68 510,58 L560,47';
  const emaSlow = 'M0,94 C60,92 100,74 150,74 C200,76 230,86 270,84 C320,80 345,56 390,52 C440,50 470,64 515,60 L560,52';
  const markers: Array<{ x: number; y: number; dir: 'up' | 'down' }> = [
    { x: 140, y: 64, dir: 'up' },
    { x: 260, y: 80, dir: 'down' },
    { x: 380, y: 42, dir: 'up' },
    { x: 510, y: 58, dir: 'down' },
  ];
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={{ width: '100%', height: VH }}>
      <path d={price} fill="none" stroke="var(--text-secondary)" strokeWidth={1.6} />
      <path d={emaFast} fill="none" stroke="var(--accent-yellow)" strokeWidth={1.2} opacity={0.9} />
      <path d={emaSlow} fill="none" stroke="var(--info)" strokeWidth={1.2} opacity={0.9} />
      {markers.map((m, i) => (
        <motion.path
          key={i}
          d={m.dir === 'up' ? `M${m.x},${m.y - 7} l4,7 h-8 Z` : `M${m.x},${m.y + 7} l4,-7 h-8 Z`}
          fill={m.dir === 'up' ? 'var(--long)' : 'var(--short)'}
          initial={{ opacity: 0.25, scale: 0.8 }}
          animate={{ opacity: [0.25, 1, 1, 0.25], scale: [0.8, 1.25, 1, 0.8] }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }}
        />
      ))}
    </svg>
  );
}

/** Шкала торгового дня: открытие → клиринг → флэт → закрытие (regime-витрина) */
function RegimePreviewArt() {
  // Метки по горизонтали: 09:00 открытие, 14:00 клиринг, окно флэта, 18:45 закрытие
  const ticks = [
    { x: 20, label: '09:00', color: 'var(--accent-yellow)' },
    { x: 290, label: '14:00', color: 'var(--info)' },
    { x: 540, label: '18:45', color: 'var(--text-muted)' },
  ];
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={{ width: '100%', height: VH }}>
      {/* ось дня */}
      <line x1={20} y1={70} x2={540} y2={70} stroke="var(--border-strong)" strokeWidth={1.5} />
      {/* окно принудительного флэта перед закрытием */}
      <rect x={470} y={58} width={70} height={24} rx={5} fill="var(--short)" opacity={0.18} />
      {ticks.map((t) => (
        <g key={t.label}>
          <line x1={t.x} y1={62} x2={t.x} y2={78} stroke={t.color} strokeWidth={2} />
          <text x={t.x} y={96} fill="var(--text-muted)" fontSize={12} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
            {t.label}
          </text>
        </g>
      ))}
      {/* ноги хеджа: лонг/шорт-блоки в середине дня */}
      <rect x={120} y={38} width={90} height={14} rx={4} fill="var(--long)" opacity={0.5} />
      <rect x={220} y={38} width={45} height={14} rx={4} fill="var(--short)" opacity={0.5} />
      {/* бегущая точка «сейчас» */}
      <motion.circle
        cy={70}
        r={4}
        fill="var(--accent-yellow)"
        initial={{ cx: 20 }}
        animate={{ cx: [20, 470, 20] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
    </svg>
  );
}

const TEMPLATES: Array<{
  strategy: RobotStrategy;
  title: string;
  description: string;
  chips: string[];
  stats: string;
  icon: typeof Grid3x3;
}> = [
  {
    strategy: 'grid',
    title: 'Grid-бот (сеточная стратегия)',
    description:
      'Зарабатывает на колебаниях: расставляет сетку уровней выше и ниже цены, покупает на просадках и продаёт на отскоках. Идеален для боковика.',
    chips: ['Боковой рынок', 'До 20 уровней', 'Авто-перестройка сетки'],
    stats: 'Средний результат: +8,4%/мес · Макс. просадка −6%',
    icon: Grid3x3,
  },
  {
    strategy: 'signal',
    title: 'Сигнальный бот',
    description:
      'Торгует по сигналам индикаторов: пересечение EMA, RSI-фильтр. Авто-исполнение с обязательными стоп-лоссом и тейк-профитом.',
    chips: ['Трендовый рынок', 'SL/TP обязательны', 'RSI-фильтр'],
    stats: 'Win-rate 62% · R:R 1:2,1',
    icon: Activity,
  },
  {
    strategy: 'regime',
    title: 'Регламент MOEX · Hedge',
    description:
      'Внутридневной робот по расписанию биржи: вход за 10 мин до открытия, флэт за 25–38 мин до закрытия, хедж-режим, защита от маржин-колла.',
    chips: ['Внутри дня', 'Виртуальный хедж', 'Защита от маржин-колла'],
    stats: 'Флэт к закрытию дня · Без переноса overnight',
    icon: Scale,
  },
];

export default function TemplateCard({
  strategy,
  index = 0,
  onUse,
}: {
  strategy: RobotStrategy;
  index?: number;
  onUse: (strategy: RobotStrategy) => void;
}) {
  const t = TEMPLATES.find((x) => x.strategy === strategy)!;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className="group flex flex-col rounded-xl border border-subtle bg-panel p-4 transition-colors hover:border-strong md:p-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-yellow-glow text-yellow">
          <t.icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <h3 className="text-base font-semibold text-fg">{t.title}</h3>
      </div>

      <div className="mt-4 rounded-lg border border-subtle bg-inset p-2 transition-opacity duration-200 group-hover:opacity-100" style={{ opacity: 0.8 }}>
        {strategy === 'grid' ? <GridPreviewArt /> : strategy === 'regime' ? <RegimePreviewArt /> : <SignalPreviewArt />}
      </div>

      <p className="mt-3 text-sm leading-5 text-fg-secondary">{t.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {t.chips.map((c) => (
          <span key={c} className="rounded-md border border-subtle bg-panel-raised px-2 py-0.5 text-[11px] font-medium text-fg-secondary">
            {c}
          </span>
        ))}
      </div>

      <div className="mono mt-3 text-xs text-fg-muted">{t.stats}</div>

      <button
        type="button"
        onClick={() => onUse(strategy)}
        className={cn(
          'mt-4 flex h-10 items-center justify-center gap-2 rounded-[10px] bg-yellow text-sm font-bold text-app',
          'transition-shadow hover:glow-accent',
        )}
      >
        Создать из шаблона
        <ArrowRight className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
