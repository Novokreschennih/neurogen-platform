/**
 * Partner API Handler
 * Обрабатывает запросы на получение партнерских ссылок (для Promo-Kit WebApp)
 * action: params.action === "get_partner_link"
 */

export async function handlePartnerApi(event, context) {
  const {
    params,
    headers,
    response,
    ydb,
    log,
    MAIN_TOKEN,
    getHeader,
  } = context;

  if (params.action !== "get_partner_link") return null;

  const initData = getHeader(headers, "x-telegram-initdata");

  if (!initData) {
    return response(401, {
      success: false,
      error: "Telegram authorization required",
    });
  }

  try {
    const tgData = ydb.validateTelegramInitData(initData, MAIN_TOKEN);

    if (!tgData || !tgData.user) {
      return response(401, {
        success: false,
        error: "Invalid Telegram data",
      });
    }

    const telegramId = String(tgData.user.id);
    const firstName = tgData.user.first_name || "Партнёр";
    const username = tgData.user.username || telegramId;

    let user = await ydb.findUser({ tg_id: Number(telegramId) });

    if (!user) {
      user = {
        tg_id: Number(telegramId),
        partner_id: "",
        state: "START",
        bought_tripwire: false,
        session: {
          tags: ["lead_promo_kit"],
          dialog_history: [],
          xp: 0,
          mod1_done: false,
          mod2_done: false,
          mod3_done: false,
        },
        last_seen: Date.now(),
        saved_state: "",
        bot_token: MAIN_TOKEN,
        tariff: "",
        sh_user_id: "",
        sh_ref_tail: "",
        purchases: [],
        first_name: firstName,
        last_reminder_time: 0,
        reminders_count: 0,
      };
      const result = await ydb.saveUser(user);
      user.id = result.id;
      log.info(`[PROMO-KIT] New user registered via WebApp`, { userId: telegramId, dbId: result.id });
    }

    // === ГЕНЕРАЦИЯ РЕФЕРАЛЬНОЙ ССЫЛКИ ===
    let botUsername = "";
    let botToken = MAIN_TOKEN;
    let refLink = "";

    if (user.session?.bot_username) {
      botUsername = user.session.bot_username;
      botToken = user.bot_token || MAIN_TOKEN;
      refLink = `https://t.me/${botUsername}`;
      log.info(`[PROMO-KIT] Using partner's own bot (no payload)`, {
        userId: telegramId,
        botUsername,
      });
    } else {
      const botInfo = await ydb.getBotInfo(MAIN_TOKEN);
      botUsername = botInfo.username || "sethubble_bot";
      const partnerTail = user.sh_ref_tail || `id_${telegramId}`;
      refLink = `https://t.me/${botUsername}?start=${partnerTail}`;
      log.info(`[PROMO-KIT] Using main bot with tail`, {
        userId: telegramId,
        botUsername,
        partnerTail,
      });
    }

    const referrals = await ydb.getUserReferrals(telegramId);
    const earnings = referrals.length * 20 * 0.25;

    const partnerTail = user.sh_ref_tail || `id_${telegramId}`;
    const clicks = await ydb.getPartnerClicks(partnerTail);

    log.info(`[PROMO-KIT] Partner link generated`, {
      userId: telegramId,
      refLink,
      referrals: referrals.length,
      botUsername,
      clicks,
    });

    return response(200, {
      success: true,
      refLink,
      botName: botUsername,
      user: {
        id: telegramId,
        first_name: firstName,
        username,
        referrals: referrals.length,
        earnings: earnings.toFixed(2),
        clicks,
      },
    });
  } catch (error) {
    log.error(`[PROMO-KIT API] Error`, error);
    return response(500, {
      success: false,
      error: error.message || "Internal server error",
    });
  }
}
