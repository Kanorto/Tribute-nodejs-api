# Tribute-nodejs-api

Модуль для Node.js, который упрощает интеграцию ежемесячных подписок Tribute (Telegram) в любые сервисы и биллинги. Менеджер оформляет подписку по заранее подготовленным ссылкам, проверяет подпись вебхуков Tribute и синхронизирует статусы с вашим хранилищем.

## Возможности

- хранение планов подписки с готовыми ссылками Tribute;
- создание интента после подтверждения Telegram ID пользователя;
- верификация HMAC-подписи `trbt-signature` и разбор вебхуков Tribute для подписок и донатов;
- автоматическое продление подписок (раз в месяц приходит вебхук, система обновляет статус и записывает платеж);
- обработка донатов: первичный платеж, повторные списания и отмены фиксируются в хранилище;
- отмена подписки пользователем: статус обновляется локально, чтобы не начислять средства после отмены;
- событийная модель (`EventEmitter`) — можно подписываться на `subscription.created`, `subscription.renewed`, `subscription.cancelled`, `donation.*`;
- опциональный внешний `eventPublisher` (например, очередь сообщений или веб-сокет), который вызывается после обработки каждого события и гарантирует переотправку при ошибке;
- адаптер для внешних хранилищ (реализация `SubscriptionStore`) + встроенное in-memory хранилище для разработки и тестов;
- единый журнал платежей (`recordPayment`) с типами операций (`subscription`, `donation`);
- вспомогательные методы: получение подписки по Telegram ID и плану, чтение истории платежей, ручное завершение подписки без ожидания вебхука;
- функция `createTributeConfig` загружает планы и настройки из переменных окружения или JSON-файла, позволяя централизованно управлять модулем;
- TypeScript типы (`index.d.ts`).

## Установка

```bash
npm install tribute-nodejs-api
```

## Быстрый старт

```js
import express from 'express';
import { TributeSubscriptionManager, InMemorySubscriptionStore, createTributeConfig } from 'tribute-nodejs-api';

const plans = [
  {
    id: 'monthly-10',
    title: 'Подписка 10 €',
    amount: 1000,
    currency: 'eur',
    period: 'monthly',
    subscriptionLink: 'https://t.me/tribute/app?startapp=plan10',
    tributeSubscriptionId: 1644, // идентификатор подписки из Tribute
    tributePeriodId: 1547,       // идентификатор периода (ежемесячно)
  },
];

const store = new InMemorySubscriptionStore();
// billingQueue.publish — ваш адаптер очереди/уведомлений
const manager = new TributeSubscriptionManager({
  ...createTributeConfig({
    plans,
    apiKey: process.env.TRIBUTE_API_KEY,
    store,
  }),
  eventPublisher: async (event) => {
    await billingQueue.publish(event); // пересылаем события в биллинг/очередь
  },
});

// 1. Пользователь подтверждает Telegram ID (login-widget / bot). Создаём интент.
app.post('/api/tribute/intents', async (req, res) => {
  const { planId, telegramUserId } = req.body;
  const intent = await manager.createSubscriptionIntent({ planId, telegramUserId });
  res.json({
    intentId: intent.intentId,
    intentExpiresAt: intent.intentExpiresAt,
    subscriptionLink: intent.subscriptionLink,
  });
});

// 2. Вебхук Tribute (нужно передавать сырое тело!)
app.post('/webhooks/tribute', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    await manager.handleWebhook(req.body, req.headers['trbt-signature']);
    res.sendStatus(200);
  } catch (error) {
    if (error.name === 'TributeSignatureError') {
      return res.sendStatus(401);
    }
    console.error(error);
    res.sendStatus(400);
  }
});

// 3. Подписываемся на события менеджера и интегрируемся с биллингом
manager.on('subscription.created', ({ subscription }) => {
  // обновляем баланс, активируем услугу, записываем дату первой оплаты
});

manager.on('subscription.renewed', ({ subscription }) => {
  // начисляем очередной платёж, уведомляем пользователя
});

manager.on('subscription.cancelled', ({ subscription, context }) => {
  // останавливаем будущие начисления, логируем причину context.cancellation.cancelReason
});

manager.on('donation.recurrent', ({ donation }) => {
  // зачесть регулярный донат и обновить баланс пользователя donation.telegramUserId
});

manager.on('event', (event) => {
  // универсальный обработчик для логирования всех типов событий Tribute
});
```

### Экспорт планов и интеграция с фронтендом

Чтобы отдать публичные данные о планах в клиентское приложение, опубликуйте endpoint, который использует `manager.listPlans()`.
В ответе удобно сразу указывать `intentExpiresAt`, возвращаемый из `createSubscriptionIntent`, чтобы фронтенд мог показывать таймер оформления.

```js
app.get('/api/tribute/plans', (req, res) => {
  res.json({ plans: manager.listPlans() });
});

app.post('/api/tribute/intents', async (req, res) => {
  const { planId, telegramUserId } = req.body;
  const intent = await manager.createSubscriptionIntent({ planId, telegramUserId, metadata: { source: 'web' } });
  res.json({
    intentId: intent.intentId,
    intentExpiresAt: intent.intentExpiresAt,
    subscriptionLink: intent.subscriptionLink,
    plan: intent.plan,
  });
});
```

На фронтенде достаточно вызвать `/api/tribute/plans`, отобразить предложения и после выбора плана запросить `/api/tribute/intents`. Полученный `subscriptionLink` можно открыть в WebApp/боте, а `intentExpiresAt` использовать для обратного отсчёта до истечения действия ссылки.

## Управление состоянием и история платежей

Менеджер предоставляет готовые методы, чтобы без прямого доступа к хранилищу получать данные и управлять подписками:

| Метод | Что делает | Особенности |
| --- | --- | --- |
| `listPlans()` | Возвращает публичное описание планов (для UI). | Берёт данные из конфигурации, безопасно для фронтенда. |
| `createSubscriptionIntent({ planId, telegramUserId, metadata })` | Создаёт интент и выдаёт ссылку Tribute. | Возвращает `intentExpiresAt` для фронтенда; интент живёт `intentTtlMs`, сохраняется в хранилище. |
| `handleWebhook(rawBody, signature)` | Обрабатывает вебхуки Tribute и возвращает событие или `undefined` при дубликате. | Требует сырое тело запроса. Идемпотентен, валидирует HMAC и план. |
| `getIntentById(intentId)` | Возвращает сохранённый интент. | Удобно для поддержки и аудита. |
| `getSubscriptionByTributeId(tributeSubscriptionId)` | Ищет подписку по Tribute ID. | Работает, если хранилище поддерживает индексы по Tribute ID. |
| `getSubscriptionForUser({ telegramUserId, planId })` | Находит подписку пользователя для плана. | Использует специализированный метод хранилища или fallback на in-memory реализацию. |
| `listPayments(filters?)` | Возвращает историю платежей с фильтрами `telegramUserId`, `kind`, `since`, `until`, `limit`. | Платежи сортируются по `paidAt` (DESC). |
| `cancelSubscriptionLocally({ tributeSubscriptionId, cancelReason?, cancelledAt?, payload? })` | Помечает подписку отменённой без ожидания вебхука. | Эмитит `subscription.cancelled` с `context.cancellation.source === 'manual'`. |

> ⚠️ `cancelSubscriptionLocally` не сообщает Tribute об отмене — используйте его, когда нужно синхронизировать локальное состояние с уже выполненной операцией (или временно заблокировать начисления до прихода вебхука).

## Интеграция с биллингом и уведомлениями

### События `EventEmitter`

`TributeSubscriptionManager` наследуется от `EventEmitter` и эмитит события после каждой успешной обработки вебхука или административного действия:

| Событие | Когда возникает | Полезная нагрузка |
| --- | --- | --- |
| `subscription.created` | Первая оплата подписки. | `{ subscription, context }` с `context.intent` и `context.intentStatus`. |
| `subscription.renewed` | Ежемесячное продление. | `{ subscription, context.previousSubscription }`. |
| `subscription.cancelled` | Отмена через Tribute или вручную (`cancelSubscriptionLocally`). | `{ subscription, context.cancellation }`. |
| `donation.created` | Первое оформление доната. | `{ donation }`. |
| `donation.recurrent` | Повторный донат. | `{ donation }`. |
| `donation.cancelled` | Отмена регулярного доната. | `{ donation, context.cancellation }`. |
| `subscription.any` / `donation.any` | Любое событие соответствующей категории. | Удобно для агрегации метрик. |
| `event` | Универсальное событие для любых категорий. | `{ category, type, ... }`. |

Используйте эти события, чтобы синхронизировать подписки с биллингом, начислять баланс, публиковать доменные события и строить уведомления пользователям.

### Внешний `eventPublisher`

Для интеграции с очередями сообщений или сторонними сервисами можно передать функцию `eventPublisher` в конструктор менеджера или в `createTributeConfig`. Она вызывается после обновления хранилища и после `emit`, поэтому биллинг получает подтверждённое состояние. Если функция возвращает промис и отклоняется, менеджер:

- по умолчанию пробрасывает ошибку в `handleWebhook`, заставляя Tribute повторить доставку (надёжно для критичных очередей);
- при `eventPublisherFailureMode: 'log'` записывает ошибку в лог и продолжает выполнение (подходит для необязательных каналов уведомлений).

Пример публикации в очередь:

```js
const manager = new TributeSubscriptionManager({
  ...createTributeConfig({ plans, store, apiKey }),
  eventPublisher: async (event) => {
    await rabbitmqChannel.sendToQueue('tribute-events', Buffer.from(JSON.stringify(event)));
  },
});
```

> Рекомендуется оставлять режим `throw`, чтобы Tribute автоматически повторял вебхук до успешной доставки события в биллинг. Используйте `log`, только если канал уведомлений вторичный и не критичен.

### Готовность к интеграции

- все события проходят через единый журнал платежей (`recordPayment`), поэтому биллингу достаточно слушать `subscription.*` и `donation.*` или читать `listPayments()`;
- состояния подписок и донатов сохраняются до публикации события — вы всегда получаете консистентные данные;
- в тестах проверяется идемпотентность и защита от дублей, поэтому сторонние системы не получают повторных уведомлений.

### Статус интента в вебхуках подписки

В `context.intentStatus` события `subscription.created` указывается, был ли интент валидным (`matched`) или успел истечь (`expired`). Это помогает логировать случаи, когда пользователь оформил подписку спустя длительное время после выдачи ссылки.

## Конфигурация через `createTributeConfig`

`createTributeConfig()` помогает собрать корректные опции для `TributeSubscriptionManager`. Вы можете передать планы напрямую, либо описать их через переменные окружения/JSON-файл, чтобы одно и то же описание использовалось в нескольких сервисах.

```js
import { createTributeConfig, InMemorySubscriptionStore, TributeSubscriptionManager } from 'tribute-nodejs-api';

const store = new InMemorySubscriptionStore();
const manager = new TributeSubscriptionManager(
  createTributeConfig({
    store,
    plans: [{
      id: 'monthly-10',
      title: '10 €',
      amount: 1000,
      currency: 'eur',
      period: 'monthly',
      subscriptionLink: 'https://t.me/tribute/app?startapp=plan10',
    }],
    // можно не передавать apiKey — он возьмётся из TRIBUTE_API_KEY
    allowDonations: true,
  })
);
```

### Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `TRIBUTE_API_KEY` | секретный ключ Tribute для проверки подписи вебхуков; обязательна, если не передаёте `apiKey` в `createTributeConfig`. |
| `TRIBUTE_PLANS` | JSON-массив с планами подписок. Каждый объект должен содержать `id`, `title`, `amount`, `currency`, `period`, `subscriptionLink` и при необходимости `tributeSubscriptionId`/`tributePeriodId`. |
| `TRIBUTE_PLANS_FILE` | путь до JSON-файла с планами (альтернатива `TRIBUTE_PLANS`). |
| `TRIBUTE_INTENT_TTL_MINUTES` или `TRIBUTE_INTENT_TTL_MS` | Время жизни интента (по умолчанию 15 минут). |
| `TRIBUTE_SIGNATURE_ENCODING` | Формат подписи Tribute (`hex` или `base64`). |
| `TRIBUTE_ALLOW_DONATIONS` | `false`, если хотите отключить обработку донатов (по умолчанию `true`). |
| `TRIBUTE_EVENT_PUBLISHER_FAILURE_MODE` | `throw` (по умолчанию) или `log`, режим реакции на ошибки `eventPublisher`. |

Альтернативно вы можете передать соответствующие поля (`plans`, `plansFile`, `plansJson`, `intentTtlMs`, `signatureEncoding`, `allowedWebhookEvents`) непосредственно в `createTributeConfig`. Это полезно, если планы храните в собственной БД или хотите запретить часть вебхуков. Список событий, которые поддерживает модуль, ограничен подписками и донатами; чтобы полностью отключить какую-либо категорию, используйте опцию `allowedWebhookEvents` у менеджера или `createTributeConfig`.

Функцию `eventPublisher` и режим `eventPublisherFailureMode` можно передать напрямую в `createTributeConfig` (как overrides) или в конструктор менеджера. Через переменные окружения задаётся только режим (`TRIBUTE_EVENT_PUBLISHER_FAILURE_MODE`), поскольку функции публикации зависят от среды выполнения.

## Хранилище Tribute

Для продакшена реализуйте собственный класс, расширяющий `SubscriptionStore`. Он отвечает за ключевые сущности Tribute.

### Методы `SubscriptionStore`

| Метод | Назначение | Советы по реализации |
| --- | --- | --- |
| `saveIntent(intent)` | Сохраняет интент до оформления подписки. | Таблица интентов с TTL, индекс по `(intent_id)`.
| `consumeIntent(intentId)` / `consumeIntentByTelegramAndPlan()` | Помечает интент использованным (и удаляет). | Используйте транзакцию/`DELETE ... RETURNING`, чтобы избежать гонок.
| `upsertSubscription(subscription)` | Создаёт или обновляет подписку. | Индексы по `tribute_subscription_id` и `(telegram_user_id, plan_id)`.
| `getSubscriptionByTributeId(id)` | Возвращает подписку по Tribute ID. | Используется для продлений и отмен.
| `getSubscriptionByTelegramAndPlan()` | Находит подписку пользователя и плана. | Удобно для UI/админки.
| `markSubscriptionCancelled(id, cancellation)` | Фиксирует отмену и сохраняет `cancelledAt`. | Обновляет `status`, `cancelReason`, `lastEventAt`.
| `recordPayment(payment)` | Добавляет запись в журнал платежей. | Таблица `payments` с индексом по `telegram_user_id`, `paid_at DESC`.
| `listPayments(filters)` | Возвращает платежи с фильтрами. | Реализуйте пагинацию (`limit`) и сортировку по `paid_at`.
| `upsertDonation(donation)` | Создаёт/обновляет донат. | Индекс по `donation_request_id`.
| `getDonationByRequestId(id)` | Получает донат по запросу Tribute. | Используется для ретраев и отмен.
| `markDonationCancelled(id, cancellation)` | Ставит статус `cancelled`. | Обновляет `lastEventAt`, `cancelledAt`.

Встроенное `InMemorySubscriptionStore` удобно только для разработки — данные теряются после рестарта, но содержит все методы и может служить эталоном структуры.

### Пример схемы БД (PostgreSQL)

```sql
CREATE TABLE tribute_intents (
  intent_id uuid PRIMARY KEY,
  plan_id text NOT NULL,
  telegram_user_id bigint NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE tribute_subscriptions (
  tribute_subscription_id bigint PRIMARY KEY,
  tribute_period_id bigint NOT NULL,
  plan_id text NOT NULL,
  telegram_user_id bigint NOT NULL,
  user_id bigint,
  amount integer NOT NULL,
  currency text NOT NULL,
  period text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  expires_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX tribute_subscriptions_user_plan_idx
  ON tribute_subscriptions (telegram_user_id, plan_id);

CREATE TABLE tribute_donations (
  donation_request_id bigint PRIMARY KEY,
  donation_name text NOT NULL,
  telegram_user_id bigint NOT NULL,
  user_id bigint,
  period text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  anonymously boolean NOT NULL,
  message text,
  web_app_link text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE tribute_payments (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  tribute_subscription_id bigint,
  plan_id text,
  donation_request_id bigint,
  telegram_user_id bigint NOT NULL,
  user_id bigint,
  amount integer NOT NULL,
  currency text NOT NULL,
  paid_at timestamptz NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX tribute_payments_user_paid_at_idx
  ON tribute_payments (telegram_user_id, paid_at DESC);
```

## Работа с вебхуками

Документация Tribute требует проверки подписи `trbt-signature` (`HMAC-SHA256` от сырого тела). Менеджер использует ключ `apiKey`, который вы создаёте в Tribute. Если Tribute переключится на `base64`, укажите `signatureEncoding: 'base64'` в конструкторе.

Поддерживаются события:

- `new_subscription` — создаёт новую подписку или фиксирует ежемесячное продление;
- `cancelled_subscription` — отмечает подписку как отменённую;
- `new_donation` / `recurrent_donation` / `cancelled_donation` — жизненный цикл донатов.

Каждый вебхук преобразуется в событие с категорией (`subscription` или `donation`). Для универсального логирования используйте `manager.on('event', handler)`.

### Повторы и порядок событий

Tribute может повторно отправить вебхук при сетевых ошибках. Менеджер ведёт контроль времени последнего события для каждой сущности и:

- игнорирует дубликаты и устаревшие события (возвращается `undefined`, события не эмитятся);
- не записывает повторные платежи в `recordPayment`.

Таким образом обработка становится идемпотентной — при ретраях ваши слушатели не получат повторных уведомлений и не сделают двойное списание.

## Тесты

```bash
npm test
```
