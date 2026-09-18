// Стор торговых роботов (данные и CRUD; движок исполнения — отдельный агент)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Robot, RobotStats, RobotStatus } from '@/types/robot';

export interface RobotsState {
  robots: Robot[];

  addRobot: (robot: Omit<Robot, 'id' | 'createdAt' | 'stats' | 'status'> & Partial<Pick<Robot, 'stats' | 'status'>>) => Robot;
  updateRobot: (id: string, patch: Partial<Omit<Robot, 'id'>>) => void;
  removeRobot: (id: string) => void;
  setStatus: (id: string, status: RobotStatus, errorMessage?: string) => void;
  updateStats: (id: string, stats: Partial<RobotStats>) => void;
}

const emptyStats = (): RobotStats => ({
  dayPnl: 0,
  totalPnl: 0,
  trades: 0,
  winRate: 0,
  allocatedCapital: 0,
});

export const useRobotsStore = create<RobotsState>()(
  persist(
    (set) => ({
      robots: [],

      addRobot: (input) => {
        const robot: Robot = {
          id: `robot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          status: input.status ?? 'off',
          stats: input.stats ?? emptyStats(),
          ...input,
        };
        set((s) => ({ robots: [...s.robots, robot] }));
        return robot;
      },

      updateRobot: (id, patch) =>
        set((s) => ({ robots: s.robots.map((r) => (r.id === id ? { ...r, ...patch, id } : r)) })),

      removeRobot: (id) => set((s) => ({ robots: s.robots.filter((r) => r.id !== id) })),

      setStatus: (id, status, errorMessage) =>
        set((s) => ({
          robots: s.robots.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status,
                  errorMessage: status === 'error' ? errorMessage : undefined,
                  stats:
                    status === 'running' ? { ...r.stats, lastStartedAt: Date.now() } : r.stats,
                }
              : r,
          ),
        })),

      updateStats: (id, stats) =>
        set((s) => ({
          robots: s.robots.map((r) => (r.id === id ? { ...r, stats: { ...r.stats, ...stats } } : r)),
        })),
    }),
    { name: 'forts-pilot-robots' },
  ),
);

/** Число активных роботов */
export function selectActiveRobots(s: RobotsState): number {
  return s.robots.filter((r) => r.status === 'running').length;
}
