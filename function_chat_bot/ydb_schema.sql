-- ============================================================
-- YDB Schema для SaaS-платформы NeuroGen (Версия 3.0)
-- ============================================================

-- -------------------------------------------------------------
-- Таблица: users (пользователи бота)
-- -------------------------------------------------------------
-- Хранит всех пользователей всех ботов
-- Ключ: user_id (Telegram ID)

CREATE TABLE users (
    user_id Utf8,
    partner_id Utf8,
    state Utf8,
    bought_tripwire Bool,
    session Json,
    last_seen Uint64,
    saved_state Utf8,
    bot_token Utf8,
    tariff Utf8,
    sh_user_id Utf8,
    sh_ref_tail Utf8,
    purchases Json,
    first_name Utf8,
    last_reminder_time Uint64,
    reminders_count Uint64,
    pin_code Utf8,
    session_version Uint64,
    PRIMARY KEY (user_id)
);

-- -------------------------------------------------------------
-- Таблица: bots (информация о ботах партнеров)
-- -------------------------------------------------------------
-- Хранит данные о ботах, созданных партнерами
-- Ключ: bot_token (Telegram Bot Token)

CREATE TABLE bots (
    bot_token Utf8,
    user_id Utf8,
    bot_username Utf8,
    created_at Uint64,
    sh_user_id Utf8,
    sh_ref_tail Utf8,
    tripwire_link Utf8,
    vk_group_id Utf8,
    PRIMARY KEY (bot_token)
);

-- -------------------------------------------------------------
-- Таблица: link_clicks (аналитика переходов по ссылкам)
-- -------------------------------------------------------------
-- Хранит статистику кликов по реферальным ссылкам
-- Ключ: (partner_id, clicked_at) — для группировки по времени

CREATE TABLE link_clicks (
    partner_id Utf8,
    user_id Utf8,
    clicked_at Uint64,
    bot_token Utf8,
    PRIMARY KEY (partner_id, clicked_at, user_id)
);

-- -------------------------------------------------------------
-- Индексы для ускорения поиска
-- -------------------------------------------------------------

-- Индекс для поиска пользователей по боту
CREATE INDEX idx_users_bot_token ON users (bot_token);

-- Индекс для поиска пользователей по партнеру
CREATE INDEX idx_users_partner_id ON users (partner_id);

-- Индекс для поиска пользователей по статусу оплаты
CREATE INDEX idx_users_bought_tripwire ON users (bought_tripwire);

-- Индекс для поиска пользователей по последнему визиту (для крона)
CREATE INDEX idx_users_last_seen ON users (last_seen);

-- Индекс для поиска ботов по VK группе
CREATE INDEX idx_bots_vk_group_id ON bots (vk_group_id);

-- -------------------------------------------------------------
-- Примечания по использованию
-- -------------------------------------------------------------

-- 1. users:
--    - user_id: Telegram ID пользователя (строка)
--    - partner_id: Реферальный хвост (например, "p_qdr")
--    - state: Текущий шаг воронки (например, "START", "Tripwire_Offer")
--    - bought_tripwire: true если куплен PRO
--    - session: JSON с тегами и временными данными
--    - last_seen: Timestamp последнего действия (Unix ms)
--    - saved_state: Сохранённая позиция для возврата из напоминаний
--    - bot_token: Токен бота, в котором находится пользователь
--    - tariff: "PAID" если оплачен тариф Rocket/Shuttle
--    - sh_user_id: Цифровой ID в SetHubble
--    - sh_ref_tail: Хвост партнёрской ссылки
--    - purchases: JSON массив купленных продуктов
--    - first_name: Имя пользователя
--    - last_reminder_time: Timestamp последнего напоминания
--    - reminders_count: Счётчик отправленных напоминаний
--    - pin_code: 4-значный PIN-код для доступа к ИИ-приложениям (v4.3+)

-- 2. bots:
--    - bot_token: Токен бота от @BotFather
--    - user_id: Telegram ID владельца бота
--    - bot_username: Юзернейм бота (например, "my_funnel_bot")
--    - created_at: Timestamp создания бота
--    - sh_user_id: ID владельца в SetHubble
--    - sh_ref_tail: Партнёрский хвост владельца
--    - tripwire_link: Ссылка на оплату Tripwire

-- -------------------------------------------------------------
-- Примеры запросов
-- -------------------------------------------------------------

-- Получить пользователя:
-- SELECT * FROM users WHERE user_id = "123456789";

-- Сохранить пользователя:
-- UPSERT INTO users (user_id, partner_id, state, bought_tripwire, session, last_seen)
-- VALUES ("123456789", "p_qdr", "START", false, Json("{"tags":[]}"), Uint64("1708800000000"));

-- Получить бот по токену:
-- SELECT * FROM bots WHERE bot_token = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz";

-- Найти всех пользователей бота:
-- SELECT user_id FROM users WHERE bot_token = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz";

-- Найти всех пользователей партнёра:
-- SELECT * FROM users WHERE partner_id = "p_qdr";

-- Обновить статус оплаты:
-- UPDATE users SET bought_tripwire = true, state = "Delivery_1"
-- WHERE user_id = "123456789";

-- -------------------------------------------------------------
-- Миграции (v4.3+)
-- -------------------------------------------------------------

-- v4.3.1: Добавить поле pin_code в существующую таблицу users:
-- ALTER TABLE users ADD COLUMN pin_code Utf8;

-- Обновить PIN для существующих PRO-пользователей:
-- UPDATE users SET pin_code = "1234" WHERE bought_tripwire = true AND pin_code IS NULL;

-- v4.3.2: Добавить поле session_version для защиты от race condition:
-- ALTER TABLE users ADD COLUMN session_version Uint64;

-- Инициализировать версию для существующих пользователей:
-- UPDATE users SET session_version = 0 WHERE session_version IS NULL;

-- v5.0: Добавить поле vk_group_id для VK-ботов:
-- ALTER TABLE bots ADD COLUMN vk_group_id Utf8;

-- Создать индекс для поиска по VK группе:
-- CREATE INDEX idx_bots_vk_group_id ON bots (vk_group_id);
