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
- **Обёртка YDB**: `function_chat_bot/ydb_helper.js` — `getUser()`, `saveUser()`, `mergeUsers()`, `findUser()`
- **Обработчики каналов**: `function_chat_bot/src/platforms/telegram/`, `vk/`, `web_chat.js`
- **Схема БД**: `function_chat_bot/ydb_schema.sql`
- **Протестированные модули**: `src/utils/validator.js`, `pin.js`, `jwt_utils.js`, `ux_helpers.js`, `channel_manager.js`, `ttl_cache.js`

## Критический баг (актуален)

В `ydb_helper.js` была ошибка валидации, блокирующая идентификаторы пользователей с `:` (например `email:user@gmail.com`, `vk:123`, `web:<uuid>`). Исправлено добавлением `isValidUserId()` в строке 11. Если в логах появляются ошибки валидации — проверь это первым делом.

## Ключевые константы

```
RATE_LIMIT_MAX = 60 req/min
CRON_MAX_USERS_PER_RUN = 200
DOZHIM_DELAY_HOURS = 20
PRODUCT_ID_FREE = "140_9d5d2"
PRODUCT_ID_PRO = "103_97999"
MAX_RETRIES = 3
MAX_RETRY_DELAY_SEC = 10
```

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