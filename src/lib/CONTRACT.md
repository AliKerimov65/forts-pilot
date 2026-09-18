# FORTS PILOT — Контракт для page-агентов

Используйте ТОЛЬКО задокументированные здесь интерфейсы. Импорты через алиас `@/...`.
Роутинг: `react-router` v7 (`import { useNavigate, Link, useSearchParams } from 'react-router'` — НЕ `react-router-dom`, она не установлена).
Иконки — `lucide-react`. Все числа/деньги — класс `mono` (JetBrains Mono).

## Дизайн-токены → Tailwind-классы

| design.md токен | Класс |
|---|---|
| `bg-app` | `bg-app` |
| `bg-panel` | `bg-panel` |
| `bg-panel-raised` | `bg-panel-raised` |
| `bg-inset` | `bg-inset` |
| `border-subtle` / `border-strong` | `border-subtle` / `border-strong` |
| `accent` (#FFDD2D) | `bg-yellow` / `text-yellow` / `border-yellow` |
| `accent-dim` | `text-yellow-dim` |
| `accent-glow` | `bg-yellow-glow` |
| `long` / `long-dim` | `text-long` / `bg-long-dim` |
| `short` / `short-dim` | `text-short` / `bg-short-dim` |
| `warn` | `text-warn` / `bg-warn` |
| `info` | `text-info` / `bg-info` |
| `text-primary` / `text-secondary` / `text-muted` | `text-fg` / `text-fg-secondary` / `text-fg-muted` |

Утилиты: `.mono`, `.flash-long`/`.flash-short`, `.pulse-dot`, `.marquee-track`, `.shimmer`, `.glow-accent`, `.hero-glow`.
Кнопки: primary = `rounded-[10px] bg-yellow font-bold text-app hover:glow-accent`; danger = `border border-short text-short hover:bg-short-dim`; ghost = `border border-subtle`.

## Типы (`src/types/`, реэкспорт из `@/types`)

- `market.ts`: `Instrument {uid, figi, ticker, classCode, name, basicAsset, lot, currency, minPriceIncrement, expirationDate?, marginBuy?, marginSell?}`, `Candle {time(ms), open, high, low, close, volume, isComplete}`, `OrderBookLevel {price, quantity}`, `OrderBook {instrumentId, bids, asks, lastPrice, limitUp?, limitDown?, time}`, `Quote {instrumentId, price, delta, changePct?, time}`, `CandleInterval` (`CANDLE_INTERVAL_1_MIN|5_MIN|15_MIN|HOUR|DAY|WEEK`).
- `trading.ts`: `Direction='long'|'short'`, `Position {instrumentId, figi?, ticker, name?, direction, lots, avgPrice, currentPrice, pnl, margin?}`, `OrderStatus='new'|'partially_filled'|'filled'|'cancelled'|'rejected'`, `Order {orderId, accountId, instrumentId, ticker, direction, lotsRequested, lotsExecuted, price?, orderType:'limit'|'market', status, time, message?}`, `Trade {id, orderId?, instrumentId, ticker, direction, lots, price, commission?, pnl?, source:'manual'|'robot', robotId?, robotName?, time}`, `JournalEventType='trade'|'order'|'sl'|'tp'|'robot'|'risk'|'system'`, `JournalEvent {id, type, text, amount?, robotId?, instrumentId?, time}`, `PortfolioSummary {totalAmount, cash, freeMargin, blockedMargin, dayPnl, dayPnlPct, expectedYieldPct?}`, `EquityPoint {time, equity, benchmark?}`.
- `robot.ts`: `RobotStrategy='grid'|'signal'`, `RobotStatus='off'|'running'|'paused'|'error'`, `GridParams {upperBound, lowerBound, levels, lotsPerLevel}`, `SignalParams {signalType, timeframe, lots, stopLossPts?, takeProfitPts?}`, `RobotParams` (union по strategy), `RobotStats {dayPnl, totalPnl, trades, winRate(0..1), allocatedCapital, lastStartedAt?}`, `Robot {id, name, strategy, instrumentId, ticker, status, errorMessage?, params, stats, createdAt}`.
- `account.ts`: `Account {id, name, type, status, openedDate?, accessLevel?}`, `AppMode='sandbox'|'live'`, `ConnectionStatus='online'|'offline'|'error'|'connecting'`.

## API-слой (`@/lib/tinvest/`)

### client.ts
- `BASE_PROD`, `BASE_SANDBOX` — строки.
- `Quotation {units: string, nano: number}`, `MoneyValue extends Quotation {currency}`.
- `quotationToNumber(q): number`, `numberToQuotation(v): Quotation`, `numberToMoneyValue(v, currency='rub'): MoneyValue`.
- `class ApiError extends Error {status: number, code?, description?, trackingId?}` (status 0 = сеть/таймаут).
- `callApi<T>(service, method, body, {token, sandbox?, timeoutMs?, retries?}): Promise<T>` — низкий уровень (обычно не нужен, берите services).
- `newOrderId(): string` — UUID v4 для идемпотентности PostOrder.
- `maskToken(token): string` → `"t.ab…xyz"`.

### services.ts (режим sandbox/live выбирается АВТОМАТИЧЕСКИ из connection-стора; требуют токен, иначе throw)
- `getAccounts(): Promise<Account[]>`
- `getFutures(): Promise<Instrument[]>`
- `findInstrument(query: string): Promise<Instrument[]>`
- `getFuturesMargin(instrumentId): Promise<{buy: number, sell: number}>`
- `getCandles(instrumentId, from: Date, to: Date, interval: CandleInterval, limit?): Promise<Candle[]>`
- `getOrderBook(instrumentId, depth=20): Promise<OrderBook>`
- `getLastPrices(instrumentIds: string[]): Promise<Quote[]>`
- `postOrder(params: PostOrderParams): Promise<PostOrderResult>` — `PostOrderParams {instrumentId, direction, lots, orderType:'limit'|'market', price?, orderId?}`; `PostOrderResult {orderId, status, lotsRequested, lotsExecuted, executedPrice?, commission?, message?}`. В sandbox-режиме уходит в `SandboxService/PostSandboxOrder`.
- `cancelOrder(orderId): Promise<void>`
- `getOrders(): Promise<Order[]>`
- `getPortfolio(): Promise<PortfolioSummary & {positions: Position[]}>`
- `getPositions(): Promise<Position[]>`
- `openSandboxAccount(name?): Promise<string>` (accountId), `sandboxPayIn(accountId, amountRub): Promise<void>`, `postSandboxOrder(accountId, params): Promise<PostOrderResult>` — явные sandbox-вызовы.

### polling.ts
- `usePolling(fetcher: () => Promise<void>|void, {intervalMs, enabled?, immediate?}, onError?)` — пауза на скрытой вкладке, защита от наложения запросов.
- `POLLING_DEFAULTS = {prices: 3000, positions: 5000}`.

### mock.ts (детерминированные mock-данные; демо-режим и fallback)
- `MOCK_INSTRUMENTS: Instrument[]` (Si, BR, IMOEXF, RTSI, GAZP; uid вида `mock-uid-si`)
- `mockGetFutures()`, `mockFindInstrument(q)`, `mockGetCandles(uid, interval?, count=120)`, `mockGetOrderBook(uid, depth=10)`, `mockGetLastPrices(uids)` (сдвигает рандомволк — для поллинга), `mockGetPositions()`, `mockGetPortfolio()`, `mockGetEquitySeries('1D'|'1W'|'1M'|'3M'|'ALL')`, `mockGetTrades()`, `mockGetJournalEvents()`, `mockGetRobots()`, `seededRandom(seed)`.
- Паттерн: `const useMock = !useConnectionStore(s => s.token)` → mock-функции вместо services.

## Сторы (zustand, persist в localStorage)

### `@/store/connection` — `useConnectionStore`
Поля: `token: string|null`, `accountId: string|null`, `accounts: Account[]`, `mode: AppMode`, `status: ConnectionStatus`, `latencyMs: number|null`, `demoMode: boolean`.
Экшены: `setToken`, `setAccount`, `setAccounts`, `setMode`, `setStatus`, `setLatency`, `setDemoMode`, `testConnection(): Promise<boolean>` (GetAccounts + выбирает счёт), `disconnect()`.
Хелперы: `maskedToken(token)`, `selectIsConnected(s)` (токен ИЛИ demoMode — селектор для гейтов).

### `@/store/market` — `useMarketStore`
Поля: `instruments: Instrument[]`, `selectedInstrumentId: string|null`, `quotes: Record<uid, {price, delta, changePct, time}>`, `candles: Record<uid, Candle[]>`, `orderBook: OrderBook|null`.
Экшены: `setInstruments`, `selectInstrument(uid)`, `updateQuotes(Quote[])`, `updateQuote(uid, price, changePct?)`, `setCandles(uid, candles)`, `setOrderBook`.

### `@/store/trading` — `useTradingStore`
Поля: `positions: Position[]`, `orders: Order[]`, `trades: Trade[]`, `events: JournalEvent[]` (новые сверху, лимит 200), `portfolio: PortfolioSummary|null`, `equity: Record<period, EquityPoint[]>`, `seeded: boolean`.
Экшены: `setPositions`, `setOrders`, `setTrades`, `setPortfolio`, `setEquity(period, points)`, `addTrade(trade)` (сделка + событие в ленту), `addEvent({type, text, amount?, ...})`, `upsertOrder(order)`, `removeOrder(orderId)`, `markSeeded()`, `reset()`.

### `@/store/robots` — `useRobotsStore`
Поля: `robots: Robot[]`.
Экшены: `addRobot(input): Robot`, `updateRobot(id, patch)`, `removeRobot(id)`, `setStatus(id, status, errorMessage?)`, `updateStats(id, partialStats)`. Селектор `selectActiveRobots(s)`.

### `@/store/risk` — `useRiskStore`
Поля: `limits {dailyStopRub, maxPositionLots, maxMarginPct, maxActiveRobots}`, `automations {stopRobotsOnDailyStop, closePositionsOnDailyStop, blockOrdersOnMargin, confirmLiveOrders}`, `events: RiskEvent[]`, `currentDayPnl`, `currentMarginPct`.
Экшены: `setLimits(patch)`, `setAutomations(patch)`, `addEvent({kind, text})`, `setCurrents(dayPnl, marginPct)`, `isDailyStopHit(): boolean`.

## Shared-компоненты (`@/components/`)

- `AppShell.tsx` — Layout с `<Outlet/>` (уже подключён в App.tsx, страницы рендерятся внутрь; НЕ добавляйте свой shell и НЕ добавляйте отступы под topbar/tabbar — они уже в Layout).
- `StatCard` — `{label, value: ReactNode, delta?, deltaPositive?, sparkline?: number[], footer?, icon?, onClick?, className?}`.
- `PriceTicker` — `{value: number, format?: (v:number)=>string, delta?: number, className?, signed?}` — флэш-подложка + spring-переход числа.
- `Badge` — `{variant?: 'long'|'short'|'info'|'accent'|'neutral', children, className?}`.
- `EmptyState` — `{icon?: ReactNode, image?: string, imageAlt?, title, subtitle?, actionLabel?, onAction?, className?}`.
- `RobotStatusDot` — `{status: RobotStatus, size?=8, className?}`.
- `ConfirmDangerModal` — `{open, onOpenChange, title, description?, confirmLabel?, holdMs?=1500, onConfirm}` — press-and-hold 1.5с с круговым прогрессом. ОБЯЗАТЕЛЕН для боевых ордеров и запуска роботов в live.
- `Sparkline` — `{data: number[], width?=96, height?=28, positive?, className?}`.
- `InstallPrompt`, `LockScreen` — уже смонтированы в App; хелперы LockScreen: `isLockEnabled()`, `setLockPin(pin: string|null)`.

## Прочее

- Форматтеры `@/lib/format`: `formatRub(v, digits=2)`, `formatSignedRub(v, digits=0)`, `formatNumber(v, digits=0)`, `formatPct(v, digits=2)`, `formatTime(ms)`, `formatDateShort(ms)`, `formatRelative(ms)`.
- Хук `@/hooks/useDashboardData` — пример полного цикла seed + polling (можно переиспользовать паттерн на своих страницах).
- Роуты: `/` Дашборд (готов), `/terminal`, `/robots`, `/positions`, `/journal`, `/risk` — стабы `src/pages/Stub.tsx`; `/connect` — стаб. Гейт: без токена и demoMode → редирект на `/connect` (уже в App.tsx).
- Переходы страниц: оборачивайте корень страницы в `motion.div` с `initial={{opacity:0, y:8}} animate={{opacity:1,y:0}} transition={{duration:0.22, ease:'easeOut'}}`.
- Ассеты в `public/`: `logo.svg`, `empty-robots.svg`, `empty-journal.svg`, `connect-hero.svg`, `install-ios.svg`, `offline.svg`, `auth-lock.svg`, `icon-192.png`, `icon-512.png` — ссылки `/logo.svg` и т.д.
