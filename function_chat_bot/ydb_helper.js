import crypto from "crypto";
import pkg from "ydb-sdk";
import { LRUCache } from "lru-cache";
import { log } from "./src/utils/logger.js";
import { runMigrations } from "./src/utils/db_migrations.js";

const { Driver, getCredentialsFromEnv, TypedValues } = pkg;

// ОПТИМИЗАЦИЯ: Кэш для настроек ботов (TTL 5 минут)
const botInfoCache = new LRUCache({ max: 50, ttl: 5 * 60 * 1000 });
// ОПТИМИЗАЦИЯ: Кэш для статуса подписки ИИ владельца (TTL 1 минута)
const ownerAiCache = new LRUCache({ max: 50, ttl: 60 * 1000 });

export { log };

const isValidBotToken = (token) => /^\d+:[A-Za-z0-9_-]+$/.test(token);

export function isValidUserId(userId) {
  if (!userId || typeof userId !== "string") return false;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  )
    return true;
  if (/^\d{3,20}$/.test(userId)) return true;
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId))
    return true;
  if (/^(email:|vk:|web:|telegram:)/.test(userId)) return true;
  return false;
}

export const driver = new Driver({
  endpoint: process.env.YDB_ENDPOINT,
  database: process.env.YDB_DATABASE,
  authService: getCredentialsFromEnv(),
  // === ИСПРАВЛЕНИЕ: ЖЕСТКИЕ ЛИМИТЫ ДЛЯ SERVERLESS ===
  poolSettings: {
    minLimit: 1,      // Не держим кучу сессий про запас
    maxLimit: 3,      // ОПТИМИЗАЦИЯ: 3 сессии на контейнер (было 10).
                      // При 3+ параллельных контейнерах 10 сессий каждый
                      // превышает глобальный лимит YDB Serverless (~20-50),
                      // вызывая RESOURCE_EXHAUSTED.
    keepAlivePeriod: 30000 // Пинговать раз в 30 сек
  }
});

// Хелпер для определения временных ошибок сети и YDB
function isTransientYdbError(e) {
  const msg = e.message || String(e);
  return msg.includes("RESOURCE_EXHAUSTED") ||
         msg.includes("UNAVAILABLE") ||
         msg.includes("Connection dropped") ||
         msg.includes("Session is busy");
}

let driverInitialized = false;

export async function init() {
  if (!driverInitialized) {
    try {
      await driver.ready(3000);
      driverInitialized = true;
      log.info("YDB Driver initialized successfully");
      await runMigrations(driver);
    } catch (e) {
      log.error("Failed to initialize YDB Driver", e.message || String(e));
      throw e;
    }
  }
  return driver;
}

// === v6.0: Омниканальная схема ===
const USER_FIELDS =
  "id, email, tg_id, vk_id, web_id, partner_id, state, bought_tripwire, session, last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases, first_name, last_reminder_time, reminders_count, pin_code, session_version, ai_active_until, created_at, custom_api_key, custom_prompt, ai_model, ai_provider, user_daily_limit";

function mapUser(row) {
  if (!row) return null;
  let s = { tags: [], dialog_history: [] };
  let p = [];

  try {
    const j = row.items[8]?.jsonValue || row.items[8]?.textValue;
    if (j && j !== "null") {
      s = JSON.parse(j);
      if (!s.dialog_history) s.dialog_history = [];
    }
    const pj = row.items[15]?.jsonValue || row.items[15]?.textValue;
    if (pj && pj !== "null") p = JSON.parse(pj);
  } catch (e) {
    log.error("Error parsing user JSON fields", e.message || String(e));
  }

  return {
    id: row.items[0]?.textValue || "",
    email: row.items[1]?.textValue || "",
    // Безопасное извлечение как Int64
    tg_id: row.items[2]?.uint64Value
      ? Number(row.items[2].uint64Value)
      : row.items[2]?.int64Value
        ? Number(row.items[2].int64Value)
        : null,
    vk_id: row.items[3]?.uint64Value
      ? Number(row.items[3].uint64Value)
      : row.items[3]?.int64Value
        ? Number(row.items[3].int64Value)
        : null,
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
    ai_active_until: row.items[21]?.uint64Value
      ? Number(row.items[21].uint64Value)
      : 0,
    created_at: row.items[22]?.uint64Value
      ? Number(row.items[22].uint64Value)
      : null,
    custom_api_key: row.items[23]?.textValue || "",
    custom_prompt: row.items[24]?.textValue || "",
    ai_model: row.items[25]?.textValue || "",
    ai_provider: row.items[26]?.textValue || "",
    user_daily_limit: row.items[27]?.uint64Value
      ? Number(row.items[27].uint64Value)
      : 0,

    // Обратная совместимость для старого кода (CRM, рассылки)
    get user_id() {
      return this.tg_id ? String(this.tg_id) : this.id;
    },
  };
}

export async function findUser(criteria) {
  if (!criteria || Object.keys(criteria).length === 0) return null;

  const maxRetries = 3;
  const baseDelayMs = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await driver.tableClient.withSession(async (session) => {
        let viewClause = "";
        let whereClause = "";
        let params = {};
        let declareType = "Utf8";

        if (criteria.id) {
          whereClause = "id = $search_val";
          params = { $search_val: TypedValues.utf8(String(criteria.id)) };
        } else if (criteria.tg_id) {
          // ИСПОЛЬЗУЕМ ИНДЕКС VIEW
          viewClause = "VIEW idx_tg_id";
          whereClause = "tg_id = $search_val";
          params = { $search_val: TypedValues.uint64(String(criteria.tg_id)) };
          declareType = "Uint64";
        } else if (criteria.email) {
          viewClause = "VIEW idx_email";
          whereClause = "email = $search_val";
          params = {
            $search_val: TypedValues.utf8(String(criteria.email).toLowerCase()),
          };
        } else if (criteria.web_id) {
          viewClause = "VIEW idx_web_id";
          whereClause = "web_id = $search_val";
          params = { $search_val: TypedValues.utf8(String(criteria.web_id)) };
        } else if (criteria.sh_user_id) {
          // ✅ v7.2: Поиск по SetHubble ID (омниканальное слияние)
          viewClause = "VIEW idx_sh_user_id";
          whereClause = "sh_user_id = $search_val";
          params = { $search_val: TypedValues.utf8(String(criteria.sh_user_id)) };
        } else if (criteria.vk_id) {
          viewClause = "VIEW idx_vk_id";
          whereClause = "vk_id = $search_val";
          params = { $search_val: TypedValues.uint64(String(criteria.vk_id)) };
          declareType = "Uint64";
        } else {
          return null;
        }

        // Подставляем VIEW в запрос
        const query = `
          DECLARE $search_val AS ${declareType};
          SELECT ${USER_FIELDS} FROM users ${viewClause} WHERE ${whereClause};
        `;

        const { resultSets } = await session.executeQuery(query, params);
        if (!resultSets[0] || resultSets[0].rows.length === 0) return null;

        return mapUser(resultSets[0].rows[0]);
      });
    } catch (e) {
      // ИСПОЛЬЗУЕМ НАШ НОВЫЙ ХЕЛПЕР
      if (isTransientYdbError(e) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log.warn(`[findUser] Transient error, retry ${attempt+1}/${maxRetries} in ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      log.error(`Failed to find user by criteria`, e.message || String(e), criteria);
      return null;
    }
  }
  return null;
}

export async function verifyEmailCode(email, code) {
  if (!email || !code) return { valid: false, error: "Missing email or code" };

  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $email AS Utf8;
        DECLARE $code AS Utf8;
        SELECT ${USER_FIELDS} FROM users VIEW idx_email WHERE email = $email LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $email: TypedValues.utf8(email.toLowerCase()),
      });

      if (!resultSets[0] || resultSets[0].rows.length === 0) {
        return { valid: false, error: "User not found" };
      }

      const user = mapUser(resultSets[0].rows[0]);
      const sessionData = user.session || {};
      const storedCode = sessionData.email_verification_code;
      const codeExpiry = sessionData.email_verification_expires;

      if (!storedCode || storedCode !== code) {
        return { valid: false, error: "Invalid code" };
      }

      if (codeExpiry && Date.now() > codeExpiry) {
        return { valid: false, error: "Code expired" };
      }

      sessionData.email_verified = true;
      sessionData.email_verification_code = null;
      sessionData.email_verification_expires = null;
      if (!sessionData.channels) sessionData.channels = {};
      if (!sessionData.channels.email) sessionData.channels.email = {};
      sessionData.channels.email.subscribed = true;
      sessionData.channels.email.verified = true;

      const updateQuery = `
        DECLARE $uid AS Utf8;
        DECLARE $js AS Json;
        DECLARE $sv AS Uint64;
        UPSERT INTO users (id, session, session_version) VALUES ($uid, $js, $sv);
      `;
      await session.executeQuery(updateQuery, {
        $uid: TypedValues.utf8(user.id),
        $js: TypedValues.json(JSON.stringify(sessionData)),
        $sv: TypedValues.uint64(String((user.session_version || 0) + 1)),
      });

      return { valid: true, user };
    });
  } catch (e) {
    log.error(`[VERIFY EMAIL] Failed`, e.message || String(e), { email });
    return { valid: false, error: "Verification failed" };
  }
}

export async function getUser(userId) {
  if (!userId || typeof userId !== "string") return null;

  try {
    return await driver.tableClient.withSession(async (session) => {
      let query, params;

      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          userId,
        )
      ) {
        query = `DECLARE $id AS Utf8; SELECT ${USER_FIELDS} FROM users WHERE id = $id;`;
        params = { $id: TypedValues.utf8(userId) };
      } else if (/^\d{3,20}$/.test(userId)) {
        // Добавили VIEW idx_tg_id
        query = `DECLARE $id AS Uint64; SELECT ${USER_FIELDS} FROM users VIEW idx_tg_id WHERE tg_id = $id OR vk_id = $id LIMIT 1;`;
        params = { $id: TypedValues.uint64(userId) };
      } else if (
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId)
      ) {
        // Добавили VIEW idx_email
        query = `DECLARE $email AS Utf8; SELECT ${USER_FIELDS} FROM users VIEW idx_email WHERE email = $email;`;
        params = { $email: TypedValues.utf8(userId.toLowerCase()) };
      } else {
        const cleanId = userId.replace(/^(vk:|email:|web:)/, "");
        // Добавили VIEW idx_web_id
        query = `DECLARE $wid AS Utf8; SELECT ${USER_FIELDS} FROM users VIEW idx_web_id WHERE web_id = $wid OR id = $wid LIMIT 1;`;
        params = { $wid: TypedValues.utf8(cleanId) };
      }

      const { resultSets } = await session.executeQuery(query, params);
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      return mapUser(resultSets[0].rows[0]);
    });
  } catch (e) {
    log.error(`Failed to get user`, e.message || String(e), { userId });
    return null;
  }
}

export async function saveUser(user) {
  const userId = user.id || crypto.randomUUID();
  let tgId = user.tg_id;
  if (!tgId && user.user_id && /^\d{3,20}$/.test(String(user.user_id))) {
    tgId = Number(user.user_id);
  }

  // === ИСПРАВЛЕНИЕ: Jitter (размазывание нагрузки) ===
  // Добавляем случайную паузу от 10 до 50 мс перед попыткой сохранения.
  // Это предотвращает одновременный удар по базе от нескольких контейнеров
  // и размазывает пиковые всплески запросов во времени.
  await new Promise(res => setTimeout(res, 10 + Math.random() * 40));

  // Retry logic for RESOURCE_EXHAUSTED errors
  const maxRetries = 4;
  const baseDelayMs = 400;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
          $aiUntil: TypedValues.uint64(String(user.ai_active_until || 0)),
          $cak: TypedValues.utf8(String(user.custom_api_key || "")),
          $cp: TypedValues.utf8(String(user.custom_prompt || "")),
          $aim: TypedValues.utf8(String(user.ai_model || "")),
          $aip: TypedValues.utf8(String(user.ai_provider || "")),
          $udl: TypedValues.uint64(String(user.user_daily_limit || 0)),
        };

        const query = `
          DECLARE $id AS Utf8; DECLARE $email AS Utf8;
          DECLARE $tg_id AS Uint64; DECLARE $vk_id AS Uint64; DECLARE $web_id AS Utf8;
          DECLARE $pid AS Utf8; DECLARE $st AS Utf8; DECLARE $br AS Bool;
          DECLARE $js AS Json; DECLARE $ls AS Uint64; DECLARE $sv AS Utf8; DECLARE $bt AS Utf8;
          DECLARE $tr AS Utf8; DECLARE $shui AS Utf8; DECLARE $shrt AS Utf8; DECLARE $pur AS Json;
          DECLARE $fn AS Utf8; DECLARE $lrt AS Uint64; DECLARE $rc AS Uint64; DECLARE $pc AS Utf8;
          DECLARE $newVer AS Uint64; DECLARE $cat AS Uint64; DECLARE $aiUntil AS Uint64;
          DECLARE $cak AS Utf8; DECLARE $cp AS Utf8; DECLARE $aim AS Utf8; DECLARE $aip AS Utf8; DECLARE $udl AS Uint64;

          UPSERT INTO users (
            id, email, tg_id, vk_id, web_id,
            partner_id, state, bought_tripwire, session,
            last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases,
            first_name, last_reminder_time, reminders_count, pin_code, session_version, ai_active_until, created_at,
            custom_api_key, custom_prompt, ai_model, ai_provider, user_daily_limit
          ) VALUES (
            $id, $email, $tg_id, $vk_id, $web_id,
            $pid, $st, $br, $js, $ls, $sv, $bt, $tr, $shui, $shrt, $pur, $fn, $lrt, $rc, $pc, $newVer, $aiUntil, $cat,
            $cak, $cp, $aim, $aip, $udl
          );
        `;
        await session.executeQuery(query, params);

        return { success: true, id: userId, version: newVersion };
      });
    } catch (e) {
      // ИСПОЛЬЗУЕМ НАШ НОВЫЙ ХЕЛПЕР
      if (isTransientYdbError(e) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log.warn(`[saveUser] Transient error, retry ${attempt + 1}/${maxRetries} in ${delay}ms`, { userId });
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      log.error(`Failed to save user`, e.message || String(e), { userId, attempt });
      return { success: false };
    }
  }

  return { success: false };
}

/**
 * ОПТИМИЗАЦИЯ: Частичное обновление пользователя — UPDATE только указанных полей.
 * Вместо полного UPSERT всех 28 колонок (saveUser) обновляет только то, что реально изменилось.
 * Это снижает нагрузку на YDB и уменьшает объём передаваемых данных.
 *
 * @param {string} userId - ID пользователя
 * @param {Object} fields - Объект с полями для обновления { state, last_seen, session, ... }
 * @param {number} expectedVersion - Ожидаемая версия для optimistic lock (session_version)
 * @returns {Promise<boolean>} true если обновление успешно
 */
export async function partialUpdateUser(userId, fields, expectedVersion) {
  if (!userId || !fields || Object.keys(fields).length === 0) return false;
  try {
    return await driver.tableClient.withSession(async (session) => {
      const setClauses = [];
      const params = {
        $id: TypedValues.utf8(String(userId)),
      };

      if (fields.state !== undefined) {
        setClauses.push("state = $st");
        params.$st = TypedValues.utf8(String(fields.state));
      }
      if (fields.last_seen !== undefined) {
        setClauses.push("last_seen = $ls");
        params.$ls = TypedValues.uint64(String(fields.last_seen));
      }
      if (fields.session !== undefined) {
        setClauses.push("session = $js");
        params.$js = TypedValues.json(JSON.stringify(fields.session));
      }
      if (fields.saved_state !== undefined) {
        setClauses.push("saved_state = $sv");
        params.$sv = TypedValues.utf8(String(fields.saved_state));
      }
      if (fields.email !== undefined) {
        setClauses.push("email = $em");
        params.$em = TypedValues.utf8(String(fields.email).toLowerCase());
      }
      if (fields.bot_token !== undefined) {
        setClauses.push("bot_token = $bt");
        params.$bt = TypedValues.utf8(String(fields.bot_token));
      }
      if (fields.tg_id !== undefined) {
        setClauses.push("tg_id = $tg");
        params.$tg = TypedValues.uint64(String(fields.tg_id));
      }
      if (fields.vk_id !== undefined) {
        setClauses.push("vk_id = $vk");
        params.$vk = TypedValues.uint64(String(fields.vk_id));
      }
      if (fields.web_id !== undefined) {
        setClauses.push("web_id = $wb");
        params.$wb = TypedValues.utf8(String(fields.web_id));
      }
      if (fields.last_reminder_time !== undefined) {
        setClauses.push("last_reminder_time = $lrt");
        params.$lrt = TypedValues.uint64(String(fields.last_reminder_time));
      }
      if (fields.reminders_count !== undefined) {
        setClauses.push("reminders_count = $rc");
        params.$rc = TypedValues.uint64(String(fields.reminders_count));
      }
      if (fields.bought_tripwire !== undefined) {
        setClauses.push("bought_tripwire = $br");
        params.$br = TypedValues.bool(Boolean(fields.bought_tripwire));
      }
      if (fields.purchases !== undefined) {
        setClauses.push("purchases = $pur");
        params.$pur = TypedValues.json(JSON.stringify(fields.purchases));
      }
      if (fields.partner_id !== undefined) {
        setClauses.push("partner_id = $pid");
        params.$pid = TypedValues.utf8(String(fields.partner_id));
      }
      if (fields.first_name !== undefined) {
        setClauses.push("first_name = $fn");
        params.$fn = TypedValues.utf8(String(fields.first_name));
      }
      if (fields.ai_active_until !== undefined) {
        setClauses.push("ai_active_until = $aiUntil");
        params.$aiUntil = TypedValues.uint64(String(fields.ai_active_until));
      }
      if (fields.tariff !== undefined) {
        setClauses.push("tariff = $tr");
        params.$tr = TypedValues.utf8(String(fields.tariff));
      }
      if (fields.pin_code !== undefined) {
        setClauses.push("pin_code = $pc");
        params.$pc = TypedValues.utf8(String(fields.pin_code));
      }

      // Всегда обновляем session_version (оптимистичная блокировка)
      const newVersion = (expectedVersion || 0) + 1;
      setClauses.push("session_version = $newVer");
      params.$newVer = TypedValues.uint64(String(newVersion));

      if (setClauses.length === 1) {
        // Только session_version — ничего не изменилось
        return false;
      }

      const whereClause = expectedVersion
        ? "WHERE id = $id AND session_version = $expVer"
        : "WHERE id = $id";
      if (expectedVersion) {
        params.$expVer = TypedValues.uint64(String(expectedVersion));
      }

      const query = `
        DECLARE $id AS Utf8;
        UPDATE users SET ${setClauses.join(", ")} ${whereClause};
      `;
      await session.executeQuery(query, params);
      return true;
    });
  } catch (e) {
    log.warn(`[partialUpdateUser] Failed for ${userId}: ${e.message}`);
    return false;
  }
}

export async function mergeUsers(
  surviving,
  deletedUserId,
  reason = "auto_merge",
) {
  const mergeId = crypto.randomUUID();

  try {
    return await driver.tableClient.withSession(async (session) => {
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
        $js: TypedValues.json(
          JSON.stringify(surviving.session || { tags: [] }),
        ),
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
        $aiUntil: TypedValues.uint64(String(surviving.ai_active_until || 0)),
        $mergeId: TypedValues.utf8(mergeId),
        $survId: TypedValues.utf8(String(surviving.id)),
        $delId: TypedValues.utf8(String(deletedUserId)),
        $reason: TypedValues.utf8(String(reason)),
        $mergeTs: TypedValues.uint64(String(now)),
      };

      const query = `
        DECLARE $id AS Utf8; DECLARE $email AS Utf8;
        DECLARE $tg_id AS Uint64; DECLARE $vk_id AS Uint64; DECLARE $web_id AS Utf8;
        DECLARE $pid AS Utf8; DECLARE $st AS Utf8; DECLARE $br AS Bool;
        DECLARE $js AS Json; DECLARE $ls AS Uint64; DECLARE $sv AS Utf8; DECLARE $bt AS Utf8;
        DECLARE $tr AS Utf8; DECLARE $shui AS Utf8; DECLARE $shrt AS Utf8; DECLARE $pur AS Json;
        DECLARE $fn AS Utf8; DECLARE $lrt AS Uint64; DECLARE $rc AS Uint64; DECLARE $pc AS Utf8;
        DECLARE $newVer AS Uint64; DECLARE $cat AS Uint64; DECLARE $aiUntil AS Uint64;
        DECLARE $mergeId AS Utf8; DECLARE $survId AS Utf8; DECLARE $delId AS Utf8;
        DECLARE $reason AS Utf8; DECLARE $mergeTs AS Uint64;

        UPSERT INTO users (
          id, email, tg_id, vk_id, web_id,
          partner_id, state, bought_tripwire, session,
          last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases,
          first_name, last_reminder_time, reminders_count, pin_code, session_version, ai_active_until, created_at
        ) VALUES (
          $id, $email, $tg_id, $vk_id, $web_id,
          $pid, $st, $br, $js, $ls, $sv, $bt, $tr, $shui, $shrt, $pur, $fn, $lrt, $rc, $pc, $newVer, $aiUntil, $cat
        );

        UPSERT INTO user_merges (id, surviving_user_id, deleted_user_id, merge_reason, merged_at)
        VALUES ($mergeId, $survId, $delId, $reason, $mergeTs);

        DELETE FROM users WHERE id = $delId;
      `;

      await session.executeQuery(query, saveParams);
      return true;
    });
  } catch (e) {
    log.error(
      `[MERGE FAILED] Could not merge ${deletedUserId} into ${surviving?.id}`,
      e.message || String(e),
    );
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
  if (token && !isValidBotToken(token)) return;
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

      // Инвалидация кэша после регистрации бота
      if (token) botInfoCache.delete(token);
    });
  } catch (e) {
    log.error(`Failed to register partner bot`, e.message || String(e));
  }
}

export async function updatePartnerBot(token, updates) {
  if (!isValidBotToken(token)) return;
  try {
    return await driver.tableClient.withSession(async (session) => {
      const updatesQuery = Object.entries(updates)
        .map(([key, value]) => `${key} = $${key}`)
        .join(", ");
      const query = `
        DECLARE $tok AS Utf8;
        UPDATE bots SET ${updatesQuery} WHERE bot_token = $tok;
      `;
      const params = { $tok: TypedValues.utf8(String(token)) };
      Object.entries(updates).forEach(([key, value]) => {
        params[`$${key}`] = TypedValues.utf8(String(value));
      });
      await session.executeQuery(query, params);

      // Инвалидация кэша после обновления бота
      botInfoCache.delete(token);
    });
  } catch (e) {
    log.error(`Failed to update partner bot`, e.message || String(e));
  }
}

export async function getBotInfo(token) {
  if (!isValidBotToken(token)) return null;

  // ОПТИМИЗАЦИЯ: Читаем из кэша
  const cached = botInfoCache.get(token);
  if (cached) return cached;

  try {
    return await driver.tableClient.withSession(async (session) => {
      // v7.0: Added AI columns (ai_provider, ai_model, custom_api_key, custom_prompt, user_daily_limit)
      const query = `DECLARE $tok AS Utf8; SELECT user_id, sh_user_id, sh_ref_tail, tripwire_link, bot_username, ai_provider, ai_model, custom_api_key, custom_prompt, user_daily_limit FROM bots WHERE bot_token = $tok;`;
      const { resultSets } = await session.executeQuery(query, {
        $tok: TypedValues.utf8(String(token)),
      });
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      const r = resultSets[0].rows[0];
      const botData = {
        owner_id: r.items[0].textValue,
        sh_user_id: r.items[1]?.textValue || "",
        sh_ref_tail: r.items[2]?.textValue || "",
        tripwire_link: r.items[3]?.textValue || "",
        bot_username: r.items[4]?.textValue || "",
        // v7.0 AI-поля для конструктора ИИ-сотрудников
        ai_provider: r.items[5]?.textValue || "polza",
        ai_model: r.items[6]?.textValue || "openai/gpt-4o-mini",
        custom_api_key: r.items[7]?.textValue || "",
        custom_prompt: r.items[8]?.textValue || "",
        user_daily_limit: r.items[9]?.uint64Value
          ? Number(r.items[9].uint64Value)
          : 0,
      };

      // ОПТИМИЗАЦИЯ: Пишем в кэш
      botInfoCache.set(token, botData);
      return botData;
    });
  } catch (e) {
    log.error(`Failed to get bot info`, e.message || String(e));
    return null;
  }
}

export async function getBotInfoByVkGroup(groupId) {
  if (!groupId) return null;

  // ОПТИМИЗАЦИЯ: Читаем из кэша (используем тот же кэш, ключ = "vk:" + groupId)
  const cacheKey = `vk:${groupId}`;
  const cached = botInfoCache.get(cacheKey);
  if (cached) return cached;

  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $gid AS Utf8; SELECT user_id, sh_user_id, sh_ref_tail, bot_username FROM bots VIEW idx_bots_vk_group_id WHERE vk_group_id = $gid;`;
      const { resultSets } = await session.executeQuery(query, {
        $gid: TypedValues.utf8(String(groupId)),
      });
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      const r = resultSets[0].rows[0];
      const botData = {
        owner_id: r.items[0].textValue,
        sh_user_id: r.items[1]?.textValue || "",
        sh_ref_tail: r.items[2]?.textValue || "",
        bot_username: r.items[3]?.textValue || "",
      };

      // ОПТИМИЗАЦИЯ: Пишем в кэш
      botInfoCache.set(cacheKey, botData);
      return botData;
    });
  } catch (e) {
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
        `DECLARE $ts AS List<Utf8>; SELECT COUNT(*) as t, COUNT_IF(bought_tripwire = true) as s FROM users VIEW idx_partner_id WHERE partner_id IN $ts;`,
        { $ts: TypedValues.list(utf8Type, tails) },
      );
      const statsRow = userRes.resultSets[0].rows[0];
      return {
        total: Number(statsRow.items[0].uint64Value),
        sales: Number(statsRow.items[1].uint64Value),
      };
    });
  } catch (e) {
    return { total: 0, sales: 0 };
  }
}

// === ИСПРАВЛЕНИЕ: Выбираем id и tg_id вместо старого user_id ===
export async function getUserReferrals(userId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const botRes = await session.executeQuery(
        `DECLARE $uid AS Utf8; SELECT sh_ref_tail FROM bots WHERE user_id = $uid;`,
        { $uid: TypedValues.utf8(String(userId)) },
      );
      const tails = (botRes.resultSets[0]?.rows || [])
        .map((r) => r.items[0].textValue)
        .filter((t) => t);
      if (tails.length === 0) return [];

      const utf8Type = TypedValues.utf8("").type;
      const userRes = await session.executeQuery(
        `DECLARE $ts AS List<Utf8>;
         SELECT id, tg_id, first_name, last_seen, bought_tripwire
         FROM users VIEW idx_partner_id
         WHERE partner_id IN $ts
         ORDER BY last_seen DESC LIMIT 50;`,
        { $ts: TypedValues.list(utf8Type, tails) },
      );

      return (userRes.resultSets[0]?.rows || []).map((r) => {
        const id = r.items[0].textValue;
        const tgId = r.items[1].uint64Value
          ? String(r.items[1].uint64Value)
          : null;
        return {
          user_id: tgId || id, // Сохраняем совместимость для фронтенда CRM
          first_name: r.items[2].textValue || "Друг",
          last_seen: r.items[3].uint64Value
            ? Number(r.items[3].uint64Value)
            : 0,
          bought_tripwire: r.items[4].boolValue || false,
        };
      });
    });
  } catch (e) {
    log.error(`Failed to get user referrals`, e.message || String(e), {
      userId,
    });
    return [];
  }
}

export async function getBotUsers(botToken, limit = 100, offset = 0) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8; DECLARE $l AS Uint64; DECLARE $o AS Uint64;
         SELECT ${USER_FIELDS} FROM users VIEW idx_bot_token WHERE bot_token = $bt ORDER BY last_seen DESC LIMIT $l OFFSET $o;`,
        {
          $bt: TypedValues.utf8(String(botToken)),
          $l: TypedValues.uint64(String(limit)),
          $o: TypedValues.uint64(String(offset)),
        },
      );
      return (resultSets[0]?.rows || []).map((r) => mapUser(r));
    });
  } catch (e) {
    log.error(`Failed to get bot users`, e.message || String(e));
    return [];
  }
}

export async function getBotUsersCount(botToken) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8; SELECT COUNT(*) as cnt FROM users VIEW idx_bot_token WHERE bot_token = $bt;`,
        { $bt: TypedValues.utf8(String(botToken)) },
      );
      if (!resultSets[0] || resultSets[0].rows.length === 0) return 0;
      return Number(resultSets[0].rows[0].items[0].uint64Value);
    });
  } catch (e) {
    return 0;
  }
}

export async function getUsersByPartner(partnerId, limit = 10000, offset = 0) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $pid AS Utf8; DECLARE $l AS Uint64; DECLARE $o AS Uint64;
         SELECT ${USER_FIELDS} FROM users
         VIEW idx_partner_id
         WHERE partner_id = $pid
         ORDER BY last_seen DESC LIMIT $l OFFSET $o;`,
        {
          $pid: TypedValues.utf8(String(partnerId)),
          $l: TypedValues.uint64(String(limit)),
          $o: TypedValues.uint64(String(offset)),
        },
      );
      return (resultSets[0]?.rows || []).map((r) => mapUser(r));
    });
  } catch (e) {
    log.error(`Failed to get users by partner`, e.message || String(e));
    return [];
  }
}

export async function getPartnerUsersCount(partnerId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $pid AS Utf8; SELECT COUNT(*) as cnt FROM users VIEW idx_partner_id WHERE partner_id = $pid;`,
        { $pid: TypedValues.utf8(String(partnerId)) },
      );
      if (!resultSets[0] || resultSets[0].rows.length === 0) return 0;
      return Number(resultSets[0].rows[0].items[0].uint64Value);
    });
  } catch (e) {
    return 0;
  }
}

export async function getPartnerStatsByFunnel(partnerId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $pid AS Utf8;
         SELECT state, bought_tripwire, COUNT(*) AS cnt FROM users VIEW idx_partner_id WHERE partner_id = $pid GROUP BY state, bought_tripwire;`,
        { $pid: TypedValues.utf8(String(partnerId)) },
      );

      let total = 0, paid = 0, start_count = 0, training_count = 0, tripwire_count = 0, delivery_count = 0;
      for (const row of resultSets[0]?.rows || []) {
        const items = row.items || [];
        const st = items[0]?.textValue || items[0]?.utf8Value || "";
        const isPro = items[1]?.boolValue === true;
        const count = Number(items[2]?.uint64Value || 0);

        total += count;
        if (isPro) { paid += count; delivery_count += count; }
        else {
          if (st === "START") start_count += count;
          else if (st.includes("Module") || st.includes("Theory") || st.includes("Training")) training_count += count;
          else if (st.includes("Tripwire") || st.includes("Offer") || st === "FAQ_PRO") tripwire_count += count;
        }
      }
      return {
        total, paid,
        byStage: { start: start_count, training: training_count, tripwire: tripwire_count, delivery: delivery_count },
      };
    });
  } catch (e) {
    return { total: 0, paid: 0, byStage: { start: 0, training: 0, tripwire: 0, delivery: 0 } };
  }
}

export async function getBotStats(botToken) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8;
         SELECT state, bought_tripwire, COUNT(*) AS cnt FROM users VIEW idx_bot_token WHERE bot_token = $bt GROUP BY state, bought_tripwire;`,
        { $bt: TypedValues.utf8(String(botToken)) },
      );
      let total = 0,
        paid = 0,
        start_count = 0,
        training_count = 0,
        tripwire_count = 0,
        delivery_count = 0;
      for (const row of resultSets[0]?.rows || []) {
        const items = row.items || [];
        const st = items[0]?.textValue || items[0]?.utf8Value || "";
        const isPro = items[1]?.boolValue === true;
        const count = Number(items[2]?.uint64Value || 0);

        total += count;
        if (isPro) {
          paid += count;
          delivery_count += count;
        } else {
          if (st === "START") start_count += count;
          else if (
            st.includes("Module") ||
            st.includes("Theory") ||
            st.includes("Training")
          )
            training_count += count;
          else if (
            st.includes("Tripwire") ||
            st.includes("Offer") ||
            st === "FAQ_PRO"
          )
            tripwire_count += count;
        }
      }
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
    return {
      total: 0,
      paid: 0,
      byStage: { start: 0, training: 0, tripwire: 0, delivery: 0 },
    };
  }
}

export async function getStaleUsers(hoursAgo = 1, limit = 50, offset = 0) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const cutoff = Date.now() - hoursAgo * 60 * 60 * 1000;
      const { resultSets } = await session.executeQuery(
        `DECLARE $c AS Uint64; DECLARE $l AS Uint64; DECLARE $o AS Uint64;
         SELECT ${USER_FIELDS} FROM users VIEW idx_last_seen WHERE last_seen < $c ORDER BY last_seen ASC LIMIT $l OFFSET $o;`,
        {
          $c: TypedValues.uint64(String(cutoff)),
          $l: TypedValues.uint64(String(limit)),
          $o: TypedValues.uint64(String(offset)),
        },
      );
      return (resultSets[0]?.rows || []).map((row) => mapUser(row));
    });
  } catch (e) {
    return [];
  }
}

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
  for (let i = 0; i < userIds.length; i += rateLimit) {
    const chunk = userIds.slice(i, i + rateLimit);
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
            if (
              error.response?.body?.error_code === 429 &&
              attempt < maxRetries
            ) {
              const delay =
                Math.min(
                  (error.response?.body?.parameters?.retry_after || 1) *
                    Math.pow(2, attempt),
                  10,
                ) * 1000;
              await new Promise((res) => setTimeout(res, delay));
              continue;
            }
            return { success: false, userId, error: lastError };
          }
        }
        return { success: false, userId, error: lastError };
      }),
    );
    chunkResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value.success) results.sent++;
      else {
        results.failed++;
        if (
          (result.reason || result.value?.error)?.response?.body?.error_code ===
          429
        )
          results.rateLimited++;
      }
    });
    if (i + rateLimit < userIds.length)
      await new Promise((r) => setTimeout(r, pauseBetweenChunksSec * 1000));
  }
  return results;
}

export function validateTelegramInitData(initData, botToken) {
  try {
    if (!initData) return null;
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return null;

    const dataCheckArr = [];
    for (const [key, value] of urlParams.entries()) {
      if (key !== "hash") dataCheckArr.push(`${key}=${value}`);
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

    if (calculatedHash !== hash) return null;
    const authDate = parseInt(urlParams.get("auth_date") || "0", 10);
    if (Math.floor(Date.now() / 1000) - authDate > 24 * 60 * 60) return null;

    const result = {};
    for (const [key, value] of urlParams.entries()) {
      if (key === "user") result.user = JSON.parse(value);
      else if (key !== "hash" && key !== "auth_date") result[key] = value;
    }
    result.auth_date = authDate;
    return result;
  } catch (e) {
    return null;
  }
}

export function isAdmin(telegramId) {
  const adminIds = (process.env.CRM_ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id);
  return adminIds.includes(String(telegramId));
}

/**
 * ОПТИМИЗАЦИЯ: Легкий запрос только для проверки даты подписки ИИ владельца.
 * Вместо загрузки всего профиля пользователя (getUser) запрашиваем только одно поле.
 * Результат кэшируется на 60 секунд.
 *
 * @param {string} ownerId - ID владельца бота
 * @returns {Promise<number>} timestamp окончания подписки или 0
 */
export async function getOwnerAiStatus(ownerId) {
  if (!ownerId) return 0;

  const cached = ownerAiCache.get(String(ownerId));
  if (cached !== undefined) return cached;

  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $id AS Utf8; SELECT ai_active_until FROM users WHERE id = $id;`;
      const { resultSets } = await session.executeQuery(query, {
        $id: TypedValues.utf8(String(ownerId)),
      });

      let activeUntil = 0;
      if (resultSets[0] && resultSets[0].rows.length > 0) {
        activeUntil = resultSets[0].rows[0].items[0]?.uint64Value
          ? Number(resultSets[0].rows[0].items[0].uint64Value)
          : 0;
      }

      ownerAiCache.set(String(ownerId), activeUntil);
      return activeUntil;
    });
  } catch (e) {
    log.error(`Failed to get owner AI status`, e.message || String(e));
    return 0;
  }
}

/**
 * Проверить, активна ли ИИ-подписка владельца канала (омниканальная проверка)
 * @param {object} leadUser - пользователь-лид (из любого канала)
 * @param {string|null} botToken - токен Telegram бота (для TG канала)
 * @param {string|null} vkGroupId - ID группы VK (для VK канала)
 * @returns {Promise<boolean>} true если ИИ активен у владельца
 */
export async function isOwnerAiActive(leadUser, botToken, vkGroupId) {
  try {
    let ownerId = null;
    const MAIN_TOKEN = process.env.BOT_TOKEN;

    // 1. Пытаемся найти владельца через Telegram бота (теперь из кэша!)
    if (botToken && botToken !== "VK_CENTRAL_GROUP") {
      const botInfo = await getBotInfo(botToken);
      if (botInfo) ownerId = botInfo.owner_id;
    }
    // 2. Пытаемся найти владельца через VK группу (теперь из кэша!)
    else if (vkGroupId) {
      const botInfo = await getBotInfoByVkGroup(vkGroupId);
      if (botInfo) ownerId = botInfo.owner_id;
    }
    // 3. Ищем по реферальному хвосту (для Web-чата)
    else if (leadUser?.partner_id) {
      const utf8Type = TypedValues.utf8("").type;
      const ownerRows = await driver.tableClient.withSession(
        async (session) => {
          const { resultSets } = await session.executeQuery(
            `DECLARE $tail AS Utf8; SELECT id, ai_active_until FROM users VIEW idx_sh_ref_tail WHERE sh_ref_tail = $tail LIMIT 1;`,
            { $tail: TypedValues.utf8(String(leadUser.partner_id)) },
          );
          return resultSets[0]?.rows || [];
        },
      );
      if (ownerRows.length > 0) {
        const ownerIdFromRow = ownerRows[0].items[0]?.textValue;
        const activeUntil = ownerRows[0].items[1]?.uint64Value
          ? Number(ownerRows[0].items[1].uint64Value)
          : 0;
        // Если нашли владельца по partner_id, проверяем его ai_active_until
        if (ownerIdFromRow) {
          return activeUntil > Date.now();
        }
      }
    }

    // ОПТИМИЗАЦИЯ: Используем легкую функцию вместо загрузки всего юзера
    if (ownerId) {
      const activeUntil = await getOwnerAiStatus(ownerId);
      return activeUntil > Date.now();
    }

    // Если это главный системный бот, ИИ работает всегда
    if (botToken === MAIN_TOKEN) return true;

    return false;
  } catch (e) {
    log.error(
      "[AI SUBSCRIPTION] Error checking owner AI status",
      e.message || String(e),
    );
    return false;
  }
}

export async function recordLinkClick(partnerId, userId, botToken) {
  try {
    await driver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $pid AS Utf8; DECLARE $uid AS Utf8; DECLARE $bt AS Utf8; DECLARE $ts AS Uint64;
        UPSERT INTO link_clicks (partner_id, user_id, clicked_at, bot_token) VALUES ($pid, $uid, $ts, $bt);
      `;
      await session.executeQuery(query, {
        $pid: TypedValues.utf8(String(partnerId)),
        $uid: TypedValues.utf8(String(userId)),
        $bt: TypedValues.utf8(String(botToken)),
        $ts: TypedValues.uint64(String(Date.now())),
      });
    });
  } catch (e) {
    log.error(`[LINK CLICK] Failed to record`, e.message || String(e));
  }
}

export async function getPartnerClicks(partnerId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const query = `
        DECLARE $pid AS Utf8; DECLARE $cutoff AS Uint64;
        SELECT COUNT(*) as clicks FROM link_clicks WHERE partner_id = $pid AND clicked_at >= $cutoff;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $pid: TypedValues.utf8(String(partnerId)),
        $cutoff: TypedValues.uint64(String(cutoff)),
      });
      return resultSets[0]?.rows[0]
        ? Number(resultSets[0].rows[0].items[0].uint64Value)
        : 0;
    });
  } catch (e) {
    return 0;
  }
}

/**
 * Проверить, был ли уже обработан update_id (YDB-based deduplication)
 * @param {string} updateId - update_id из Telegram
 * @returns {Promise<boolean>} true если уже обработан
 */
export async function isUpdateProcessed(updateId) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $uid AS Utf8; SELECT update_id FROM processed_updates WHERE update_id = $uid;`;
      const { resultSets } = await session.executeQuery(query, {
        $uid: TypedValues.utf8(String(updateId)),
      });
      return resultSets[0]?.rows?.length > 0;
    });
  } catch (e) {
    log.warn(
      `[PROCESSED UPDATES] Check failed, allowing through: ${e.message}`,
    );
    return false;
  }
}

/**
 * Записать update_id как обработанный (YDB-based deduplication)
 * @param {string} updateId - update_id из Telegram
 * @param {number} ttlMs - TTL в миллисекундах (default: 5 минут)
 * @returns {Promise<boolean>} true если успешно записан
 */
export async function markUpdateProcessed(updateId, ttlMs = 5 * 60 * 1000) {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const now = Date.now();
      const expireAt = now + ttlMs;
      return await driver.tableClient.withSession(async (session) => {
        const query = `
          DECLARE $uid AS Utf8; DECLARE $processed_at AS Uint64; DECLARE $expire_at AS Uint64;
          UPSERT INTO processed_updates (update_id, processed_at, expire_at) VALUES ($uid, $processed_at, $expire_at);
        `;
        await session.executeQuery(query, {
          $uid: TypedValues.utf8(String(updateId)),
          $processed_at: TypedValues.uint64(String(now)),
          $expire_at: TypedValues.uint64(String(expireAt)),
        });
        return true;
      });
    } catch (e) {
      if (isTransientYdbError(e) && attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 300 * Math.pow(2, attempt)));
        continue;
      }
      log.warn(`[PROCESSED UPDATES] Mark failed: ${e.message}`);
      return false;
    }
  }
}

/**
 * Очистить просроченные записи в processed_updates (TTL cleanup)
 * @returns {Promise<number>} Количество удалённых записей
 */
export async function cleanupProcessedUpdates() {
  try {
    const now = Date.now();
    return await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $now AS Uint64; DELETE FROM processed_updates WHERE expire_at < $now;`;
      const result = await session.executeQuery(query, {
        $now: TypedValues.uint64(String(now)),
      });
      return result.status?.affectedRows || 0;
    });
  } catch (e) {
    log.warn(`[PROCESSED UPDATES] Cleanup failed: ${e.message}`);
    return 0;
  }
}

/**
 * Найти пользователя по реферальному хвосту (для Web-чата)
 */
export async function getUserByRefTail(tail) {
  if (!tail) return null;
  try {
    return await driver.tableClient.withSession(async (session) => {
      const query = `DECLARE $tail AS Utf8; SELECT ${USER_FIELDS} FROM users VIEW idx_sh_ref_tail WHERE sh_ref_tail = $tail LIMIT 1;`;
      const { resultSets } = await session.executeQuery(query, {
        $tail: TypedValues.utf8(String(tail)),
      });
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;
      return mapUser(resultSets[0].rows[0]);
    });
  } catch (e) {
    log.error(`Failed to get user by ref tail`, e.message || String(e));
    return null;
  }
}

/**
 * Батчевое обновление last_seen для списка пользователей
 * 1 запрос к БД вместо N индивидуальных saveUser
 */
export async function batchUpdateLastSeen(userIds) {
  if (!userIds || userIds.length === 0) return;
  try {
    return await driver.tableClient.withSession(async (session) => {
      const utf8Type = TypedValues.utf8("").type;
      const query = `
        DECLARE $ids AS List<Utf8>;
        DECLARE $now AS Uint64;
        UPDATE users SET last_seen = $now WHERE id IN $ids;
      `;
      await session.executeQuery(query, {
        $ids: TypedValues.list(utf8Type, userIds),
        $now: TypedValues.uint64(String(Date.now())),
      });
    });
  } catch (e) {
    log.error(`[BATCH UPDATE] Failed`, e.message);
  }
}

