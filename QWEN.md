# NeuroGen Platform (SetHubble) — Project Documentation

## Overview

**NeuroGen Platform** (aka **SetHubble**) — SaaS platform for Telegram/VK bots with AI consultant and automated sales funnel. Runs on Yandex Cloud serverless functions with YDB as database.

### Version

- **Bot:** 5.0 — Multi-Channel (Telegram + VK + Web + Email)
- **License:** MIT

---

## Architecture

```
neurogen-platform/
├── function_chat_bot/
│   ├── index.js                # Entry point: bot setup, HTTP handlers, CRON, rate limiting, API versioning
│   ├── ai_engine.js            # AI engine: response generation, emotion analysis
│   ├── ydb_helper.js           # YDB SDK wrapper + auto migrations
│   ├── ydb_schema.sql          # Database schema
│   ├── ENV_TEMPLATE.txt        # Environment variables template
│   └── src/
│       ├── core/
│       │   ├── http_handlers/  # HTTP endpoints (web-chat, CRM API, payments, CRON, partner)
│       │   ├── email/          # Email service (Yandex Cloud Postbox API v2 + AWS SigV4)
│       │   └── channels/       # Channel manager (multi-channel orchestration)
│       ├── platforms/          # Platform handlers (Telegram, VK)
│       ├── scenarios/          # Funnel scenarios (tg, vk, common)
│       │   ├── common/         # Shared: texts.js, step_meta.js, get_links.js, constants.js
│       │   ├── telegram/       # Telegram buttons + actions
│       │   └── vk/             # VK buttons + handler
│       └── utils/              # Utils (validator, logger, retry, webhook_retry, JWT, PIN, cache, db_migrations)
├── tools/
│   ├── crm_dashboard.html      # CRM dashboard for bot owners
│   ├── crm_demo.html           # Demo CRM (for FREE users)
│   └── promo-kit-v2.html       # Promo materials
└── website/                    # Marketing site / blog (Eleventy SSG)
    ├── eleventy.config.js
    └── src/
        ├── content/blog/       # Blog articles
        ├── content/news/       # Platform news
        ├── content/academy/    # Academy modules
        ├── ai.njk              # AI tools page (full funnel v5.0, skips email if returning user)
        └── join.njk            # Registration/referral page (multi-channel, partner_id encoding)
```

---

## Tech Stack

| Component       | Technology                                       |
| --------------- | ------------------------------------------------ |
| **Bot backend** | Node.js 20+, ES Modules                          |
| **Telegram**    | Telegraf 4.x                                     |
| **VK**          | VK Callback API (direct HTTP webhook)            |
| **Database**    | Yandex Database (YDB)                            |
| **AI engine**   | OpenRouter API (DeepSeek v3.2 default)           |
| **Payments**    | SetHubble (crypto gateway: USDT, BTC, ETH, TON)  |
| **Email**       | Yandex Cloud Postbox API **v2** (AWS SigV4 auth) |
| **Site**        | Eleventy 3.x (Nunjucks, Markdown)                |
| **Deploy**      | Yandex Cloud Functions + API Gateway             |

---

## Multi-Channel Architecture (v5.0)

### Channels

| Channel      | Status  | User ID prefix           | Sending method         |
| ------------ | ------- | ------------------------ | ---------------------- |
| **Telegram** | ✅ Full | `user_id` (numeric)      | Telegraf `sendMessage` |
| **VK**       | ✅ Full | `vk:${userId}`           | VK API `messages.send` |
| **Website**  | ✅ Full | `web:${uuid}`            | Web chat widget        |
| **Email**    | ✅ Full | `email:user@example.com` | Yandex Postbox API v2  |

### Channel Linking (v5.0)

All channels are linked through **email**:

```
/join/ → email → YDB: { user_id: "email:user@gmail.com", partner_id: "abc123" }
   ↓
Telegram: t.me/bot?start=abc123|base64encoded_email
   ↓
Bot decodes email → finds email:xxx record → MERGE → one user with all channels
   ↓
Result: { user_id: "123456789", partner_id: "abc123", session.email: "user@gmail.com",
          session.channels: { telegram: {...}, email: {...}, web: {...} } }
```

**MERGE logic:**

- **Telegram**: email encoded в start payload (`partnerId|encodedEmail`)
- **VK**: user types email → searches `email:xxx` → MERGE
- **Web**: user types email in chat → searches `email:xxx` → MERGE
- **CRON**: skips merged email records (`session.merged_to` exists)

### Session JSON Structure

All channel data stored in existing `session` JSON column:

```jsonc
{
  "dialog_history": [...],
  "tags": [],
  // Multi-channel:
  "email": "user@example.com",
  "email_verified": false,
  "channels": {
    "telegram": {
      "enabled": true,
      "configured": true,
      "bot_username": "my_bot",
      "linked_at": 1712345678000
    },
    "vk": {
      "enabled": false,
      "group_id": "",
      "configured": false
    },
    "web": {
      "enabled": true,
      "configured": true,
      "session_id": "web:uuid",
      "linked_at": 1712345678000
    },
    "email": {
      "enabled": true,
      "configured": true,
      "subscribed": true
    }
  },
  "channel_states": {
    "telegram": "START",
    "vk": "START",
    "web": "START",
    "email": "START"
  },
  // Channel merging:
  "merged_to": "123456789",     // for email-only records
  "merged_at": 1712345678000,    // timestamp of merge
  "email_record_id": "email:user@example.com"  // for web users
}
```

### How It Works

1. User lands on `/join/?page=partner_id` → enters email
2. Chooses channel: Telegram / VK / Website / Email
3. Partner_id encoded in URL: `hex(partner_id)` → decoded on client
4. Telegram deep link: `t.me/bot?start=partnerId|encodedEmail`
5. Bot decodes email → finds `email:xxx` record → **MERGE** → single user
6. All channels share same funnel, track state independently
7. Email templates are **personalized** — links only to connected channels
8. CRON/dozhim reaches users via their enabled channels
9. CRM shows all leads with channel badges, supports cross-channel broadcast

### Email Templates (Personalized)

| Template                                  | When                       | Personalization                           |
| ----------------------------------------- | -------------------------- | ----------------------------------------- |
| `welcome(user)`                           | Email captured on `/join/` | Links to connected channels + suggestions |
| `reminder(user, stepName)`                | 1-3h inactivity            | Links to connected channels only          |
| `followup(user, offerType)`               | 20h+ on payment            | Links + suggestions for missing channels  |
| `proPurchased(user)`                      | After PRO purchase         | Links to connected channels               |
| `verifyEmail(code)`                       | Email verification         | Code display                              |
| `channelSetupComplete(user, channelName)` | Channel configured         | All connected channels                    |
| `broadcast(user, message)`                | Admin broadcast            | Links to connected channels               |

---

## Components

### 1. `function_chat_bot/` — Main Bot

#### Key Features

- **AI consultant** — context-aware answers based on completed material + emotion analysis
- **Sales funnel** — multi-step onboarding with tripwire offer ($20 for PRO)
- **10-step follow-ups** — drip campaigns with escalating intervals (1h to 9 days)
- **Reminders** — auto-reminders via REMIND_MAP (1h, 3h, 24h, 48h)
- **CRON jobs** — inactive user processing, broadcasts, training
- **Multi-platform** — Telegram (primary) + VK (via webhooks)
- **CRM Web App** — dashboard for bot owners (analytics, broadcasts, management)
- **Partner system** — referral links, up to 10 levels deep, **any format** (not just `p_xxx`)
- **Channel linking** — all channels merged via email
- **Retry logic** — exponential backoff on 429
- **Webhook retries** — 5s → 30s if processing fails
- **TTL cache** — deduplication of processed update_id

#### HTTP Endpoints

| Handler              | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `web_chat.js`        | AI chat via website widget (validates partner_id, email)            |
| `crm_api.js`         | CRM API for dashboard (stats, users, broadcasts, **XSS protected**) |
| `app_auth.js`        | JWT auth for NeuroGen Apps                                          |
| `payment_webhook.js` | SetHubble payment webhooks                                          |
| `cron_jobs.js`       | CRON: follow-ups, reminders, training (skips merged records)        |
| `partner_api.js`     | Partner referral API                                                |

#### Health Check

```
GET ?action=health
→ {
  "status": "ok",
  "ydb": "ok" | "initializing",
  "uptime": 123.45,
  "memory": { "rss": 12345678, "heapUsed": 8765432, ... },
  "version": "5.0",
  "timestamp": 1712345678000
}
```

#### API Versioning

| Path          | Version | Notes                                 |
| ------------- | ------- | ------------------------------------- |
| `/api/v1/...` | v1      | Future API (with auth, rate limiting) |
| `/api/...`    | legacy  | Backward compatibility                |
| `/webhook`    | v0      | Telegram webhook (default)            |

Response header: `X-API-Version: v1`

#### Structured Logging

All logs include:

```jsonc
{
  "level": "INFO" | "WARN" | "ERROR",
  "msg": "User processed",
  "trace_id": "abc123def456",    // unique per request
  "timestamp": "2026-04-10T14:00:00.000Z",
  "userId": "123456789",
  "action": "/start"
}
```

#### Environment Variables

Full list in `ENV_TEMPLATE.txt`. Key ones:

```bash
# Required
BOT_TOKEN=                          # Telegram bot token
YDB_ENDPOINT=                       # YDB endpoint
YDB_DATABASE=                       # Database path
PRODUCT_ID_FREE=                    # Free product ID
PRODUCT_ID_PRO=                     # PRO product ID
SETHUBBLE_SECRET=                   # Payment webhook secret
JWT_SECRET=                         # ⚠️ JWT key (NOT BOT_TOKEN!)

# AI
OPENROUTER_API_KEY=                 # OpenRouter API key
AI_ENGINE_MODEL=deepseek/deepseek-v3.2
WEB_CHAT_MODEL=deepseek/deepseek-v3.2

# Multi-channel (v5.0)
YANDEX_CLOUD_FOLDER_ID=             # YC folder ID containing Postbox
POSTBOX_FROM_EMAIL=noreply@yourdomain.com  # Verified Postbox identity
POSTBOX_FROM_NAME=NeuroGen          # Sender display name
# Auth: IAM token (Cloud Functions) OR Static Access Key (external):
YANDEX_CLOUD_ACCESS_KEY_ID=         # Static access key ID (optional)
YANDEX_CLOUD_SECRET_KEY=            # Static access key secret (optional)
VK_GROUP_TOKEN=                     # VK group token for API
VK_SERVICE_TOKEN=                   # VK community service token (for bot clones)
VK_CENTRAL_GROUP=                   # VK central community ID

# Rate Limiting (v5.0)
RATE_LIMIT_MAX=60                   # HTTP requests per minute per IP
RATE_LIMIT_WINDOW_MS=60000          # Rate limit window in ms

# Webhook Retry (v5.0)
WEBHOOK_RETRY_DELAYS=5000,30000     # Retry delays in ms (5s, 30s)

# Optional
SUPABASE_URL=                       # Supabase for PIN generation
SUPABASE_SERVICE_KEY=
SYNC_KEY=                           # SalutBot sync key
CRM_ADMIN_IDS=                      # Global admin Telegram IDs
```

#### Commands

```bash
# Syntax check
npm run check

# Create deploy archive (function.zip — WITHOUT node_modules)
npm run deploy
```

### 2. Email Service — Yandex Cloud Postbox API **v2**

**Authentication:** AWS SigV4 (Static Access Key) **OR** IAM Token (Cloud Functions)

**Role:** `postbox.sender` (NOT `postbox.messageCreator`!)

**Endpoint:** `https://postbox.cloud.yandex.net/v2/email/outbound-emails`

**API Request format:**

```bash
curl \
  --request POST \
  --url 'https://postbox.cloud.yandex.net/v2/email/outbound-emails' \
  --header 'Content-Type: application/json' \
  --user "${ACCESS_KEY_ID}:${SECRET_KEY}" \
  --aws-sigv4 "aws:amz:ru-central1:ses" \
  --data-binary '{
    "FromEmailAddress": "noreply@sethubble.ru",
    "Destination": { "ToAddresses": ["user@gmail.com"] },
    "Content": {
      "Simple": {
        "Subject": { "Data": "Test", "Charset": "UTF-8" },
        "Body": {
          "Text": { "Data": "Plain text", "Charset": "UTF-8" },
          "Html": { "Data": "<p>HTML</p>", "Charset": "UTF-8" }
        }
      }
    }
  }'
```

**Node.js integration:**

```javascript
import { sendEmail, templates } from "./src/core/email/email_service.js";

// Send personalized welcome email
const user = {
  first_name: "Иван",
  partner_id: "abc123",
  session: { channels: { telegram: { enabled: true } } },
};
const tpl = templates.welcome(user);
await sendEmail({ to: "user@gmail.com", ...tpl });
```

**Limits:** Check Yandex Cloud console for current TPS and daily limits. Design CRON batches accordingly.

**DNS setup required:**

- SPF: `v=spf1 include:_spf.yandex.net ~all`
- DKIM: TXT record at `_yandex-postbox._domainkey`

### 3. `tools/` — HTML Tools

Standalone HTML files (no build, inline CSS/JS):

| File                 | Purpose                           |
| -------------------- | --------------------------------- |
| `crm_dashboard.html` | Full CRM for bot owners           |
| `crm_demo.html`      | Demo for FREE users (read-only)   |
| `promo-kit-v2.html`  | Promo materials and landing pages |

### 4. `website/` — Marketing Site

Static site generator based on [eleventy-base-blog v9](https://github.com/11ty/eleventy-base-blog).

#### Commands

```bash
npm start         # Dev server
npm run build     # Production build
npm run build-ghpages  # Build with path prefix for GitHub Pages
npm run debugstart     # Debug mode with verbose output
```

#### Content Structure

- `src/content/blog/` — blog articles (marketing, case studies, instructions)
- `src/content/news/` — platform news
- `src/content/academy/` — academy modules
- `src/ai.njk` — AI tools page (full funnel v5.0, skips email/channels for returning users)
- `src/join.njk` — registration/referral page (multi-channel, partner_id encoding)

#### Referral Flow (v5.0)

```
sethubble.ru/join/?page=hex(partner_id)
   ↓
join.njk decodes → partnerId (any format: abc, xyz, p_qdr, my_ref)
   ↓
User enters email → saved to localStorage (neurogen_email)
   ↓
User selects channel:
   - Telegram → t.me/bot?start=partnerId|base64(email)
   - VK       → vk.com/sethubble?ref=partnerId
   - Web      → /ai/?ref=partnerId
   - Email    → "Check your inbox" message
   ↓
Web user: /ai/?ref=partnerId → skips email/channel screens (already entered)
```

#### Features

- **Draft protection** — drafts (`draft: true`) not published in production
- **RSS feeds** — `/feed/feed.xml` (blog) and `/feed/news.xml` (news)
- **Image optimization** — auto-generate WebP + JPEG via `@11ty/eleventy-img`
- **Minification** — HTML/CSS/JS compressed in production only
- **Search** — Fuse.js for full-text client-side search

---

## Database (YDB)

### Tables

| Table         | Purpose                       | Primary Key                         |
| ------------- | ----------------------------- | ----------------------------------- |
| `users`       | All users across all bots     | `user_id` (string)                  |
| `bots`        | Partner bot info              | `bot_token`                         |
| `link_clicks` | Referral link click analytics | `(partner_id, clicked_at, user_id)` |

### Indexes

- `idx_users_bot_token` — search by bot token
- `idx_users_partner_id` — search by partner tail
- `idx_users_bought_tripwire` — search by payment status
- `idx_users_last_seen` — search by last visit time (for CRON)
- `idx_bots_vk_group_id` — search by VK group ID

### Migrations (Automatic — v5.0)

Migrations run automatically on YDB init:

```sql
-- v4.3.1: pin_code
ALTER TABLE users ADD COLUMN pin_code Utf8;

-- v4.3.2: session_version (race condition protection)
ALTER TABLE users ADD COLUMN session_version Uint64;

-- v5.0: vk_group_id
ALTER TABLE bots ADD COLUMN vk_group_id Utf8;
```

**Note:** All channel data goes into `session` JSON — no schema changes needed for multi-channel.

---

## Sales Funnel

### Main Stages

1. **START** → user enters bot
2. **Start_Choice** → role selection (Agent / Online / Offline)
3. **Training (FREE)** → 3 modules (strategy, online, offline)
4. **Offer_Tripwire** → PRO offer ($20 discounted, $40 full)
5. **Delivery_1** → PRO materials delivery
6. **PRO Training** → 4 advanced modules
7. **Rocket/Shuttle** → scaling tariff offers

### Follow-ups (Dozhim)

- **10 steps for Tripwire** — intervals from 50h to 216h (9 days)
- **10 steps for tariffs** — intervals from 20h to 216h
- **Dynamic intervals** — configurable via `DOZHIM_DELAY_HOURS` and `DOZHIM_MAP`

### Reminders

Auto-reminders at `1h, 3h, 24h, 48h` for key training steps (`REMIND_MAP`).

### Multi-Channel Extension (v5.0)

After completing setup for one channel, user is asked:

> "Want to also set up additional channels?"
>
> - [ ] VKontakte
> - [ ] Website chat widget
> - [ ] Email newsletter
> - [ ] Skip

Each channel is a mini-module of 3-4 steps. User progress tracked per-channel in `session.channel_states`.

---

## Security

- **Telegram initData validation** — HMAC-SHA256 signature check with 24h timeout
- **JWT authentication** — for CRM Web App and NeuroGen Apps
- **Global admins** — bypass bot ownership check via `CRM_ADMIN_IDS`
- **PRO verification** — bot owners need PRO status for CRM access
- **Race condition protection** — `session_version` for UPSERT operations
- **Input validation** — `validator.js` validates all incoming data (partner_id, email, callback_data, start payload)
- **XSS protection** — `escapeHtml()` on all user data in CRM API responses
- **Rate limiting** — `RATE_LIMIT_MAX=60` requests/min per IP
- **⚠️ Critical:** `JWT_SECRET` must NOT match `BOT_TOKEN`

---

## Error Handling

| Error                | Behavior                                                   |
| -------------------- | ---------------------------------------------------------- |
| **429 (Rate Limit)** | Exponential backoff, max `MAX_RETRIES` attempts            |
| **403 (Blocked)**    | Log, mark user as inactive                                 |
| **Network errors**   | Log, function doesn't crash                                |
| **YDB errors**       | Return `null` for reads, `{success: false}` for writes     |
| **Webhook fails**    | Retry: 5s → 30s, then return 500 (Telegram retries ~15min) |
| **Transient error**  | Return 500 → Telegram retries                              |
| **Permanent error**  | Return 200 → stops Telegram retries                        |

---

## Serverless Architecture Notes

- **Cold start** — expected on function cold start
- **State in YDB** — all state in DB, not in memory
- **Limits** — CRON limited by users per run (`CRON_MAX_USERS_PER_RUN`)
- **Batch processing** — users processed in batches with configurable pauses
- **Dependencies** — `npm install` runs automatically on YC Functions (no node_modules in archive)
- **Archive size** — ~158 KB (source code only, no node_modules)

---

## Reliability & Monitoring (v5.0)

### Health Check

```
GET ?action=health
→ { status: "ok", ydb: "ok", uptime: 123.45, memory: {...}, version: "5.0" }
```

### Trace ID

Every request gets a unique `trace_id` included in all log entries for debugging.

### Auto Migrations

DB schema migrations run automatically on YDB init — no manual ALTER TABLE needed.

### Webhook Retries

If processing fails (YDB unavailable, timeout), retries with backoff: 5s → 30s.

### Rate Limiting

HTTP endpoint rate limiting: 60 requests/min per IP (configurable via `RATE_LIMIT_MAX`).

---

## Implementation Plan (v5.0 — Multi-Channel)

### ✅ Phase 1: Infrastructure (DONE)

1. ✅ Email service — Postbox API v2 + AWS SigV4
2. ✅ Channel manager — read/write channel configs from session
3. ✅ ENV_TEMPLATE.txt — Postbox + VK variables
4. ✅ Input validation — `validator.js` (partner_id, email, callback_data)
5. ✅ XSS protection — `escapeHtml()` in CRM API

### ✅ Phase 2: VK Full Integration (DONE)

6. ✅ Enhanced VK handler — complete funnel, keyword commands, CRON reachability
7. ✅ sendStepToUser — support VK channel
8. ✅ VK buttons — channel selection buttons
9. ✅ VK email merge — when user types email → finds email:xxx record → MERGE

### ✅ Phase 3: Website Funnel (DONE)

10. ✅ Web chat persistence — save web users to YDB (`web_chat.js`)
11. ✅ Full funnel on /ai.njk — email capture → channel selection → setup → training → offer
12. ✅ /join.njk — multi-channel routing, partner_id encoding, localStorage skip for returning users
13. ✅ Web email merge — when user types email in chat → finds email:xxx → MERGE

### ✅ Phase 4: Multi-Channel CRM (DONE)

14. ✅ CRM API updates — multi-channel filtering, stats, XSS protection
15. ✅ CRM dashboard updates — channel badges, filters, multi-channel broadcast
16. ✅ CRON jobs update — multi-channel dozhim/reminders (TG + VK + email), skip merged records
17. ✅ Shared texts update — multi-channel setup module texts
18. ✅ Email templates — personalized per user's connected channels

### ✅ Phase 5: Reliability (DONE)

19. ✅ Health check endpoint
20. ✅ Structured logging with trace_id
21. ✅ Auto DB migrations
22. ✅ Webhook retries with backoff
23. ✅ API versioning (`/api/v1/`)
24. ✅ Rate limiting
