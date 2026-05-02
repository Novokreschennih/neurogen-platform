# NeuroGen Platform — Руководство для агента

## Пакеты

- `function_chat_bot/` — Serverless-функция Yandex Cloud (Node ≥20, ESM)
- `website/` — Статический сайт на Eleventy (Node ≥18)

## Команды

```bash
# Бот: проверка синтаксиса / деплой / тесты
cd function_chat_bot
npm run check          # node --check index.js
npm run deploy         # zip -r function.zip . -x '*.git*' '*.env' 'node_modules/*' '*.md' 'знания/*'
npm test              # node tests/run.js

# Сайт: сборка / разработка
cd website
npm run build         # tailwindcss + eleventy
npm start             # dev server с hot reload

# Просмотр логов бота (Yandex Cloud)
yc serverless function logs --function-name sethubble-bot --tail 50
```

## Архитектура

- **Точка входа бота**: `function_chat_bot/index.js` (HTTP-обработчики, CRON, rate limiting)
- **Об��ртка YDB**: `function_chat_bot/ydb_helper.js` — `getUser()`, `saveUser()`, `mergeUsers()`, `findUser()`, `partialUpdateUser()`, `getBotInfo()`, `getOwnerAiStatus()`
- **Обработчики каналов**: `function_chat_bot/src/platforms/telegram/`, `vk/`, `web_chat.js`
- **Схема БД**: `function_chat_bot/ydb_schema.sql`
- **Основные модули**: `src/core/omni_resolver.js`, `src/core/channels/channel_manager.js`, `src/core/email/email_service.js`
- **Утилиты**: `src/utils/validator.js`, `src/utils/logger.js`, `src/utils/pin.js`, `src/utils/jwt_utils.js`, `src/utils/retry.js`, `src/utils/ttl_cache.js`, `src/utils/ux_helpers.js`, `src/utils/vk_photo_cache.js`, `src/utils/webhook_retry.js`, `src/utils/db_migrations.js`
- **Протестированные модули**: `src/utils/validator.js`, `pin.js`, `jwt_utils.js`, `ux_helpers.js`, `channel_manager.js`, `ttl_cache.js`, `vk_photo_cache.js`, `webhook_retry.js`, `db_migrations.js`

## Критический баг (актуален)

В `ydb_helper.js` была ошибка валидации, блокирующая идентификаторы пользователей с `:` (например `email:user@gmail.com`, `vk:123`, `web:<uuid>`). Исправлено добавлением `isValidUserId()` в строке 18. Если в логах появляются ошибки валидации — проверь это первым делом.

## Ключевые константы

```
RATE_LIMIT_MAX = 60 req/min
CRON_MAX_USERS_PER_RUN = 200
DOZHIM_DELAY_HOURS = 20
PRODUCT_ID_FREE = "140_9d5d2"
PRODUCT_ID_PRO = "103_97999"
MAX_RETRIES = 2
MAX_RETRY_DELAY_SEC = 10
WEBHOOK_RETRY_DELAYS = 5000,30000
UPDATE_TTL_MS = 300000
CRON_STALE_HOURS = 1
CRON_USER_PAUSE_MS = 35
CRON_BROADCAST_PAUSE_SEC = 1
CRON_MAX_USERS_PER_RUN = 200
AI_FREE_LIMIT = 3
AI_PRO_LIMIT = 30
BROADCAST_RATE_LIMIT = 30

## Формат ID пользователя (v5.0+ Мультиканальность)

```
telegram:<numeric_id>  или просто число для Telegram
vk:<numeric_id>        или просто число для VK
email:user@gmail.com
web:<uuid>
Чистый UUID для внутреннего первичного ключа
```

## Поток объединения каналов

1. Пользователь приходит через любой канал
2. Если email известен → `findUser({ email })`
3. Если существует → `mergeUsers(existing, new, "web_form_merge")`
4. Старая запись получает `session.merged_to: <primary_id>`

## Паттерны в логах

- `[WEB LEAD] getUser result, found: false` → новый пользователь, вызовет `saveUser`
- `[WEB LEAD] Saved email user to YDB` → успех
- `[YDB] Invalid user_id format` → ошибка валидации (проверь `isValidUserId`)
- `[YDB NOT AVAILABLE]` → проблема подключения или деплоя

## Существующие файлы с инструкциями (читать первыми)

- `DEPLOY_GUIDE.md` — полная процедура деплоя (YDB, Telegram, VK, Postbox, сайт, CRON)
- `AI_CONTEXT_BRIEF.md` — архитектура и решения по дизайну
- `QWEN.md` — дополнительный контекст для моделей Qwen