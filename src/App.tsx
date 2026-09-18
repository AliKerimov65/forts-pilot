// App — корневой роутинг (паттерн B: AppShell с <Outlet/> + вложенные Route)
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import AppShell from '@/components/AppShell';
import InstallPrompt, { trackVisit } from '@/components/InstallPrompt';
import LockScreen from '@/components/LockScreen';
import Dashboard from '@/pages/Dashboard';
import Stub from '@/pages/Stub';
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
          <Route path="terminal" element={<RequireConnection><Stub title="Терминал" /></RequireConnection>} />
          <Route path="robots" element={<RequireConnection><Stub title="Торговые роботы" /></RequireConnection>} />
          <Route path="positions" element={<RequireConnection><Stub title="Позиции и ордера" /></RequireConnection>} />
          <Route path="journal" element={<RequireConnection><Stub title="Журнал сделок" /></RequireConnection>} />
          <Route path="risk" element={<RequireConnection><Stub title="Риск-менеджмент" /></RequireConnection>} />
          <Route path="connect" element={<Stub title="Подключение" subtitle="Скоро — ввод API-токена Т-Инвестиций, выбор счёта и режима" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <InstallPrompt />
      <LockScreen />
    </BrowserRouter>
  );
}
