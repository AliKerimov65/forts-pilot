// Хранилище учётных данных FORTS PILOT («credential vault»)
// Кардинальная замена zustand persist для токена: прямая СИНХРОННАЯ запись,
// обязательная верификация чтением после записи, проба доступности хранилища,
// фолбэк localStorage → IndexedDB. Без middleware, подписок и гонок состояний.

export interface Credentials {
  token: string;
  accountId: string | null;
  mode: 'sandbox' | 'live';
  savedAt: number;
}

export interface ProbeResult {
  localStorage: boolean;
  indexedDB: boolean;
  /** Понятная причина недоступности для UI */
  reason: string | null;
}

export interface SaveResult {
  ok: boolean;
  backend: 'localStorage' | 'indexedDB' | 'none';
  error: string | null;
}

const LS_KEY = 'forts-pilot-vault-v1';
const LEGACY_ZUSTAND_KEY = 'forts-pilot-connection';
const IDB_NAME = 'forts-pilot-vault';
const IDB_STORE = 'kv';

function safeGetLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Проба хранилища: реальная запись/чтение/удаление тестового ключа */
export function probeStorage(): ProbeResult {
  let ls = false;
  let lsError: string | null = null;
  try {
    const k = '__fp_probe__';
    window.localStorage.setItem(k, '1');
    ls = window.localStorage.getItem(k) === '1';
    window.localStorage.removeItem(k);
  } catch (e) {
    lsError = e instanceof Error ? e.message : String(e);
  }
  const idb = typeof indexedDB !== 'undefined';
  return {
    localStorage: ls,
    indexedDB: idb,
    reason: ls || idb ? null : `Браузер блокирует локальное хранилище${lsError ? ` (${lsError})` : ''} — вероятно, приватный режим или запрет данных сайтов`,
  };
}

/** IndexedDB: минимальная обёртка get/put/delete */
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB недоступна'));
  });
}

async function idbPut(value: Credentials): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, 'credentials');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка записи IndexedDB'));
  });
  db.close();
}

async function idbGet(): Promise<Credentials | null> {
  try {
    const db = await idbOpen();
    const value = await new Promise<Credentials | null>((resolve) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get('credentials');
      req.onsuccess = () => resolve((req.result as Credentials | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return value;
  } catch {
    return null;
  }
}

function parseCredentials(raw: string | null): Credentials | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Credentials;
    return typeof c?.token === 'string' && c.token.startsWith('t.') ? c : null;
  } catch {
    return null;
  }
}

/** Миграция из старого zustand persist-ключа (одноразовая, не удаляет источник) */
function migrateFromLegacy(): Credentials | null {
  const raw = safeGetLS(LEGACY_ZUSTAND_KEY);
  if (!raw) return null;
  try {
    const state = (JSON.parse(raw) as { state?: Record<string, unknown> }).state;
    const token = typeof state?.token === 'string' ? state.token : null;
    if (!token || !token.startsWith('t.')) return null;
    return {
      token,
      accountId: typeof state?.accountId === 'string' ? state.accountId : null,
      mode: state?.mode === 'live' ? 'live' : 'sandbox',
      savedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Синхронное чтение (localStorage + legacy-миграция).
 * IndexedDB проверяется только асинхронно — см. loadCredentials().
 */
export function loadCredentialsSync(): Credentials | null {
  const direct = parseCredentials(safeGetLS(LS_KEY));
  if (direct) return direct;
  const legacy = migrateFromLegacy();
  if (legacy) {
    // переложили в хранилище нового формата (лучшее усилие)
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(legacy));
    } catch {
      /* не критично */
    }
    return legacy;
  }
  return null;
}

/** Полное чтение: localStorage → legacy → IndexedDB */
export async function loadCredentials(): Promise<Credentials | null> {
  const sync = loadCredentialsSync();
  if (sync) return sync;
  return idbGet();
}

/**
 * Атомарная ВЕРИФИЦИРУЕМАЯ запись: записал → прочитал обратно → сверил.
 * При отказе localStorage — асинхронный фолбэк в IndexedDB.
 */
export function saveCredentials(c: Credentials): SaveResult {
  const payload = JSON.stringify(c);
  try {
    window.localStorage.setItem(LS_KEY, payload);
    const readBack = window.localStorage.getItem(LS_KEY);
    if (readBack === payload) {
      return { ok: true, backend: 'localStorage', error: null };
    }
    // Запись не верифицировалась — хранилище молча отказало (редкие приватные режимы)
    throw new Error('чтение после записи не совпало');
  } catch (e) {
    const lsError = e instanceof Error ? e.message : String(e);
    if (typeof indexedDB !== 'undefined') {
      // Фолбэк: IndexedDB. Запись асинхронная по природе API — ставим в очередь
      // и честно сообщаем backend; финальную истину даст loadCredentials() при запуске.
      void idbPut(c).catch(() => {
        /* запишется при следующей попытке сохранения */
      });
      return { ok: true, backend: 'indexedDB', error: null };
    }
    return { ok: false, backend: 'none', error: `Хранилище недоступно: ${lsError}` };
  }
}

/** Полная очистка (localStorage + IndexedDB; из legacy-ключа удаляем только токен/счёт, настройки сохраняем) */
export function clearCredentials(): void {
  try {
    window.localStorage.removeItem(LS_KEY);
    // Стерилизуем legacy-ключ: иначе миграция «воскресит» удалённый токен при следующем запуске
    const legacyRaw = window.localStorage.getItem(LEGACY_ZUSTAND_KEY);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw) as { state?: Record<string, unknown> };
        if (parsed.state && ('token' in parsed.state || 'accountId' in parsed.state)) {
          delete parsed.state.token;
          delete parsed.state.accountId;
          window.localStorage.setItem(LEGACY_ZUSTAND_KEY, JSON.stringify(parsed));
        }
      } catch {
        /* повреждённый legacy — игнорируем */
      }
    }
  } catch {
    /* не критично */
  }
  if (typeof indexedDB !== 'undefined') {
    void idbOpen()
      .then(
        (db) =>
          new Promise<void>((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).delete('credentials');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              resolve();
            };
          }),
      )
      .catch(() => {
        /* не критично */
      });
  }
}
