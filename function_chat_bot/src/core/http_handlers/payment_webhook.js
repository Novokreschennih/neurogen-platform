/**
 * Payment Webhook Handler (OMNICHANNEL)
 * Обрабатывает входящие платежи от SetHubble (Telegram, Web, Email)
 * action: params.action === "payment"
 */

import crypto from "crypto"; // Для генерации ID заглушек

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
    console.error("[PAYMENT ERROR] Невозможно распарсить тело", e);
    return response(400, "invalid_json");
  }

  // === 1. ПАРСИНГ ДАННЫХ ИЗ SETHUBBLE ===
  let hubTelegramId = data.hub_telegram_id || params.hub_telegram_id;
  let hubEmail = data.hub_email || params.hub_email;
  const hubProductId = data.hub_id || params.hub_id;
  const hubRef = data.hub_refferal || params.hub_refferal || "p_qdr";
  const hubName = data.hub_fname || params.hub_fname || "Новый Партнер";

  // Очистка пустых значений (SetHubble может прислать "0")
  if (hubTelegramId === "0" || hubTelegramId === 0) hubTelegramId = null;
  if (hubEmail === "0") hubEmail = null;

  if (!hubProductId || typeof hubProductId !== "string") {
    log.warn("[PAYMENT] Missing hub_id", { hubProductId });
    return response(400, "invalid_product_id");
  }

  if (!hubTelegramId && !hubEmail) {
    log.error("[PAYMENT] Оплата без TG и без Email (невозможно связать)", { data });
    return response(200, "ignored_no_identifiers");
  }

  // === 2. ПОИСК ПОЛЬЗОВАТЕЛЯ (OMNI-RESOLVER) ===
  let u = null;

  // Ищем по TG (если есть)
  if (hubTelegramId && /^\d+$/.test(String(hubTelegramId))) {
    u = await ydb.findUser({ tg_id: Number(hubTelegramId) });
  }

  // Если по TG не нашли, но есть Email — ищем по Email
  if (!u && hubEmail) {
    u = await ydb.findUser({ email: hubEmail });
  }

  // === 3. СОЗДАНИЕ ЗАГЛУШКИ (Если вообще нет в базе) ===
  if (!u) {
    console.log(`[PAYMENT] User not found. Creating stub user from webhook data.`);
    u = {
      id: crypto.randomUUID(),
      tg_id: hubTelegramId ? Number(hubTelegramId) : 0,
      email: hubEmail ? hubEmail.toLowerCase() : "",
      user_id: hubTelegramId ? String(hubTelegramId) : (hubEmail || "web_stub"),
      first_name: hubName,
      state: "Delivery_1",
      bought_tripwire: false,
      session: { tags: ["created_from_payment"] },
      purchases: [],
      partner_id: hubRef
    };

    // Если есть email, сразу помечаем канал как настроенный
    if (hubEmail) {
      u.session.channels = { email: { configured: true, enabled: true, subscribed: true } };
    }
  }

  // === 4. ОБРАБОТКА ОПЛАТЫ ===
  if (!u.purchases.includes(hubProductId)) u.purchases.push(hubProductId);

  // === ПРОДАЖА PRO-СТАТУСА ===
  if (hubProductId === PRODUCT_ID_PRO || hubProductId === PRODUCT_ID_PRO_40) {
    console.log(`>>> [PAYMENT] User ${u.user_id} activated PRO mode! 💰`);
    u.bought_tripwire = true;
    u.state = "Delivery_1";

    if (!u.pin_code) {
      u.pin_code = generatePin(4);
      console.log(`>>> [PIN] Generated PIN ${u.pin_code} for user ${u.user_id}`);
    }

    await ydb.saveUser(u);

    // Уведомление партнеру (владельцу)
    const saleMsg =
      `💰 <b>У ТЕБЯ НОВАЯ ОПЛАТА PRO!</b>\n\n` +
      `🔥 <b>Лид:</b> ${u.first_name || "Без имени"}\n` +
      `💸 <b>Твоя комиссия 50%</b> уже отправлена в твой кошелек SetHubble.\n\n` +
      `<i>Проверь баланс и статистику в CRM-дашборде.</i>`;
    await notifyBotOwner(u.bot_token, saleMsg, bot);

    // Переводим лида на шаг выдачи
    await sendStepToUser(u.bot_token || MAIN_TOKEN, u.user_id, u.state, u);

    // === УВЕДОМЛЕНИЕ ЛИДУ (OMNICHANNEL) ===
    const proCongratsText = 
      `🎉 <b>ПОЗДРАВЛЯЮ С PRO-СТАТУСОМ!</b>\n\n` +
      `Ты в элите! Теперь у тебя есть доступ ко всем инструментам NeuroGen.\n\n` +
      `<b>✅ ДОСТУП: БЕССРОЧНЫЙ</b>\n` +
      `<b>🔥 ТВОИ ВОЗМОЖНОСТИ:</b>\n` +
      `• 50% комиссия с личных продаж (вместо 25%)\n` +
      `• Пассивный доход 5% до 5-го уровня\n` +
      `• 8 ИИ-приложений NeuroGen в подарок\n` +
      `• CRM-дашборд для управления лидами\n\n` +
      `<b>🔐 ТВОЙ ПЕРСОНАЛЬНЫЙ PIN-КОД:</b>\n` +
      `<code>${u.pin_code}</code>\n\n` +
      `<i>Сохрани этот PIN-код! Он понадобится для входа в ИИ-приложения (Инструменты).</i>`;

    if (u.tg_id) {
      // Отправляем в Telegram
      try {
        await bot.telegram.sendMessage(u.tg_id, proCongratsText, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🧠 ОТКРЫТЬ ИИ-ПРИЛОЖЕНИЯ", callback_data: "apps_menu" }],
              [{ text: "🎓 НАЧАТЬ PRO-ОБУЧЕНИЕ", callback_data: "Training_Pro_Main" }]
            ],
          },
        });
      } catch (err) {
        log.error(`[PIN SEND FAILED] Can't send PIN to TG ${u.tg_id}`, err);
      }
    } else if (u.email) {
      // Отправляем на Email, если Телеграма нет
      try {
        const { sendEmail } = await import("../email/email_service.js");
        await sendEmail({
          to: u.email,
          subject: "🎉 Ваш PRO-статус активирован! (PIN-код внутри)",
          text: proCongratsText.replace(/<[^>]*>?/gm, ""), // Чистим HTML для text-версии
          html: proCongratsText.replace(/\n/g, "<br>")      // Делаем красивые переносы для HTML
        });
        console.log(`[PAYMENT] Sent PRO congratulations and PIN to email: ${u.email}`);
      } catch (err) {
        log.error(`[PIN SEND FAILED] Can't send PIN to Email ${u.email}`, err);
      }
    }
  } 
  
  // === ИИ ПОДПИСКА (SAAS) ===
  else if (hubProductId === PRODUCT_ID_AI_SUBSCRIPTION) {
    console.log(`>>> [AI SUBSCRIPTION] Processing payment for user ${u.user_id}`);
    const currentExpiry = u.ai_active_until || Date.now();
    u.ai_active_until = Math.max(currentExpiry, Date.now()) + (30 * 24 * 60 * 60 * 1000);
    await ydb.saveUser(u);

    const expiryDate = new Date(u.ai_active_until).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    const subText = `🤖 <b>ИИ-подписка активирована!</b>\n\nПодписка на ИИ-консультанта NeuroGen действует до <b>${expiryDate}</b>.\nДоступна в ботах Telegram, VK и на Web-платформе.`;

    if (u.tg_id) {
      try { await bot.telegram.sendMessage(u.tg_id, subText, { parse_mode: "HTML" }); } catch (e) {}
    } else if (u.email) {
      try {
        const { sendEmail } = await import("../email/email_service.js");
        await sendEmail({ to: u.email, subject: "🤖 ИИ-подписка NeuroGen активирована!", text: subText, html: subText.replace(/\n/g, "<br>") });
      } catch (e) {}
    }
  } 
  
  // === БЕСПЛАТНАЯ РЕГИСТРАЦИЯ ===
  else {
    console.log(`>>> [PAYMENT] User ${u.user_id} registered FREE product`);
    await ydb.saveUser(u);
  }

  return response(200, "ok");
}
