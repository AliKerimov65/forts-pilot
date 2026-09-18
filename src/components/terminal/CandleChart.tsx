// CandleChart — свечной график на lightweight-charts v5 (design.md §5, terminal.md §2.3)
// Свечи long/short, объёмы 20% снизу, кроссхейр magnet, price scale справа mono.
// Оверлеи: ордера (синий пунктир), SL/TP (красный/зелёный пунктир, drag), уровни grid-робота,
// маркеры сделок ▲/▼. Drag линий SL/TP: pointer-обработчики + priceToCoordinate.
import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Instrument } from '@/types/market';
import type { Order, Trade } from '@/types/trading';
import { roundToStep } from './utils';

export interface ChartLine {
  id: string;
  price: number;
  color: string;
  title?: string;
  style?: 'dashed' | 'dotted' | 'solid';
  axisLabel?: boolean;
}

export interface CandleChartProps {
  candles: Candle[];
  instrument: Instrument | null;
  /** Длительность свечи в мс — для live-обновления последней свечи */
  intervalMs: number;
  /** Текущая цена (тик) — обновляет последнюю свечу */
  livePrice?: number;
  /** Линии активных ордеров выбранного инструмента */
  orders?: Order[];
  /** SL/TP тикета (drag на графике) */
  slPrice?: number | null;
  tpPrice?: number | null;
  /** Уровни grid-робота */
  gridLevels?: number[];
  /** Сделки для маркеров ▲▼ */
  trades?: Trade[];
  /** Drag-завершение линии SL/TP (родитель показывает confirm) */
  onLineDragEnd?: (kind: 'sl' | 'tp', price: number) => void;
  className?: string;
}

const LONG = '#16C784';
const SHORT = '#EA3943';
const INFO = '#3B82F6';
const GRID_LEVEL = 'rgba(154,164,178,0.35)';

function toSec(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export default function CandleChart({
  candles,
  instrument,
  intervalMs,
  livePrice,
  orders,
  slPrice,
  tpPrice,
  gridLevels,
  trades,
  onLineDragEnd,
  className,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<Map<string, IPriceLine>>(new Map());
  const candlesRef = useRef<Candle[]>([]);
  const instrumentRef = useRef<Instrument | null>(null);
  const dragRef = useRef<{ kind: 'sl' | 'tp'; line: IPriceLine; original: number } | null>(null);
  const onDragEndRef = useRef(onLineDragEnd);
  useEffect(() => {
    onDragEndRef.current = onLineDragEnd;
    instrumentRef.current = instrument;
  }, [onLineDragEnd, instrument]);

  // ---------- создание чарта (один раз) ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9AA4B2',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(30,38,50,0.6)' },
        horzLines: { color: 'rgba(30,38,50,0.6)' },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: '#2A3444', labelBackgroundColor: '#2A3444' },
        horzLine: { color: '#2A3444', labelBackgroundColor: '#2A3444' },
      },
      rightPriceScale: { borderColor: '#1E2632' },
      timeScale: { borderColor: '#1E2632', timeVisible: true, secondsVisible: false },
      width: el.clientWidth,
      height: el.clientHeight,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: LONG,
      downColor: SHORT,
      borderUpColor: LONG,
      borderDownColor: SHORT,
      wickUpColor: LONG,
      wickDownColor: SHORT,
      wickVisible: true,
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    markersRef.current = createSeriesMarkers(candleSeries, []);

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width: Math.max(0, width), height: Math.max(0, height) });
    });
    ro.observe(el);

    // ---------- drag линий SL/TP ----------
    const hitTest = (clientY: number): { kind: 'sl' | 'tp'; line: IPriceLine; price: number } | null => {
      const series = candleSeriesRef.current;
      if (!series) return null;
      const rect = el.getBoundingClientRect();
      const y = clientY - rect.top;
      for (const kind of ['sl', 'tp'] as const) {
        const line = linesRef.current.get(kind);
        if (!line) continue;
        const price = line.options().price;
        const coord = series.priceToCoordinate(price);
        if (coord !== null && Math.abs(coord - y) <= 8) return { kind, line, price };
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const hit = hitTest(e.clientY);
      if (!hit || !chartRef.current) return;
      dragRef.current = { kind: hit.kind, line: hit.line, original: hit.price };
      chartRef.current.applyOptions({ handleScroll: false, handleScale: false });
      el.style.touchAction = 'none';
      el.style.cursor = 'row-resize';
      hit.line.applyOptions({ lineWidth: 2 });
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const series = candleSeriesRef.current;
      if (!drag) {
        // hover-подсветка курсором над линиями SL/TP
        el.style.cursor = hitTest(e.clientY) ? 'row-resize' : 'crosshair';
        return;
      }
      if (!series) return;
      const rect = el.getBoundingClientRect();
      const price = series.coordinateToPrice(e.clientY - rect.top);
      if (price === null) return;
      const step = instrumentRef.current?.minPriceIncrement ?? 0;
      drag.line.applyOptions({ price: roundToStep(price, step || 0.0001) });
      e.preventDefault();
    };

    const onPointerUp = () => {
      const drag = dragRef.current;
      if (!drag || !chartRef.current) return;
      dragRef.current = null;
      chartRef.current.applyOptions({ handleScroll: true, handleScale: true });
      el.style.touchAction = '';
      el.style.cursor = 'crosshair';
      drag.line.applyOptions({ lineWidth: 1 });
      const newPrice = drag.line.options().price;
      // откат линии — подтверждение/отмена решает родитель (перерисует оверлеи)
      drag.line.applyOptions({ price: drag.original });
      if (Math.abs(newPrice - drag.original) > 1e-9) {
        onDragEndRef.current?.(drag.kind, newPrice);
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
      linesRef.current.clear();
    };
  }, []);

  // ---------- данные свечей ----------
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;
    candlesRef.current = candles;
    const seen = new Set<number>();
    const bars = candles.filter((c) => {
      const t = toSec(c.time) as number;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
    candleSeries.setData(
      bars.map((c) => ({ time: toSec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    volumeSeries.setData(
      bars.map((c) => ({
        time: toSec(c.time),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(22,199,132,0.45)' : 'rgba(234,57,67,0.45)',
      })),
    );
    chartRef.current?.timeScale().scrollToRealTime();
  }, [candles]);

  // ---------- live-тик: обновление последней свечи ----------
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || livePrice === undefined || intervalMs <= 0) return;
    const all = candlesRef.current;
    if (all.length === 0) return;
    const now = Date.now();
    const bucket = Math.floor(now / intervalMs) * intervalMs;
    const last = all[all.length - 1];
    let bar: Candle;
    if (bucket <= last.time) {
      bar = { ...last, close: livePrice, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice) };
    } else {
      bar = { time: bucket, open: livePrice, high: livePrice, low: livePrice, close: livePrice, volume: 0, isComplete: false };
    }
    candleSeries.update({ time: toSec(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    volumeSeries.update({
      time: toSec(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgba(22,199,132,0.45)' : 'rgba(234,57,67,0.45)',
    });
  }, [livePrice, intervalMs]);

  // ---------- оверлей-линии: ордера, SL/TP, grid ----------
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    for (const line of linesRef.current.values()) candleSeries.removePriceLine(line);
    linesRef.current.clear();

    const add = (line: ChartLine) => {
      const pl = candleSeries.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 1,
        lineStyle: line.style === 'dotted' ? LineStyle.SparseDotted : line.style === 'solid' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: line.axisLabel ?? true,
        title: line.title ?? '',
      });
      linesRef.current.set(line.id, pl);
    };

    for (const o of orders ?? []) {
      if (o.price === undefined) continue;
      add({
        id: `order-${o.orderId}`,
        price: o.price,
        color: INFO,
        title: `${o.direction === 'long' ? 'B' : 'S'} ${o.lotsRequested}`,
      });
    }
    if (slPrice != null) add({ id: 'sl', price: slPrice, color: SHORT, title: 'SL' });
    if (tpPrice != null) add({ id: 'tp', price: tpPrice, color: LONG, title: 'TP' });
    (gridLevels ?? []).forEach((p, i) =>
      add({ id: `grid-${i}`, price: p, color: GRID_LEVEL, style: 'dotted', axisLabel: false }),
    );
  }, [orders, slPrice, tpPrice, gridLevels]);

  // ---------- маркеры сделок ----------
  useEffect(() => {
    if (!markersRef.current) return;
    const markers: SeriesMarker<Time>[] = (trades ?? [])
      .map((t) => ({
        time: toSec(t.time),
        position: t.direction === 'long' ? ('belowBar' as const) : ('aboveBar' as const),
        color: t.direction === 'long' ? LONG : SHORT,
        shape: t.direction === 'long' ? ('arrowUp' as const) : ('arrowDown' as const),
        text: `${t.direction === 'long' ? 'Покупка' : 'Продажа'} ${t.lots} × ${t.price.toLocaleString('ru-RU')}`,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current.setMarkers(markers);
  }, [trades]);

  return <div ref={containerRef} className={className ?? 'h-full w-full'} style={{ cursor: 'crosshair' }} />;
}
