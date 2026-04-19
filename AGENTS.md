# NeuroGen Platform - Agent Operating Guide

## ⚠️ CRITICAL BUG FIXES APPLIED

### Email Confirmation & Delivery Issues (Fixed)
- **Root Cause**: `ydb_helper.js` `getUser()` and `saveUser()` blocked all multi-channel user_ids with `:` in validation
- **Fix Applied**: Added `isValidUserId()` function that properly validates `email:`, `vk:`, `web:`, `telegram:` prefixed IDs
- **Affected Files**: `function_chat_bot/ydb_helper.js` (line 11 - `isValidUserId` function)

### Channel Overwrite Issue (Fixed)  
- **Root Cause**: Web form saves created new users instead of merging with existing channel data
- **Fix Applied**: `web_chat.js` uses `mergeUsers()` for email form submissions when user with email already exists
- **Affected Files**: `function_chat_bot/src/core/http_handlers/web_chat.js` (lines 197-207)

## 📋 ARCHITECTURE ESSENTIALS

### Database Schema
- **Primary Key**: UUID `id` (not numeric Telegram ID)
- **Channel Columns**: `tg_id`, `vk_id`, `web_id`, `email` (all nullable)
- **Session JSON**: Contains `channels`, `channel_states`, `merged_to`, `dialog_history`
- **Key Indexes**: `email`, `tg_id`, `vk_id`, `web_id`, `bot_token` (all GLOBAL)

### User ID Format (v5.0+ Multi-Channel)
- `telegram:<numeric_id>` or just numeric for Telegram
- `vk:<numeric_id>` or just numeric for VK  
- `email:user@gmail.com` for email-based IDs
- `web:<uuid>` for web sessions
- Pure UUIDs for internal primary key

### Omnichannel Merge Flow
1. User arrives via any channel (TG/VK/Web/Email)
2. If email known → search `user_id: "email:user@gmail.com"`
3. `mergeUsers(surviving, deleted)` transfers all data to primary TG record
4. Old record gets `session.merged_to: <primary_id>`
5. Result: ONE user row with multiple channels enabled

## 🚨 CRITICAL FILES

### Core User Management
- `function_chat_bot/ydb_helper.js` - YDB wrapper, `isValidUserId()`, `getUser()`, `saveUser()`, `mergeUsers()`, `findUser()`
- `function_chat_bot/index.js` - Entry point, HTTP handlers, CRON, rate limiting
- `function_chat_bot/src/core/http_handlers/web_chat.js` - Web/email lead capture

### Database Schema
- `function_chat_bot/ydb_schema.sql` - Tables: users, bots, link_clicks

### Channel Handlers
- `function_chat_bot/src/platforms/telegram/telegram_setup.js` - Telegram webhook
- `function_chat_bot/src/platforms/vk/vk_handler.js` - VK callback API  
- `function_chat_bot/src/core/http_handlers/web_chat.js` - Web + Email handler

## 📝 DEPLOYMENT COMMANDS

```bash
# Deploy function
cd function_chat_bot && npm run deploy

# Check syntax
cd function_chat_bot && npm run check

# View logs (debug email/issue)
yc serverless function logs --function-name sethubble-bot --tail 50 | grep "WEB LEAD"

# Test endpoint
curl -X POST "https://<API_GW_HOST>/?action=web-chat" \
  -H "Content-Type: application/json" \
  -d '{"isEmail":true,"email":"test@test.com","partner_id":"p_qdr"}'
```

## 🔍 KEY LOG PATTERNS

### Successful Email Processing
- `[WEB LEAD] getUser result, found: false` → calls `saveUser`
- `[WEB LEAD] Saved email user to YDB` → success!
- `[MERGE] Merging channels...` → channel unification

### Error Patterns  
- `[YDB] Invalid user_id format` → validation failing (check `isValidUserId`)
- `[YDB NOT AVAILABLE]` → connection issue
- `[WEB LEAD] YDB NOT AVAILABLE` → deployment needed

## ⚙️ IMPORTANT CONSTANTS

```javascript
// Rate limiting
RATE_LIMIT_MAX = 60 requests/minute
CRON_MAX_USERS_PER_RUN = 200 users
DOZHIM_DELAY_HOURS = 20 hours (initial)

// Products
PRODUCT_ID_FREE = "140_9d5d2"
PRODUCT_ID_PRO = "103_97999"

// Retry logic
MAX_RETRIES = 3
MAX_RETRY_DELAY_SEC = 10
```

## 🎯 VALIDATION RULES

### Email Processing (web_chat.js line 188-223)
1. Validate email format
2. `findUser({ email })` - check existing
3. If exists → `mergeUsers(existingEmailUser, webUser.id, "web_form_merge")`
4. If new → `saveUser(webUser)` with email channel enabled
5. Return `{success: true}`

### Multi-Channel User Record
```json
{
  "id": "primary-uuid",
  "email": "user@gmail.com",
  "tg_id": 123456789,
  "vk_id": 987654321,
  "web_id": "abc-uuid-123",
  "session": {
    "channels": {
      "telegram": {"enabled": true},
      "vk": {"enabled": true},
      "web": {"enabled": true},
      "email": {"enabled": true, "subscribed": true}
    },
    "channel_states": {...},
    "merged_to": "123456789"
  }
}
```
