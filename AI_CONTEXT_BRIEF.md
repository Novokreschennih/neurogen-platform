# NeuroGen Platform v5.0 — Контекст для нового разработчика/ИИ

## 🎯 Что мы делаем

Разрабатываем SaaS-платформу для Telegram/VK ботов с AI-консультантом и автоматизированной воронкой продаж.

**Стек:** Node.js 20, Yandex Cloud Functions (serverless), YDB (база данных), Telegraf (Telegram), VK Callback API, Yandex Postbox API v2 (email), Eleventy (сайт).

---

## ✅ КРИТИЧЕСКИЙ БАГ НАЙДЕН И ИСПРАВЛЁН (10 апреля 2026)

### 🐛 Проблема: Email не сохранялся в YDB

**Корневая причина:** В `ydb_helper.js` функции `getUser()` и `saveUser()` содержали проверку:

```javascript
if (!userId || String(userId).includes(":")) return null; // ← БЛОКИРОВАЛО ВСЕ КАНАЛЫ!
```

Эта защита от инъекций **блокировала все мультиканальные user_id**:

- `email:user@gmail.com` ❌
- `vk:123456` ❌
- `web:uuid-here` ❌

**Решение:** Создана функция `isValidUserId()` с поддержкой v5.0 мультиканальности:

```javascript
function isValidUserId(userId) {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0)
    return false;
  // Числовой Telegram/VK ID
  if (/^\d{3,20}$/.test(userId)) return true;
  // Специальные префиксы мультиканальности v5.0
  if (/^vk:[a-zA-Z0-9_.-]{1,50}$/.test(userId)) return true;
  if (/^email:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId))
    return true;
  if (/^web:[a-f0-9-]{20,50}$/.test(userId)) return true; // UUID формат
  return false;
}
```

**Исправленные файлы:**

- ✅ `function_chat_bot/ydb_helper.js` — `getUser()` теперь проверяет формат, а не просто наличие `:`
- ✅ `function_chat_bot/ydb_helper.js` — `saveUser()` аналогично исправлен
- ✅ Синтаксис проверен: `npm run check` → exit code 0

**Следующий шаг:** Перезалить `function.zip` и проверить логи:

```bash
cd function_chat_bot && npm run deploy
yc serverless function logs --function-name sethubble-bot --tail 50 | grep "WEB LEAD"
```

---

## 📂 Ключевые файлы

### 1. `function_chat_bot/index.js` — Entry point

- **Строка 4:** `import * as ydb from "./ydb_helper.js"`
- **Строка 920:** `const dbInitPromise = ydb.init()`
- **Строка 996:** `handleWebChat(event, { action, ydb, log, corsHeaders })` — **ydb передаётся!**
- **Строка 912:** `setTraceId(traceId)` — trace_id для логов

### 2. `function_chat_bot/src/core/http_handlers/web_chat.js` — Обработка email

- **Строка 11:** `import { validateEmail, validatePartnerId }`
- **Строка 47:** `if (context.ydb)` — проверка наличия YDB
- **Строка 50:** `await context.ydb.getUser(emailUserId)` — поиск
- **Строка 100:** `await context.ydb.saveUser(emailUser)` — сохранение

### 3. `function_chat_bot/ydb_helper.js` — YDB SDK wrapper

- **Строка 96-106:** `isValidUserId()` — **НОВАЯ** валидация user_id
- **Строка 108-130:** `getUser(userId)` — исправлено, теперь поддерживает `email:`, `vk:`, `web:`
- **Строка 132-145:** `saveUser(user)` — исправлено, аналогично
- **Строка 95:** `mapUser(row)` — маппинг YDB row → JS объект

### 4. `function_chat_bot/src/utils/validator.js` — Валидация входных данных

- `validateEmail()`, `validatePartnerId()`, `validateUserId()` — все используют regex
- `escapeHtml()` — XSS защита для CRM

---

## 🛠 Что нужно сделать сейчас

### Шаг 1: Перезалить function.zip

```bash
cd function_chat_bot && npm run deploy
```

### Шаг 2: Проверить логи

```bash
yc serverless function logs --function-name sethubble-bot --tail 100
```

Искать:

- ✅ `[WEB LEAD] Saved email user to YDB` — **всё работает!**
- ✅ `[WEB LEAD] getUser result, found: false` → затем `Calling saveUser`
- ❌ `[WEB LEAD] YDB NOT AVAILABLE` — **всё ещё проблема** (маловероятно)
- ❌ `[YDB] Invalid user_id format` — валидация не проходит (проверить формат email)

### Шаг 3: Протестировать через curl

```bash
curl -X POST "https://<API_GW_HOST>/?action=web-chat" \
  -H "Content-Type: application/json" \
  -d '{"isEmail":true,"email":"test@test.com","partner_id":"p_qdr"}'
```

Ожидаемый ответ: `{"success":true}`

### Шаг 4: Проверить YDB напрямую

```bash
# Через YC CLI или консоль YDB
SELECT user_id, partner_id, first_name FROM users WHERE user_id LIKE 'email:%';
```

---

## ✅ Что уже реализовано (НЕ ТРОГАТЬ)

- ✅ Мультиканальная архитектура (TG, VK, Web, Email)
- ✅ Channel linking через email (MERGE записей)
- ✅ Postbox API v2 + AWS SigV4 auth
- ✅ Input validation (`validator.js`)
- ✅ XSS защита в CRM (`escapeHtml`)
- ✅ Rate Limiting (60 запросов/мин на IP)
- ✅ Health Check endpoint (`?action=health`)
- ✅ Trace ID logging
- ✅ Auto DB migrations
- ✅ Webhook retries (5s → 30s)
- ✅ API versioning (`/api/v1/`)
- ✅ Graceful Degradation — функция не падает при ошибках YDB
- ✅ **ИСПРАВЛЕНИЕ:** `isValidUserId()` — поддержка `email:`, `vk:`, `web:` префиксов

---

## 💡 Дополнительная диагностика (если нужна)

Можно добавить в `web_chat.js` для отладки:

```javascript
log.info(`[WEB LEAD] context.ydb type`, {
  type: typeof context.ydb,
  keys: Object.keys(context.ydb || {}),
  hasGetUser: typeof context.ydb?.getUser === "function",
  hasSaveUser: typeof context.ydb?.saveUser === "function",
});
```

---

## 📦 Архив для деплоя

`function_chat_bot/function.zip` — 158 KB (без `node_modules`, YC делает `npm install` сам)

Команда для создания архива:

```bash
cd function_chat_bot && npm run deploy
```

---

## 🔗 Связанные файлы

| Файл                                                   | Назначение                                            |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `function_chat_bot/index.js`                           | Entry point, HTTP handlers, CRON, rate limiting       |
| `function_chat_bot/src/core/http_handlers/web_chat.js` | Web chat endpoint, email capture                      |
| `function_chat_bot/ydb_helper.js`                      | YDB SDK wrapper, auto migrations, **isValidUserId()** |
| `function_chat_bot/ydb_schema.sql`                     | Схема базы данных                                     |
| `function_chat_bot/ai_engine.js`                       | AI движок (OpenRouter API)                            |
| `website/src/join.njk`                                 | Лендинг с формой ввода email                          |
| `website/src/ai.njk`                                   | Воронка на сайте                                      |
| `tools/crm_dashboard.html`                             | CRM для владельцев ботов                              |
| `DEPLOY_GUIDE.md`                                      | Инструкция по деплою                                  |
| `QWEN.md`                                              | Полная документация проекта                           |

---

## 🎯 Контекст: Мультиканальная архитектура v5.0

### Как работает связка каналов через email

```
/join/?page=partner_id → пользователь вводит email
   ↓
Telegram: t.me/bot?start=partnerId|base64(email)
   ↓
Bot декодирует email → находит запись "email:xxx" в YDB → MERGE
   ↓
Результат: один пользователь с каналами Telegram + Email
```

Все каналы связаны через email. Когда пользователь приходит через Telegram с encoded email в start payload, бот:

1. Декодирует email из `?start=`
2. Ищет запись `user_id: "email:user@gmail.com"` в YDB
3. MERGE: переносит все данные в основную запись `user_id: "123456789"` (Telegram ID)
4. Старая запись помечается `session.merged_to: "123456789"`

### Сессия хранится в JSON колонке `session`

```json
{
  "dialog_history": [...],
  "tags": [],
  "email": "user@example.com",
  "email_verified": false,
  "channels": {
    "telegram": { "enabled": true, "bot_username": "my_bot" },
    "vk": { "enabled": false },
    "web": { "enabled": true, "session_id": "web:uuid" },
    "email": { "enabled": true, "subscribed": true }
  },
  "channel_states": {
    "telegram": "START",
    "web": "START"
  },
  "merged_to": "123456789",
  "merged_at": 1712345678000
}
```

---

## 📝 Важно помнить

1. **Serverless архитектура** — функция запускается на каждый запрос, холодный старт возможен
2. **YDB инициализируется один раз** — `dbInitPromise` кешируется между вызовами в рамках одного инстанса
3. **Все состояние в YDB** — не в памяти функции
4. **Graceful Degradation** — функция не падает, возвращает `{success: false}` при ошибках
5. **Trace ID** — каждый запрос получает уникальный `trace_id` для отладки в логах
6. **API Gateway** — проксирует запросы в Cloud Function, поддерживает CORS

---

**Дата:** 10 апреля 2026
**Версия:** v5.0 — Multi-Channel
**Статус:** 🟢 Баг исправлен — нужно перезалить function.zip
