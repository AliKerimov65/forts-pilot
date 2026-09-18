// App — корневой роутинг (паттерн B: AppShell с <Outlet/> + вложенные Route)
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import AppShell from '@/components/AppShell';
import InstallPrompt, { trackVisit } from '@/components/InstallPrompt';
import LockScreen from '@/components/LockScreen';
import Dashboard from '@/pages/Dashboard';
import Terminal from '@/pages/Terminal';
import Robots from '@/pages/Robots';
import Positions from '@/pages/Positions';
import Journal from '@/pages/Journal';
import Risk from '@/pages/Risk';
import Connect from '@/pages/Connect';
import { useConnectionStore, selectIsConnected } from '@/store/connection';

/** Редирект на /connect, если нет токена и не включён демо-режим (design.md §4.3) */
function RequireConnection({ children }: { children: ReactNode }) {
  const connected = useConnectionStore(selectIsConnected);
  if (!connected) return <Navigate to="/connect" replace />;
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    trackVisit(); // счётчик визитов для InstallPrompt (показ после 2-го)
    // Убираем splash после монтирования
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 300ms';
      setTimeout(() => splash.remove(), 320);
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<RequireConnection><Dashboard /></RequireConnection>} />
          <Route path="terminal" element={<RequireConnection><Terminal /></RequireConnection>} />
          <Route path="robots" element={<RequireConnection><Robots /></RequireConnection>} />
          <Route path="positions" element={<RequireConnection><Positions /></RequireConnection>} />
          <Route path="journal" element={<RequireConnection><Journal /></RequireConnection>} />
          <Route path="risk" element={<RequireConnection><Risk /></RequireConnection>} />
          <Route path="connect" element={<Connect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <InstallPrompt />
      <LockScreen />
    </BrowserRouter>
  );
}
