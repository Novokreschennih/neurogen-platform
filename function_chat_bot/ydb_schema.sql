-- ============================================================
-- YDB Schema для SaaS-платформы NeuroGen (Версия 6.0 — Омниканальность)
-- ============================================================
-- Ключевые изменения v6.0:
-- - Переход от префиксов в user_id (vk:, email:, web:) к UUID Primary Key
-- - Отдельные колонки для каждого канала: tg_id, vk_id, web_id, email
-- - Вторичные индексы для быстрого поиска по любому каналу
-- - Таблица user_merges для аудита слияний профилей
-- ============================================================

-- -------------------------------------------------------------
-- Таблица: users (пользователи)
-- -------------------------------------------------------------
-- Primary Key: id (UUID v4)
-- Индексы объявлены inline внутри CREATE TABLE (YDB требует так)

CREATE TABLE users (
    id Utf8,                        -- 🔑 Primary Key: UUID v4
    email Utf8,                     -- ⚡ Email (клей для объединения каналов)
    tg_id Uint64,                   -- ⚡ Telegram ID (только цифры)
    vk_id Uint64,                   -- ⚡ VK ID (только цифры)
    web_id Utf8,                    -- ⚡ Web session ID (cookie с лендинга)
    partner_id Utf8,                -- Реферальный хвост
    state Utf8,                     -- Текущий шаг воронки
    bought_tripwire Bool,           -- Куплен ли Tripwire/PRO
    session Json,                   -- JSON: dialog_history, tags, channel_states, XP
    last_seen Uint64,               -- Timestamp последнего действия (Unix ms)
    saved_state Utf8,               -- Сохранённая позиция для возврата
    bot_token Utf8,                 -- Токен бота
    tariff Utf8,                    -- "PAID" если оплачен тариф
    sh_user_id Utf8,                -- Цифровой ID в SetHubble
    sh_ref_tail Utf8,               -- Партнёрский хвост в SetHubble
    purchases Json,                 -- JSON массив купленных продуктов
    first_name Utf8,                -- Имя пользователя
    last_reminder_time Uint64,      -- Timestamp последнего напоминания
    reminders_count Uint64,         -- Счётчик отправленных напоминаний
    pin_code Utf8,                  -- 4-значный PIN для ИИ-приложений
    session_version Uint64,         -- Версия сессии (race condition protection)
    ai_active_until Uint64,         -- Timestamp TTL подписки ИИ-консультанта (0 = неактивна)
    created_at Uint64,              -- Timestamp создания (Unix ms)
    PRIMARY KEY (id),

    -- Вторичные индексы (inline — YDB требует внутри CREATE TABLE)
    INDEX idx_users_email GLOBAL ON (email),
    INDEX idx_users_tg_id GLOBAL ON (tg_id),
    INDEX idx_users_vk_id GLOBAL ON (vk_id),
    INDEX idx_users_web_id GLOBAL ON (web_id),
    INDEX idx_users_bot_token GLOBAL ON (bot_token),
    INDEX idx_users_partner_id GLOBAL ON (partner_id),
    INDEX idx_users_bought_tripwire GLOBAL ON (bought_tripwire),
    INDEX idx_users_last_seen GLOBAL ON (last_seen),
    INDEX idx_sh_user_id GLOBAL ON (sh_user_id)
);

-- -------------------------------------------------------------
-- Таблица: user_merges (аудит слияний профилей)
-- -------------------------------------------------------------
-- Append-only: только запись, никогда не обновляется

CREATE TABLE user_merges (
    id Utf8,                        -- 🔑 Primary Key: UUID операции слияния
    surviving_user_id Utf8,         -- ID основного пользователя (остался)
    deleted_user_id Utf8,           -- ID поглощённого пользователя (удалён)
    merge_reason Utf8,              -- Причина: email_match, web_merge, tg_merge, vk_merge, manual
    merged_at Uint64,               -- Timestamp слияния (Unix ms)
    deleted_session_backup Json,    -- Backup JSON удалённого профиля
    PRIMARY KEY (id)
);

-- -------------------------------------------------------------
-- Таблица: bots (информация о ботах партнёров)
-- v7.0: Добавлены AI-колонки для конструктора ИИ-сотрудников
-- -------------------------------------------------------------

CREATE TABLE bots (
    bot_token Utf8,              -- 🔑 Primary Key
    user_id Utf8,               -- Telegram ID владельца бота
    bot_username Utf8,          -- Username бота
    created_at Uint64,          -- Timestamp создания
    sh_user_id Utf8,            -- SetHubble User ID
    sh_ref_tail Utf8,           -- Партнёрский хвост
    tripwire_link Utf8,         -- Tripwire/PRO ссылка
    vk_group_id Utf8,          -- VK Group ID
    -- v7.0: AI-конструктор — настройки ИИ для партнёров
    ai_provider Utf8,           -- 'polza' или 'openrouter'
    ai_model Utf8,              -- модель, напр. 'openai/gpt-4o-mini'
    custom_api_key Utf8,        -- личный API-ключ партнёра
    custom_prompt Utf8,         -- кастомный системный промпт
    user_daily_limit Uint64,    -- дневной лимит на одного лида
    PRIMARY KEY (bot_token),

    INDEX idx_bots_vk_group_id GLOBAL ON (vk_group_id)
);

-- -------------------------------------------------------------
-- Таблица: processed_updates (защита от дублей webhook/Telegram update)
-- -------------------------------------------------------------
-- TTL-based deduplication: записи автоматически удаляются через TTL
-- TTL задаётся через expire_at timestamp

CREATE TABLE processed_updates (
    update_id Utf8,                   -- 🔑 Primary Key: update_id (строка)
    processed_at Uint64,             -- Timestamp обработки (Unix ms)
    expire_at Uint64,                 -- Timestamp TTL (Unix ms) — автоудаление
    PRIMARY KEY (update_id),

    INDEX idx_expire_at GLOBAL ON (expire_at)
);

-- -------------------------------------------------------------
-- Таблица: link_clicks (аналитика переходов)
-- -------------------------------------------------------------

CREATE TABLE link_clicks (
    partner_id Utf8,
    user_id Utf8,
    clicked_at Uint64,
    bot_token Utf8,
    PRIMARY KEY (partner_id, clicked_at, user_id)
);

-- -------------------------------------------------------------
-- Примеры запросов
-- -------------------------------------------------------------

-- Найти по UUID:
-- SELECT * FROM users WHERE id = "550e8400-e29b-41d4-a716-446655440000";

-- Найти по Telegram ID:
-- SELECT * FROM users WHERE tg_id = 123456789;

-- Найти по email:
-- SELECT * FROM users WHERE email = "user@example.com";

-- Привязать Telegram к пользователю найденному по web_id:
-- UPDATE users SET tg_id = 999888 WHERE web_id = "abc-123-def";

-- Слияние: обновить основной + удалить дубликат + записать аудит
-- UPSERT INTO users (id, email, tg_id, ...) VALUES (...);
-- UPSERT INTO user_merges (id, surviving_user_id, deleted_user_id, merge_reason, merged_at) VALUES (...);
-- DELETE FROM users WHERE id = "deleted-uuid";
