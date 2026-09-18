import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Без StrictMode (react-dev.md: двойной запуск эффектов ломает canvas/поллинг)
createRoot(document.getElementById('root')!).render(<App />);

// Регистрация service worker (PWA, design.md §8)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* SW недоступен — приложение работает без офлайн-кеша */
    });
  });
}
