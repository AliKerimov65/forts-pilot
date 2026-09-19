import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Без StrictMode (react-dev.md: двойной запуск эффектов ломает canvas/поллинг)
createRoot(document.getElementById('root')!).render(<App />);

// Регистрация service worker (PWA) + автообновление версии
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let reloaded = false;
  // Новый SW активировался → перезагружаемся один раз, чтобы подхватить свежие ассеты
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        // Проверяем обновления при старте и каждые 15 минут
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
        // Если новый SW уже ждёт активации — активируем немедленно
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch(() => {
        /* SW недоступен — приложение работает без офлайн-кеша */
      });
  });
  // При возврате во вкладку — проверка обновлений
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((r) => r?.update().catch(() => {}));
    }
  });
}
