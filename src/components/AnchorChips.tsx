// AnchorChips — горизонтальные чипы-якоря длинных страниц (v2-components.md §9)
// Только mobile (lg:hidden), sticky под мобильным topbar (52px topbar + 40px чипы + 8px).
// Активный якорь отслеживается IntersectionObserver'ом; тап — smooth-scroll к секции.
// Компонент сам выставляет целевым секциям scroll-margin-top: 156px (под sticky-смещение).
// Экспорт: default. Пропсы — AnchorChipsProps.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface AnchorChipItem {
  /** id целевой секции (без #) */
  id: string;
  label: string;
}

export interface AnchorChipsProps {
  anchors: AnchorChipItem[];
  className?: string;
}

export default function AnchorChips({ anchors, className }: AnchorChipsProps) {
  const [activeId, setActiveId] = useState<string>(anchors[0]?.id ?? '');

  useEffect(() => {
    const targets = anchors
      .map((a) => document.getElementById(a.id))
      .filter((el): el is HTMLElement => el !== null);
    targets.forEach((el) => {
      el.style.scrollMarginTop = '156px';
    });
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [anchors]);

  const scrollTo = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      className={cn(
        'sticky top-[100px] z-20 -mx-3 flex gap-2 overflow-x-auto bg-app/95 px-3 py-2 backdrop-blur lg:hidden',
        className,
      )}
    >
      {anchors.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => scrollTo(a.id)}
          className={cn(
            'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-[120ms]',
            a.id === activeId
              ? 'border-yellow/40 bg-yellow-glow text-yellow'
              : 'border-subtle bg-panel text-fg-secondary',
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
