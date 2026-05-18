# NeuroGen Platform — Agent Guide

## Packages

- `function_chat_bot/` — Yandex Cloud Serverless Function (Node ≥20, ESM, entry: `index.handler`)
- `website/` — Eleventy 3.x static site with Tailwind 4 (Node ≥18)
- `tools/` — Standalone HTML tools (no build): CRM dashboard, demo, promo kit

## Commands

```bash
# Bot: syntax check / test / deploy
cd function_chat_bot
npm run check          # node --check index.js
npm test              # node tests/run.js (custom runner, no deps)
npm run deploy         # zip -r function.zip . (NO node_modules — YC runs npm install)

# Website: build / dev
cd website
npm run build         # tailwindcss + eleventy → _site/
npm start             # tailwindcss --watch + eleventy --serve
npm run build-ghpages # build with path prefix for GitHub Pages
npm run debug         # DEBUG=Eleventy* build

# View bot logs (Yandex Cloud)
yc serverless function logs --function-name sethubble-bot --tail 50
```

## Architecture

- **Bot entrypoint**: `function_chat_bot/index.js` — exports `handler` for YC Functions, routes HTTP actions (`/webhook`, `?action=web-chat|cron|health|...`)
- **YDB wrapper**: `function_chat_bot/ydb_helper.js` — `getUser()`, `saveUser()`, `mergeUsers()`, `findUser()`, `partialUpdateUser()`, `getBotInfo()`, `getOwnerAiStatus()`
- **AI engine**: `function_chat_bot/ai_engine.js` — OpenRouter API (default: `deepseek/deepseek-v3.2`)
- **Channel handlers**: `src/platforms/telegram/`, `src/platforms/vk/`, `src/core/http_handlers/web_chat.js`
- **HTTP handlers**: `src/core/http_handlers/` — `web_chat.js`, `crm_api.js`, `app_auth.js`, `payment_webhook.js`, `cron_jobs.js`, `partner_api.js`
- **Database schema**: `function_chat_bot/ydb_schema.sql` (auto-migrations on init)
- **Core modules**: `src/core/omni_resolver.js`, `src/core/channels/channel_manager.js`, `src/core/email/email_service.js`
- **Utils**: `src/utils/validator.js`, `logger.js`, `pin.js`, `jwt_utils.js`, `retry.js`, `ttl_cache.js`, `ux_helpers.js`, `vk_photo_cache.js`, `webhook_retry.js`, `db_migrations.js`
- **Tested modules**: `validator.js`, `pin.js`, `jwt_utils.js`, `ux_helpers.js`, `channel_manager.js`, `ttl_cache.js`, `vk_photo_cache.js`, `webhook_retry.js`, `db_migrations.js`

## Critical Rules

- **`JWT_SECRET` must NOT match `BOT_TOKEN`** — security vulnerability if they do
- **Postbox SA role**: `postbox.sender` (NOT `postbox.messageCreator`)
- **Deploy archive excludes `node_modules`** — Yandex Cloud runs `npm install` from `package.json` at deploy time
- **Cold starts expected** — serverless function, YDB init cached via `dbInitPromise` per instance
- **All state in YDB** — never store state in function memory
- **Graceful degradation** — function never crashes on YDB errors, returns `{success: false}`

## User ID Format (v5.0 Multi-Channel)

| Channel    | User ID format                    | Notes                        |
|------------|-----------------------------------|------------------------------|
| Telegram   | numeric string (e.g. `6278976865`) | or `telegram:<id>`           |
| VK         | `vk:<numeric_id>`                 |                              |
| Email      | `email:user@gmail.com`            |                              |
| Web        | `web:<uuid>`                      |                              |
| Internal   | bare UUID                         | primary key in YDB           |

`isValidUserId()` in `ydb_helper.js:18` validates all formats. If `[YDB] Invalid user_id format` appears in logs, check this first.

## Key Constants

```
RATE_LIMIT_MAX = 60 req/min per IP
CRON_MAX_USERS_PER_RUN = 200
DOZHIM_DELAY_HOURS = 20
PRODUCT_ID_FREE = "140_9d5d2"   (25% commission)
PRODUCT_ID_PRO = "103_97999"    (50% commission)
MAX_RETRIES = 2
MAX_RETRY_DELAY_SEC = 10
WEBHOOK_RETRY_DELAYS = 5000,30000
UPDATE_TTL_MS = 300000
CRON_STALE_HOURS = 1
CRON_USER_PAUSE_MS = 35
CRON_BROADCAST_PAUSE_SEC = 1
AI_FREE_LIMIT = 3
AI_PRO_LIMIT = 30
BROADCAST_RATE_LIMIT = 30
```

## Omni-channel Merge Flow

1. User arrives via any channel → email captured
2. If email known → `findUser({ email })` finds `email:xxx` record
3. If exists → `mergeUsers(existing, new, "web_form_merge")`
4. Old record gets `session.merged_to: <primary_id>` and is skipped by CRON

## Log Patterns

- `[WEB LEAD] getUser result, found: false` → new user, will call `saveUser`
- `[WEB LEAD] Saved email user to YDB` → success
- `[YDB] Invalid user_id format` → validation failing (check `isValidUserId`)
- `[YDB NOT AVAILABLE]` → connection or deployment issue
- `[CRON] Processing inactive users` → CRON trigger fired

## Deploy Checklist (high-level)

1. YDB created, schema applied (auto-migrations run on init)
2. Service Account with roles: `serverless.functions.invoker`, `ydb.data.editor`, `postbox.sender`
3. SA attached to Cloud Function
4. `npm run check` → exit 0, then `npm run deploy` → `function.zip`
5. Upload to YC Functions: Node.js 20, `index.handler`, 512MB, 30s timeout
6. Set env vars from `ENV_TEMPLATE.txt` (~50 variables)
7. Create API Gateway, set `API_GW_HOST`
8. Telegram webhook: `https://<API_GW_HOST>/webhook`
9. VK Callback API: `https://<API_GW_HOST>/?action=vk-webhook`
10. CRON trigger: `0 */1 * * *` with body `{"action":"cron"}`

Full procedure: `DEPLOY_GUIDE.md`

## Existing Instruction Files

- `DEPLOY_GUIDE.md` — full deploy procedure (YDB, Telegram, VK, Postbox, website, CRON)
- `AI_CONTEXT_BRIEF.md` — architecture and design decisions, known bugs
- `QWEN.md` — complete project documentation (589 lines, most comprehensive)