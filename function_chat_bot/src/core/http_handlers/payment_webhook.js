/**
 * Payment Webhook Handler
 * Обрабатывает входящие платежи от SetHubble
 * action: params.action === "payment"
 */

export async function handlePaymentWebhook(event, context) {
  const {
    params,
    headers,
    response,
    ydb,
    log,
    bot,
    sendStepToUser,
    notifyBotOwner,
    generatePin,
    MAIN_TOKEN,
    PRODUCT_ID_PRO,
    PRODUCT_ID_PRO_40,
    PRODUCT_ID_AI_SUBSCRIPTION,
  } = context;

  if (params.action !== "payment") return null;

  const secret = process.env.SETHUBBLE_SECRET || "super_secret_key_123";
  const reqKey = headers["x-payment-key"] || params.key;
  if (reqKey !== secret) return response(403, "Forbidden");

  let bodyStr = event.body || "";
  if (event.isBase64Encoded)
    bodyStr = Buffer.from(event.body, "base64").toString("utf8");

  let data = {};
  try {
    data = bodyStr.startsWith("{")
      ? JSON.parse(bodyStr)
      : context.querystring.parse(bodyStr);
  } catch (e) {
    console.error("[PAYMENT ERROR] Невозможно распарсить тело запроса", e);
    return response(400, "invalid_json");
  }

  const hubTelegramId = data.hub_telegram_id || params.hub_telegram_id;
  const hubProductId = data.hub_id || params.hub_id;

  console.log(`[PAYMENT DEBUG] hub_id: ${hubProductId}`);
  console.log(`[PAYMENT DEBUG] PRODUCT_ID_PRO: ${PRODUCT_ID_PRO}`);
  console.log(`[PAYMENT DEBUG] PRODUCT_ID_PRO_40: ${PRODUCT_ID_PRO_40}`);
  console.log(`[PAYMENT DEBUG] Match: ${hubProductId === PRODUCT_ID_PRO}`);

  if (!hubTelegramId) {
    log.warn("[PAYMENT] Missing hub_telegram_id", { data });
    return response(200, "ignored_no_id");
  }

  if (!/^\d+$/.test(String(hubTelegramId))) {
    log.error("[PAYMENT] Invalid hub_telegram_id format", { hubTelegramId });
    return response(400, "invalid_id_format");
  }

  if (!hubProductId || typeof hubProductId !== "string") {
    log.warn("[PAYMENT] Missing or invalid hub_id", { hubProductId });
    return response(400, "invalid_product_id");
  }

  let u = await ydb.findUser({ tg_id: Number(hubTelegramId) });

  if (!u) {
    console.log(`[PAYMENT] User ${hubTelegramId} not found. Creating stub user to save PRO status.`);
    u = {
      tg_id: Number(hubTelegramId),
      state: "Delivery_1",
      bought_tripwire: false,
      session: { tags: ["created_from_payment"] },
      purchases: [],
      partner_id: "p_qdr"
    };
  }

  if (u) {
    if (!u.purchases.includes(hubProductId)) u.purchases.push(hubProductId);

    if (hubProductId === PRODUCT_ID_PRO || hubProductId === PRODUCT_ID_PRO_40) {
      console.log(`>>> [PAYMENT] User ${u.user_id} activated PRO mode! 💰`);
      u.bought_tripwire = true;
      u.state = "Delivery_1";

      if (!u.pin_code) {
        u.pin_code = generatePin(4);
        console.log(`>>> [PIN] Generated PIN ${u.pin_code} for user ${u.user_id}`);
      }

      await ydb.saveUser(u);

      const saleMsg =
        `💰 <b>У ТЕБЯ НОВАЯ ОПЛАТА PRO!</b>\n\n` +
        `🔥 <b>Лид:</b> <a href="tg://user?id=${u.user_id}">${u.first_name || "Без имени"}</a> только что активировал PRO-статус в твоем боте!\n` +
        `💸 <b>Твоя комиссия 50%</b> уже отправлена в твой кошелек SetHubble.\n\n` +
        `<i>Проверь баланс и статистику в CRM-дашборде.</i>`;

      await notifyBotOwner(u.bot_token, saleMsg, bot);

      await sendStepToUser(u.bot_token || MAIN_TOKEN, u.user_id, u.state, u);

      try {
        await bot.telegram.sendMessage(
          u.user_id,
          `🔐 <b>ТВОЙ ПЕРСОНАЛЬНЫЙ PIN-КОД</b>\n\n` +
            `Для доступа ко всем ИИ-приложениям NeuroGen:\n\n` +
            `<b>Telegram ID:</b> <code>${u.user_id}</code>\n` +
            `<b>PIN-код:</b> <code>${u.pin_code}</code>\n\n` +
            `<i>Сохрани эти данные! Они понадобятся для входа.</i>`,
          { parse_mode: "HTML" },
        );
      } catch (err) {
        log.error(`[PIN SEND FAILED] Can't send PIN to user ${u.user_id}`, err);
      }

      await bot.telegram.sendMessage(
        u.user_id,
        `🎉 <b>ПОЗДРАВЛЯЮ С PRO-СТАТУСОМ!</b>\n\n` +
          `Ты в элите! Теперь у тебя есть доступ ко всем инструментам NeuroGen.\n\n` +
          `<b>✅ ДОСТУП: БЕССРОЧНЫЙ</b>\n` +
          `Ты купил PRO один раз — пользуешься всегда!\n\n` +
          `<b>🔥 ТВОИ ВОЗМОЖНОСТИ:</b>\n` +
          `• 50% комиссия с личных продаж (вместо 25%)\n` +
          `• Пассивный доход 5% до 5-го уровня\n` +
          `• 8 ИИ-приложений NeuroGen в подарок\n` +
          `• CRM-дашборд для управления лидами\n` +
          `• Доступ к PRO-обучению\n\n` +
          `<b>🎁 ТВОИ ИНСТРУМЕНТЫ:</b>\n` +
          `🎬 Viral Video — сценарии для роликов\n` +
          `🤖 Bot Scenarios — сценарии для ботов\n` +
          `🏗 Master Architect — стратегия\n` +
          `🌐 Landing Pages — генератор сайтов\n` +
          `🎨 Web Design — Style Transfer\n` +
          `📢 Ads — рекламные объявления\n` +
          `🚀 Deploy — публикация сайтов\n` +
          `✍️ Monetization — нейро-копирайтинг\n\n` +
          `<b>👇 ЧТО ДЕЛАТЬ ДАЛЬШЕ:</b>\n` +
          `1️⃣ Жми /apps — получишь ссылки на все приложения\n` +
          `2️⃣ Сохрани PIN-код (он для прямого входа)\n` +
          `3️⃣ Начни PRO-обучение в приложении\n\n` +
          `<b>🔐 КАК ВХОДИТЬ:</b>\n` +
          `• <b>Быстро:</b> нажми /apps → кликни на ссылку\n` +
          `• <b>Напрямую:</b> открой приложение → введи PIN\n\n` +
          `<i>💡 Не передавай ссылки друзьям — в каждом приложении есть реф-ссылка на SetHubble. Если друг зарегистрируется по ней, ты потеряешь комиссию с его оборота!</i>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🧠 ОТКРЫТЬ ИИ-ПРИЛОЖЕНИЯ", callback_data: "apps_menu" }],
              [{ text: "🎓 НАЧАТЬ PRO-ОБУЧЕНИЕ", callback_data: "Training_Pro_Main" }],
              [{ text: "📊 МОЙ ПРОФИЛЬ", callback_data: "EDIT_PROFILE" }],
            ],
          },
        },
      );
    } else if (hubProductId === PRODUCT_ID_AI_SUBSCRIPTION) {
      console.log(`>>> [AI SUBSCRIPTION] Processing payment for user ${u.user_id}`);
      const currentExpiry = u.ai_active_until || Date.now();
      u.ai_active_until = Math.max(currentExpiry, Date.now()) + (30 * 24 * 60 * 60 * 1000);
      await ydb.saveUser(u);
      console.log(`>>> [AI SUBSCRIPTION] Extended until ${new Date(u.ai_active_until).toISOString()}`);

      const expiryDate = new Date(u.ai_active_until).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      await bot.telegram.sendMessage(
        u.user_id,
        `🤖 <b>ИИ-подписка активирована!</b>\n\n` +
          `Подписка на ИИ-консультанта NeuroGen действует до <b>${expiryDate}</b>.\n\n` +
          `Доступен в ботах Telegram, VK, а также на Web-платформе (Telegram, VK, Web) сроком 30 дней.`,
        { parse_mode: "HTML" },
      );
    } else {
      console.log(`>>> [PAYMENT] User ${u.user_id} registered FREE product`);
      await ydb.saveUser(u);
    }
  } else {
    log.warn("[PAYMENT] User not found", { hubTelegramId });
  }

  return response(200, "ok");
}
