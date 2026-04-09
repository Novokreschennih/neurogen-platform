# NeuroGen Platform (SetHubble) — Project Documentation

## Overview

**NeuroGen Platform** (aka **SetHubble**) — SaaS platform for Telegram/VK bots with AI consultant and automated sales funnel. Runs on Yandex Cloud serverless functions with YDB as database.

### Version
- **Bot:** 4.3.2 (moving to 5.0 — multi-channel)
- **License:** MIT

---

## Architecture

```
neurogen-platform/
├── function_chat_bot/
│   ├── index.js                # Entry point: bot setup, HTTP handlers, CRON
│   ├── ai_engine.js            # AI engine: response generation, emotion analysis
│   ├── ydb_helper.js           # YDB SDK wrapper
│   ├── ydb_schema.sql          # Database schema
│   ├── ENV_TEMPLATE.txt        # Environment variables template
│   └── src/
│       ├── core/
│       │   ├── http_handlers/  # HTTP endpoints (web-chat, CRM API, payments, CRON, partner)
│       │   ├── email/          # Email service (Yandex Cloud Postbox)
│       │   └── channels/       # Channel manager (multi-channel orchestration)
│       ├── platforms/          # Platform handlers (Telegram, VK)
│       ├── scenarios/          # Funnel scenarios (tg, vk, common)
│       │   ├── common/         # Shared: texts.js, step_meta.js, get_links.js, constants.js
│       │   ├── telegram/       # Telegram buttons + actions
│       │   └── vk/             # VK buttons + handler
│       └── utils/              # Utils (logger, retry, JWT, PIN, cache)
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
        ├── ai.njk              # AI tools page (full funnel)
        └── join.njk            # Registration/referral page
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Bot backend** | Node.js 20+, ES Modules |
| **Telegram** | Telegraf 4.x |
| **VK** | VK Callback API (direct HTTP webhook) |
| **Database** | Yandex Database (YDB) |
| **AI engine** | OpenRouter API (DeepSeek v3.2 default) |
| **Payments** | SetHubble (crypto gateway: USDT, BTC, ETH, TON) |
| **Email** | Yandex Cloud Postbox (HTTP API) |
| **Site** | Eleventy 3.x (Nunjucks, Markdown) |
| **Deploy** | Yandex Cloud Functions + API Gateway |

---

## Multi-Channel Architecture (v5.0)

### Channels
| Channel | Status | User ID prefix | Sending method |
|---------|--------|---------------|----------------|
| **Telegram** | ✅ Full | `user_id` (numeric) | Telegraf `sendMessage` |
| **VK** | 🔄 Partial | `vk:${userId}` | VK API `messages.send` |
| **Website** | ❌ Stateless | `web:${uuid}` | Push notification / email |
| **Email** | ❌ New | email address | Yandex Postbox API |

### Session JSON Structure (no DB migration needed)

All channel data stored in existing `session` JSON column:

```jsonc
{
  "dialog_history": [...],
  "tags": [],
  // NEW — Multi-channel:
  "email": "user@example.com",
  "email_verified": false,
  "channels": {
    "telegram": {
      "enabled": true,
      "sh_user_id": "123",
      "sh_ref_tail": "p_xxx",
      "bot_token": "123456:ABC...",
      "bot_username": "my_bot",
      "configured": true,
      "configured_at": 1712345678000
    },
    "vk": {
      "enabled": false,
      "group_id": "",
      "configured": false
    },
    "web": {
      "enabled": false,
      "session_id": ""
    },
    "email": {
      "enabled": false,
      "subscribed": false,
      "last_sent": 0
    }
  },
  "channel_states": {
    "telegram": "Module_1_Strategy",
    "vk": "START",
    "web": "START",
    "email": "START"
  }
}
```

### How It Works

1. User lands on `/join` or `/ai` → enters email
2. Chooses channel(s): Telegram / VK / Website / Email
3. Goes through simplified setup per channel (3-4 steps)
4. After completing one channel → prompted to enable others
5. All channels share the same funnel steps but track state independently
6. CRON/dozhim reaches users via their enabled channels
7. CRM shows all leads with channel badges, supports cross-channel broadcast

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
- **Partner system** — referral links, up to 10 levels deep
- **Retry logic** — exponential backoff on 429
- **TTL cache** — deduplication of processed update_id

#### HTTP Endpoints

| Handler | Purpose |
|---------|---------|
| `web_chat.js` | AI chat via website widget |
| `crm_api.js` | CRM API for dashboard (stats, users, broadcasts) |
| `app_auth.js` | JWT auth for NeuroGen Apps |
| `payment_webhook.js` | SetHubble payment webhooks |
| `cron_jobs.js` | CRON: follow-ups, reminders, training |
| `partner_api.js` | Partner referral API |

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

# Multi-channel (NEW v5.0)
YANDEX_CLOUD_API_KEY=               # YC API key for Postbox (role: postbox.messageCreator)
YANDEX_CLOUD_FOLDER_ID=             # YC folder ID containing Postbox
POSTBOX_FROM_EMAIL=noreply@yourdomain.com  # Verified Postbox identity
POSTBOX_FROM_NAME=NeuroGen          # Sender display name
VK_SERVICE_TOKEN=                   # VK community service token (for bot clones)
VK_CENTRAL_GROUP=                   # VK central community ID

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

# Create deploy archive (function.zip)
npm run deploy
```

### 2. Email Service — Yandex Cloud Postbox

**Authentication:** API key with role `postbox.messageCreator`

**Endpoint:** `https://postbox.api.cloud.yandex.net/postbox/v1/messages:send`

**API Request format:**

```bash
curl -X POST \
  https://postbox.api.cloud.yandex.net/postbox/v1/messages:send \
  -H "Authorization: Api-Key <YC_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "folderId": "<FOLDER_ID>",
    "messages": [
      {
        "to": [{ "email": "test@example.com" }],
        "from": { "email": "noreply@yourdomain.com" },
        "subject": "Test Message",
        "text": "Plain text version",
        "html": "<p>HTML version</p>"
      }
    ]
  }'
```

**Node.js integration:**

```javascript
async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.YANDEX_CLOUD_API_KEY;
  const folderId = process.env.YANDEX_CLOUD_FOLDER_ID;
  const fromEmail = process.env.POSTBOX_FROM_EMAIL;
  const fromName = process.env.POSTBOX_FROM_NAME || "NeuroGen";

  const response = await fetch(
    "https://postbox.api.cloud.yandex.net/postbox/v1/messages:send",
    {
      method: "POST",
      headers: {
        "Authorization": `Api-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderId,
        messages: [{
          to: [{ email: to }],
          from: { email: fromEmail, name: fromName },
          subject,
          text,
          html,
        }],
      }),
    },
  );
  return response.json();
}
```

**Limits:** Check Yandex Cloud console for current TPS and daily limits. Design CRON batches accordingly.

**DNS setup required:**
- SPF: `v=spf1 include:_spf.yandex.net ~all`
- DKIM: TXT record at `_yandex-postbox._domainkey`

### 3. `tools/` — HTML Tools

Standalone HTML files (no build, inline CSS/JS):

| File | Purpose |
|------|---------|
| `crm_dashboard.html` | Full CRM for bot owners |
| `crm_demo.html` | Demo for FREE users (read-only) |
| `promo-kit-v2.html` | Promo materials and landing pages |

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
- `src/ai.njk` — AI tools page (full funnel v5.0)
- `src/join.njk` — registration/referral page

#### Features

- **Draft protection** — drafts (`draft: true`) not published in production
- **RSS feeds** — `/feed/feed.xml` (blog) and `/feed/news.xml` (news)
- **Image optimization** — auto-generate WebP + JPEG via `@11ty/eleventy-img`
- **Minification** — HTML/CSS/JS compressed in production only
- **Search** — Fuse.js for full-text client-side search

---

## Database (YDB)

### Tables

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `users` | All users across all bots | `user_id` (string) |
| `bots` | Partner bot info | `bot_token` |
| `link_clicks` | Referral link click analytics | `(partner_id, clicked_at, user_id)` |

### Indexes

- `idx_users_bot_token` — search by bot token
- `idx_users_partner_id` — search by partner tail
- `idx_users_bought_tripwire` — search by payment status
- `idx_users_last_seen` — search by last visit time (for CRON)

### Migrations (v4.3+)

```sql
-- v4.3.1: Add PIN code
ALTER TABLE users ADD COLUMN pin_code Utf8;

-- v4.3.2: Add session version (race condition protection)
ALTER TABLE users ADD COLUMN session_version Uint64;
```

**Note v5.0:** No schema changes needed for multi-channel. All channel data goes into `session` JSON.

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
- **⚠️ Critical:** `JWT_SECRET` must NOT match `BOT_TOKEN`

---

## Error Handling

| Error | Behavior |
|-------|----------|
| **429 (Rate Limit)** | Exponential backoff, max `MAX_RETRIES` attempts |
| **403 (Blocked)** | Log, mark user as inactive |
| **Network errors** | Log, function doesn't crash |
| **YDB errors** | Return `null` for reads, `{success: false}` for writes |

---

## Serverless Architecture Notes

- **Cold start** — expected on function cold start
- **State in YDB** — all state in DB, not in memory
- **Limits** — CRON limited by users per run (`CRON_MAX_USERS_PER_RUN`)
- **Batch processing** — users processed in batches with configurable pauses

---

## Implementation Plan (v5.0 — Multi-Channel)

### Phase 1: Infrastructure
1. **Email service** (`src/core/email/email_service.js`) — Postbox API integration
2. **Channel manager** (`src/core/channels/channel_manager.js`) — read/write channel configs from session
3. **Update ENV_TEMPLATE.txt** — add Postbox + VK variables

### Phase 2: VK Full Integration
4. **Enhance VK handler** — complete funnel, keyword commands, CRON reachability
5. **Extend sendStepToUser** — support VK channel in index.js
6. **Update VK buttons** — add channel selection buttons

### Phase 3: Website Funnel
7. **Web chat persistence** — save web users to YDB (`web_chat.js`)
8. **Full funnel on /ai.njk** — email capture → channel selection → setup → training → offer
9. **Update /join.njk** — add VK + Email options to modal

### Phase 4: Multi-Channel CRM
10. **CRM API updates** — multi-channel filtering, stats
11. **CRM dashboard updates** — channel badges, filters, multi-channel broadcast
12. **CRON jobs update** — multi-channel dozhim/reminders (TG + VK + email)
13. **Shared texts update** — add multi-channel setup module texts
