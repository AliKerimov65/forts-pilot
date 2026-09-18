// Хук жизненного цикла движка роботов — монтируется на странице «Роботы».
// Запускает цикл при монтировании, останавливает при размонтировании.
import { useEffect } from 'react';
import { useRobotsStore, selectActiveRobots } from '@/store/robots';
import { startRobotsEngine, stopRobotsEngine } from './engine';

export function useRobotsEngine(): { runningCount: number } {
  const runningCount = useRobotsStore(selectActiveRobots);

  useEffect(() => {
    startRobotsEngine();
    return () => stopRobotsEngine();
  }, []);

  return { runningCount };
}
