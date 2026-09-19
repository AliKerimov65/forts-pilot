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

- `market.ts`: `InstrumentType='stock'|'future'|'etf'|'currency'|'bond'|'option'|'index'`; `Instrument {uid, figi, ticker, classCode, name, basicAsset, lot, currency, minPriceIncrement, type, apiTradeAvailable, tradable, buyAvailable?, sellAvailable?, shortEnabled?, forQualInvestor?, tradingStatus?, weekendFlag?, isin?, expirationDate?, marginBuy?, marginSell?}` (все классы инструментов Т-Инвестиций; **индексы: `tradable=false` — только котировки, ордера запрещены, UI обязан блокировать Buy/Sell**), `Candle {time(ms), open, high, low, close, volume, isComplete}`, `OrderBookLevel {price, quantity}`, `OrderBook {instrumentId, bids, asks, lastPrice, limitUp?, limitDown?, time}`, `Quote {instrumentId, price, delta, changePct?, time}`, `CandleInterval` (`CANDLE_INTERVAL_1_MIN|5_MIN|15_MIN|HOUR|DAY|WEEK`).
- `trading.ts`: `Direction='long'|'short'`, `Position {instrumentId, figi?, ticker, name?, direction, lots, avgPrice, currentPrice, pnl, margin?}`, `OrderStatus='new'|'partially_filled'|'filled'|'cancelled'|'rejected'`, `Order {orderId, accountId, instrumentId, ticker, direction, lotsRequested, lotsExecuted, price?, orderType:'limit'|'market', status, time, message?}`, `Trade {id, orderId?, instrumentId, ticker, direction, lots, price, commission?, pnl?, source:'manual'|'robot', robotId?, robotName?, time}`, `JournalEventType='trade'|'order'|'sl'|'tp'|'robot'|'risk'|'system'`, `JournalEvent {id, type, text, amount?, robotId?, instrumentId?, time}`, `PortfolioSummary {totalAmount, cash, freeMargin, blockedMargin, dayPnl, dayPnlPct, expectedYieldPct?}`, `EquityPoint {time, equity, benchmark?}`.
- `robot.ts`: `RobotStrategy='grid'|'signal'|'regime'|'rescue'`, `RobotStatus='off'|'running'|'paused'|'error'`, `GridParams {upperBound, lowerBound, levels, lotsPerLevel}`, `SignalParams {signalType, timeframe, lots, stopLossPts?, takeProfitPts?}`, `RegimeParams {lots, maxPositionLots}`, `RescueParams {targetDirection, targetLots, targetAvgPrice, maxTotalLots}`, `RobotParams` (union по strategy; варианты `regime`/`rescue` дополнительно несут обязательное поле-оболочку `signal: SignalParams` — см. разделы про regime/rescue ниже), `RobotStats {dayPnl, totalPnl, trades, winRate(0..1), allocatedCapital, lastStartedAt?}`, `Robot {id, name, strategy, instrumentId, ticker, status, errorMessage?, params, stats, createdAt}`.
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
- Списки по классам (INSTRUMENT_STATUS_BASE): `getFutures()`, `getShares()`, `getEtfs()`, `getCurrencies()`, `getBonds()` — все `Promise<Instrument[]>`
- `getOptionsBy(basicAssetUid: string): Promise<Instrument[]>` — опционы ТОЛЬКО по базовому активу (фильтр обязателен, «все опционы» получить нельзя)
- `getIndices(): Promise<Instrument[]>` — индексы/индикативы (Indicatives); `tradable=false`, только котировки
- `findInstrument(query: string): Promise<Instrument[]>` — поиск только по фьючерсам (legacy)
- `findInstrumentAll(query: string): Promise<Instrument[]>` — поиск по ВСЕМ классам (FindInstrument без instrumentKind)
- `mapInstrumentKind(kind?: string): InstrumentType` — маппинг enum API (`INSTRUMENT_TYPE_*`) → класс
- `getFuturesMargin(instrumentId): Promise<{buy: number, sell: number}>` — ГО фьючерса
- `getMarginAttributes(): Promise<MarginAttributes>` — маржа ПО СЧЁТУ (UsersService!): `{liquidPortfolio, startingMargin, minimalMargin, fundsSufficiencyLevel, amountOfMissingFunds, correctedMargin}` (все ₽, кроме fundsSufficiencyLevel)
- `getCandles(instrumentId, from: Date, to: Date, interval: CandleInterval, limit?): Promise<Candle[]>`
- `getOrderBook(instrumentId, depth=20): Promise<OrderBook>` — ⚠️ для индексов стакана нет, не вызывать
- `getLastPrices(instrumentIds: string[]): Promise<Quote[]>` — работает и для индексов
- `getTradingStatus(instrumentId): Promise<TradingStatusInfo>` — `{instrumentId, tradingStatus, limitOrderAvailable, marketOrderAvailable, bestpriceOrderAvailable, onlyBestPrice, tradingNow}`; «торгуется сейчас» = `tradingNow` + флаги доступных типов заявок
- `getTradingSchedules(from: Date, to: Date, exchange?): Promise<TradingSchedule[]>` — расписание площадок (`{exchange, days: TradingScheduleDay[]}`)
- `postOrder(params: PostOrderParams): Promise<PostOrderResult>` — `PostOrderParams {instrumentId, direction, lots, orderType:'limit'|'market'|'bestprice', price?, orderId?, instrument?, priceType?:'point'|'currency', confirmMarginTrade?}`; `PostOrderResult {orderId, status, lotsRequested, lotsExecuted, executedPrice?, commission?, message?}`. **`lots` — в ЛОТАХ для всех классов**. Передайте `instrument` — валидация (неторгуемый индекс/недоступная покупка → понятная ошибка ДО вызова API) и авто-выбор priceType (фьючерсы/облигации — POINT, акции/ETF/валюты — CURRENCY). В sandbox-режиме уходит в `SandboxService/PostSandboxOrder`.
- `cancelOrder(orderId): Promise<void>`
- `getOrders(): Promise<Order[]>`
- `getPortfolio(): Promise<PortfolioSummary & {positions: Position[]}>`
- `getPositions(): Promise<Position[]>`
- `openSandboxAccount(name?): Promise<string>` (accountId), `sandboxPayIn(accountId, amountRub): Promise<void>`, `postSandboxOrder(accountId, params): Promise<PostOrderResult>` — явные sandbox-вызовы.

### instruments.ts (хелперы по классам)
- `instrumentTypeLabel(type): string` — рус.: Акция/Фьючерс/Индекс/ETF/Валюта/Облигация/Опцион
- `isTradable(i): boolean` — `tradable && apiTradeAvailable` (индексы → false)
- `priceStep(i): number` — шаг цены (дефолт 1)
- `qtyToUnits(i, lots): number` / `unitsToQty(i, units): number` — лоты ↔ штуки
- `priceDigits(i): number`, `roundPriceToStep(i, price): number`, `formatInstrumentPrice(i, price): string` — цена по minPriceIncrement
- `isTradingNow(i): boolean` — tradingStatus ∈ {NORMAL_TRADING, DEALER_NORMAL_TRADING}

### Правила для UI по классам
1. **Индексы (`type==='index'`) — только котировки**: свечи/last price есть, стакана и ленты нет, ордера ЗАПРЕЩЕНЫ (UI обязан скрывать/блокировать Buy/Sell; `postOrder` с `instrument` тоже бросит ошибку).
2. Доступность: проверяйте `isTradable(i)`, `buyAvailable/sellAvailable`, `shortEnabled` (false → блокировать SELL без покрытия), `forQualInvestor`, `tradingStatus`/`getTradingStatus()` (флаги limit/market/bestprice, `onlyBestPrice`).
3. Облигации: цена — в % от номинала. Валюты вне сессии — режим дилера, только BESTPRICE (`onlyBestPrice`).
4. Количество в заявках — всегда лоты; штуки = `qtyToUnits(i, lots)`.

### polling.ts
- `usePolling(fetcher: () => Promise<void>|void, {intervalMs, enabled?, immediate?}, onError?)` — пауза на скрытой вкладке, защита от наложения запросов.
- `POLLING_DEFAULTS = {prices: 3000, positions: 5000}`.

### mock.ts (детерминированные mock-данные; демо-режим и fallback)
- Каталоги: `MOCK_INSTRUMENTS` (фьючерсы: Si, BR, IMOEXF, RTSI, GAZP; uid вида `mock-uid-si` — НЕ менять), `MOCK_SHARES` (SBER, GAZP, LKOH, YDEX, ROSN, MGNT), `MOCK_ETFS` (TMOS, SBMX), `MOCK_CURRENCIES` (USD000UTSTOM, CNYRUB_TOM), `MOCK_INDICES` (IMOEX, RTSI, RGBI — `tradable=false`), `MOCK_BONDS` (SU26238RMFS4, SU26243RMFS4), `MOCK_OPTIONS` (SI91250CE, SI91250PE), `MOCK_ALL_INSTRUMENTS` (всё вместе). uid не-фьючерсов: `mock-uid-{type}-{ticker}`.
- По классам: `mockGetFutures()`, `mockGetShares()`, `mockGetEtfs()`, `mockGetCurrencies()`, `mockGetBonds()`, `mockGetOptionsBy(basicAssetUid?)`, `mockGetIndices()`, `mockGetAllInstruments()`
- Поиск: `mockFindInstrument(q)` (фьючерсы), `mockFindInstrumentAll(q)` (все классы, в т.ч. по ISIN)
- Маркетдата (работают для ЛЮБОГО uid из каталога, seed от тикера): `mockGetCandles(uid, interval?, count=120)`, `mockGetOrderBook(uid, depth=10)`, `mockGetLastPrices(uids)` (сдвигает рандомволк — для поллинга)
- Статусы/маржа/расписание: `mockGetTradingStatus(uid)`, `mockGetMarginAttributes()`, `mockGetTradingSchedules()`
- Прочее: `mockGetPositions()`, `mockGetPortfolio()`, `mockGetEquitySeries('1D'|'1W'|'1M'|'3M'|'ALL')`, `mockGetTrades()`, `mockGetJournalEvents()`, `mockGetRobots()`, `seededRandom(seed)`.
- Паттерн: `const useMock = !useConnectionStore(s => s.token)` → mock-функции вместо services.

## Стратегия 'regime' — «Регламент MOEX · Hedge» (`@/lib/robots/`)

Внутридневная стратегия по регламенту Мосбиржи: премаркет-анализ → вход на открытии →
виртуальный хедж → контроль клирингов → TP/переоткрытие → принудительный флэт перед
закрытием дня → margin guard. Полный конфиг живёт в ext-сторе (`getExtConfig(robot).regime`),
рантайм — в памяти движка (не персистится).

### Создание regime-робота (UI)
```ts
addRobot({
  name, strategy: 'regime', instrumentId, ticker,
  params: {
    strategy: 'regime',
    regime: { lots: 2, maxPositionLots: 6 },
    // обязательная оболочка совместимости с текущим визардом (движок regime её не читает):
    signal: { signalType: 'regime', timeframe: '5m', lots: 2 },
  },
});
useRobotsExtStore.getState().setConfig(robot.id, {
  mode: 'sandbox', protection: defaultProtection(), regime: { ...DEFAULT_REGIME_CONFIG, ...overrides },
});
```
Поля `RegimeConfig` (дефолты): `entryOffsetMin`(10) — за сколько мин до открытия премаркет-анализ;
`flatBeforeCloseMinMin`(25)/`flatBeforeCloseMaxMin`(38) — окно принудительного флэта до конца
основной сессии (момент выбирается раз в день, детерминированно по дате); `hedgeEnabled`(true),
`baseHedgeRatio`(0.5); `clearingWatchMin`(5); `jumpZThreshold`(2.5); `takeProfitPts`(120, в шагах
цены); `tpClosePct`(0.5); `reentryRetracePct`(0.3); `trailingEnabled`(true); `minConfidence`(0.55);
`marginWarn/Reduce/Emergency`(0.55/0.70/0.82); `maxPositionLots`, `lots`.
Русские подписи/описания полей — `REGIME_CONFIG_LABELS`, подписи фаз — `REGIME_PHASE_LABELS`
(оба из `@/lib/robots/config`).

### Регламент (`schedule.ts`)
`getSessionPlan(exchange, date, api?)` — дефолт FORTS: основная 09:00–18:45 МСК (промклиринг
14:00–14:05), вечерняя 19:05–23:50, сб/вс выходные; с боевым токеном уточняется через
`getTradingSchedules` (кэш сутки). `getSessionPhase(now, plan)` → `{phase: 'pre_open'|'main'|
'clearing_day'|'clearing_evening'|'evening'|'closed', nextEventAt, msToNext, sessionOpen, dayClose}`.

### Хедж-неттинг
Позиция — виртуальные ноги `{longLots, shortLots, avgLong, avgShort}`; Т-Инвест неттинговый,
поэтому в API уходит только изменение НЕТТО (buy/sell на дельту). Если ноги сбалансированы —
реальный ордер не нужен и не выставляется.

### Margin guard (`marginGuard.ts`)
`assessMargin(attrs, cfg)` → `{utilization 0..1, level: 'ok'|'warn'|'reduce'|'emergency', freeMargin}`;
`reduce` — запрет входов + сокращение нетто; `emergency` — полный флэт, робот → `paused`,
события в risk-стор (`kind:'margin'`) и ленту (`type:'risk'`). Демо — `demoMarginAttributes(utilization)`.

### Статус для UI (`engine.ts`)
`getRegimeStatus(robotId): RegimeStatusSnapshot | undefined` — `{state, legs, netLots, sessionPhase,
nextEventAt, msToNext, flatAt, sessionOpen, dayClose, direction, confidence, marginLevel,
marginUtilization, unrealizedPts, lastJump, lastEventText}`. Использовать для бейджа фазы
(`REGIME_PHASE_LABELS[state]`), обратного отсчёта до события регламента (`msToNext`) и блока ног.
`getRobotExposure(robot)` для regime возвращает строку вида `нетто +1 лот (L2/S1)`.
События стратегии (анализ, вход, TP, переоткрытие, клиринг-скачки, флэт) пишутся в ленту
журнала (`type:'robot'`).

## Стратегия 'rescue' — «Спасатель позиции» (`@/lib/robots/rescue.ts`)

Пользователь выбирает убыточную позицию из портфеля (в демо — из `mockGetPositions()`),
робот спасает её: анализатор каждый тик → вердикт + план (лестница усреднения) → исполнение
рыночными ордерами. Полный конфиг — в ext-сторе (`getExtConfig(robot).rescue`), рантайм —
в памяти движка.

### Создание rescue-робота (UI)
```ts
addRobot({
  name, strategy: 'rescue', instrumentId: position.instrumentId, ticker: position.ticker,
  params: {
    strategy: 'rescue',
    rescue: {
      targetDirection: position.direction,   // 'long'|'short'
      targetLots: position.lots,
      targetAvgPrice: position.avgPrice,
      maxTotalLots: 6,
    },
    // обязательная оболочка совместимости с визардом (движок rescue её не читает):
    signal: { signalType: 'rescue', timeframe: '5m', lots: position.lots },
  },
});
useRobotsExtStore.getState().setConfig(robot.id, {
  mode: 'sandbox', protection: defaultProtection(),
  rescue: { ...DEFAULT_RESCUE_CONFIG, targetInstrumentId: position.instrumentId,
    targetDirection: position.direction, targetLots: position.lots,
    targetAvgPrice: position.avgPrice, ...overrides },
});
```
Поля `RescueConfig` (дефолты): `maxAvgSteps`(3), `stepAtrMult`(1.0), `lotMult`(1.3, жёсткий кэп
≤1.5 — анти-мартингейл), `maxTotalLots`(6), `recoverTargetPct`(0.003), `recoverCloseAll`(true),
`hedgePauseEnabled`(true), `allowStopOut`(false), `maxDrawdownPct`(0.05),
`marginReturnBufferMin`(60), `minActionBeforeDeadlineMin`(10), `marginWarn/Reduce/Emergency`
(0.55/0.70/0.82). Подписи полей — `RESCUE_CONFIG_LABELS`, вердиктов — `RESCUE_VERDICT_LABELS`,
состояний — `RESCUE_STATE_LABELS` (всё из `@/lib/robots/config`).

### Вердикты анализатора
`wait` (ждём) / `average_down` (усреднение: цена лучше последней докупки на `stepAtrMult×ATR`,
RSI-перепроданность или тренд не против) / `hedge_pause` (офсетная позиция замораживает
просадку; неттинг — счёт уходит во флэт с обратным входом при снятии) / `recover_exit`
(цена ≥ weightedAvg + recoverTargetPct; `recoverCloseAll=true` — закрыть всё и остановиться,
иначе — частичные фиксации добавок шагами, исходная позиция остаётся) / `stop_out`
(только при `allowStopOut=true` и просадке > `maxDrawdownPct` — закрывается ВСЯ позиция,
включая исходную). Каждый вердикт с `confidence` 0..1 и `reasoning[]` (строки по-русски).

### Маржинальный регламент (ключевое)
Комиссия Т-Инвестиций за непокрытую позицию = 0 при возврате плеча до конца торгового дня
(или <5000 ₽). Робот использует плечо ТОЛЬКО внутри дня:
`marginDeadline = dayClose − marginReturnBufferMin`. До дедлайна добавки/хеджи разрешены
(с marginGuard); после — новые добавки запрещены, все добавленные роботом лоты и хедж
закрываются (возврат плеча), исходная позиция пользователя НЕ закрывается принудительно.
Перед добавкой проверяется `minActionBeforeDeadlineMin` и оценивается комиссия
`estimateCarryFee(addedValue)` (₽/день, лестница в `marginGuard.ts` — укажите её пользователю
в reasoning/подсказке). Действия только в фазах `main`/`evening`.
Маржа `emergency` — немедленный флэт добавок/хеджа (исходная позиция не трогается); этот
флэт НЕ отключается никакими risk-overrides.

### Статус для UI (`engine.ts`)
`getRescueStatus(robotId): RescueStatusSnapshot | undefined` —
`{state ('monitoring'|'averaging'|'hedged'|'recovering'|'returning_margin'|'stopped'),
verdict, confidence, reasoning[], plan: RescueStep[] ({kind, lots, triggerPrice, done, reason} —
лестница с done-флагами), addsLots, hedgeLots, recoveredPct (0..1), weightedAvg, drawdownPct,
marginDeadline (ms), msToDeadline, marginLevel, marginUtilization, lastEventText}`.
`getRobotExposure(robot)` для rescue — строка вида `добавки 3 лот + хедж 5, отыграно 42%`.
События (усреднения, хедж, возврат плеча, спасение/стоп-аут) — в ленте журнала (`type:'robot'`).
После достижения цели или стоп-аута робот → `paused` с пояснением в `errorMessage` нет —
текст причины уходит в событие; при `stopRobot` статус `paused` и `errorMessage` = причина.

## Ручное отключение рисков по счёту (risk overrides)

`useRiskStore`: `accountOverrides: Record<accountId, {disabled, disabledAt?, note?}>` (persist),
`setAccountRiskOverride(accountId, disabled, note?)`, селектор `isRiskDisabledFor(accountId)`.
При `disabled=true` для текущего счёта (`useConnectionStore.accountId`) глобальный daily-stop
движка НЕ останавливает роботов. **Не отключается никогда**: маржинальный emergency-флэт
marginGuard (level `'emergency'` в regime/rescue) — защита от маржин-колла абсолютна.
UI: тумблер на странице риска по текущему счёту + отображение `note`/`disabledAt`; при
активном override показывать предупреждение, что emergency-флэт продолжает работать.

## Сторы (zustand, persist в localStorage)

### `@/store/connection` — `useConnectionStore`
Поля: `token: string|null`, `accountId: string|null`, `accounts: Account[]`, `mode: AppMode`, `status: ConnectionStatus`, `latencyMs: number|null`, `demoMode: boolean`.
Экшены: `setToken`, `setAccount`, `setAccounts`, `setMode`, `setStatus`, `setLatency`, `setDemoMode`, `testConnection(): Promise<boolean>` (GetAccounts + выбирает счёт), `disconnect()`.
Хелперы: `maskedToken(token)`, `selectIsConnected(s)` (токен ИЛИ demoMode — селектор для гейтов).

### `@/store/market` — `useMarketStore`
Поля: `instruments: Instrument[]` (все классы), `selectedInstrumentId: string|null`, `quotes: Record<uid, {price, delta, changePct, time}>`, `candles: Record<uid, Candle[]>`, `orderBook: OrderBook|null`, `instrumentFilter: InstrumentType|'all'` (дефолт `'all'`).
Экшены: `setInstruments`, `selectInstrument(uid)`, `setInstrumentFilter(filter)`, `updateQuotes(Quote[])`, `updateQuote(uid, price, changePct?)`, `setCandles(uid, candles)`, `setOrderBook`.

### `@/store/trading` — `useTradingStore`
Поля: `positions: Position[]`, `orders: Order[]`, `trades: Trade[]`, `events: JournalEvent[]` (новые сверху, лимит 200), `portfolio: PortfolioSummary|null`, `equity: Record<period, EquityPoint[]>`, `seeded: boolean`.
Экшены: `setPositions`, `setOrders`, `setTrades`, `setPortfolio`, `setEquity(period, points)`, `addTrade(trade)` (сделка + событие в ленту), `addEvent({type, text, amount?, ...})`, `upsertOrder(order)`, `removeOrder(orderId)`, `markSeeded()`, `reset()`.

### `@/store/robots` — `useRobotsStore`
Поля: `robots: Robot[]`.
Экшены: `addRobot(input): Robot`, `updateRobot(id, patch)`, `removeRobot(id)`, `setStatus(id, status, errorMessage?)`, `updateStats(id, partialStats)`. Селектор `selectActiveRobots(s)`.

### `@/store/risk` — `useRiskStore`
Поля: `limits {dailyStopRub, maxPositionLots, maxMarginPct, maxActiveRobots}`, `automations {stopRobotsOnDailyStop, closePositionsOnDailyStop, blockOrdersOnMargin, confirmLiveOrders}`, `events: RiskEvent[]`, `currentDayPnl`, `currentMarginPct`, `accountOverrides: Record<accountId, AccountRiskOverride>` (persist — см. раздел «Ручное отключение рисков по счёту»).
Экшены: `setLimits(patch)`, `setAutomations(patch)`, `addEvent({kind, text})`, `setCurrents(dayPnl, marginPct)`, `isDailyStopHit(): boolean`, `setAccountRiskOverride(accountId, disabled, note?)`, `isRiskDisabledFor(accountId): boolean`.

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
