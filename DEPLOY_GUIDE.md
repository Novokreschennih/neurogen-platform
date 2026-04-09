# 🚀 Полная инструкция по деплою NeuroGen v5.0

> **Версия:** 5.0 — Multi-Channel (Telegram + VK + Email + Web)
> **Дата:** 9 апреля 2026
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

---

## Что изменилось в v5.0

### Ключевое изменение
- **`?page=` теперь кодирует `partner_id`** (ref-хвост партнёра), а не `bot_username`
- **Мультиканальность:** один ref-линк работает для Telegram, VK, Web и Email
- **Все каналы** записывают `partner_id` в `users.partner_id` в YDB

### Новые переменные окружения
- `VK_GROUP_TOKEN` — токен группы VK для API
- `VK_COMMUNITY_URL` — URL сообщества VK

### Обратная совместимость
- Старые ссылки с `bot_username` → fallback на `MY_PARTNER_ID`
- `referrer` параметр всё ещё работает как fallback для `partner_id`

---

## 1. Подготовка — Yandex Cloud

### 1.1. YDB (база данных)

Если YDB ещё не создана:

```bash
# В консоли Yandex Cloud:
# 1. Serverless → Serverless Databases → Create database
# 2. Тип: Serverless
# 3. Запомни Endpoint и Database path
```

**Проверь схему:** файл `function_chat_bot/ydb_schema.sql` должен быть применён.
Если таблица `users` уже существует — проверь что есть колонки:
- `partner_id Utf8` (была всегда)
- `session_version Uint64` (v4.3.2)
- `pin_code Utf8` (v4.3.1)

### 1.2. Service Account

Создай сервисный аккаунт с ролями:
- `serverless.functions.invoker` — для вызова функций
- `ydb.admin` или `ydb.data.editor` — для работы с YDB
- `postbox.messageCreator` — для email-рассылок (опционально)

---

## 2. Настройка переменных окружения

### 2.1. Скопируй шаблон

```bash
cd function_chat_bot
cp ENV_TEMPLATE.txt .env
```

### 2.2. Заполни ОБЯЗАТЕЛЬНЫЕ переменные

Открой `.env` и заполни:

```bash
# ============================================================
# 1. TELEGRAM BOT (ОБЯЗАТЕЛЬНО)
# ============================================================
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
# ⚠️ Токен от @BotFather для ГЛАВНОГО бота (sethubble_biz_bot)

# ============================================================
# 2. YANDEX DATABASE (ОБЯЗАТЕЛЬНО)
# ============================================================
YDB_ENDPOINT=grpc.ydb.serverless.yandexcloud.net:443
# ⚠️ Endpoint из консоли YDB
YDB_DATABASE=/ru/home/<folder-id>/my-ydb
# ⚠️ Полный путь к базе

# ============================================================
# 3. SETHUBBLE — ПРОДУКТЫ И ОПЛАТЫ (ОБЯЗАТЕЛЬНО)
# ============================================================
PRODUCT_ID_FREE=140_9d5d2
PRODUCT_ID_PRO=103_97999
SETHUBBLE_SECRET=super_secret_key_123
# ⚠️ Из кабинета SetHubble

# ============================================================
# 4. МОИ ДАННЫЕ В SETHUBBLE (ОБЯЗАТЕЛЬНО)
# ============================================================
MY_SH_USER_ID=1123
MY_PARTNER_ID=p_qdr
# ⚠️ Твой ref-хвост (может быть любым: abc, xyz, my_ref и т.д.)

# ============================================================
# 5. CRM WEB APP (ОБЯЗАТЕЛЬНО)
# ============================================================
CRM_ADMIN_IDS=6278976865
# ⚠️ Твой Telegram ID (через запятую если несколько)

# ============================================================
# 6. ССЫЛКИ НА КОНТЕНТ (ОБЯЗАТЕЛЬНО)
# ============================================================
DISK_LINK=https://disk.yandex.ru/d/auId7HugR0sdzA
FREE_DISK_LINK=https://disk.yandex.ru/d/a2Gsuwnu32eJKg

# ============================================================
# 7. АДМИНИСТРИРОВАНИЕ (ОБЯЗАТЕЛЬНО)
# ============================================================
ADMIN_TELEGRAM_ID=6278976865

# ============================================================
# 9. БЕЗОПАСНОСТЬ — JWT SECRET (КРИТИЧЕСКИ ВАЖНО!)
# ============================================================
JWT_SECRET=super_random_string_at_least_32_chars
# ⚠️ НЕ должен совпадать с BOT_TOKEN!

# ============================================================
# 10. API GATEWAY (ПОСЛЕ ДЕПЛОЯ)
# ============================================================
API_GW_HOST=d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net
# ⚠️ Заполни ПОСЛЕ создания API Gateway

# ============================================================
# 19. API КЛЮЧИ (ОПЦИОНАЛЬНО)
# ============================================================
OPENROUTER_API_KEY=sk-or-v1-xxxxx
# ⚠️ Из openrouter.ai

# ============================================================
# 21. YANDEX CLOUD POSTBOX — EMAIL (ОПЦИОНАЛЬНО, для v5.0)
# ============================================================
YANDEX_CLOUD_API_KEY=ycn_xxxxx
YANDEX_CLOUD_FOLDER_ID=b1gxxxxx
POSTBOX_FROM_EMAIL=noreply@sethubble.ru
POSTBOX_FROM_NAME=NeuroGen

# ============================================================
# 22. VKONTAKTE — ИНТЕГРАЦИЯ (ОПЦИОНАЛЬНО, для v5.0)
# ============================================================
VK_GROUP_TOKEN=vk1_a.xxxxxx
VK_CENTRAL_GROUP=123456789
VK_SECRET_KEY=my_callback_secret
VK_COMMUNITY_URL=https://vk.com/sethubble
VK_CONFIRM_CODE=confirmed_code_string
```

### 2.3. Переменные, которые можно оставить по умолчанию

| Переменная | Значение по умолчанию | Описание |
|-----------|---------------------|----------|
| `AI_FREE_LIMIT` | `3` | Лимит AI для FREE |
| `AI_PRO_LIMIT` | `30` | Лимит AI для PRO |
| `DOZHIM_DELAY_HOURS` | `20` | Задержка дожима |
| `CRON_BATCH_SIZE` | `50` | Пользователей за запуск CRON |
| `MAX_RETRIES` | `2` | Повторы при 429 |
| `CRON_MAX_USERS_PER_RUN` | `200` | Лимит CRON |

---

## 3. Деплой бота (function_chat_bot)

### 3.1. Установи зависимости

```bash
cd function_chat_bot
npm install
```

### 3.2. Проверь синтаксис

```bash
npm run check
# Должно вывести: "node --check index.js" → exit code 0
```

### 3.3. Создай архив для деплоя

```bash
npm run deploy
# Создаст function.zip
```

### 3.4. Загрузи в Yandex Cloud Functions

**Вариант A — через консоль:**

1. Serverless → Cloud Functions → Создать функцию
2._runtime: Node.js 20_
3. Загрузи `function.zip`
4. **Entry point:** `index.handler`
5. **Timeout:** 30 сек
6. **Memory:** 512 MB

**Вариант B — через YC CLI:**

```bash
# Создай функцию
yc serverless function create \
  --name sethubble-bot \
  --runtime nodejs20 \
  --entrypoint index.handler \
  --memory 512m \
  --execution-timeout 30s

# Загрузи версию
yc serverless function version create \
  --function-name sethubble-bot \
  --runtime nodejs20 \
  --entrypoint index.handler \
  --memory 512m \
  --execution-timeout 30s \
  --package function.zip
```

### 3.5. Настрой переменные окружения в функции

**В консоли Yandex Cloud:**
Cloud Functions → `sethubble-bot` → Переменные окружения → Добавить все из `.env`

**Через YC CLI:**

```bash
yc serverless function version create \
  --function-name sethubble-bot \
  --runtime nodejs20 \
  --entrypoint index.handler \
  --memory 512m \
  --environment file://.env \
  --package function.zip
```

⚠️ **Важно:** формат `.env` для YC CLI — файл без `export`, просто `KEY=VALUE` на каждой строке.

### 3.6. Создай API Gateway

1. Serverless → API Gateway → Создать
2. Конфиг (OpenAPI spec):

```yaml
openapi: 3.0.0
info:
  title: SetHubble API
  version: 1.0.0
paths:
  /webhook:
    post:
      x-yc-apigateway-integration:
        function_id: <FUNCTION_ID>
        tag: latest
        service_account: <SA_ID>
      operationId: webhook
```

3. Скопируй **invocation URL** → это `API_GW_HOST`

### 3.7. Подключи webhook к Telegram

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

### 4.1. Создай главного бота

1. Открой @BotFather в Telegram
2. `/newbot` → имя: `SetHubble Bot` → username: `sethubble_biz_bot`
3. Скопируй токен → `BOT_TOKEN` в `.env`

### 4.2. Настрой команды

В @BotFather:
```
/setcommands
@sethubble_biz_bot
start - 🚀 Запустить систему
menu - 🏠 Главное меню
tools - 🎒 Инструменты
stats - 📊 Моя статистика
```

### 4.3. Проверь работу

1. Открой `t.me/sethubble_biz_bot`
2. Нажми `/start`
3. Должен появиться экран START воронки

### 4.4. Как работает реферал

```
t.me/sethubble_biz_bot?start=abc123
                                      ↓
Бот читает "abc123" → users.partner_id = "abc123"
```

**Примеры ref-ссылок для партнёров:**
```
https://t.me/sethubble_biz_bot?start=my_ref
https://t.me/sethubble_biz_bot?start=ivan_2026
https://t.me/sethubble_biz_bot?start=p_qdr
```

---

## 5. Настройка VK Callback API

### 5.1. Создай сообщество

1. ВКонтакте → Мои сообщества → Создать
2. Название: `SetHubble`
3. Тип: **Бизнес** или **Публичная страница**

### 5.2. Получи токены

**Групповой токен (`VK_GROUP_TOKEN`):**
1. Управление сообществом → Работа с API
2. Создать ключ → права: `messages`, `photos`, `users`
3. Скопируй → `VK_GROUP_TOKEN`

**Сервисный токен (`VK_SERVICE_TOKEN`):**
1. Настройки приложения → Сервисный токен
2. Скопируй → `VK_SERVICE_TOKEN`

### 5.3. Настрой Callback API

1. Управление сообществом → Работа с API → Callback API
2. **Тип:** Сервер
3. **URL:** `https://<API_GW_HOST>/?action=vk-webhook`
4. Нажми **Подтвердить**
5. Скопируй код подтверждения → `VK_CONFIRM_CODE` в `.env`
6. **Секретный ключ** → `VK_SECRET_KEY` в `.env`

### 5.4. Включи события

В настройках Callback API включи:
- ✅ `message_new` — новые сообщения
- ✅ `message_event` — нажатие callback-кнопок

### 5.5. Как работает реферал

VK **не поддерживает** deep link с параметрами как Telegram. Партнёрский ID передаётся через:

1. **Кнопка "Начать"** с payload: `{"ref": "abc123"}`
2. **Текст сообщения:** если пользователь ввёл ref-хвост вручную

**Для партнёров:**
```
https://vk.com/sethubble?ref=abc123
                              ↓
Партнёр просит пользователя нажать "Начать"
или написать ref-хвост в сообщении
```

⚠️ **Важно:** VK не передаёт `?ref=` из URL боту автоматически. Для полноценной поддержки нужны start-кнопки (см. документацию VK).

---

## 6. Настройка Email (Yandex Postbox)

### 6.1. Подключи Postbox

1. Yandex Cloud Console → Postbox → Создать
2. Выбери фолдер → получи `YANDEX_CLOUD_FOLDER_ID`

### 6.2. Верифицируй домен

1. В Postbox → Добавить домен → `sethubble.ru`
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

### 6.3. Создай API-ключ

1. Service Accounts → Создать аккаунт
2. Роль: `postbox.messageCreator`
3. Создай авторизованный ключ → `YANDEX_CLOUD_API_KEY`

### 6.4. Заполни переменные

```bash
YANDEX_CLOUD_API_KEY=ycn_xxxxx
YANDEX_CLOUD_FOLDER_ID=b1gxxxxx
POSTBOX_FROM_EMAIL=noreply@sethubble.ru
POSTBOX_FROM_NAME=NeuroGen
```

### 6.5. Проверь отправку

```bash
curl -X POST \
  https://postbox.api.cloud.yandex.net/postbox/v1/messages:send \
  -H "Authorization: Api-Key $YANDEX_CLOUD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "folderId": "'$YANDEX_CLOUD_FOLDER_ID'",
    "messages": [{
      "to": [{ "email": "твой_email@gmail.com" }],
      "from": { "email": "noreply@sethubble.ru", "name": "NeuroGen" },
      "subject": "Тест",
      "text": "Тестовое письмо"
    }]
  }'
```

---

## 7. Деплой сайта (website)

### 7.1. Обнови URL API Gateway

В `website/src/join.njk`:
```javascript
const API_URL = "https://<API_GW_HOST>/?action=web-chat";
```

В `website/src/ai.njk`:
```javascript
const API_URL = "https://<API_GW_HOST>/?action=web-chat";
```

### 7.2. Собери сайт

```bash
cd website
npm install
npm run build
# Output → website/_site/
```

### 7.3. Задеплой

**Вариант A — GitHub Pages:**
```bash
cd website
npm run build-ghpages
# Push к gh-pages branch
```

**Вариант B — Yandex Object Storage (статический хостинг):**

```bash
# Создай бакет с публичным доступом
yc storage create-bucket --name sethubble-site --anonymous-access-readable

# Загрузи файлы
yc storage cp --recursive website/_site/ s3://sethubble-site/
```

**Вариант C — любой статический хостинг** (Netlify, Vercel, etc.)

### 7.4. Проверь реферал

Открой:
```
https://sethubble.ru/join/?page=abc123
```

1. Введи email → нажми "ПРОДОЛЖИТЬ"
2. Выбери Telegram → должен редиректнуть на `t.me/sethubble_biz_bot?start=abc123`
3. Выбери Web → должен редиректнуть на `/ai/?ref=abc123`

---

## 8. Настройка CRON-задач

CRON запускает дожимы, напоминания и рассылки.

### 8.1. Создай триггер

**В консоли Yandex Cloud:**
Cloud Functions → `sethubble-bot` → Триггеры → Создать

**Тип:** Cron-триггер

**Параметры:**
- **Cron-выражение:** `0 */1 * * *` (каждый час)
- **Тело запроса:** `{"action":"cron"}`
- **Тег:** `$latest`

### 8.2. Настрой лимиты

В `.env`:
```bash
CRON_STALE_HOURS=1        # Через сколько считать пользователя неактивным
CRON_BATCH_SIZE=50        # Пользователей за запуск
CRON_MAX_USERS_PER_RUN=200 # Максимум за один запуск
CRON_USER_PAUSE_MS=35     # Пауза между пользователями (мс)
```

### 8.3. Проверь CRON

1. Подожди срабатывания триггера
2. В логах функции должно быть: `[CRON] Processing inactive users`

---

## 9. Проверка работоспособности

### 9.1. Telegram

```
✅ /start → экран START
✅ /menu → главное меню
✅ /stats → статистика
✅ Реферал /start?abc123 → users.partner_id = "abc123"
✅ Покупка Tripwire → bought_tripwire = true
✅ CRON дожим → через 1 час неактивности
```

### 9.2. VK

```
✅ Callback API подтверждён
✅ message_new → воронка START
✅ Callback-кнопки → работают
✅ partner_id из payload → записывается
```

### 9.3. Web

```
✅ /join/?page=abc123 → email capture → выбор канала
✅ /ai/?ref=abc123 → web-чат с partner_id
✅ API /web-chat → сохраняет users.partner_id
```

### 9.4. Email

```
✅ POST /web-chat { isEmail: true, email: "x@y.com", partner_id: "abc" }
✅ users.partner_id = "abc" для email:user_id
✅ Postbox отправляет письма
```

### 9.5. Платёжный webhook

```
✅ SetHubble → POST /webhook → обновление bought_tripwire
✅ SETHUBBLE_SECRET → валидация подписи
```

---

## 10. Troubleshooting

### Бот не отвечает на /start

```bash
# Проверь webhook
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# Проверь логи функции
yc serverless function logs --function-name sethubble-bot --follow
```

### Ошибка YDB

```bash
# Проверь подключение
echo "SELECT 1;" | ydb -e $YDB_ENDPOINT -d $YDB_DATABASE -s

# Проверь переменные
yc serverless function get --name sethubble-bot
```

### VK не подтверждает Callback API

1. Убедись что функция отвечает на `type: "confirmation"`
2. `VK_CONFIRM_CODE` должен совпадать с кодом в настройках ВК
3. Проверь логи: `[VK WEBHOOK] Request received`

### Email не отправляется

```bash
# Проверь API ключ
curl -H "Authorization: Api-Key $YANDEX_CLOUD_API_KEY" \
  https://postbox.api.cloud.yandex.net/postbox/v1/senders

# Проверь DNS (SPF, DKIM)
dig TXT sethubble.ru
dig TXT _yandex-postbox._domainkey.sethubble.ru
```

### Web-чат не сохраняет partner_id

1. Открой DevTools → Network → проверь POST запрос
2. Тело запроса должно содержать: `{"partner_id": "abc123", ...}`
3. В логах функции: `[WEB CHAT] New web user created` с `partnerId: "abc123"`

---

## Чек-лист перед запуском

- [ ] YDB создана, схема применена
- [ ] Сервисный аккаунт с ролями создан
- [ ] `BOT_TOKEN` заполнен
- [ ] `YDB_ENDPOINT` и `YDB_DATABASE` заполнены
- [ ] `MY_PARTNER_ID` заполнен
- [ ] `JWT_SECRET` заполнен (НЕ совпадает с BOT_TOKEN!)
- [ ] `OPENROUTER_API_KEY` заполнен
- [ ] Функция загружена, версия создана
- [ ] API Gateway создан, `API_GW_HOST` заполнен
- [ ] Webhook в Telegram установлен
- [ ] Переменные окружения в функции заполнены
- [ ] VK Callback API подтверждён (если используешь VK)
- [ ] Postbox домен верифицирован (если используешь Email)
- [ ] Сайт задеплоен, `join.njk` и `ai.njk` обновлены
- [ ] CRON-триггер создан
- [ ] Тестовый /start → работает
- [ ] Тестовый реферал `?start=abc123` → partner_id записан
- [ ] Тестовый /join/?page=abc123 → маршрутизация работает

---

## Полезные ссылки

- **Yandex Cloud Functions:** https://yandex.cloud/ru/docs/functions/
- **Yandex YDB:** https://ydb.tech/docs/
- **Yandex Postbox:** https://yandex.cloud/ru/docs/postbox/
- **VK Callback API:** https://dev.vk.com/ru/api/bots/getting-started
- **Telegram Bot API:** https://core.telegram.org/bots/api