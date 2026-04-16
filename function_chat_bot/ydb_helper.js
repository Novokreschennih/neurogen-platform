import crypto from "crypto";
import pkg from "ydb-sdk";
import { log } from "./src/utils/logger.js";
import { runMigrations } from "./src/utils/db_migrations.js";

const { Driver, getCredentialsFromEnv, TypedValues } = pkg;

export { log };

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
  "id, email, tg_id, vk_id, web_id, partner_id, state, bought_tripwire, session, last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases, first_name, last_reminder_time, reminders_count, pin_code, session_version, created_at";

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
    created_at: row.items[21]?.uint64Value
      ? Number(row.items[21].uint64Value)
      : null,

    // Обратная совместимость для старого кода (CRM, рассылки)
    get user_id() {
      return this.tg_id ? String(this.tg_id) : this.id;
    },
  };
}

export async function findUser(criteria) {
  if (!criteria || Object.keys(criteria).length === 0) return null;

  try {
    return await driver.tableClient.withSession(async (session) => {
      let whereClause = "";
      let params = {};
      let declareType = "Utf8";

      if (criteria.id) {
        whereClause = "id = $search_val";
        params = { $search_val: TypedValues.utf8(String(criteria.id)) };
      } else if (criteria.tg_id) {
        whereClause = "tg_id = $search_val";
        params = { $search_val: TypedValues.uint64(String(criteria.tg_id)) };
        declareType = "Uint64";
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
        declareType = "Uint64";
      } else {
        return null;
      }

      const query = `
        DECLARE $search_val AS ${declareType};
        SELECT ${USER_FIELDS} FROM users WHERE ${whereClause};
      `;

      const { resultSets } = await session.executeQuery(query, params);
      if (!resultSets[0] || resultSets[0].rows.length === 0) return null;

      return mapUser(resultSets[0].rows[0]);
    });
  } catch (e) {
    log.error(
      `Failed to find user by criteria`,
      e.message || String(e),
      criteria,
    );
    return null;
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
        query = `DECLARE $id AS Uint64; SELECT ${USER_FIELDS} FROM users WHERE tg_id = $id OR vk_id = $id LIMIT 1;`;
        params = { $id: TypedValues.uint64(userId) };
      } else if (
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userId)
      ) {
        query = `DECLARE $email AS Utf8; SELECT ${USER_FIELDS} FROM users WHERE email = $email;`;
        params = { $email: TypedValues.utf8(userId.toLowerCase()) };
      } else {
        const cleanId = userId.replace(/^(vk:|email:|web:)/, "");
        query = `DECLARE $wid AS Utf8; SELECT ${USER_FIELDS} FROM users WHERE web_id = $wid OR id = $wid LIMIT 1;`;
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

  // Retry logic for RESOURCE_EXHAUSTED errors
  const maxRetries = 3;
  const baseDelayMs = 500;

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
      const errMsg = e.message || String(e);
      const isResourceExhausted = errMsg.includes("RESOURCE_EXHAUSTED");

      if (isResourceExhausted && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log.warn(
          `[saveUser] RESOURCE_EXHAUSTED, retry ${attempt + 1}/${maxRetries} in ${delay}ms`,
          { userId },
        );
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      log.error(`Failed to save user`, errMsg, { userId, attempt });
      return { success: false };
    }
  }

  return { success: false };
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
        DECLARE $newVer AS Uint64; DECLARE $cat AS Uint64;
        DECLARE $mergeId AS Utf8; DECLARE $survId AS Utf8; DECLARE $delId AS Utf8;
        DECLARE $reason AS Utf8; DECLARE $mergeTs AS Uint64;

        UPSERT INTO users (
          id, email, tg_id, vk_id, web_id,
          partner_id, state, bought_tripwire, session,
          last_seen, saved_state, bot_token, tariff, sh_user_id, sh_ref_tail, purchases,
          first_name, last_reminder_time, reminders_count, pin_code, session_version, created_at
        ) VALUES (
          $id, $email, $tg_id, $vk_id, $web_id,
          $pid, $st, $br, $js, $ls, $sv, $bt, $tr, $shui, $shrt, $pur, $fn, $lrt, $rc, $pc, $newVer, $cat
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
    });
  } catch (e) {
    log.error(`Failed to update partner bot`, e.message || String(e));
  }
}

export async function getBotInfo(token) {
  if (!isValidBotToken(token)) return null;
  try {
    return await driver.tableClient.withSession(async (session) => {
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
        bot_username: r.items[4]?.textValue || "",
      };
    });
  } catch (e) {
    log.error(`Failed to get bot info`, e.message || String(e));
    return null;
  }
}

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
         FROM users
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
         SELECT ${USER_FIELDS} FROM users WHERE bot_token = $bt ORDER BY last_seen DESC LIMIT $l OFFSET $o;`,
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
        `DECLARE $bt AS Utf8; SELECT COUNT(*) as cnt FROM users WHERE bot_token = $bt;`,
        { $bt: TypedValues.utf8(String(botToken)) },
      );
      if (!resultSets[0] || resultSets[0].rows.length === 0) return 0;
      return Number(resultSets[0].rows[0].items[0].uint64Value);
    });
  } catch (e) {
    return 0;
  }
}

export async function getBotStats(botToken) {
  try {
    return await driver.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery(
        `DECLARE $bt AS Utf8;
         SELECT state, bought_tripwire, COUNT(*) AS cnt FROM users WHERE bot_token = $bt GROUP BY state, bought_tripwire;`,
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
