# 🚀 Полная инструкция по деплою NeuroGen v5.0

> **Версия:** 5.0 — Multi-Channel (Telegram + VK + Email + Web)
> **Дата:** 10 апреля 2026
> **Платформа:** Yandex Cloud Serverless Functions + YDB

---

## 📋 Оглавление

1. [Что изменилось в v5.0](#что-изменилось-в-v50)
2. [Подготовка — Yandex Cloud](#1-подготовка--yandex-cloud)
3. [Настройка переменных окружения](#2-настройка-переменных-окружения)
4. [Деплой бота (function_chat_bot)](#3-деплой-бота-function_chat_bot)
5. [Настройка Telegram-бота](#4-настройка-telegram-бота)
6. [Настройка VK Callback API](#5-настройка-vk-callback-api)
7. [Настройка Email (Yandex Postbox)](#6-настройка-email-yandex-postbox)
8. [Деплой сайта (website)](#7-деплой-сайта-website)
9. [Настройка CRON-задач](#8-настройка-cron-задач)
10. [Проверка работоспособности](#9-проверка-работоспособности)
11. [Troubleshooting](#10-troubleshooting)
12. [Чек-лист перед запуском](#чек-лист-перед-запуском)

---

## Что изменилось в v5.0

### Мультиканальная партнёрская система

- **`?page=` теперь кодирует `partner_id`** (ref-хвост партнёра), а не `bot_username`
- Один ref-линк работает для **Telegram, VK, Web и Email**
- Все каналы записывают `partner_id` в `users.partner_id` в YDB

### Каналы

| Канал        | Как передаётся partner_id                    | Пример                               |
| ------------ | -------------------------------------------- | ------------------------------------ |
| **Telegram** | `?start=partner_id` в deep link              | `t.me/bot?start=abc123`              |
| **VK**       | payload `{"ref": "abc"}` или текст сообщения | `vk.com/sethubble` → кнопка "Начать" |
| **Web**      | `?ref=partner_id` в URL                      | `sethubble.ru/ai/?ref=abc123`        |
| **Email**    | Сохраняется вместе с email в YDB             | через форму `/join/`                 |

### Postbox API v2

- API обновлён на **v2** (`postbox.cloud.yandex.net/v2/email/outbound-emails`)
- Аутентификация: **AWS SigV4** (Static Access Key) или **IAM-токен** (Cloud Functions)
- Роль SA: **`postbox.sender`** (не `postbox.messageCreator`!)

### Обратная совместимость

- `referrer` параметр работает как fallback для `partner_id`
- Любой формат ref-хвоста: `abc`, `xyz`, `p_qdr`, `my_ref_2026`

---

## 1. Подготовка — Yandex Cloud

### 1.1. YDB (база данных)

Если YDB ещё не создана:

1. Консоль → Serverless → Serverless Databases → Создать
2. Тип: **Serverless**
3. Запомни **Endpoint** и **Database path**

**Проверь схему** (`function_chat_bot/ydb_schema.sql`):

- `partner_id Utf8` ✅
- `session_version Uint64` ✅ (v4.3.2)
- `pin_code Utf8` ✅ (v4.3.1)

### 1.2. Service Account

Создай сервисный аккаунт с ролями:

| Роль                           | Зачем                        |
| ------------------------------ | ---------------------------- |
| `serverless.functions.invoker` | Вызов функций                |
| `ydb.data.editor`              | Запись в YDB                 |
| `postbox.sender`               | Отправка email через Postbox |

---

## 2. Настройка переменных окружения

### 2.1. Скопируй шаблон

```bash
cd function_chat_bot
cp ENV_TEMPLATE.txt .env
```

### 2.2. Заполни ОБЯЗАТЕЛЬНЫЕ переменные

```bash
# ============================================
# TELEGRAM BOT
# ============================================
BOT_TOKEN=1234567890:ABCdef...
# Токен от @BotFather для главного бота

# ============================================
# YANDEX DATABASE
# ============================================
YDB_ENDPOINT=grpc.ydb.serverless.yandexcloud.net:443
YDB_DATABASE=/ru/home/<folder-id>/my-ydb

# ============================================
# SETHUBBLE — ПРОДУКТЫ И ОПЛАТЫ
# ============================================
PRODUCT_ID_FREE=140_9d5d2
PRODUCT_ID_PRO=103_97999
SETHUBBLE_SECRET=super_secret_key_123

# ============================================
# МОИ ДАННЫЕ В SETHUBBLE
# ============================================
MY_SH_USER_ID=1123
MY_PARTNER_ID=abc123
# ⚠️ Твой ref-хвост — может быть любым: abc, xyz, p_qdr и т.д.

# ============================================
# CRM + АДМИНИСТРИРОВАНИЕ
# ============================================
CRM_ADMIN_IDS=6278976865
ADMIN_TELEGRAM_ID=6278976865

# ============================================
# БЕЗОПАСНОСТЬ — JWT SECRET (КРИТИЧЕСКИ!)
# ============================================
JWT_SECRET=super_random_string_at_least_32_chars
# ⚠️ НЕ должен совпадать с BOT_TOKEN!

# ============================================
# API GATEWAY (заполни ПОСЛЕ деплоя)
# ============================================
API_GW_HOST=d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net

# ============================================
# AI (OpenRouter)
# ============================================
OPENROUTER_API_KEY=sk-or-v1-xxxxx

# ============================================
# EMAIL — Yandex Postbox (API v2)
# ============================================
YANDEX_CLOUD_FOLDER_ID=b1gxxxxx
POSTBOX_FROM_EMAIL=noreply@sethubble.ru
POSTBOX_FROM_NAME=NeuroGen
# Для Cloud Functions — IAM-токен используется автоматически (SA привязан к функции)
# Для локального теста — Static Access Key:
YANDEX_CLOUD_ACCESS_KEY_ID=YCAje_xxxxx
YANDEX_CLOUD_SECRET_KEY=xxxxx

# ============================================
# VKONTAKTE (опционально)
# ============================================
VK_GROUP_TOKEN=vk1_a.xxxxxx
VK_CENTRAL_GROUP=123456789
VK_SECRET_KEY=my_callback_secret
VK_COMMUNITY_URL=https://vk.com/sethubble
VK_CONFIRM_CODE=confirmed_code_string
```

### 2.3. Можно оставить по умолчанию

| Переменная               | По умолчанию | Описание                     |
| ------------------------ | ------------ | ---------------------------- |
| `AI_FREE_LIMIT`          | `3`          | Лимит AI для FREE            |
| `AI_PRO_LIMIT`           | `30`         | Лимит AI для PRO             |
| `DOZHIM_DELAY_HOURS`     | `20`         | Задержка дожима              |
| `CRON_BATCH_SIZE`        | `50`         | Пользователей за запуск CRON |
| `CRON_MAX_USERS_PER_RUN` | `200`        | Макс за один запуск CRON     |
| `MAX_RETRIES`            | `2`          | Повторы при 429              |

---

## 3. Деплой бота (function_chat_bot)

### 3.1. Установи зависимости

```bash
cd function_chat_bot
npm install
npm audit fix  # исправь уязвимости
```

### 3.2. Проверь синтаксис

```bash
npm run check
# Должно: exit code 0
```

### 3.3. Создай архив

```bash
npm run deploy
# Создаст function.zip (~150 KB, без node_modules)
```

⚠️ **Важно:** архив **НЕ включает** `node_modules`. Yandex Cloud сам запустит `npm install` при деплое.

### 3.4. Загрузи в Yandex Cloud Functions

**Через консоль:**

1. Serverless → Cloud Functions → Создать функцию
2. Runtime: **Node.js 20**
3. Загрузи `function.zip`
4. Entry point: **`index.handler`**
5. Timeout: **30 сек**
6. Memory: **512 MB**
7. ✅ Включить: **«Собирать зависимости из package.json»**

**Через YC CLI:**

```bash
yc serverless function create \
  --name sethubble-bot \
  --runtime nodejs20 \
  --entrypoint index.handler \
  --memory 512m \
  --execution-timeout 30s \
  --service-account-id <SA_ID>

yc serverless function version create \
  --function-name sethubble-bot \
  --runtime nodejs20 \
  --entrypoint index.handler \
  --memory 512m \
  --execution-timeout 30s \
  --package function.zip
```

### 3.5. Настрой переменные окружения

Консоль → Cloud Functions → `sethubble-bot` → Переменные окружения → Добавить все из `.env`

### 3.6. Привяжи Service Account к функции

Консоль → Cloud Functions → `sethubble-bot` → Сервисный аккаунт → Выбери свой SA

> Это нужно чтобы функция получала IAM-токен автоматически (для Postbox и YDB).

### 3.7. Создай API Gateway

1. Serverless → API Gateway → Создать
2. Spec (OpenAPI 3.0):

```yaml
openapi: "3.0.0"
info:
  title: "SetHubble API"
  version: "1.0.0"
paths:
  /webhook:
    post:
      x-yc-apigateway-integration:
        function_id: <FUNCTION_ID>
        tag: $latest
        service_account_id: <SA_ID>
      operationId: webhook
  /:
    post:
      x-yc-apigateway-integration:
        function_id: <FUNCTION_ID>
        tag: $latest
        service_account_id: <SA_ID>
      operationId: main
```

3. Скопируй **invocation URL** → это `API_GW_HOST`

### 3.8. Подключи webhook к Telegram

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<API_GW_HOST>/webhook"
```

Проверь:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

---

## 4. Настройка Telegram-бота

### 4.1. Создай бота

1. @BotFather → `/newbot`
2. Имя: `SetHubble Bot` → Username: `sethubble_biz_bot`
3. Скопируй токен → `BOT_TOKEN`

### 4.2. Команды

```
/setcommands
@sethubble_biz_bot
start - 🚀 Запустить систему
menu - 🏠 Главное меню
tools - 🎒 Инструменты
stats - 📊 Моя статистика
```

### 4.3. Как работает реферал

```
t.me/sethubble_biz_bot?start=abc123
                                      ↓
Бот читает "abc123" → users.partner_id = "abc123"
```

**Ссылки для партнёров:**

```
https://t.me/sethubble_biz_bot?start=my_ref
https://t.me/sethubble_biz_bot?start=ivan_2026
https://t.me/sethubble_biz_bot?start=p_qdr
```

---

## 5. Настройка VK Callback API

### 5.1. Создай сообщество

ВКонтакте → Мои сообщества → Создать → `SetHubble`

### 5.2. Получи токены

**Групповой токен:**

1. Управление сообществом → Работа с API → Создать ключ
2. Права: `messages`, `photos`, `users`
3. Скопируй → `VK_GROUP_TOKEN`

**Сервисный токен:**

1. Настройки приложения → Сервисный токен
2. Скопируй → `VK_SERVICE_TOKEN`

### 5.3. Callback API

1. Управление сообществом → Работа с API → Callback API
2. Тип: **Сервер**
3. URL: `https://<API_GW_HOST>/?action=vk-webhook`
4. Нажми **Подтвердить** → скопируй код → `VK_CONFIRM_CODE`
5. Секретный ключ → `VK_SECRET_KEY`

### 5.4. Включи события

- ✅ `message_new`
- ✅ `message_event`

### 5.5. Как работает реферал в VK

VK **не поддерживает** `?ref=` в URL для бота. Партнёрский ID передаётся:

1. Через payload кнопки «Начать»: `{"ref": "abc123"}`
2. Если пользователь написал ref-хвост текстом

**Для партнёров:**

```
https://vk.com/sethubble?ref=abc123
→ Партнёр просит пользователя нажать «Начать»
  или написать ref-хвост в сообщении
```

---

## 6. Настройка Email (Yandex Postbox)

### 6.1. Подключи Postbox

1. Yandex Cloud Console → Postbox → Создать
2. Фолдер: тот же где и функция
3. Запомни `YANDEX_CLOUD_FOLDER_ID`

### 6.2. Верифицируй домен

1. Postbox → Добавить домен → `sethubble.ru`
2. Добавь DNS-записи:

**SPF:**

```
TXT sethubble.ru → v=spf1 include:_spf.yandex.net ~all
```

**DKIM:**

```
TXT _yandex-postbox._domainkey.sethubble.ru → v=DKIM1; k=rsa; p=MIIBIjANBg...
```

3. Дождись верификации (до 24 часов)

### 6.3. Роль SA и ключ

**Роль:** `postbox.sender` (не `postbox.messageCreator`!)

**Ключ:** Static Access Key (Key ID + Secret Key)

```bash
yc iam key create --service-account-id <SA_ID> \
  --description "Postbox static key"
# Сохрани Key ID и Secret Key — они показываются только один раз!
```

### 6.4. Переменные

```bash
YANDEX_CLOUD_FOLDER_ID=b1gxxxxx
POSTBOX_FROM_EMAIL=noreply@sethubble.ru
POSTBOX_FROM_NAME=NeuroGen
YANDEX_CLOUD_ACCESS_KEY_ID=YCAje_xxxxx
YANDEX_CLOUD_SECRET_KEY=xxxxx
```

### 6.5. Проверь отправку

**Через AWS CLI:**

```bash
aws sesv2 send-email \
  --from-email-address noreply@sethubble.ru \
  --destination '{"ToAddresses":["твой_email@gmail.com"]}' \
  --content '{"Simple":{"Subject":{"Data":"Тест","Charset":"UTF-8"},"Body":{"Text":{"Data":"Привет из Postbox v2!","Charset":"UTF-8"}}}}' \
  --endpoint-url https://postbox.cloud.yandex.net
```

**Через cURL (AWS SigV4):**

```bash
curl \
  --request POST \
  --url 'https://postbox.cloud.yandex.net/v2/email/outbound-emails' \
  --header 'Content-Type: application/json' \
  --user "${YANDEX_CLOUD_ACCESS_KEY_ID}:${YANDEX_CLOUD_SECRET_KEY}" \
  --aws-sigv4 "aws:amz:ru-central1:ses" \
  --data-binary '{
    "FromEmailAddress": "noreply@sethubble.ru",
    "Destination": { "ToAddresses": ["твой_email@gmail.com"] },
    "Content": {
      "Simple": {
        "Subject": { "Data": "Тест", "Charset": "UTF-8" },
        "Body": { "Text": { "Data": "Привет из v2!", "Charset": "UTF-8" } }
      }
    }
  }'
```

### 6.6. Email-сценарии

Бот отправляет письма в следующих случаях:

| Сценарий              | Когда                  | Шаблон                             |
| --------------------- | ---------------------- | ---------------------------------- |
| **Welcome**           | Ввод email на `/join/` | `templates.welcome()`              |
| **Напоминание**       | 1-3ч неактивности      | `templates.reminder()`             |
| **Дожим (Tripwire)**  | 20h+ на этапе оплаты   | `templates.followup(offerType)`    |
| **Подтверждение PRO** | После покупки PRO      | `templates.welcome()`              |
| **Канал подключён**   | После настройки канала | `templates.channelSetupComplete()` |

Шаблоны генерируются в коде (`src/core/email/email_service.js`) через `Content.Simple`.

---

## 7. Деплой сайта (website)

### 7.1. Обнови API URL

В `website/src/join.njk` и `website/src/ai.njk`:

```javascript
const API_URL = "https://<API_GW_HOST>/?action=web-chat";
```

### 7.2. Собери

```bash
cd website
npm install
npm run build
# Output → website/_site/
```

### 7.3. Задеплой

- **GitHub Pages:** `npm run build-ghpages` → push к `gh-pages`
- **Yandex Object Storage:** `yc storage cp --recursive website/_site/ s3://sethubble-site/`
- **Любой хостинг:** Netlify, Vercel, etc.

### 7.4. Проверь реферал

Открой `https://sethubble.ru/join/?page=abc123`:

1. Введи email → ПРОДОЛЖИТЬ
2. Telegram → `t.me/bot?start=abc123` ✅
3. Web → `/ai/?ref=abc123` ✅

---

## 8. Настройка CRON-задач

### 8.1. Создай триггер

Консоль → Cloud Functions → `sethubble-bot` → Триггеры → Создать

| Параметр       | Значение                   |
| -------------- | -------------------------- |
| Тип            | Cron                       |
| Cron-выражение | `0 */1 * * *` (каждый час) |
| Тело           | `{"action":"cron"}`        |
| Тег            | `$latest`                  |

### 8.2. Лимиты

```bash
CRON_STALE_HOURS=1
CRON_BATCH_SIZE=50
CRON_MAX_USERS_PER_RUN=200
CRON_USER_PAUSE_MS=35
```

---

## 9. Проверка работоспособности

### Telegram

- ✅ `/start` → экран START
- ✅ `/menu` → главное меню
- ✅ `?start=abc123` → `users.partner_id = "abc123"`
- ✅ Покупка Tripwire → `bought_tripwire = true`

### VK

- ✅ Callback API подтверждён
- ✅ `message_new` → воронка START
- ✅ Callback-кнопки работают
- ✅ `partner_id` из payload записывается

### Web

- ✅ `/join/?page=abc123` → email capture → выбор канала
- ✅ `/ai/?ref=abc123` → web-чат с partner_id
- ✅ `/web-chat` → сохраняет `users.partner_id`

### Email

- ✅ POST `{ isEmail: true, email: "x@y.com", partner_id: "abc" }`
- ✅ `users.partner_id = "abc"` для `email:x@y.com`
- ✅ Postbox отправляет письма

---

## 10. Troubleshooting

### Бот не отвечает

```bash
# Проверь webhook
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# Логи функции
yc serverless function logs --function-name sethubble-bot --follow
```

### Ошибка YDB

```bash
echo "SELECT 1;" | ydb -e $YDB_ENDPOINT -d $YDB_DATABASE -s
```

### Email не отправляется

**403 Forbidden:**

- Роль SA должна быть `postbox.sender` (не `postbox.messageCreator`!)
- Ключ: Static Access Key (не API-ключ)
- SA и Postbox адрес должны быть в **одном фолдере**

**Проверь DNS:**

```bash
dig TXT sethubble.ru
dig TXT _yandex-postbox._domainkey.sethubble.ru
```

### Web-чат не сохраняет partner_id

1. DevTools → Network → POST запрос
2. Тело: `{"partner_id": "abc123", ...}`
3. Логи: `[WEB CHAT] New web user created` с `partnerId: "abc123"`

---

## Чек-лист перед запуском

### Инфраструктура

- [ ] YDB создана, схема применена
- [ ] Service Account создан с ролями: `serverless.functions.invoker`, `ydb.data.editor`, `postbox.sender`
- [ ] SA привязан к Cloud Function

### Бот

- [ ] `BOT_TOKEN` заполнен
- [ ] `YDB_ENDPOINT` и `YDB_DATABASE` заполнены
- [ ] `MY_PARTNER_ID` заполнен
- [ ] `JWT_SECRET` заполнен (НЕ совпадает с BOT_TOKEN!)
- [ ] `OPENROUTER_API_KEY` заполнен
- [ ] `function.zip` загружен, версия создана
- [ ] Переменные окружения в функции заполнены

### Telegram

- [ ] API Gateway создан, `API_GW_HOST` заполнен
- [ ] Webhook установлен: `https://<API_GW_HOST>/webhook`
- [ ] Тестовый `/start` → работает
- [ ] Тестовый `?start=abc123` → `partner_id` записан

### VK (опционально)

- [ ] Сообщество создано, токены получены
- [ ] Callback API подтверждён
- [ ] События `message_new` и `message_event` включены

### Email (опционально)

- [ ] Postbox подключён, домен верифицирован (SPF + DKIM)
- [ ] Static Access Key создан
- [ ] Тестовое письмо отправлено → получено

### Сайт

- [ ] `API_URL` обновлён в `join.njk` и `ai.njk`
- [ ] Сайт собран и задеплоен
- [ ] `/join/?page=abc123` → маршрутизация по каналам работает

### CRON

- [ ] Cron-триггер создан
- [ ] Логи показывают `[CRON] Processing inactive users`

---

## Полезные ссылки

- **Yandex Cloud Functions:** https://yandex.cloud/ru/docs/functions/
- **Yandex YDB:** https://ydb.tech/docs/
- **Yandex Postbox (API v2):** https://yandex.cloud/ru/docs/postbox/api-ref/email/outbound-emails/create
- **VK Callback API:** https://dev.vk.com/ru/api/bots/getting-started
- **Telegram Bot API:** https://core.telegram.org/bots/api
