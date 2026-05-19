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
    "generate-post",
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
          vk: true,
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
        vk: true,
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
      let botInfo = null;
      const partnerTail = user.sh_ref_tail || `id_${telegramId}`;

      if (user.session?.bot_username) {
        botUsername = user.session.bot_username;
        botToken = user.bot_token || MAIN_TOKEN;
      } else {
        botInfo = await ydb.getBotInfo(MAIN_TOKEN);
        botUsername = botInfo?.bot_username || "sethubble_bot";
      }

      // v7.2: Landing page is the primary share link (higher conversion)
      const joinLink = `https://neuro-gen.ru/?page=${partnerTail}`;
      const b2bRefLink = `https://neuro-gen.ru/?page=${partnerTail}&role=b2b`;
      const botDirectLink = `https://t.me/${botUsername}`;

      const referrals = await ydb.getUserReferrals(telegramId);
      // Считаем реальные оплаты (PRO-статусы) среди приведенных людей
      const paidReferrals = referrals.filter(r => r.bought_tripwire).length;
      const clicks = await ydb.getPartnerClicks(partnerTail);

      return response(200, {
        success: true,
        refLink: joinLink,
        b2bRefLink,
        botDirectLink,
        botName: botUsername,
        central_tg_bot: "sethubble_biz_bot",
        central_vk_group: process.env.VK_CENTRAL_GROUP || "237421168",
        has_personal_bot: !!user.session?.bot_username,
        user: {
          id: telegramId,
          first_name: firstName,
          xp: user.session?.xp || 0, // NeuroCoins для динамической цены PRO
          inviter_sh_id: botInfo?.sh_user_id || "1123", // ID пригласителя для AFID
          referrals: referrals.length,
          paid_referrals: paidReferrals, // Отдаем количество оплат
          clicks,
          is_pro: user.bought_tripwire,
          sh_user_id: user.sh_user_id || "",
          partner_id: user.sh_ref_tail,
          ai_active_until: user.ai_active_until || 0,
          // === Расширенные данные ИИ ===
          custom_prompt: user.custom_prompt || "",
          ai_provider: user.ai_provider || "polza",
          ai_model: user.ai_model || "deepseek/deepseek-v4-flash",
          custom_api_key: user.custom_api_key || "",
          user_daily_limit: user.user_daily_limit || 0,
          ai_ui_state: user.session?.ai_ui_state || null, // Состояние селектов
          
          // === НОВАЯ СТРОКА: Передаем ID продукта из ENV во фронтенд ===
          ai_product_id: process.env.PRODUCT_ID_AI_SUBSCRIPTION || "150_3ca87",
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
        ai_ui_state // Получаем сохраненное состояние интерфейса
      } = aiSettings;

      // Обновляем основные поля
      user.custom_prompt = custom_prompt || "";
      user.ai_provider = ai_provider || "polza";
      user.ai_model = ai_model || "deepseek/deepseek-v4-flash";
      user.custom_api_key = custom_api_key || "";
      user.user_daily_limit = user_daily_limit || 0;

      // Сохраняем стейт интерфейса в сессию
      if (ai_ui_state) {
        if (!user.session) user.session = {};
        user.session.ai_ui_state = ai_ui_state;
      }

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

  // === 5. GENERATE POST (ИИ-КОПИРАЙТЕР ДЛЯ PROMO-KIT) ===
  if (params.action === "generate-post") {
    try {
      let user = await ydb.getUser(telegramId);
      if (!user) {
        return response(404, {
          success: false,
          error: "User not found",
        });
      }

      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch (e) {}

      const topic = body.topic || "предприниматели";
      const refLink = body.link || "https://neuro-gen.ru";

      const genLimit = user.bought_tripwire ? 30 : 5;
      const today = new Date().toISOString().split("T")[0];

      if (!user.session) user.session = {};
      if (user.session.post_gen_date !== today) {
        user.session.post_gen_count = 0;
        user.session.post_gen_date = today;
      }

      if (user.session.post_gen_count >= genLimit) {
        await ydb.saveUser(user);
        return response(200, {
          answer: `⏳ Лимит генераций на сегодня исчерпан (${genLimit}/${genLimit}). Активируйте PRO для увеличения лимитов.`
        });
      }

      user.session.post_gen_count = (user.session.post_gen_count || 0) + 1;

      let ownerSettings = { ai_provider: "polza", ai_model: "deepseek/deepseek-v4-flash", custom_api_key: "" };
      if (user.partner_id && user.partner_id !== "p_qdr") {
        try {
          const owner = await ydb.getUserByRefTail(user.partner_id);
          if (owner) {
            ownerSettings = {
              ai_provider: owner.ai_provider || "polza",
              ai_model: owner.ai_model || "deepseek/deepseek-v4-flash",
              custom_api_key: owner.custom_api_key || ""
            };
          }
        } catch(e) {}
      }

      const apiKey = ownerSettings.custom_api_key || process.env.POLZA_API_KEY || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        await ydb.saveUser(user);
        return response(200, { answer: "⚠️ Системный API ключ не настроен" });
      }

      const baseURL = ownerSettings.ai_provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://polza.ai/api/v1";

      const systemPrompt = `Ты — SMM-копирайтер платформы NeuroGen / SetHubble.
Твоя задача: написать ОДИН короткий вирусный пост для соцсетей.

📋 БАЗА ЗНАНИЙ О ПРОДУКТЕ:
- SetHubble — гибридная IT-платформа и крипто-платежный шлюз с многоуровневой партнёркой. Не MLM, не affiliate-маркетинг.
- Пользователь получает ИИ-бота, который продаёт за него 24/7, доступ к нейросетям NeuroGen, пассивный доход в USDT со всей сети.
- FREE: 25% лично, по 3% до 3 уровня. PRO: 50% лично, по 5% до 5 уровней + CRM + ИИ-приложения.
- Делишься ссылкой → люди закрепляются за тобой навсегда (до 10 уровней) → получаешь % с их покупок.
- Можно подключать офлайн-бизнесы (салоны, СТО, фитнес) через QR-коды и многоуровневые промокоды.
- Онлайн-бизнес: приём USDT/BTC/ETH/TON от $1, монетизация отказников.
- O2O-генератор «Троянский конь»: PDF-презентация с QR-кодом для B2B-встреч.
- Компрессия: деньги ленивых партнёров поднимаются к активным.
- PRO стоит $40 (или $20 за 100 NeuroCoins).

🎯 СТИЛЬ И СТРУКТУРА (ОБЯЗАТЕЛЬНО СЛЕДУЙ ЭТИМ ПРИМЕРАМ):

Пример 1:
🚀 Хватит сливать бюджет на Яндекс.Директ!

Моя новая IT-система оцифрует ваших клиентов и превратит их в агентов. Вы платите % только за РЕАЛЬНЫЕ деньги в кассе.

Плюс — вы получаете пассивный доход с их онлайн-покупок. Узнайте как 👇
ССЫЛКА

Пример 2:
💸 Хочешь свой бизнес, но нет стартового капитала?

Стань теневым партнёром! Раздавай бесплатный инструмент (QR-коды) кофейням и салонам красоты, и получай % с их оборота.

Обучение и старт $0: 👇
ССЫЛКА

Пример 3:
📱 Монетизируй тех, кто НЕ КУПИЛ твой курс!

95% твоей аудитории уходит к конкурентам. С нашей системой они станут твоими агентами и будут приносить пассивный доход, даже покупая чужие продукты.

Как это работает: 👇
ССЫЛКА

📏 ЖЁСТКИЕ ПРАВИЛА:
1. Структура: ЭМОДЗИ + ПРОВОКАЦИОННЫЙ ЗАГОЛОВОК → БОЛЬ АУДИТОРИИ → КОНКРЕТНОЕ РЕШЕНИЕ → CTA + ССЫЛКА
2. 200-400 символов. Без воды, без длинных вступлений.
3. НИКАКИХ хештегов. НИКАКИХ кавычек вокруг текста.
4. Используй конкретику: USDT, %, $0, 24/7, QR-коды, ИИ-бот.
5. Тон: провокационный, энергичный, с эмодзи.
6. Разбивай на короткие абзацы (1-2 предложения).
7. В самом конце — призыв к действию и ЭТУ ССЫЛКУ: ${refLink}

Аудитория поста: ${topic}.
Напиши пост.`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://neuro-gen.ru"
        },
        body: JSON.stringify({
          model: ownerSettings.ai_model || "deepseek/deepseek-v4-flash",
          messages:[
            { role: "system", content: systemPrompt },
            { role: "user", content: "Сгенерируй пост для соцсетей." }
          ],
          max_tokens: 1000,
          temperature: 0.7
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;

      if (!text) throw new Error("Empty response");

      await ydb.saveUser(user);
      return response(200, { answer: text });

    } catch (e) {
      log.error(`[PARTNER API] generate-post error`, e);
      return response(500, { error: e.message });
    }
  }

  return null;
}
