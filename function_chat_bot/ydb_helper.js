import crypto from "crypto";
import pkg from "ydb-sdk";
import { log } from "./src/utils/logger.js";
import { runMigrations } from "./src/utils/db_migrations.js";

const { Driver, getCredentialsFromEnv, TypedValues } = pkg;

// Экспортируем логгер для обратной совместимости
export { log };

// === 2. ВАЛИДАЦИЯ ===
// Простой Regex для проверки формата токена Telegram (ID:HASH)
const isValidBotToken = (token) => /^\d+:[A-Za-z0-9_-]+$/.test(token);

export const driver = new Driver({
  endpoint: process.env.YDB_ENDPOINT,
  database: process.env.YDB_DATABASE,
  authService: getCredentialsFromEnv(),
});

let driverInitialized = false;

export async function init() {
  if (!driverInitialized) {
    try {
      await driver.ready(3000);
      driverInitialized = true;
      log.info("YDB Driver initialized successfully");

      // v5.0: Автоматические миграции
      await runMigrations(driver);
    } catch (e) {
      log.error("Failed to initialize YDB Driver", e);
      throw e; // Критическая ошибка, без БД работать нельзя
    }
  }
  return driver;
}

// === v6.0: Омниканальная схема — UUID PK, отдельные колонки каналов ===
const USER_FIELDS =
  "id, email, tg_id, vk_id, web_id, partner_id, state, bought_tripwire, session, last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases, first_name, last_reminder_time, reminders_count, pin_code, session_version, created_at";

function mapUser(row) {
  if (!row) return null;
  let s = { tags: [], dialog_history: [] };
  let p = [];

  try {
    const j = row.items[8]?.jsonValue || row.items[8]?.textValue;
    if (j && j !== "null") {
      s = JSON.parse(j);
      if (!s.dialog_history) {
        s.dialog_history = [];
      }
    }

    const pj = row.items[15]?.jsonValue || row.items[15]?.textValue;
    if (pj && pj !== "null") p = JSON.parse(pj);
  } catch (e) {
    log.error("Error parsing user JSON fields", e, {
      rowId: row.items[0]?.textValue,
    });
  }

  return {
    id: row.items[0]?.textValue || "",
    email: row.items[1]?.textValue || "",
    tg_id: row.items[2]?.uint64Value ? Number(row.items[2].uint64Value) : null,
    vk_id: row.items[3]?.uint64Value ? Number(row.items[3].uint64Value) : null,
    web_id: row.items[4]?.textValue || "",
    partner_id: row.items[5]?.textValue || "p_qdr",
    state: row.items[6]?.textValue || "START",
    bought_tripwire: row.items[7]?.boolValue || false,
    session: s,
    last_seen: row.items[9]?.uint64Value
      ? Number(row.items[9].uint64Value)
      : null,
    saved_state: row.items[10]?.textValue || "",
    bot_token: row.items[11]?.textValue || "",
    tariff: row.items[12]?.textValue || "",
    sh_user_id: row.items[13]?.textValue || "",
    sh_ref_tail: row.items[14]?.textValue || "",
    purchases: Array.isArray(p) ? p : [],
    first_name: row.items[16]?.textValue || "",
    last_reminder_time: row.items[17]?.uint64Value
      ? Number(row.items[17].uint64Value)
      : null,
    reminders_count: row.items[18]?.uint64Value
      ? Number(row.items[18].uint64Value)
      : 0,
    pin_code: row.items[19]?.textValue || "",
    session_version: row.items[20]?.uint64Value
      ? Number(row.items[20].uint64Value)
      : 0,
    created_at: row.items[21]?.uint64Value
      ? Number(row.items[21].uint64Value)
      : null,
    // Обратная совместимость: user_id = tg_id (для старого кода)
    get user_id() {
      return this.tg_id ? String(this.tg_id) : this.id;
    },
  };
}

/**
 * Умный поиск пользователя по любому каналу
 * @param {object} criteria - { id, tg_id, vk_id, web_id, email }
 * @returns {object|null} User object или null
 */
export async function findUser(criteria) {
  if (!criteria || Object.keys(criteria).length === 0) return null;

  try {
    return await driver.tableClient.withSession(async (session) => {
      let whereClause = "";
      let params = {};

      if (criteria.id) {
        whereClause = "id = $search_val";
        params = { $search_val: TypedValues.utf8(String(criteria.id)) };
      } else if (criteria.tg_id) {
        whereClause = "tg_id = $search_val";
        params = { $search_val: TypedValues.uint64(String(criteria.tg_id)) };
      } else if (criteria.email) {
        whereClause = "email = $search_val";
        params = {
          $search_val: TypedValues.utf8(String(criteria.email).toLowerCase()),
        };
      } else if (criteria.web_id) {
        whereClause = "web_id = $search_val";
        params = { $search_val: TypedValues.utf8(String(criteria.web_id)) };
      } else if (criteria.vk_id) {
        whereClause = "vk_id = $search_val";
        params = { $search_val: TypedValues.uint64(String(criteria.vk_id)) };
      } else {
        return null;
      }

      const query = `
        DECLARE $search_val AS Utf8;
        SELECT ${USER_FIELDS} FROM users WHERE ${whereClause};
      `;

      const { resultSets } = await session.executeQuery(query, params);
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;

      return mapUser(resultSets[0].rows[0]);
    });
  } catch (e) {
    log.error(`Failed to find user by criteria`, e, criteria);
    return null;
  }
}

/**
 * Обратная совместимость: getUser по-прежнему работает
 * Поддерживает старый формат для плавного перехода
 * @deprecated Используйте findUser({ tg_id, email, web_id, vk_id, id })
 */
export async function getUser(userId) {
  if (!userId || typeof userId !== "string") return null;

  try {
    return await driver.tableClient.withSession(async (session) => {
      // Пробуем найти по UUID (id)
      let query, params;

      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        query = `DECLARE $id AS Utf8; SELECT ${USER_FIELDS} FROM users WHERE id = $id;`;
        params = { $id: TypedValues.utf8(userId) };
      } else if (/^\d{3,20}$/.test(userId)) {
        // Числовой ID — пробуем tg_id, затем vk_id
        query = `DECLARE $id AS Uint64; SELECT ${USER_FIELDS} FROM users WHERE tg_id = $id OR vk_id = $id LIMIT 1;`;
        params = { $id: TypedValues.uint64(userId) };
      } else if (
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId)
      ) {
        query = `DECLARE $email AS Utf8; SELECT ${USER_FIELDS} FROM users WHERE email = $email;`;
        params = { $email: TypedValues.utf8(userId.toLowerCase()) };
      } else {
        // Web session ID или legacy префиксы — пробуем web_id, затем id (UUID без форматирования)
        const cleanId = userId.replace(/^(vk:|email:|web:)/, "");
        query = `DECLARE $wid AS Utf8; SELECT ${USER_FIELDS} FROM users WHERE web_id = $wid OR id = $wid LIMIT 1;`;
        params = { $wid: TypedValues.utf8(cleanId) };
      }

      const { resultSets } = await session.executeQuery(query, params);
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      return mapUser(resultSets[0].rows[0]);
    });
  } catch (e) {
    log.error(`Failed to get user`, e, { userId });
    return null;
  }
}

/**
 * Сохранить пользователя (v6.0 — Омниканальная схема)
 * - Автогенерация UUID при первом сохранении
 * - Корректные типы для всех колонок
 * - Обратная совместимость: принимает user.id или user.user_id
 */
export async function saveUser(user) {
  // v6.0: Генерируем UUID если это новый пользователь
  const userId = user.id || crypto.randomUUID();

  // v6.0: tg_id — приоритетный канал для Telegram
  // Обратная совместимость: если передан user_id но не tg_id — парсим
  let tgId = user.tg_id;
  if (!tgId && user.user_id && /^\d{3,20}$/.test(String(user.user_id))) {
    tgId = Number(user.user_id);
  }

  try {
    return await driver.tableClient.withSession(async (session) => {
      const newVersion = (user.session_version || 0) + 1;
      const now = Date.now();

      const params = {
        $id: TypedValues.utf8(String(userId)),
        $email: TypedValues.utf8(String(user.email || "").toLowerCase()),
        $tg_id: TypedValues.uint64(String(tgId || "0")),
        $vk_id: TypedValues.uint64(String(user.vk_id || "0")),
        $web_id: TypedValues.utf8(String(user.web_id || "")),
        $pid: TypedValues.utf8(String(user.partner_id || "p_qdr")),
        $st: TypedValues.utf8(String(user.state || "START")),
        $br: TypedValues.bool(Boolean(user.bought_tripwire)),
        $js: TypedValues.json(JSON.stringify(user.session || { tags: [] })),
        $ls: TypedValues.uint64(String(user.last_seen || now)),
        $sv: TypedValues.utf8(String(user.saved_state || "")),
        $bt: TypedValues.utf8(String(user.bot_token || "")),
        $tr: TypedValues.utf8(String(user.tariff || "")),
        $shui: TypedValues.utf8(String(user.sh_user_id || "")),
        $shrt: TypedValues.utf8(String(user.sh_ref_tail || "")),
        $pur: TypedValues.json(JSON.stringify(user.purchases || [])),
        $fn: TypedValues.utf8(String(user.first_name || "Друг")),
        $lrt: TypedValues.uint64(String(user.last_reminder_time || 0)),
        $rc: TypedValues.uint64(String(user.reminders_count || 0)),
        $pc: TypedValues.utf8(String(user.pin_code || "")),
        $newVer: TypedValues.uint64(String(newVersion)),
        $cat: TypedValues.uint64(String(user.created_at || now)),
      };

      const query = `
        DECLARE $id AS Utf8; DECLARE $email AS Utf8;
        DECLARE $tg_id AS Uint64; DECLARE $vk_id AS Uint64; DECLARE $web_id AS Utf8;
        DECLARE $pid AS Utf8; DECLARE $st AS Utf8; DECLARE $br AS Bool;
        DECLARE $js AS Json; DECLARE $ls AS Uint64; DECLARE $sv AS Utf8; DECLARE $bt AS Utf8;
        DECLARE $tr AS Utf8; DECLARE $shui AS Utf8; DECLARE $shrt AS Utf8; DECLARE $pur AS Json;
        DECLARE $fn AS Utf8; DECLARE $lrt AS Uint64; DECLARE $rc AS Uint64; DECLARE $pc AS Utf8;
        DECLARE $newVer AS Uint64; DECLARE $cat AS Uint64;

        UPSERT INTO users (
          id, email, tg_id, vk_id, web_id,
          partner_id, state, bought_tripwire, session,
          last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases,
          first_name, last_reminder_time, reminders_count, pin_code, session_version, created_at
        ) VALUES (
          $id, $email, $tg_id, $vk_id, $web_id,
          $pid, $st, $br, $js, $ls, $sv, $bt, $tr, $shui, $shrt, $pur, $fn, $lrt, $rc, $pc, $newVer, $cat
        );
      `;
      await session.executeQuery(query, params);

      return { success: true, id: userId, version: newVersion };
    });
  } catch (e) {
    log.error(`Failed to save user`, e, { userId });
    return { success: false };
  }
}

/**
 * Слияние двух профилей пользователей
 * @param {object} surviving - Объект пользователя, который остаётся (основной)
 * @param {string} deletedUserId - UUID пользователя, которого поглощают
 * @param {string} reason - Причина: 'email_match', 'web_merge', 'tg_merge', 'vk_merge', 'manual'
 * @returns {boolean} Успешность слияния
 */
export async function mergeUsers(surviving, deletedUserId, reason = "auto_merge") {
  const mergeId = crypto.randomUUID();

  try {
    return await driver.tableClient.withSession(async (session) => {
      // 1. Подготавливаем параметры для обновления выжившего
      const newVersion = (surviving.session_version || 0) + 1;
      const now = Date.now();

      const saveParams = {
        $id: TypedValues.utf8(String(surviving.id)),
        $email: TypedValues.utf8(String(surviving.email || "").toLowerCase()),
        $tg_id: TypedValues.uint64(String(surviving.tg_id || "0")),
        $vk_id: TypedValues.uint64(String(surviving.vk_id || "0")),
        $web_id: TypedValues.utf8(String(surviving.web_id || "")),
        $pid: TypedValues.utf8(String(surviving.partner_id || "p_qdr")),
        $st: TypedValues.utf8(String(surviving.state || "START")),
        $br: TypedValues.bool(Boolean(surviving.bought_tripwire)),
        $js: TypedValues.json(JSON.stringify(surviving.session || { tags: [] })),
        $ls: TypedValues.uint64(String(now)),
        $sv: TypedValues.utf8(String(surviving.saved_state || "")),
        $bt: TypedValues.utf8(String(surviving.bot_token || "")),
        $tr: TypedValues.utf8(String(surviving.tariff || "")),
        $shui: TypedValues.utf8(String(surviving.sh_user_id || "")),
        $shrt: TypedValues.utf8(String(surviving.sh_ref_tail || "")),
        $pur: TypedValues.json(JSON.stringify(surviving.purchases || [])),
        $fn: TypedValues.utf8(String(surviving.first_name || "Друг")),
        $lrt: TypedValues.uint64(String(surviving.last_reminder_time || 0)),
        $rc: TypedValues.uint64(String(surviving.reminders_count || 0)),
        $pc: TypedValues.utf8(String(surviving.pin_code || "")),
        $newVer: TypedValues.uint64(String(newVersion)),
        $cat: TypedValues.uint64(String(surviving.created_at || now)),
        // Параметры для аудита и удаления
        $mergeId: TypedValues.utf8(mergeId),
        $survId: TypedValues.utf8(String(surviving.id)),
        $delId: TypedValues.utf8(String(deletedUserId)),
        $reason: TypedValues.utf8(String(reason)),
        $mergeTs: TypedValues.uint64(String(now)),
      };

      // 2. Единая транзакция: UPDATE + DELETE + аудит
      const query = `
        DECLARE $id AS Utf8; DECLARE $email AS Utf8;
        DECLARE $tg_id AS Uint64; DECLARE $vk_id AS Uint64; DECLARE $web_id AS Utf8;
        DECLARE $pid AS Utf8; DECLARE $st AS Utf8; DECLARE $br AS Bool;
        DECLARE $js AS Json; DECLARE $ls AS Uint64; DECLARE $sv AS Utf8; DECLARE $bt AS Utf8;
        DECLARE $tr AS Utf8; DECLARE $shui AS Utf8; DECLARE $shrt AS Utf8; DECLARE $pur AS Json;
        DECLARE $fn AS Utf8; DECLARE $lrt AS Uint64; DECLARE $rc AS Uint64; DECLARE $pc AS Utf8;
        DECLARE $newVer AS Uint64; DECLARE $cat AS Uint64;
        DECLARE $mergeId AS Utf8; DECLARE $survId AS Utf8; DECLARE $delId AS Utf8;
        DECLARE $reason AS Utf8; DECLARE $mergeTs AS Uint64;

        -- Обновляем основного пользователя
        UPSERT INTO users (
          id, email, tg_id, vk_id, web_id,
          partner_id, state, bought_tripwire, session,
          last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases,
          first_name, last_reminder_time, reminders_count, pin_code, session_version, created_at
        ) VALUES (
          $id, $email, $tg_id, $vk_id, $web_id,
          $pid, $st, $br, $js, $ls, $sv, $bt, $tr, $shui, $shrt, $pur, $fn, $lrt, $rc, $pc, $newVer, $cat
        );

        -- Записываем в аудит-лог
        UPSERT INTO user_merges (id, surviving_user_id, deleted_user_id, merge_reason, merged_at)
        VALUES ($mergeId, $survId, $delId, $reason, $mergeTs);

        -- Удаляем поглощённый профиль
        DELETE FROM users WHERE id = $delId;
      `;

      await session.executeQuery(query, saveParams);

      log.info(`[MERGE] Successfully merged ${deletedUserId} into ${surviving.id}`, {
        reason,
        survivingId: surviving.id,
        deletedId: deletedUserId,
      });
      return true;
    });
  } catch (e) {
    log.error(`[MERGE FAILED] Could not merge ${deletedUserId} into ${surviving?.id}`, e);
    return false;
  }
}

export async function registerPartnerBot(
  ownerId,
  token,
  username,
  shui,
  shrt,
  twLink,
  vkGroupId = "",
) {
  // Валидация токена перед запросом к БД
  if (token && !isValidBotToken(token)) {
    log.warn(`Invalid bot token format attempt`, { ownerId, token });
    throw new Error("Invalid bot token format");
  }

  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $uid AS Utf8; DECLARE $tok AS Utf8; DECLARE $un AS Utf8;
        DECLARE $ts AS Uint64; DECLARE $shui AS Utf8; DECLARE $shrt AS Utf8;
        DECLARE $twl AS Utf8; DECLARE $vkgid AS Utf8;
        UPSERT INTO bots (bot_token, user_id, bot_username, created_at, sh_user_id, sh_ref_tail, tripwire_link, vk_group_id)
        VALUES ($tok, $uid, $un, $ts, $shui, $shrt, $twl, $vkgid);
      `;
      await session.executeQuery(query, {
        $uid: TypedValues.utf8(String(ownerId)),
        $tok: TypedValues.utf8(String(token || "")),
        $un: TypedValues.utf8(String(username || "")),
        $ts: TypedValues.uint64(String(Date.now())),
        $shui: TypedValues.utf8(String(shui)),
        $shrt: TypedValues.utf8(String(shrt)),
        $twl: TypedValues.utf8(String(twLink)),
        $vkgid: TypedValues.utf8(String(vkGroupId)),
      });
      log.info(`New partner bot registered`, { ownerId, username, vkGroupId });
    });
  } catch (e) {
    log.error(`Failed to register partner bot`, e, { ownerId, username });
    throw e;
  }
}

export async function updatePartnerBot(token, updates) {
  // Валидация токена перед запросом к БД
  if (!isValidBotToken(token)) {
    log.warn(`Invalid bot token format attempt`, { token });
    throw new Error("Invalid bot token format");
  }

  try {
    return await driver.tableClient.withSession(async (session) => {
      const updatesQuery = Object.entries(updates)
        .map(([key, value]) => `${key} = $${key}`)
        .join(", ");

      const query = `
        DECLARE $tok AS Utf8;
        UPDATE bots SET ${updatesQuery} WHERE bot_token = $tok;
      `;

      const params = {
        $tok: TypedValues.utf8(String(token)),
      };

      Object.entries(updates).forEach(([key, value]) => {
        params[`$${key}`] = TypedValues.utf8(String(value));
      });

      await session.executeQuery(query, params);
      log.info(`Partner bot updated`, {
        token: token.substring(0, 10) + "...",
      });
    });
  } catch (e) {
    log.error(`Failed to update partner bot`, e, {
      token: token.substring(0, 10) + "...",
    });
    throw e;
  }
}

export async function getBotInfo(token) {
  if (!isValidBotToken(token)) return null;

  try {
    return await driver.tableClient.withSession(async (session) => {
      // ИСПРАВЛЕНИЕ: Добавили bot_username в SELECT запрос
      const query = `DECLARE $tok AS Utf8; SELECT user_id, sh_user_id, sh_ref_tail, tripwire_link, bot_username FROM bots WHERE bot_token = $tok;`;
      const { resultSets } = await session.executeQuery(query, {
        $tok: TypedValues.utf8(String(token)),
      });
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      const r = resultSets[0].rows[0];
      return {
        owner_id: r.items[0].textValue,
        sh_user_id: r.items[1]?.textValue || "",
        sh_ref_tail: r.items[2]?.textValue || "",
        tripwire_link: r.items[3]?.textValue || "",
        bot_username: r.items[4]?.textValue || "", // ИСПРАВЛЕНИЕ: Теперь мы достаем юзернейм!
      };
    });
  } catch (e) {
    log.error(`Failed to get bot info`, e, {
      tokenMasked: token.substring(0, 10) + "...",
    });
    return null;
  }
}

/**
 * Получить информацию о VK-боте по ID группы
 * @param {string} groupId - VK group ID
 * @returns {object|null} { owner_id, sh_user_id, sh_ref_tail }
 */
export async function getBotInfoByVkGroup(groupId) {
  if (!groupId) return null;

  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $gid AS Utf8; SELECT user_id, sh_user_id, sh_ref_tail, bot_username FROM bots WHERE vk_group_id = $gid;`;
      const { resultSets } = await session.executeQuery(query, {
        $gid: TypedValues.utf8(String(groupId)),
      });
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      const r = resultSets[0].rows[0];
      return {
        owner_id: r.items[0].textValue,
        sh_user_id: r.items[1]?.textValue || "",
        sh_ref_tail: r.items[2]?.textValue || "",
        bot_username: r.items[3]?.textValue || "",
      };
    });
  } catch (e) {
    log.error(`Failed to get VK bot info`, e, { groupId });
    return null;
  }
}

export async function getPartnerStats(ownerId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const botRes = await session.executeQuery(
        `DECLARE $uid AS Utf8; SELECT sh_ref_tail FROM bots WHERE user_id = $uid;`,
        { $uid: TypedValues.utf8(String(ownerId)) },
      );
      const tails = (botRes.resultSets[0]?.rows || [])
        .map((r) => r.items[0].textValue)
        .filter((t) => t);

      if (tails.length === 0) return { total: 0, sales: 0 };

      const utf8Type = TypedValues.utf8("").type;
      const userRes = await session.executeQuery(
        `DECLARE $ts AS List<Utf8>; SELECT COUNT(*) as t, COUNT_IF(bought_tripwire = true) as s FROM users WHERE partner_id IN $ts;`,
        { $ts: TypedValues.list(utf8Type, tails) },
      );

      const statsRow = userRes.resultSets[0].rows[0];
      return {
        total: Number(statsRow.items[0].uint64Value),
        sales: Number(statsRow.items[1].uint64Value),
      };
    });
  } catch (e) {
    log.error(`Failed to get stats`, e, { ownerId });
    return { total: 0, sales: 0 };
  }
}

/**
 * Получить список рефералов пользователя (по partner_id)
 * @param {string} userId - Telegram ID владельца
 * @returns {Promise<Array>} - Массив пользователей-рефералов
 */
export async function getUserReferrals(userId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      // 1. Получаем уникальный партнерский хвост (sh_ref_tail) владельца
      const botRes = await session.executeQuery(
        `DECLARE $uid AS Utf8; SELECT sh_ref_tail FROM bots WHERE user_id = $uid;`,
        { $uid: TypedValues.utf8(String(userId)) },
      );
      const tails = (botRes.resultSets[0]?.rows || [])
        .map((r) => r.items[0].textValue)
        .filter((t) => t);

      // Если нет бота или хвоста — рефералов быть не может
      if (tails.length === 0) return [];

      // 2. Ищем юзеров, закрепленных за этим хвостом
      const utf8Type = TypedValues.utf8("").type;
      const userRes = await session.executeQuery(
        `DECLARE $ts AS List<Utf8>; SELECT user_id, first_name, last_seen, bought_tripwire FROM users WHERE partner_id IN $ts ORDER BY last_seen DESC LIMIT 50;`,
        { $ts: TypedValues.list(utf8Type, tails) },
      );

      return (userRes.resultSets[0]?.rows || []).map((r) => ({
        user_id: r.items[0].textValue,
        first_name: r.items[1].textValue,
        last_seen: Number(r.items[2].uint64Value),
        bought_tripwire: r.items[3].boolValue,
      }));
    });
  } catch (e) {
    log.error(`Failed to get user referrals`, e, { userId });
    return [];
  }
}

/**
 * Получить список пользователей бота
 * @param {string} botToken - Токен бота
 * @param {number} limit - Лимит записей (для пагинации)
 * @param {number} offset - Смещение (для пагинации)
 * @returns {Promise<Array>} - Массив объектов пользователей
 */
export async function getBotUsers(botToken, limit = 100, offset = 0) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      // === ИСПРАВЛЕНИЕ v4.3.5: Запрашиваем ВСЕ поля пользователя, а не только user_id ===
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8; DECLARE $l AS Uint64; DECLARE $o AS Uint64;
         SELECT ${USER_FIELDS} FROM users WHERE bot_token = $bt ORDER BY last_seen DESC LIMIT $l OFFSET $o;`,
        {
          $bt: TypedValues.utf8(String(botToken)),
          $l: TypedValues.uint64(String(limit)),
          $o: TypedValues.uint64(String(offset)),
        },
      );
      // === ИСПРАВЛЕНИЕ v4.3.5: Пропускаем строки через mapUser для полноценных объектов ===
      return (resultSets[0]?.rows || []).map((r) => mapUser(r));
    });
  } catch (e) {
    log.error(`Failed to get bot users`, e, {
      botTokenMasked: botToken.substring(0, 10) + "...",
    });
    return [];
  }
}

/**
 * Получить общее количество пользователей бота (для пагинации)
 * @param {string} botToken - Токен бота
 * @returns {Promise<number>} - Количество пользователей
 */
export async function getBotUsersCount(botToken) {
  try {
    const result = await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8; SELECT COUNT(*) as cnt FROM users WHERE bot_token = $bt;`,
        { $bt: TypedValues.utf8(String(botToken)) },
      );
      if (!resultSets[0] || resultSets[0].rows.length === 0) return 0;
      return Number(resultSets[0].rows[0].items[0].uint64Value);
    });
    return result;
  } catch (e) {
    log.error(`Failed to get bot users count`, e, {
      botTokenMasked: botToken.substring(0, 10) + "...",
    });
    return 0;
  }
}

/**
 * Получить агрегированную статистику по боту (оптимизированный SQL-запрос)
 * @param {string} botToken - Токен бота
 * @returns {Promise<object>} - { total, paid, byStage: { start, training, tripwire, delivery } }
 */
export async function getBotStats(botToken) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      // 1. Агрегация на уровне БД (YDB обожает GROUP BY и пропускает без ошибок)
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8;
         SELECT
           state,
           bought_tripwire,
           COUNT(*) AS cnt
         FROM users
         WHERE bot_token = $bt
         GROUP BY state, bought_tripwire;`,
        { $bt: TypedValues.utf8(String(botToken)) },
      );

      const rows = resultSets[0]?.rows || [];

      // ОТЛАДКА: логируем структуру ответа YDB
      log.info(`[CRM STATS] Raw rows from YDB:`, JSON.stringify(rows, null, 2));

      // 2. Умный подсчет в памяти (решает все проблемы со строгими типами YDB)
      let total = 0,
        paid = 0;
      let start_count = 0,
        training_count = 0,
        tripwire_count = 0,
        delivery_count = 0;

      for (const row of rows) {
        // YDB возвращает: rows[].items[] где items = [state, bought_tripwire, count]
        const items = row.items || [];

        // items[0] = state (textValue), items[1] = bought_tripwire (boolValue), items[2] = count (uint64Value)
        const st = items[0]?.textValue || items[0]?.utf8Value || "";
        const isPro = items[1]?.boolValue === true;
        const count = Number(
          items[2]?.uint64Value || items[2]?.uint32Value || 0,
        );

        log.info(
          `[CRM STATS] Processing: state=${st}, isPro=${isPro}, count=${count}`,
        );

        total += count;

        if (isPro) {
          paid += count;
          delivery_count += count; // Все, кто купил, уходят в статус выдачи/PRO
        } else {
          if (st === "START") {
            start_count += count;
          } else if (
            st.includes("Module") ||
            st.includes("Theory") ||
            st.includes("Training")
          ) {
            training_count += count;
          } else if (
            st.includes("Tripwire") ||
            st.includes("Offer") ||
            st === "FAQ_PRO"
          ) {
            tripwire_count += count;
          }
        }
      }

      log.info(
        `[CRM STATS] Final: total=${total}, paid=${paid}, start=${start_count}, training=${training_count}, tripwire=${tripwire_count}, delivery=${delivery_count}`,
      );

      // 3. Отдаем фронтенду идеальную структуру
      return {
        total,
        paid,
        byStage: {
          start: start_count,
          training: training_count,
          tripwire: tripwire_count,
          delivery: delivery_count,
        },
      };
    });
  } catch (e) {
    log.error(`[CRM STATS ERROR] Failed to calculate stats`, e);
    return {
      total: 0,
      paid: 0,
      byStage: { start: 0, training: 0, tripwire: 0, delivery: 0 },
    };
  }
}

/**
 * Получить список неактивных пользователей для дожимов и напоминаний
 * @param {number} hoursAgo - Сколько часов назад должен быть последний визит
 * @param {number} limit - Лимит пользователей за один запрос
 * @param {number} offset - Смещение для пагинации (оптимизация CRON)
 * @returns {Promise<Array>} - Массив пользователей
 */
export async function getStaleUsers(hoursAgo = 1, limit = 50, offset = 0) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const cutoff = Date.now() - hoursAgo * 60 * 60 * 1000;
      // === ИСПРАВЛЕНИЕ v4.3.3: YQL синтаксис LIMIT $l OFFSET $o ===
      const { resultSets } = await session.executeQuery(
        `DECLARE $c AS Uint64; DECLARE $l AS Uint64; DECLARE $o AS Uint64;
         SELECT ${USER_FIELDS} FROM users WHERE last_seen < $c ORDER BY last_seen ASC LIMIT $l OFFSET $o;`,
        {
          $c: TypedValues.uint64(String(cutoff)),
          $l: TypedValues.uint64(String(limit)),
          $o: TypedValues.uint64(String(offset)),
        },
      );
      return (resultSets[0]?.rows || []).map((row) => mapUser(row));
    });
  } catch (e) {
    log.error(`Failed to get stale users`, e);
    return [];
  }
}

/**
 * Рассылка с rate limiting и обработкой 429 (экспоненциальный backoff)
 * @param {Telegraf} bot - Инстанс бота
 * @param {string[]} userIds - Массив ID пользователей
 * @param {string} text - Текст сообщения
 * @param {object} options - Дополнительные опции Telegram API
 * @param {number} rateLimit - Количество сообщений в секунду (default: 30)
 * @param {number} maxRetries - Максимум попыток при 429 (default: 3)
 * @param {number} pauseBetweenChunksSec - Пауза между пачками в секундах (default: 1)
 * @returns {object} { sent: number, failed: number, rateLimited: number }
 */
export async function broadcastWithRateLimit(
  bot,
  userIds,
  text,
  options = {},
  rateLimit = 30,
  maxRetries = 3,
  pauseBetweenChunksSec = 1,
) {
  const results = { sent: 0, failed: 0, rateLimited: 0 };
  const totalChunks = Math.ceil(userIds.length / rateLimit);

  log.info(`[BROADCAST] Starting`, {
    totalUsers: userIds.length,
    rateLimit,
    totalChunks,
    pauseBetweenChunksSec,
  });

  for (let i = 0; i < userIds.length; i += rateLimit) {
    const chunk = userIds.slice(i, i + rateLimit);
    const chunkNum = Math.floor(i / rateLimit) + 1;

    log.debug(`[BROADCAST] Processing chunk ${chunkNum}/${totalChunks}`);

    const chunkResults = await Promise.allSettled(
      chunk.map(async (userId) => {
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            await bot.telegram.sendMessage(userId, text, {
              ...options,
              protect_content: true,
            });
            return { success: true, userId };
          } catch (error) {
            lastError = error;
            const errorCode = error.response?.body?.error_code || error.code;

            // 429 — экспоненциальный backoff
            if (errorCode === 429 && attempt < maxRetries) {
              const retryAfter =
                error.response?.body?.parameters?.retry_after || 1;
              const delay =
                Math.min(retryAfter * Math.pow(2, attempt), 10) * 1000;
              log.warn(
                `[BROADCAST] 429 for user ${userId}, retrying in ${delay}ms`,
                {
                  attempt: attempt + 1,
                  maxRetries,
                },
              );
              await new Promise((res) => setTimeout(res, delay));
              continue;
            }

            // Другие ошибки — логируем и прекращаем попытки для этого пользователя
            log.warn(`[BROADCAST] Failed for user ${userId}`, {
              errorCode,
              errorMsg: error.response?.body?.description || error.message,
              attempt: attempt + 1,
            });
            return { success: false, userId, error: lastError };
          }
        }

        // Все попытки исчерпаны
        log.error(`[BROADCAST] Max retries exceeded for user ${userId}`, {
          error: lastError?.message,
        });
        return { success: false, userId, error: lastError };
      }),
    );

    // Подсчитываем результаты чанка
    chunkResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value.success) {
        results.sent++;
      } else {
        results.failed++;
        // Проверяем, была ли это 429 ошибка
        const error = result.reason || result.value?.error;
        if (error?.response?.body?.error_code === 429) {
          results.rateLimited++;
        }
      }
    });

    // Пауза между пачками (настраиваемая)
    if (i + rateLimit < userIds.length) {
      await new Promise((r) => setTimeout(r, pauseBetweenChunksSec * 1000));
    }
  }

  log.info(`[BROADCAST] Finished`, {
    total: userIds.length,
    sent: results.sent,
    failed: results.failed,
    rateLimited: results.rateLimited,
    successRate: `${((results.sent / userIds.length) * 100).toFixed(1)}%`,
  });

  return results;
}

/**
 * Валидация initData от Telegram WebApp
 */
export function validateTelegramInitData(initData, botToken) {
  try {
    if (!initData) return null;

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return null;

    const dataCheckArr = [];
    for (const [key, value] of urlParams.entries()) {
      if (key !== "hash") {
        dataCheckArr.push(`${key}=${value}`);
      }
    }
    dataCheckArr.sort();

    const cryptoKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", cryptoKey)
      .update(dataCheckArr.join("\n"))
      .digest("hex");

    if (calculatedHash !== hash) {
      log.warn("[TG VALIDATION] Invalid hash");
      return null;
    }

    const authDate = parseInt(urlParams.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 24 * 60 * 60) {
      log.warn("[TG VALIDATION] initData expired");
      return null;
    }

    const result = {};
    for (const [key, value] of urlParams.entries()) {
      if (key === "user") {
        result.user = JSON.parse(value);
      } else if (
        key === "receiver" ||
        key === "chat_type" ||
        key === "chat_instance"
      ) {
        result[key] = value;
      } else if (key !== "hash" && key !== "auth_date") {
        result[key] = value;
      }
    }
    result.auth_date = authDate;

    return result;
  } catch (e) {
    log.error("[TG VALIDATION] Error:", e);
    return null;
  }
}

/**
 * Проверка, является ли пользователь Глобальным Администратором
 */
export function isAdmin(telegramId) {
  const adminIds = (process.env.CRM_ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id);

  return adminIds.includes(String(telegramId));
}

/**
 * Записать клик по реферальной ссылке
 * @param {string} partnerId - Партнерский хвост (p_xxx)
 * @param {string} userId - Telegram ID кликнувшего
 * @param {string} botToken - Токен бота, где произошел клик
 */
export async function recordLinkClick(partnerId, userId, botToken) {
  try {
    await driver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $pid AS Utf8;
        DECLARE $uid AS Utf8;
        DECLARE $bt AS Utf8;
        DECLARE $ts AS Uint64;

        UPSERT INTO link_clicks (partner_id, user_id, clicked_at, bot_token)
        VALUES ($pid, $uid, $ts, $bt);
      `;

      await session.executeQuery(query, {
        $pid: TypedValues.utf8(String(partnerId)),
        $uid: TypedValues.utf8(String(userId)),
        $bt: TypedValues.utf8(String(botToken)),
        $ts: TypedValues.uint64(String(Date.now())),
      });
    });
    log.debug(`[LINK CLICK] Recorded`, { partnerId, userId });
  } catch (e) {
    log.error(`[LINK CLICK] Failed to record`, e, { partnerId, userId });
  }
}

/**
 * Получить статистику кликов партнера за последние 24 часа
 * @param {string} partnerId - Партнерский хвост
 * @returns {Promise<number>} - Количество кликов
 */
export async function getPartnerClicks(partnerId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 часа назад

      const query = `
        DECLARE $pid AS Utf8;
        DECLARE $cutoff AS Uint64;

        SELECT COUNT(*) as clicks
        FROM link_clicks
        WHERE partner_id = $pid AND clicked_at >= $cutoff;
      `;

      const { resultSets } = await session.executeQuery(query, {
        $pid: TypedValues.utf8(String(partnerId)),
        $cutoff: TypedValues.uint64(String(cutoff)),
      });

      const row = resultSets[0]?.rows[0];
      return row ? Number(row.items[0].uint64Value) : 0;
    });
  } catch (e) {
    log.error(`[LINK CLICK] Failed to get stats`, e, { partnerId });
    return 0;
  }
}
