# Tribute Webhooks — Полная документация (собрано с wiki.tribute.tg)

Источник: https://wiki.tribute.tg/ru/api-dokumentaciya/vebkhuki

> Этот файл аккуратно собран из публичной страницы документации Tribute по вебхукам. Ссылки сделаны **абсолютными**, чтобы не ломаться при копировании.

---

## Обзор

Вебхуки Tribute используются для уведомления вашего сервера о событиях в системе: подписки, донаты, покупки цифровых и физических товаров. Ваш сервер принимает `POST` запросы с телом `application/json` и **обязательно** проверяет подпись.

**Подпись:** в каждом запросе есть заголовок `trbt-signature` — это HMAC-SHA256 подпись **сырого тела запроса**, посчитанная с использованием вашего API‑ключа (секрета).  
**Повторы при сбое:** при ошибке доставки Tribute повторит запросы через _5 минут_, _15 минут_, _30 минут_, _1 час_, _10 часов_.

Подробнее на источнике: https://wiki.tribute.tg/ru/api-dokumentaciya/vebkhuki

---

## Настройка на стороне Tribute

1) Откройте **Дэшборд автора → Настройки (меню из трёх точек) → Раздел «API‑ключи»**.  
2) Сгенерируйте API‑ключ, если его ещё нет.  
3) Укажите **URL вашего вебхука** в настройках вебхуков.

Источник: https://wiki.tribute.tg/ru/api-dokumentaciya/vebkhuki

---

## Проверка подписи (пример кода)

Ниже примеры **иллюстративны** — важна логика: взять _сырой_ байтовый буфер тела запроса, посчитать HMAC‑SHA256 с ключом (ваш API‑ключ) и сравнить с `trbt-signature`.

### Node.js (Express)

```js
import crypto from 'crypto';
import express from 'express';

const app = express();

// ВАЖНО: получаем сырое тело для корректной подписи
app.use(express.raw({ type: 'application/json' }));

function verifySignature(rawBody, signatureHeader, apiKey) {
  const hmac = crypto.createHmac('sha256', apiKey);
  hmac.update(rawBody);
  const digest = hmac.digest('hex'); // предположительно hex; если сервер присылает base64 — поменяйте на 'base64'
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
}

app.post('/webhooks/tribute', (req, res) => {
  const signature = req.get('trbt-signature');
  const apiKey = process.env.TRIBUTE_API_KEY;
  const raw = req.body; // Buffer от express.raw

  if (!signature || !verifySignature(raw, signature, apiKey)):
    return res.status(401).json({ ok: false, error: 'invalid signature' });

  const event = JSON.parse(raw.toString('utf8'));
  // Обработка по event.name ...
  return res.status(200).json({ ok: true });
});

app.listen(3000);
```

### Bun (Bun.serve)

```js
import { Buffer } from 'node:buffer';
import { verifyTributeSignature } from 'tribute-nodejs-api';

const apiKey = Bun.env.TRIBUTE_API_KEY;

const server = Bun.serve({
  port: 3000,
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/webhooks/tribute') {
      return new Response('not found', { status: 404 });
    }

    const rawBody = await request.arrayBuffer();
    const signature = request.headers.get('trbt-signature');

    if (!verifyTributeSignature(rawBody, signature, apiKey)) {
      return new Response('invalid signature', { status: 401 });
    }

    const event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    console.log('Tribute event:', event.name);
    return new Response('ok');
  },
});

console.log(`Webhook server running on http://localhost:${server.port}`);
```

### Python (Flask)

```py
import hmac, hashlib
from flask import Flask, request, jsonify

app = Flask(__name__)
API_KEY = b'your_api_key_here'

def verify_signature(raw_body: bytes, signature: str) -> bool:
    digest = hmac.new(API_KEY, raw_body, hashlib.sha256).hexdigest()  # или .digest()/base64
    return hmac.compare_digest(digest, signature)

@app.post('/webhooks/tribute')
def tribute_webhook():
    signature = request.headers.get('trbt-signature')
    if not signature or not verify_signature(request.get_data(), signature):
        return jsonify(ok=False, error='invalid signature'), 401

    event = request.get_json(force=True, silent=False)
    # Обработка по event["name"]...
    return jsonify(ok=True), 200
```

> ⚠️ **Encoding подписи** (hex/base64) документация на странице не конкретизирует. Если сравнение не проходит при `hex`, попробуйте `base64`. Всегда используйте безопасное сравнение (`timingSafeEqual`/`compare_digest`).

---

## Требования к ответу вашего вебхука

- Успешная обработка: **HTTP 200**. Тело ответа может быть пустым либо `application/json` по вашему усмотрению.
- Возможные ошибки со стороны вашего сервера:
  - **400** — некорректные данные вебхука
  - **401** — неверная подпись

Источник: https://wiki.tribute.tg/ru/api-dokumentaciya/vebkhuki

---

## События (каталог)

Ниже перечислены события с кратким описанием и **примерами payload** из документации.

### 1) Новая подписка — `new_subscription`

Уведомление о покупке подписки пользователем.

**Пример:**
```json
{
  "name": "new_subscription",
  "created_at": "2025-03-20T01:15:58.33246Z",
  "sent_at": "2025-03-20T01:15:58.542279448Z",
  "payload": {
    "subscription_name": "Поддержите творчество ",
    "subscription_id": 1644,
    "period_id": 1547,
    "period": "monthly",
    "price": 1000,
    "amount": 700,
    "currency": "eur",
    "user_id": 31326,
    "telegram_user_id": 12321321,
    "channel_id": 614,
    "channel_name": "lbs",
    "expires_at": "2025-04-20T01:15:57.305733Z"
  }
}
```

### 2) Отмена подписки — `cancelled_subscription`

Уведомление об отмене подписки пользователем.

**Пример:**
```json
{
  "name": "cancelled_subscription",
  "created_at": "2025-03-21T11:20:44.013969Z",
  "sent_at": "2025-03-21T11:20:44.527657077Z",
  "payload": {
    "subscription_name": "Присоединяйтесь к закрытому клубу ",
    "subscription_id": 1646,
    "period_id": 1549,
    "period": "monthly",
    "price": 1000,
    "amount": 1000,
    "currency": "eur",
    "user_id": 31326,
    "telegram_user_id": 12321321,
    "channel_id": 614,
    "channel_name": "lbs",
    "cancel_reason": "",
    "expires_at": "2025-03-20T11:13:44.737Z"
  }
}
```

### 3) Создан физический заказ — `physical_order_created`

Уведомление о создании нового физического заказа.

**Пример:**
```json
{
  "name": "physical_order_created",
  "created_at": "2025-10-21T09:06:01.780Z",
  "sent_at": "2025-10-21T09:06:01.780Z",
  "payload": {
    "order_id": 12345,
    "status": "pending",
    "user_id": 31326,
    "telegram_user_id": 12321321,
    "products": [
      {
        "product_name": "Футболка с принтом",
        "quantity": 2,
        "price": 150000,
        "currency": "rub"
      }
    ],
    "total": 300000,
    "currency": "rub",
    "shipping_address": "Россия, Москва, ул. Пушкина, д. 10, кв. 5",
    "tracking_number": "RU123456789CN",
    "created_at": "2025-03-20T01:15:58.33246Z",
    "updated_at": "2025-03-20T01:15:58.33246Z"
  }
}
```

### 4) Физический заказ отправлен — `physical_order_shipped`

Уведомление об отправке физического заказа.

**Пример:**
```json
{
  "name": "physical_order_shipped",
  "created_at": "2025-10-21T09:06:01.780Z",
  "sent_at": "2025-10-21T09:06:01.780Z",
  "payload": {
    "order_id": 12345,
    "status": "pending",
    "user_id": 31326,
    "telegram_user_id": 12321321,
    "products": [
      {
        "product_name": "Футболка с принтом",
        "quantity": 2,
        "price": 150000,
        "currency": "rub"
      }
    ],
    "total": 300000,
    "currency": "rub",
    "shipping_address": "Россия, Москва, ул. Пушкина, д. 10, кв. 5",
    "tracking_number": "RU123456789CN",
    "created_at": "2025-03-20T01:15:58.33246Z",
    "updated_at": "2025-03-20T01:15:58.33246Z"
  }
}
```

### 5) Физический заказ отменён — `physical_order_canceled`

Уведомление об отмене физического заказа.

**Пример:**
```json
{
  "name": "physical_order_canceled",
  "created_at": "2025-10-21T09:06:01.780Z",
  "sent_at": "2025-10-21T09:06:01.780Z",
  "payload": {
    "order_id": 12345,
    "status": "pending",
    "user_id": 31326,
    "telegram_user_id": 12321321,
    "products": [
      {
        "product_name": "Футболка с принтом",
        "quantity": 2,
        "price": 150000,
        "currency": "rub"
      }
    ],
    "total": 300000,
    "currency": "rub",
    "shipping_address": "Россия, Москва, ул. Пушкина, д. 10, кв. 5",
    "tracking_number": "RU123456789CN",
    "created_at": "2025-03-20T01:15:58.33246Z",
    "updated_at": "2025-03-20T01:15:58.33246Z"
  }
}
```

### 6) Новый донат — `new_donation`

Уведомление о новом донате.

**Пример:**
```json
{
  "name": "new_donation",
  "created_at": "2025-03-20T01:15:58.33246Z",
  "sent_at": "2025-03-20T01:15:58.542279448Z",
  "payload": {
    "donation_request_id": 123,
    "donation_name": "Поддержать мою работу",
    "message": "Спасибо за ваш контент!",
    "period": "once",
    "amount": 1000,
    "currency": "usd",
    "anonymously": false,
    "web_app_link": "https://t.me/tribute/app?startapp=d123",
    "user_id": 31326,
    "telegram_user_id": 12321321
  }
}
```

### 7) Регулярный донат — `recurrent_donation`

Уведомление о платеже по регулярному донату.

**Пример:**
```json
{
  "name": "recurrent_donation",
  "created_at": "2025-03-20T01:15:58.33246Z",
  "sent_at": "2025-03-20T01:15:58.542279448Z",
  "payload": {
    "donation_request_id": 123,
    "donation_name": "Ежемесячная поддержка",
    "period": "monthly",
    "amount": 500,
    "currency": "eur",
    "anonymously": false,
    "web_app_link": "https://t.me/tribute/app?startapp=d456",
    "user_id": 31326,
    "telegram_user_id": 12321321
  }
}
```

### 8) Отмена доната — `cancelled_donation`

Уведомление об отмене регулярного доната.

**Пример:**
```json
{
  "name": "cancelled_donation",
  "created_at": "2025-03-20T01:15:58.33246Z",
  "sent_at": "2025-03-20T01:15:58.542279448Z",
  "payload": {
    "donation_request_id": 123,
    "donation_name": "Ежемесячная поддержка",
    "period": "monthly",
    "amount": 500,
    "currency": "eur",
    "anonymously": false,
    "web_app_link": "https://t.me/tribute/app?startapp=d456",
    "user_id": 31326,
    "telegram_user_id": 12321321
  }
}
```

### 9) Покупка цифрового товара — `new_digital_product`

Уведомление о покупке цифрового товара.

**Пример:**
```json
{
  "name": "new_digital_product",
  "created_at": "2025-03-20T01:15:58.33246Z",
  "sent_at": "2025-03-20T01:15:58.542279448Z",
  "payload": {
    "product_id": 456,
    "amount": 500,
    "currency": "usd",
    "user_id": 31326,
    "telegram_user_id": 12321321
  }
}
```

---

## Мини‑JSON‑схема события (общая форма)

Все вебхуки имеют общую «обёртку» следующего вида:

```json
{
  "name": "string",        // тип события (см. каталог выше)
  "created_at": "string",  // ISO-8601
  "sent_at": "string",     // ISO-8601
  "payload": { }           // объект с данными события (структура зависит от типа)
}
```

> Точные типы полей `payload` приведены в примерах выше (документация GitBook содержит их в блоке «Show properties», однако в публичном HTML они скрыты — в этом файле оставлены **реальные примеры** с названиями полей).

---

## Полезные ссылки

- Вебхуки (исходная страница): https://wiki.tribute.tg/ru/api-dokumentaciya/vebkhuki
- Заказы (API): https://wiki.tribute.tg/ru/api-dokumentaciya/zakazy
- Товары (API): https://wiki.tribute.tg/ru/api-dokumentaciya/tovary
- Tribute (главная): https://tribute.tg/
