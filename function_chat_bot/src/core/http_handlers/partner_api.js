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

  const actions = [
    "get_partner_link",
    "update_ai_settings",
    "get_public_config",
  ];
  if (!actions.includes(params.action)) return null;

  // === 1. ПУБЛИЧНЫЙ ЭНДПОИНТ (Не требует токена!) ===
  if (params.action === "get_public_config") {
    try {
      let tail = params.page;
      if (!tail && event.body) {
        try {
          tail = JSON.parse(event.body).page;
        } catch (e) {}
      }

      const owner = await ydb.getUserByRefTail(tail);
      if (!owner) {
        return response(200, {
          telegram: true,
          vk: false,
          web: true,
          email: false,
          sh_user_id: "1123",
          first_name: "SetHubble",
        });
      }

      const channels = owner.session?.channels || {};
      // Флаг канала загорится ТОЛЬКО если есть реальный токен (и это не дефолтная заглушка)
      const hasPersonalBot =
        owner.bot_token &&
        owner.bot_token !== "VK_CENTRAL_GROUP" &&
        owner.bot_token !== process.env.BOT_TOKEN;

      return response(200, {
        telegram: !!hasPersonalBot,
        vk: !!channels.vk?.configured,
        web: true,
        email: !!channels.email?.configured,
        sh_user_id: owner.sh_user_id || "ID скрыт",
        first_name: owner.first_name || "Партнёр",
      });
    } catch (e) {
      log.error(`[PARTNER API] get_public_config error`, e);
      return response(500, { error: e.message });
    }
  }

  // === 2. АВТОРИЗАЦИЯ (Ниже только приватные методы) ===
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

  // === 3. GET PARTNER LINK ===
  if (params.action === "get_partner_link") {
    try {
      // Используем getUser — он сам поймет, UUID это или Telegram ID
      let user = await ydb.getUser(telegramId);

      // Promo-Kit открывают ТОЛЬКО существующие пользователи.
      // Если профиль не найден, возвращаем ошибку, а НЕ создаем пустышку!
      if (!user) {
        log.warn(`[PARTNER API] User not found for token uid: ${telegramId}`);
        return response(404, {
          success: false,
          error: "User profile not found. Open from bot.",
        });
      }

      let botUsername = "";
      let botToken = MAIN_TOKEN;
      const partnerTail = user.sh_ref_tail || `id_${telegramId}`;

      if (user.session?.bot_username) {
        botUsername = user.session.bot_username;
        botToken = user.bot_token || MAIN_TOKEN;
      } else {
        const botInfo = await ydb.getBotInfo(MAIN_TOKEN);
        botUsername = botInfo?.bot_username || "sethubble_bot";
      }

      // v7.2: Landing page is the primary share link (higher conversion)
      const joinLink = `https://sethubble.ru/join/?page=${partnerTail}`;
      const b2bRefLink = `https://sethubble.ru/join/?page=${partnerTail}&role=b2b`;
      const botDirectLink = `https://t.me/${botUsername}`;

      const referrals = await ydb.getUserReferrals(telegramId);
      const earnings = referrals.length * 20 * 0.25;
      const clicks = await ydb.getPartnerClicks(partnerTail);

      return response(200, {
        success: true,
        refLink: joinLink,
        b2bRefLink,
        botDirectLink,
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

  // === 4. UPDATE AI SETTINGS ===
  if (params.action === "update_ai_settings") {
    try {
      // Используем getUser — он сам поймет, UUID это или Telegram ID
      let user = await ydb.getUser(telegramId);
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
