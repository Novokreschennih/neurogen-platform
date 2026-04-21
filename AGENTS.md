# NeuroGen Platform — Agent Guide

## Packages

- `function_chat_bot/` — Yandex Cloud Serverless Function (Node ≥20, ESM)
- `website/` — Eleventy static site (Node ≥18)

## Commands

```bash
# Bot: syntax check / deploy / test
cd function_chat_bot
npm run check          # node --check index.js
npm run deploy         # zip -r function.zip . -x '*.git*' '*.env' 'node_modules/*' '*.md' 'знания/*'
npm test              # node tests/run.js

# Website: build / dev
cd website
npm run build         # tailwindcss + eleventy
npm start             # dev server with hot reload

# View bot logs (Yandex Cloud)
yc serverless function logs --function-name sethubble-bot --tail 50
```

## Architecture

- **Bot entrypoint**: `function_chat_bot/index.js` (HTTP handlers, CRON, rate limiting)
- **YDB wrapper**: `function_chat_bot/ydb_helper.js` — `getUser()`, `saveUser()`, `mergeUsers()`, `findUser()`
- **Channel handlers**: `function_chat_bot/src/platforms/telegram/`, `vk/`, `web_chat.js`
- **Database schema**: `function_chat_bot/ydb_schema.sql`
- **Bot tested on**: `src/utils/validator.js`, `pin.js`, `jwt_utils.js`, `ux_helpers.js`, `channel_manager.js`, `ttl_cache.js`

## Critical Bug Fix (still relevant)

`ydb_helper.js` had a validation bug blocking multi-channel user_ids containing `:` (e.g. `email:user@gmail.com`, `vk:123`, `web:<uuid>`). Fixed by adding `isValidUserId()` at line 11. If validation errors appear in logs, check this first.

## Key Constants

```
RATE_LIMIT_MAX = 60 req/min
CRON_MAX_USERS_PER_RUN = 200
DOZHIM_DELAY_HOURS = 20
PRODUCT_ID_FREE = "140_9d5d2"
PRODUCT_ID_PRO = "103_97999"
MAX_RETRIES = 3
MAX_RETRY_DELAY_SEC = 10
```

## User ID Format (v5.0+ Multi-Channel)

```
telegram:<numeric_id>  or just numeric for Telegram
vk:<numeric_id>        or just numeric for VK
email:user@gmail.com
web:<uuid>
Pure UUID for internal primary key
```

## Omni-channel Merge Flow

1. User arrives via any channel
2. If email known → `findUser({ email })`
3. If exists → `mergeUsers(existing, new, "web_form_merge")`
4. Old record gets `session.merged_to: <primary_id>`

## Log Patterns

- `[WEB LEAD] getUser result, found: false` → new user, will call `saveUser`
- `[WEB LEAD] Saved email user to YDB` → success
- `[YDB] Invalid user_id format` → validation failing (check `isValidUserId`)
- `[YDB NOT AVAILABLE]` → connection or deployment issue

## Existing Instruction Files (read these first)

- `DEPLOY_GUIDE.md` — full deploy procedure (YDB, Telegram, VK, Postbox, website, CRON)
- `AI_CONTEXT_BRIEF.md` — architecture and design decisions
- `QWEN.md` — additional context for Qwen models