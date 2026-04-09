/**
 * CRM API Handler
 * Обрабатывает запросы из CRM-дашборда
 * actions: "get_crm_data", "export_csv", "send_crm_broadcast"
 */

import TelegrafPkg from "telegraf";
const { Telegraf } = TelegrafPkg;

export async function handleCrmApi(event, context) {
  const { action, ydb, log, corsHeaders, authorizeCrmRequest, BROADCAST_RATE_LIMIT } = context;

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

    const leads = users
      .map((u) => ({
        user_id: u.user_id,
        first_name: u.first_name,
        state: u.state,
        bought_tripwire: u.bought_tripwire,
        last_seen: u.last_seen,
        tags: u.session?.tags || [],
      }))
      .filter((u) => u !== null);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        stats,
        leads,
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

    if (Object.keys(filters).length > 0) {
      const allIds = await ydb.getBotUsers(botToken);
      const allUsers = await Promise.all(allIds.map((id) => ydb.getUser(id)));

      targetUserIds = allUsers
        .filter((u) => u !== null)
        .filter((u) => {
          let isMatch = true;

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
            const inactiveDays = (Date.now() - anchorTime) / (1000 * 60 * 60 * 24);
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

    const extraOptions = { parse_mode: "HTML" };
    if (data.reply_markup) {
      extraOptions.reply_markup = data.reply_markup;
    }

    const broadcastBot = new Telegraf(botToken);
    const results = await ydb.broadcastWithRateLimit(
      broadcastBot,
      targetUserIds,
      message,
      extraOptions,
      BROADCAST_RATE_LIMIT,
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        matched_users: targetUserIds.length,
        sent: results.sent,
        failed: results.failed,
      }),
    };
  }

  // === EXPORT CSV ===
  if (action === "export_csv") {
    const allIds = await ydb.getBotUsers(botToken);
    const allUsers = await Promise.all(allIds.map((id) => ydb.getUser(id)));

    const csvRows = [
      ["user_id", "first_name", "state", "is_pro", "last_seen"],
    ];
    allUsers
      .filter((u) => u !== null)
      .forEach((u) => {
        csvRows.push([
          u.user_id,
          u.first_name || "",
          u.state || "",
          u.bought_tripwire ? "PRO" : "FREE",
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

  return null;
}
