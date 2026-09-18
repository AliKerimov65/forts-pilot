// RobotStatusDot — точка статуса робота 8px (design.md §5)
import { cn } from '@/lib/utils';
import type { RobotStatus } from '@/types/robot';

const STATUS_CLASSES: Record<RobotStatus, string> = {
  running: 'bg-long pulse-dot',
  paused: 'bg-yellow',
  error: 'bg-short',
  off: 'bg-fg-muted',
};

const STATUS_TITLES: Record<RobotStatus, string> = {
  running: 'Работает',
  paused: 'Пауза',
  error: 'Ошибка',
  off: 'Выключен',
};

export interface RobotStatusDotProps {
  status: RobotStatus;
  /** Размер, px (по умолчанию 8) */
  size?: number;
  className?: string;
}

export default function RobotStatusDot({ status, size = 8, className }: RobotStatusDotProps) {
  return (
    <span
      title={STATUS_TITLES[status]}
      className={cn('inline-block shrink-0 rounded-full', STATUS_CLASSES[status], className)}
      style={{ width: size, height: size }}
    />
  );
}
