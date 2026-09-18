// Форматтеры чисел/денег (ru-RU, tabular-nums через класс .mono)

/** Деньги в ₽: "1 284 560,35 ₽" */
export function formatRub(value: number, fractionDigits = 2): string {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ₽`;
}

/** Число с разделителями: "73 412" */
export function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Процент со знаком: "+0,98%" */
export function formatPct(value: number, fractionDigits = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

/** Деньги со знаком: "+12 430 ₽" */
export function formatSignedRub(value: number, fractionDigits = 0): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatRub(Math.abs(value), fractionDigits)}`;
}

/** Время "14:32:07" */
export function formatTime(timeMs: number): string {
  return new Date(timeMs).toLocaleTimeString('ru-RU', { hour12: false });
}

/** Дата короткая "12 сен" */
export function formatDateShort(timeMs: number): string {
  return new Date(timeMs).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** «N мин назад» / время сегодня */
export function formatRelative(timeMs: number): string {
  const diff = Date.now() - timeMs;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24 && new Date(timeMs).getDate() === new Date().getDate()) return formatTime(timeMs);
  return formatDateShort(timeMs);
}
