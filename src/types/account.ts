// Типы подключения и счетов Т-Инвестиций

/** Счёт (нормализованный из UsersService/GetAccounts) */
export interface Account {
  id: string;
  /** Отображаемое имя, напр. "Основной счёт" */
  name: string;
  /** Тип счёта (ACCOUNT_TYPE_*) */
  type: string;
  status: string;
  openedDate?: string;
  accessLevel?: string;
}

/** Режим работы приложения */
export type AppMode = 'sandbox' | 'live';

/** Статус соединения с API */
export type ConnectionStatus = 'online' | 'offline' | 'error' | 'connecting';
