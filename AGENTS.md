# NeuroGen Platform — Agent Guide

## Packages

| Package | Purpose | Node | Branch |
|---------|---------|------|--------|
| `function_chat_bot/` | Yandex Cloud Serverless Function (Telegram + VK + Email + Web bot) | ≥20 (ESM) | — |
| `sethubble.ru/` | Blog/marketing site (Eleventy 3 + Tailwind 4) | ≥18 (`.nvmrc`: 20) | `main` |
| `neuro-gen.ru/` | SaaS landing pages (Eleventy 3, no Tailwind) | ≥18 | `master` |

`function_chat_bot/` is tracked by the **parent repo** (`git@github.com:Novokreschennih/neurogen-platform.git`). `sethubble.ru/` and `neuro-gen.ru/` are truly independent nested repos with their own `.git/` and CI.

## Commands

```bash
# Bot: syntax check / test / deploy
cd function_chat_bot
npm run check          # node --check index.js
npm test               # node tests/run.js (custom runner, no deps)
npm run deploy         # zip -r function.zip . (excludes node_modules, .git, .env, *.md, знания/*)

# sethubble.ru (blog + Tailwind)
cd sethubble.ru
npm run build          # tailwindcss → src/css/style.css, then eleventy → _site/
npm start              # tailwindcss --watch + eleventy --serve
npm run debug          # DEBUG=Eleventy* build

# neuro-gen.ru (plain Eleventy)
cd neuro-gen.ru
npm run build          # eleventy → _site/
npm start              # eleventy --serve --quiet
```

## Architecture — function_chat_bot

- **Entrypoint**: `index.js` — exports `handler` for YC Functions, routes `?action=web-chat|cron|health|...` and `/webhook`
- **YDB**: `ydb_helper.js` — getUser/saveUser/mergeUsers/findUser/partialUpdateUser/getBotInfo/getOwnerAiStatus; uses LRU caches for botInfo (5min), ownerAi (1min), partner (5min), ownerSettings (5min)
- **AI**: `ai_engine.js` — OpenRouter/Polza API (default model: `deepseek/deepseek-v4-flash`)
- **Schema**: `ydb_schema.sql` (auto-migrations on init via `src/utils/db_migrations.js`)
- **Source layout**: `src/core/{channels,email,http_handlers,omni_resolver.js}`, `src/platforms/{telegram,vk}/`, `src/scenarios/`, `src/utils/`
- **All state in YDB** — never store state in function memory
- **Graceful degradation** — never crashes on YDB errors, returns `{success: false}`
- **Cold starts expected** — YDB init cached via `dbInitPromise` per instance
- **Tests**: single file `tests/run.js` — custom runner, no deps, covers validator, retry, JWT, pin, TTL cache. Scenarios and channel handlers are **not** tested.

## YDB Gotchas

- **Pool: `maxLimit: 2`** — serverless tuning. Don't increase blindly; YDB serverless has connection limits.
- **`RESOURCE_EXHAUSTED`** — YDB throttle. `saveUser()` retries 5× (1s→2s→4s→8s→16s). If all fail, returns `{success: false}`. Prefer `partialUpdateUser()` for lightweight field changes.
- **`driverInitialized`** is exported from `ydb_helper.js` and used in health check (`index.js:1036`).

## Critical Rules

- **`JWT_SECRET` must NOT match `BOT_TOKEN`** — security vulnerability
- **Postbox SA role**: `postbox.sender` (NOT `postbox.messageCreator`)
- **Deploy archive excludes `node_modules`** — YC runs `npm install` at runtime
- **User ID formats**: `telegram:<id>` | `vk:<id>` | `email:xxx` | `web:<uuid>` | bare UUID (internal). Validated by `isValidUserId()` in `ydb_helper.js`
- **Telegram messages use `protect_content: true`** — prevents forwarding (set in `sendStepViaTelegram`)

## CI / Deploy

| Site | Branch | Target | Method |
|------|--------|--------|--------|
| sethubble.ru | `main` | YC S3 `sethubble.ru` | GitHub Actions → s3-sync |
| neuro-gen.ru | `master` | YC S3 `neuro-gen.ru` | GitHub Actions → s3-sync |
| function_chat_bot | manual | YC Functions | `npm run deploy` → upload `function.zip` |

- S3 secrets: `YC_KEY_ID`, `YC_SECRET_KEY` (GitHub repo settings, not in code)
- Bot deploy: Node.js 20 runtime, `index.handler`, 512MB, 30s timeout, ~50 env vars from `ENV_TEMPLATE.txt`
- Telegram webhook: `https://<API_GW_HOST>/webhook`
- VK Callback: `https://<API_GW_HOST>/?action=vk-webhook`
- CRON trigger: `0 */1 * * *` with body `{"action":"cron"}`

## sethubble.ru Quirks

- **CI skips Tailwind build** — `deploy.yml` runs only `npx @11ty/eleventy`, not `npm run build`. `src/css/style.css` is committed. If you change Tailwind classes, rebuild locally (`npm run build`) and commit the updated `style.css` or the deployed site will be stale.
- Draft filtering: `draft: true` hides posts in production (`ELEVENTY_ENV=production` or `NODE_ENV=production`)
- HTML minification active only in production builds
- Image shortcode generates WebP + JPEG with lightbox wrapper
- Two RSS feeds: `/feed/feed.xml` (blog), `/feed/news.xml` (news)
- CI uses Node 18; `.nvmrc` says 20 — local dev should use 20

## neuro-gen.ru Quirks

- No Tailwind, no tests, no linter — verify changes visually via `npm start`
- Pages: `join.njk`, `promo-kit.njk`, `crm.njk`, `crm-demo.njk`, `ai.njk`, `qr2pdf.njk`, `verify.njk`, `go-polza.html`
- `src/_redirects` — Netlify-style redirects file, copied to output root
- CI uses Node 20; default branch is `master` (not `main`)
- Has its own `AGENTS.md` with subproject-specific details

## Key Constants (function_chat_bot)

```
AI_FREE_LIMIT=3   AI_PRO_LIMIT=30   DOZHIM_DELAY_HOURS=20
RATE_LIMIT_MAX=60 req/min per IP    BROADCAST_RATE_LIMIT=30
CRON_MAX_USERS_PER_RUN=200          CRON_STALE_HOURS=1
MAX_RETRIES=2   MAX_RETRY_DELAY_SEC=10   WEBHOOK_RETRY_DELAYS=5000,30000
PRODUCT_ID_FREE="140_9d5d2" (25%)   PRODUCT_ID_PRO="103_97999" (50%)
```

## Existing Instruction Files

- `function_chat_bot/QWEN.md` — comprehensive project docs (589 lines)
- `function_chat_bot/PROJECT_STRUCTURE.md` — directory tree
- `function_chat_bot/ENV_TEMPLATE.txt` — all ~50 env vars
- `neuro-gen.ru/AGENTS.md` — subproject-specific guide
- `sethubble.ru/QWEN.md` — blog project docs
- `QWEN.md` (root) — platform overview and architecture
