/**
 * CRM API Handler — v5.0 Multi-Channel
 * actions: "get_crm_data", "export_csv", "send_crm_broadcast"
 *
 * Поддерживает фильтрацию и статистику по каналам:
 * - Telegram
 * - VK
 * - Web
 * - Email
 */

import TelegrafPkg from "telegraf";
const { Telegraf } = TelegrafPkg;
import channelManager from "../channels/channel_manager.js";
import { escapeHtml } from "../../utils/validator.js";

export async function handleCrmApi(event, context) {
  const {
    action,
    ydb,
    log,
    corsHeaders,
    authorizeCrmRequest,
    BROADCAST_RATE_LIMIT,
  } = context;

  const crmActions = ["get_crm_data", "export_csv", "send_crm_broadcast"];
  if (!crmActions.includes(action)) return null;

  log.info(`[CRM API] Request received`, {
    action,
    method: event.httpMethod,
    hasBody: !!event.body,
  });

  const auth = await authorizeCrmRequest(
    event.headers || {},
    event.body,
    event.isBase64Encoded,
  );
  if (auth.error) {
    log.error(`[CRM API] Auth failed`, auth.error);
    return auth.error;
  }

  log.info(`[CRM API] Auth successful`, {
    botToken: auth.botToken?.substring(0, 10) + "...",
    userId: auth.tgData?.user?.id,
  });

  const { botToken, data } = auth;

  // === GET CRM DATA ===
  if (action === "get_crm_data") {
    const page = parseInt(data.page) || 1;
    const pageSize = parseInt(data.pageSize) || 50;
    const offset = (page - 1) * pageSize;
    const totalCount = await ydb.getBotUsersCount(botToken);
    const users = await ydb.getBotUsers(botToken, pageSize, offset);
    const stats = await ydb.getBotStats(botToken);

    // Фильтр по каналу
    const channelFilter = data.channel || null;

    const leads = users
      .map((u) => {
        // Определяем канал пользователя
        const channels = channelManager.getChannelSummary(u);
        const primaryChannel = channelManager.getPrimaryChannel(u);

        // Если задан фильтр по каналу — пропускаем неподходящих
        if (channelFilter && primaryChannel !== channelFilter) return null;

        return {
          user_id: u.user_id,
          first_name: escapeHtml(u.first_name),
          state: u.state,
          bought_tripwire: u.bought_tripwire,
          last_seen: u.last_seen,
          tags: u.session?.tags || [],
          email: escapeHtml(u.session?.email || ""),
          // Мультиканальная информация
          primary_channel: primaryChannel,
          channels: channels,
          channel_states: u.session?.channel_states || {},
        };
      })
      .filter((u) => u !== null);

    // Статистика по каналам
    const channelStats = { telegram: 0, vk: 0, web: 0, email: 0 };
    users.forEach((u) => {
      const ch = channelManager.getPrimaryChannel(u);
      if (ch && channelStats[ch] !== undefined) channelStats[ch]++;
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        stats,
        leads,
        channelStats,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      }),
    };
  }

  // === SEND CRM BROADCAST ===
  if (action === "send_crm_broadcast") {
    const message = data.message;
    const filters = data.filters || {};
    let targetUserIds = data.user_ids || [];

    if (!message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing message text" }),
      };
    }

    if (Object.keys(filters).length > 0 || filters.channel) {
      // Загружаем всех пользователей бота + пользователей из других каналов
      const allUsers = await ydb.getBotUsers(botToken, 10000, 0);

      // Для мультиканальности загружаем всех неактивных пользователей (включая VK, web, email)
      // и фильтруем по bot_token или channel
      const allInactive = await ydb.getStaleUsers(99999, 10000, 0);
      const existingIds = new Set(allUsers.map((u) => u.user_id));
      for (const u of allInactive) {
        if (!existingIds.has(u.user_id)) {
          allUsers.push(u);
          existingIds.add(u.user_id);
        }
      }

      targetUserIds = allUsers
        .filter((u) => u !== null)
        .filter((u) => {
          let isMatch = true;

          // === Фильтр по каналу ===
          if (filters.channel) {
            const primaryCh = channelManager.getPrimaryChannel(u);
            isMatch = isMatch && primaryCh === filters.channel;
          }

          if (filters.filter_tab) {
            const tab = filters.filter_tab;
            if (tab === "PRO") isMatch = u.bought_tripwire === true;
            else if (tab === "FREE") isMatch = !u.bought_tripwire;
            else if (tab === "start") isMatch = u.state === "START";
            else if (tab === "training")
              isMatch =
                ((u.state || "").includes("Module") ||
                  (u.state || "").includes("Theory") ||
                  (u.state || "").includes("Training")) &&
                !u.bought_tripwire;
            else if (tab === "tripwire")
              isMatch =
                ((u.state || "").includes("Tripwire") ||
                  (u.state || "").includes("Offer") ||
                  u.state === "FAQ_PRO") &&
                !u.bought_tripwire;
            else if (tab === "offline")
              isMatch = (u.session?.tags || []).includes("segment_offline");
            else if (tab === "online")
              isMatch = (u.session?.tags || []).includes("segment_online");
          }

          if (filters.is_pro !== undefined) {
            isMatch = isMatch && u.bought_tripwire === filters.is_pro;
          }

          if (filters.tag) {
            isMatch = isMatch && u.session?.tags?.includes(filters.tag);
          }

          if (filters.state) {
            isMatch = isMatch && u.state === filters.state;
          }

          if (filters.sleeping_days) {
            const anchorTime = u.session?.last_activity || u.last_seen;
            const inactiveDays =
              (Date.now() - anchorTime) / (1000 * 60 * 60 * 24);
            isMatch = isMatch && inactiveDays >= filters.sleeping_days;
          }

          return isMatch;
        })
        .map((u) => u.user_id);
    }

    if (targetUserIds.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ matched_users: 0, sent: 0, failed: 0 }),
      };
    }

    // === Мультиканальная рассылка ===
    const allUsersForBroadcast = await ydb.getBotUsers(botToken, 10000, 0);
    const userMap = new Map(allUsersForBroadcast.map((u) => [u.user_id, u]));

    const tgUserIds = [];
    const vkUserIds = [];
    const emailUsers = [];

    for (const uid of targetUserIds) {
      let u = userMap.get(uid);
      if (!u) {
        // v6.0: Пробуем найти по разным каналам
        u = await ydb.findUser({ id: uid });
        if (!u && /^\d{3,20}$/.test(uid)) {
          u = await ydb.findUser({ tg_id: Number(uid) });
        }
        if (!u) {
          u = await ydb.findUser({ email: uid });
        }
      }
      if (!u) continue;

      const ch = channelManager.getPrimaryChannel(u);
      if (ch === "telegram") tgUserIds.push(uid);
      else if (ch === "vk") vkUserIds.push(uid);
      else if (ch === "email") emailUsers.push(u);
    }

    let totalSent = 0,
      totalFailed = 0;
    const results = {};

    // Telegram рассылка
    if (tgUserIds.length > 0) {
      const broadcastBot = new Telegraf(botToken);
      const tgResults = await ydb.broadcastWithRateLimit(
        broadcastBot,
        tgUserIds,
        message,
        {
          parse_mode: "HTML",
          ...(data.reply_markup ? { reply_markup: data.reply_markup } : {}),
        },
        BROADCAST_RATE_LIMIT,
      );
      totalSent += tgResults.sent;
      totalFailed += tgResults.failed;
      results.telegram = tgResults;
    }

    // VK рассылка (асинхронно батчами по 10)
    if (vkUserIds.length > 0 && process.env.VK_SERVICE_TOKEN) {
      const vkChunkSize = 10;
      for (let i = 0; i < vkUserIds.length; i += vkChunkSize) {
        const chunk = vkUserIds.slice(i, i + vkChunkSize);
        await Promise.all(chunk.map(async (uid) => {
          try {
            const vkUserId = uid.replace("vk:", "");
            const params = new URLSearchParams({
              access_token: process.env.VK_SERVICE_TOKEN,
              v: "5.199",
              user_id: vkUserId,
              random_id: String(Math.floor(Math.random() * 2147483647)),
              message: message.replace(/<[^>]*>/g, ""),
            });
            const resp = await fetch("https://api.vk.com/method/messages.send", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params.toString(),
            });
            const vkData = await resp.json();
            if (vkData.response) totalSent++; else totalFailed++;
          } catch {
            totalFailed++;
          }
        }));
      }
      results.vk = { sent: totalSent, failed: totalFailed };
    }

    // Email рассылка
    if (emailUsers.length > 0) {
      const { sendEmailBatch } = await import("../email/email_service.js");
      const emails = emailUsers
        .filter((u) => u.session?.email)
        .map((u) => ({
          to: u.session.email,
          subject: message.substring(0, 80),
          text: message.replace(/<[^>]*>/g, ""),
          html: message,
        }));
      if (emails.length > 0) {
        const emailResults = await sendEmailBatch(emails, {
          pauseBetweenMs: 200,
        });
        totalSent += emailResults.sent;
        totalFailed += emailResults.failed;
        results.email = emailResults;
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        matched_users: targetUserIds.length,
        sent: totalSent,
        failed: totalFailed,
        byChannel: results,
      }),
    };
  }

  // === EXPORT CSV ===
  if (action === "export_csv") {
    const allUsers = await ydb.getBotUsers(botToken, 10000, 0);

    // Также добавляем пользователей из других каналов (VK, web, email)
    const allInactive = await ydb.getStaleUsers(99999, 10000, 0);
    const existingIds = new Set(allUsers.map((u) => u.user_id));
    for (const u of allInactive) {
      if (!existingIds.has(u.user_id)) {
        allUsers.push(u);
      }
    }

    const csvRows = [
      [
        "user_id",
        "first_name",
        "state",
        "is_pro",
        "primary_channel",
        "email",
        "last_seen",
      ],
    ];
    allUsers
      .filter((u) => u !== null)
      .forEach((u) => {
        const primaryChannel =
          channelManager.getPrimaryChannel(u) || "telegram";
        csvRows.push([
          u.user_id,
          u.first_name || "",
          u.state || "",
          u.bought_tripwire ? "PRO" : "FREE",
          primaryChannel,
          u.session?.email || "",
          u.last_seen || 0,
        ]);
      });

    const csvContent = csvRows.map((row) => row.join(",")).join("\n");

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="leads.csv"',
      },
      body: csvContent,
    };
  }

  // === UPDATE AI SETTINGS (v7.1: Единый облачный интеллект) ===
  if (action === "update_ai_settings") {
    const { custom_prompt, ai_provider, ai_model, custom_api_key, user_daily_limit } = JSON.parse(event.body || "{}");

    const ownerId = auth.tgData?.user?.id;
    if (!ownerId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Owner not identified" }),
      };
    }

    // Находим партнёра по его Telegram ID
    const user = await ydb.findUser({ tg_id: Number(ownerId) });
    if (!user) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User not found" }),
      };
    }

    // Обновляем настройки ИИ в профиле партнёра
    user.custom_prompt = custom_prompt || "";
    user.ai_provider = ai_provider || "polza";
    user.ai_model = ai_model || "openai/gpt-4o-mini";
    user.custom_api_key = custom_api_key || "";
    user.user_daily_limit = user_daily_limit || 0;

    await ydb.saveUser(user);

    log.info("[AI SETTINGS] Updated for owner", { ownerId, ai_provider: user.ai_provider, ai_model: user.ai_model });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  }

  return null;
}
