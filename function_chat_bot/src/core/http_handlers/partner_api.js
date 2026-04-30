/**
 * Partner API Handler
 * Обрабатывает запросы на получение партнерских ссылок (для Promo-Kit WebApp)
 * action: params.action === "get_partner_link" или "update_ai_settings"
 *
 * Поддерживает универсальную JWT-авторизацию:
 * - x-telegram-initdata (Telegram WebApp)
 * - Authorization: Bearer <jwt_token> (VK, Web)
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
    verifyToken,
  } = context;

  const actions = ["get_partner_link", "update_ai_settings"];
  if (!actions.includes(params.action)) return null;

  // v7.1: Universal authorization
  let telegramId = null;
  let firstName = "Партнёр";

  const authHeader =
    getHeader(headers, "authorization") || getHeader(headers, "Authorization");
  const initData = getHeader(headers, "x-telegram-initdata");

  // Priority: 1. JWT token (VK/Web), 2. Telegram initData
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken ? verifyToken(token) : null;
    if (decoded && decoded.uid) {
      telegramId = String(decoded.uid);
      firstName = decoded.first_name || "Партнёр";
      log.info(`[PARTNER API] JWT auth`, { userId: telegramId });
    }
  } else if (initData) {
    const tgData = ydb.validateTelegramInitData(initData, MAIN_TOKEN);
    if (tgData && tgData.user) {
      telegramId = String(tgData.user.id);
      firstName = tgData.user.first_name || "Партнёр";
      log.info(`[PARTNER API] Telegram auth`, { userId: telegramId });
    }
  }

  if (!telegramId) {
    return response(401, {
      success: false,
      error: "Authorization required",
    });
  }

  // === GET PARTNER LINK ===
  if (params.action === "get_partner_link") {
    try {
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
          },
          last_seen: Date.now(),
          saved_state: "",
          bot_token: MAIN_TOKEN,
          tariff: "",
          sh_user_id: "",
          sh_ref_tail: "",
          purchases: [],
          first_name: firstName,
        };
        const result = await ydb.saveUser(user);
        user.id = result.id;
        log.info(`[PARTNER API] New user registered`, { userId: telegramId });
      }

      let botUsername = "";
      let botToken = MAIN_TOKEN;
      let refLink = "";

      if (user.session?.bot_username) {
        botUsername = user.session.bot_username;
        botToken = user.bot_token || MAIN_TOKEN;
        refLink = `https://t.me/${botUsername}`;
      } else {
        const botInfo = await ydb.getBotInfo(MAIN_TOKEN);
        botUsername = botInfo?.bot_username || "sethubble_bot";
        const partnerTail = user.sh_ref_tail || `id_${telegramId}`;
        refLink = `https://t.me/${botUsername}?start=${partnerTail}`;
      }

      const referrals = await ydb.getUserReferrals(telegramId);
      const earnings = referrals.length * 20 * 0.25;
      const partnerTail = user.sh_ref_tail || `id_${telegramId}`;
      const clicks = await ydb.getPartnerClicks(partnerTail);

      return response(200, {
        success: true,
        refLink,
        botName: botUsername,
        user: {
          id: telegramId,
          first_name: firstName,
          referrals: referrals.length,
          earnings: earnings.toFixed(2),
          clicks,
          is_pro: user.bought_tripwire,
          partner_id: user.sh_ref_tail,
          ai_active_until: user.ai_active_until || 0,
        },
      });
    } catch (error) {
      log.error(`[PARTNER API] Error`, error);
      return response(500, {
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }

  // === UPDATE AI SETTINGS (v7.1: Universal cloud intelligence) ===
  if (params.action === "update_ai_settings") {
    try {
      let user = await ydb.findUser({ tg_id: Number(telegramId) });
      if (!user) {
        return response(404, {
          success: false,
          error: "User not found",
        });
      }

      // Parse body for AI settings
      let aiSettings = {};
      try {
        aiSettings = event.body ? JSON.parse(event.body) : {};
      } catch (e) {
        aiSettings = {};
      }

      const {
        custom_prompt,
        ai_provider,
        ai_model,
        custom_api_key,
        user_daily_limit,
      } = aiSettings;

      // Update user AI settings
      user.custom_prompt = custom_prompt || "";
      user.ai_provider = ai_provider || "polza";
      user.ai_model = ai_model || "deepseek/deepseek-v4-flash";
      user.custom_api_key = custom_api_key || "";
      user.user_daily_limit = user_daily_limit || 0;

      await ydb.saveUser(user);

      log.info(`[PARTNER API] AI settings updated`, {
        userId: telegramId,
        ai_provider: user.ai_provider,
        ai_model: user.ai_model,
      });

      return response(200, {
        success: true,
      });
    } catch (error) {
      log.error(`[PARTNER API] AI settings error`, error);
      return response(500, {
        success: false,
        error: error.message || "Internal error",
      });
    }
  }

  return null;
}
