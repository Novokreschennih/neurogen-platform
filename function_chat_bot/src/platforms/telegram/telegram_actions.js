/**
 * Telegram Handlers — Actions, Commands, Text, Callback
 *
 * Зависимости (передаются через context):
 * - bot: Telegraf instance (уже с middleware)
 * - renderStep, getKeyboard: helper функции
 * - ydb, scenario, log, MAIN_TOKEN, isMainBot, token: основные зависимости
 * - AI_PRO_LIMIT, AI_FREE_LIMIT: лимиты AI
 * - askNeuroGenAI, getOrCreatePin, generateToken: AI и auth функции
 * - handleAppsCommand, notifyBotOwner: helper функции
 * - event: raw event для получения headers.Host
 */

import TelegrafPkg from "telegraf";
const { Telegraf } = TelegrafPkg;
import { detectLoop, getLoopHint } from "../../utils/ux_helpers.js";

export function registerTelegramActions(bot, ctx) {
  const {
    renderStep,
    getKeyboard,
    ydb,
    scenario,
    log,
    MAIN_TOKEN,
    isMainBot,
    token,
    AI_PRO_LIMIT,
    AI_FREE_LIMIT,
    askNeuroGenAI,
    getOrCreatePin,
    generateToken,
    handleAppsCommand,
    notifyBotOwner,
    event,
  } = ctx;

  // ============================================================
  // 5. ACTIONS (bot.action)
  // ============================================================
  bot.action("RESUME_LAST", async (ctx) => {
    await ctx.answerCbQuery();
    return renderStep(ctx, ctx.dbUser.saved_state || "START", token);
  });

  bot.action("MAIN_MENU", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.dbUser.reminders_count = 0;
    ctx.dbUser.last_reminder_time = 0;
    return renderStep(ctx, "MAIN_MENU", token);
  });

  bot.action("LOCKED_NEED_ID", async (ctx) => {
    await ctx.answerCbQuery();
    return renderStep(ctx, "LOCKED_TRAINING_INFO", token);
  });

  bot.action("LOCKED_NEED_PRO", async (ctx) => {
    await ctx.answerCbQuery();
    return renderStep(ctx, "LOCKED_CRM_INFO", token);
  });

  bot.action("LOCKED_NEED_TRAINING", async (ctx) => {
    await ctx.answerCbQuery();
    return renderStep(ctx, "LOCKED_PRO_TRAINING_INFO", token);
  });

  bot.action("LOCKED_NEED_PLANS", async (ctx) => {
    await ctx.answerCbQuery();
    return renderStep(ctx, "LOCKED_PLANS_INFO", token);
  });

  bot.action("RESTART_FUNNEL", async (ctx) => {
    ctx.dbUser.saved_state = "";
    ctx.dbUser.state = "START";
    ctx.dbUser.reminders_count = 0;
    ctx.dbUser.last_reminder_time = 0;

    ctx.dbUser.session = {
      tags: ctx.dbUser.session?.tags || [],
      last_activity: Date.now(),
      bot_username: ctx.dbUser.session?.bot_username,
      old_bot_token: ctx.dbUser.session?.old_bot_token,
      ai_count: ctx.dbUser.session?.ai_count,
      ai_date: ctx.dbUser.session?.ai_date,
    };

    await ydb.saveUser(ctx.dbUser);
    await ctx.answerCbQuery("Начинаем сначала! Прогресс обнулен.");
    return renderStep(ctx, "START", token);
  });

  bot.action("REMINDER_48H_RESUME", (ctx) =>
    renderStep(ctx, ctx.dbUser.saved_state || "START", token),
  );

  bot.action("EDIT_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.dbUser.sh_ref_tail) {
      return ctx.reply(
        "🔒 Сначала введи данные SetHubble (ID и хвост ссылки).\n\nНажми любую кнопку из раздела 'Путь агента', чтобы начать.",
        { protect_content: true },
      );
    }
    return renderStep(ctx, "EDIT_PROFILE", token);
  });

  bot.action("REMINDER_1H_RESUME", (ctx) =>
    renderStep(ctx, ctx.dbUser.saved_state || "START", token),
  );
  bot.action("REMINDER_3H_RESUME", (ctx) =>
    renderStep(ctx, ctx.dbUser.saved_state || "START", token),
  );
  bot.action("REMINDER_24H_RESUME", (ctx) =>
    renderStep(ctx, ctx.dbUser.saved_state || "START", token),
  );

  // === ЛОГИКА РЕГИСТРАЦИИ ===
  bot.action("CLICK_REG_ID", async (ctx) => {
    if (ctx.dbUser.sh_user_id && ctx.dbUser.sh_ref_tail) {
      return renderStep(ctx, "REGISTRATION_EXIST", token);
    }
    ctx.dbUser.state = "WAIT_REG_ID";
    await ydb.saveUser(ctx.dbUser);
    await ctx.answerCbQuery();
    await ctx.reply(
      "✍️ <b>Введи ТВОЙ цифровой ID</b>\n\nПришли мне номер, который ты получил в личном кабинете SetHubble после регистрации (например: 1234).",
      { parse_mode: "HTML", protect_content: true },
    );
  });

  bot.action("FORCE_REG_UPDATE", async (ctx) => {
    ctx.dbUser.state = "WAIT_REG_ID";
    await ydb.saveUser(ctx.dbUser);
    await ctx.answerCbQuery();
    await ctx.reply(
      "✍️ <b>Обновление данных</b>\n\nХорошо, введи новый цифровой ID:",
      { parse_mode: "HTML", protect_content: true },
    );
  });

  bot.action("SETUP_BOT_START", async (ctx) => {
    ctx.dbUser.state = "WAIT_BOT_TOKEN";
    if (ctx.dbUser.bot_token) {
      ctx.dbUser.session.is_changing_token = true;
    }
    await ydb.saveUser(ctx.dbUser);
    await ctx.answerCbQuery();
    await ctx.reply(
      "🚀 <b>НАСТРОЙКА БОТА-КЛОНА</b>\n\nПришли мне <b>API TOKEN</b> твоего бота из @BotFather (он выглядит как набор букв и цифр).",
      { parse_mode: "HTML", protect_content: true },
    );
  });

  bot.action("CONFIRM_UPGRADE", async (ctx) => {
    if (!ctx.dbUser.session.tags.includes("seen_plans"))
      ctx.dbUser.session.tags.push("seen_plans");
    await ctx.answerCbQuery("Заявка принята, проверяем...");
    return renderStep(ctx, "UPGRADE_CONFIRMED", token);
  });

  // === ОБРАБОТЧИК PROMO_KIT ===
  bot.action("PROMO_KIT", async (ctx) => {
    await ctx.answerCbQuery();

    const botName = ctx.dbUser.session?.bot_username || "sethubble_biz_bot";
    const apiGw =
      process.env.API_GW_HOST ||
      "d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net";
    const promoKitUrl =
      process.env.PROMO_KIT_URL ||
      "https://novokreschennih.github.io/neurogen-promo-kit/";

    // v7.1: Generate JWT for universal auth
    const { generateToken } = await import("../../utils/jwt_utils.js");
    const jwtToken = generateToken({
      uid: ctx.dbUser.tg_id,
      first_name: ctx.dbUser.first_name,
    }, { expiresIn: "7d" });

    const mod3Done = ctx.dbUser.session?.mod3_done;
    const isPro = ctx.dbUser.bought_tripwire;
    const mod3Param = mod3Done || isPro ? "&mod3=1" : "";

    // v7.1: Add JWT token to URL
    const webAppUrl = `${promoKitUrl}?token=${jwtToken}&bot=${botName}&api=https://${apiGw}${mod3Param}`;

    return ctx.reply(
      `🚀 <b>Promo-Kit</b>\n\nТвой генератор маркетинговых материалов:`,
      {
        parse_mode: "HTML",
        protect_content: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "📲 ОТКРЫТЬ PROMO-KIT", web_app: { url: webAppUrl } }],
          ],
        },
      },
    );
  });

  // === ОБРАБОТЧИК PARTNER_STATS ===
  bot.action("PARTNER_STATS", async (ctx) => {
    await ctx.answerCbQuery();

    const refTail = ctx.dbUser.sh_ref_tail || ctx.dbUser.partner_id || "p_qdr";

    try {
      const statsQuery = `
        DECLARE $refTail AS Utf8;
        SELECT COUNT(*) as referred_count
        FROM users
        WHERE partner_id = $refTail;
      `;
      const result = await ydb.ydb.executeQuery(statsQuery, {
        refTail: ydb.createPrimitiveValue(refTail),
      });
      const count = result.resultSets[0]?.rows[0]?.referred_count ?? 0;

      await ctx.reply(
        `📊 <b>ВАША ПАРТНЁРСКАЯ СТАТИСТИКА</b>\n\n` +
          `🔗 Ваш реф. хвост: <code>${refTail}</code>\n` +
          `👥 Приглашённых пользователей: <b>${count}</b>\n\n` +
          `💰 Выплаты автоматически начисляются при покупках.`,
        { parse_mode: "HTML" },
      );
    } catch (e) {
      log.error(`[TG PARTNER_STATS] Error:`, e);
      await ctx.reply(`⚠️ Ошибка получения статистики. Попробуйте позже.`);
    }
  });

  // ============================================================
  // 6. COMMANDS (bot.command)
  // ============================================================
  bot.command("send", async (ctx) => {
    const info = await (token === MAIN_TOKEN
      ? Promise.resolve({ owner_id: process.env.ADMIN_TELEGRAM_ID })
      : ydb.getBotInfo(token));

    if (info?.owner_id === String(ctx.from.id)) {
      ctx.dbUser.state = "WAIT_BROADCAST";
      await ctx.reply(
        "📢 <b>Режим рассылки</b>\n\nПришли текст сообщения с картинкой или без:",
        { parse_mode: "HTML", protect_content: true },
      );
    } else {
      await ctx.reply("❌ У вас нет прав администратора в этом боте.", {
        protect_content: true,
      });
    }
  });

  bot.command("menu", async (ctx) => {
    log.info(`[COMMAND /menu] Called by`, { userId: ctx.from.id });
    await renderStep(ctx, "MAIN_MENU", token);
  });

  bot.command("add_bot", async (ctx) => {
    ctx.dbUser.state = "WAIT_BOT_TOKEN";
    await ctx.reply(
      "🚀 <b>ОТЛИЧНО! СОЗДАЕМ ТВОЕГО КЛОНА.</b>\n\nПришли мне <b>API TOKEN</b> твоего нового бота из @BotFather (он выглядит как набор букв и цифр).",
      { parse_mode: "HTML", protect_content: true },
    );
  });

  bot.command("stats", async (ctx) => {
    const user = ctx.dbUser;
    let s = { total: 0, sales: 0 };
    try {
      s = await ydb.getPartnerStats(ctx.from.id);
    } catch (e) {
      log.error("[STATS ERROR]", e);
    }

    const isPro = user.bought_tripwire;
    const xp = user.session?.xp || 0;
    const earned = isPro ? s.sales * 10 : s.sales * 5;
    const lostProfit = isPro ? 0 : s.sales * 5;
    const statusText = isPro
      ? "💎 PRO (Комиссия 50%)"
      : "🆓 FREE (Комиссия 25%)";

    let text =
      `📊 <b>ТВОЯ СТАТИСТИКА И ПРОГРЕСС</b>\n\n` +
      `⚡️ <b>Статус:</b> ${statusText}\n` +
      `🪙 <b>Баланс:</b> ${xp} NeuroCoins\n\n` +
      `👥 <b>Размер сети:</b> ${s.total} чел.\n` +
      `🤝 <b>Успешных продаж:</b> ${s.sales}\n` +
      `💰 <b>Заработано с личных продаж:</b> $${earned}\n\n`;

    if (!isPro) {
      text +=
        `⚠️ <b>Упущенная прибыль: $${lostProfit}</b>\n` +
        `<i>Эти деньги улетели твоему пригласителю, потому что у тебя нет PRO-статуса. Активируй PRO, чтобы забирать 50% с каждой сделки и получить доступ к CRM!</i>`;
    } else {
      text += `🔥 <i>Отличный результат! Твоя сеть работает на максималках. Открой CRM-дашборд, чтобы посмотреть воронку лидов и сделать рассылку.</i>`;
    }

    const buttons = [];
    if (isPro) {
      const crmUrl = process.env.CRM_WEB_APP_URL || "https://novokreschennih.github.io/crm-dashboard/";
      
      // Генерируем JWT токен для CRM
      const jwtToken = generateToken({ 
        uid: user.tg_id || user.id, 
        first_name: user.first_name 
      }, { expiresIn: "7d" });

      buttons.push([
        {
          text: "📊 ОТКРЫТЬ CRM-ДАШБОРД",
          web_app: { url: `${crmUrl}?token=${jwtToken}&bot_token=${user.bot_token || ""}` },
        },
      ]);
    } else {
      buttons.push([
        { text: "💎 АКТИВИРОВАТЬ PRO", callback_data: "Offer_Tripwire" },
      ]);
    }
    buttons.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback_data: "MAIN_MENU" }]);

    await ctx.reply(text, {
      parse_mode: "HTML",
      protect_content: true,
      reply_markup: { inline_keyboard: buttons },
    });
  });

  // === handleAppsCommand — выдача доступа к ИИ-приложениям ===
  async function handleAppsCommandLocal(ctx, token) {
    const userId = ctx.from.id;
    const user = await ydb.findUser({ tg_id: Number(userId) });

    if (!user || !user.bought_tripwire) {
      await ctx.reply(
        `🔒 <b>PRO-СТАТУС ТРЕБУЕТСЯ</b>\n\n` +
          `ИИ-приложения доступны только PRO-партнёрам.\n\n` +
          `💎 <b>PRO даёт:</b>\n` +
          `• 50% комиссия (вместо 25%)\n` +
          `• 8 ИИ-приложений в подарок ($1500)\n` +
          `• CRM-дашборд\n` +
          `• Пассивный доход 5 уровней\n\n` +
          `<i>Жми на кнопку ниже, чтобы забрать доступ:</i>`,
        {
          parse_mode: "HTML",
          protect_content: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "💎 АКТИВИРОВАТЬ PRO",
                  callback_data: "Offer_Tripwire",
                },
              ],
              [{ text: "🔙 К ИНСТРУМЕНТАМ", callback_data: "TOOLS_MENU" }],
            ],
          },
        },
      );
      return;
    }

    const jwtToken = generateToken(
      {
        uid: String(userId),
        isPro: true,
        apps: [
          "viral-video",
          "bot-scenarios",
          "master-architect",
          "landing-pages",
          "web-design",
          "ads",
          "deploy",
          "monetization",
          "neurogen-studio",
        ],
      },
      { expiresIn: "7d" },
    );

    const encodedToken = Buffer.from(jwtToken)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const apps = [
      {
        id: "master-architect",
        name: "🏗️ NeuroGen: Master Architect",
        url:
          process.env.NEUROGEN_MASTER_ARCHITECT_URL ||
          "https://neuro-gen-strategy.vercel.app/",
      },
      {
        id: "bot-scenarios",
        name: "🤖 NeuroGen: Bot Scenarios",
        url:
          process.env.NEUROGEN_BOT_SCENARIOS_URL ||
          "https://telegram-bot-script-factory.vercel.app",
      },
      {
        id: "viral-video",
        name: "🎬 NeuroGen: Viral Video",
        url:
          process.env.NEUROGEN_VIRAL_VIDEO_URL ||
          "https://neurogen-viral-video.vercel.app",
      },
      {
        id: "neurogen-studio",
        name: "🌐 NeuroGen: Studio (Сайты)",
        url:
          process.env.NEUROGEN_STUDIO_URL ||
          "https://neurogen-studio.vercel.app/",
      },
    ];

    await ctx.reply(
      `🧠 <b>NEUROGEN HUB: ТВОЙ БОНУС ЗА PRO</b>\n\n` +
        `<b>🎁 ТЫ ПОЛУЧИЛ ЭТИ ПРИЛОЖЕНИЯ БЕСПЛАТНО!</b>\n\n` +
        `Это не отдельная покупка. Это твой персональный <b>подарок</b>\n` +
        `за активацию PRO-статуса. Пользуйся навсегда!\n\n` +
        `<b>🔐 ТВОИ ПЕРСОНАЛЬНЫЕ ССЫЛКИ</b>\n\n` +
        `<b>Доступ: БЕССРОЧНЫЙ ✅</b>\n\n` +
        `Ты купил PRO один раз — приложения твои навсегда!\n\n` +
        `<b>КАК ВОЙТИ:</b>\n\n` +
        `<b>1️⃣ Быстрый вход (ссылки ниже):</b>\n` +
        `• Токен в ссылке автоматически обновляется\n` +
        `• Просто нажми на кнопку\n` +
        `• Срок действия токена: 7 дней (потом обнови через раздел Инструменты)\n\n` +
        `<b>2️⃣ Прямой вход (без ссылок):</b>\n` +
        `• Открой приложение напрямую\n` +
        `• Введи свой PIN-код\n` +
        `• Доступ сохранится на 24 часа\n\n` +
        `<b>🎯 ТВОИ HUB-ПРИЛОЖЕНИЯ:</b>\n\n` +
        apps
          .map(
            (app) =>
              `${app.name} — <a href="${app.url}?token=${encodedToken}">${app.url.split("/")[2]}</a>`,
          )
          .join("\n") +
        `\n\n` +
        `<b>🔑 Твой PIN-код:</b> <code>${user.pin_code || "не создан"}</code>\n` +
        `<b>🆔 Твой Telegram ID:</b> <code>${userId}</code>\n\n` +
        `<i>Сохрани эти данные! Понадобятся для прямого входа в приложения.</i>\n\n` +
        `<i>⚠️ Не передавай ссылки — в каждом приложении реф-ссылка на SetHubble. Друг зарегистрируется по ней → ты потеряешь комиссию!</i>`,
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        protect_content: true,
      },
    );
  }

  bot.command("tools", async (ctx) => {
    await renderStep(ctx, "TOOLS_MENU", token);
  });

  bot.command("apps", async (ctx) => {
    await handleAppsCommandLocal(ctx, token);
  });

  // ============================================================
  // 7. TEXT HANDLER (bot.on("text"))
  // ============================================================
  bot.on("text", async (ctx, next) => {
    const txt = ctx.message.text.trim();
    const u = ctx.dbUser;

    if (txt.startsWith("/")) return next();

    // v6.0: Loop Detection — если пользователь повторяет одно и то же 3+ раз
    if (detectLoop(u, txt)) {
      const hint = getLoopHint(u.state);
      await ctx.reply(
        `🤔 <b>Кажется, ты застрял?</b>\n\n` +
          `Ты отправляешь одно и то же несколько раз. Возможно я не понял команду.\n\n` +
          `${hint || `Попробуй:\n• /menu — главное меню\n• /help — помощь\n• /start — начать сначала`}\n\n` +
          `Если нужна помощь — пиши, я тут! 👋`,
        { parse_mode: "HTML", protect_content: true },
      );
      return;
    }

    // === ЛОГИКА ПРОВЕРКИ СЕКРЕТНЫХ СЛОВ ===
    log.info(`[SECRET WORDS] Checking`, {
      state: u.state,
      text: txt.substring(0, 30),
    });
    const secretsConfig = {
      WAIT_SECRET_1: {
        word: "гибрид",
        xp: 20,
        next: "Module_2_Online",
        flag: "mod1_done",
        awardKey: "mod1_awarded",
      },
      WAIT_SECRET_2: {
        word: "облако",
        xp: 30,
        next: "WAIT_BOT_TOKEN",
        flag: "mod2_done",
        awardKey: "mod2",
      },
      WAIT_SECRET_3: {
        word: "сарафан",
        xp: 40,
        next: "Lesson_Final_Comparison",
        flag: "mod3_done",
        awardKey: "mod3_awarded",
      },
    };

    if (secretsConfig[u.state]) {
      log.info(`[SECRET WORDS] State matched!`, {
        state: u.state,
        word: secretsConfig[u.state].word,
      });
      const config = secretsConfig[u.state];

      if (txt.toLowerCase().trim() === config.word.toLowerCase()) {
        if (!u.session.xp_awarded) u.session.xp_awarded = {};
        const alreadyAwarded = u.session.xp_awarded[config.awardKey];

        if (!alreadyAwarded) {
          u.session.xp = (u.session.xp || 0) + config.xp;
          u.session.xp_awarded[config.awardKey] = true;
          u.session[config.flag] = true;
        }

        if (!alreadyAwarded) {
          await ctx.reply(
            `✅ <b>КОД ПРИНЯТ!</b>\n\n🪙 Тебе начислено +${config.xp} NeuroCoins! Твой баланс: ${u.session.xp}\n\nПродолжаем путь 👇`,
            { parse_mode: "HTML", protect_content: true },
          );
        } else {
          await ctx.reply(
            `✅ <b>ТЫ УЖЕ ПРОШЁЛ ЭТОТ МОДУЛЬ!</b>\n\n🪙 Монеты уже начислены.`,
            { parse_mode: "HTML", protect_content: true },
          );
        }

        if (config.next === "WAIT_BOT_TOKEN") {
          u.state = "WAIT_BOT_TOKEN";
          await ydb.saveUser(u);
          return ctx.reply(
            `🚀 <b>ПЕРЕХОДИМ К ПРАКТИКЕ: ЗАПУСК ИИ-КЛОНА</b>\n\n` +
              `Отлично, секретный код принят! 🪙\n\n` +
              `Ты уже оформил профиль своего бота по инструкции из Модуля 2. Теперь нам осталось подключить его к нашему нейроядру. Твой бот оживет и в нём сразу будут зашиты твои реферальные ссылки.\n\n` +
              `Скопируй и пришли мне <b>API TOKEN</b> твоего нового бота из @BotFather (это длинный набор букв и цифр).\n\n` +
              `🔒 <i>Помни: он не дает нам доступ к твоему аккаунту. Это совершенно безопасно.</i>`,
            { parse_mode: "HTML", protect_content: true },
          );
        }

        u.state = config.next;
        await ydb.saveUser(u);
        return renderStep(ctx, config.next, token);
      } else {
        return ctx.reply(
          "❌ <b>Неверное слово.</b>\n\nЗагляни в конец статьи еще раз, найди правильное слово и пришли его мне.",
          { parse_mode: "HTML", protect_content: true },
        );
      }
    }

    if (u.state === "WAIT_REG_ID") {
      if (isNaN(txt))
        return ctx.reply("❌ Пришли только цифры.", { protect_content: true });
      u.sh_user_id = txt;
      u.state = "WAIT_REG_TAIL";
      await ydb.saveUser(u);
      return ctx.reply(
        "✅ Принято! Теперь скопируй и пришли свою <b>Ссылку для приглашений</b> полностью (например: https://sethubble.com/ru/p_xyt):",
        { parse_mode: "HTML", protect_content: true },
      );
    }

    if (u.state === "WAIT_REG_TAIL") {
      let tail = txt.trim();
      if (tail.includes("sethubble.com")) {
        tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
      }
      u.sh_ref_tail = tail;

      // === ВЕРИФИКАЦИЯ ЧЕРЕЗ ВОПРОС ПО ТАРИФАМ ===
      const tariffQuestions = [
        {
          q: "Сколько компаний можно создать на тарифе 'Самолет'?",
          a: ["1", "один"],
        },
        {
          q: "Максимальная цена товара ($) на тарифе 'Ракета'?",
          a: ["5000", "5000$"],
        },
        {
          q: "Сколько уровней партнерских программ доступно на тарифе 'Шаттл'?",
          a: ["10", "десять"],
        },
        {
          q: "Какая комиссия (%) на тарифе 'Самолет'?",
          a: ["5", "5%", "пять"],
        },
        { q: "Какая комиссия (%) на тарифе 'Ракета'?", a: ["3", "3%", "три"] },
        { q: "Какая комиссия (%) на тарифе 'Шаттл'?", a: ["1", "1%", "один"] },
        {
          q: "Максимальный доход от партнерских программ ($/год) на тарифе 'Самолет'?",
          a: ["10k", "10000", "10 000"],
        },
        {
          q: "Максимальный доход от партнерских программ ($/год) на тарифе 'Ракета'?",
          a: ["100k", "100000", "100 000"],
        },
        {
          q: "Максимальный доход от партнерских программ ($/год) на тарифе 'Шаттл'?",
          a: ["12m", "12000000", "12 000 000"],
        },
        {
          q: "Доступна ли бинарная система на тарифе 'Самолет'?",
          a: ["нет", "недоступна", "no"],
        },
        {
          q: "Включена ли бинарная система на тарифе 'Ракета'?",
          a: ["да", "только включена", "yes"],
        },
        {
          q: "Есть ли полный доступ к бинарной системе на тарифе 'Шаттл'?",
          a: ["да", "полный доступ", "yes"],
        },
        {
          q: "Макс. количество продуктов /месяц на тарифе 'Самолет'?",
          a: ["5", "пять"],
        },
        {
          q: "Макс. количество продуктов /месяц на тарифе 'Ракета'?",
          a: ["50", "пятьдесят"],
        },
        {
          q: "Макс. количество продуктов /месяц на тарифе 'Шаттл'?",
          a: ["100", "сто"],
        },
        {
          q: "Авто-вывод средств на тарифе 'Самолет'?",
          a: ["нет", "отключён", "no", "disabled"],
        },
        {
          q: "Авто-вывод средств на тарифе 'Ракета'?",
          a: ["да", "доступно", "yes", "available"],
        },
        {
          q: "Авто-вывод средств на тарифе 'Шаттл'?",
          a: ["да", "доступно", "yes", "available"],
        },
        { q: "Получение баллов на тарифе 'Самолет'?", a: ["нет", "no"] },
        { q: "Получение баллов на тарифе 'Ракета'?", a: ["нет", "no"] },
        { q: "Получение баллов на тарифе 'Шаттл'?", a: ["да", "yes"] },
        {
          q: "Макс. сумма пожертвования ($) на тарифе 'Самолет'?",
          a: ["500", "500$"],
        },
        {
          q: "Макс. сумма пожертвования ($) на тарифе 'Ракета'?",
          a: ["5000", "5000$"],
        },
        {
          q: "Макс. сумма пожертвования ($) на тарифе 'Шаттл'?",
          a: ["300k", "300000", "300 000"],
        },
      ];

      const randomQ =
        tariffQuestions[Math.floor(Math.random() * tariffQuestions.length)];
      u.session.verification_question = randomQ.q;
      u.session.verification_answers = randomQ.a;
      u.state = "WAIT_VERIFICATION";
      await ydb.saveUser(u);

      return ctx.reply(
        `🔐 <b>ПОДТВЕРЖДЕНИЕ ВЛАДЕНИЯ АККАУНТОМ</b>\n\n` +
          `Чтобы убедиться, что у тебя есть доступ к личному кабинету SetHubble, ответь на вопрос:\n\n` +
          `<b>${randomQ.q}</b>\n\n` +
          `<i>(Подсказка: эти данные есть в таблице тарифов в твоем личном кабинете)</i>`,
        { parse_mode: "HTML", protect_content: true },
      );
    }

    if (u.state === "WAIT_VERIFICATION") {
      const expectedAnswers = u.session.verification_answers || [];
      const userAnswer = txt.toLowerCase().trim();

      const isCorrect = expectedAnswers.some(
        (ans) => userAnswer.includes(ans) || ans.includes(userAnswer),
      );

      if (!isCorrect) {
        return ctx.reply(
          `❌ <b>Неверный ответ.</b>\n\n` +
            `Загляни в таблицу тарифов в личном кабинете SetHubble и попробуй еще раз.\n\n` +
            `<b>Вопрос:</b> ${u.session.verification_question}`,
          { parse_mode: "HTML", protect_content: true },
        );
      }

      // Очистка временных данных
      delete u.session.verification_question;
      delete u.session.verification_answers;

      u.state = "Training_Main";
      await ydb.saveUser(u);

      await ctx.reply(
        `✅ <b>Аккаунт подтверждён!</b>\n\nЯ открыл для тебя доступ к материалам. В Главном Меню теперь разблокирован раздел «Обучение».\n\nА сейчас переходим сразу к делу 👇`,
        { parse_mode: "HTML", protect_content: true },
      );
      return renderStep(ctx, "Training_Main", token);
    }

    if (u.state === "WAIT_BROADCAST") {
      const ids = await ydb.getBotUsers(token);
      await ctx.reply(`🚀 Рассылка на ${ids.length} чел...`, {
        protect_content: true,
      });
      const res = await ydb.broadcastWithRateLimit(bot, ids, txt, {
        parse_mode: "HTML",
      });
      u.state = "START";
      return ctx.reply(`✅ Доставлено: ${res.sent}\nОшибок: ${res.failed}`, {
        protect_content: true,
      });
    }

    // === УНИВЕРСАЛЬНАЯ ЛОГИКА СОЗДАНИЯ БОТА ===
    if (u.state === "WAIT_BOT_TOKEN") {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${txt}/getMe`,
        ).then((r) => r.json());
        if (!res.ok)
          return ctx.reply("❌ Неверный токен. Проверь и пришли ещё раз:", {
            protect_content: true,
          });

        u.saved_state = txt;

        if (u.session.is_changing_token) {
          u.session.is_changing_token = false;
          u.saved_state = "";
          u.bot_token = txt;
          u.session.is_migrating = true;
          u.session.bot_username = res.result.username;

          try {
            if (u.session.old_bot_token) {
              const oldLeads = await ydb.getBotUsers(u.session.old_bot_token);
              for (const lead of oldLeads) {
                lead.bot_token = txt;
                await ydb.saveUser(lead);
              }
              log.info(
                `[TOKEN UPDATE] Migrated ${oldLeads.length} leads to new bot token`,
                {
                  userId: u.user_id,
                  oldToken: u.session.old_bot_token?.substring(0, 20) + "...",
                  newToken: txt.substring(0, 20) + "...",
                },
              );
              u.session.old_bot_token = null;
            }

            await ydb.registerPartnerBot(
              ctx.from.id,
              txt,
              res.result.username,
              u.sh_user_id,
              u.sh_ref_tail,
              "",
            );
            const host =
              event.headers.Host ||
              event.headers.host ||
              process.env.API_GW_HOST;
            if (host) {
              await fetch(
                `https://api.telegram.org/bot${txt}/setWebhook?url=https://${host}/?bot_token=${txt}`,
              );
            }
            u.session.is_migrating = false;
          } catch (dbErr) {
            log.error("[TOKEN UPDATE ERROR]", dbErr);
            u.session.is_migrating = false;
          }

          u.state = u.bought_tripwire ? "Training_Pro_P1_1" : "Module_2_Online";
          await ydb.saveUser(u);
          await ctx.reply(
            `✅ <b>ТОКЕН ОБНОВЛЁН И БОТ ЗАПУЩЕН!</b>\n\n🤖 Твой новый бот: @${res.result.username}\n\nМожешь продолжить работу 👇`,
            { parse_mode: "HTML", protect_content: true },
          );
          return renderStep(ctx, u.state, token);
        }

        // === СТАНДАРТНАЯ ЛОГИКА (ПЕРВЫЙ ЗАПУСК) ===
        if (u.sh_user_id && u.sh_ref_tail) {
          u.state = "CONFIRM_BOT_DATA";
          await ydb.saveUser(u);
          return ctx.reply(
            `В моей базе уже есть твои данные SetHubble:\n🆔 ID: <b>${u.sh_user_id}</b>\n🔗 Хвост: <b>${u.sh_ref_tail}</b>\n\nИспользуем их для настройки твоего нового клона?`,
            {
              parse_mode: "HTML",
              protect_content: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ ДА, ВСЁ ВЕРНО",
                      callback_data: "USE_EXISTING_DATA",
                    },
                  ],
                  [
                    {
                      text: "✏️ НЕТ, ВВЕСТИ ДРУГИЕ",
                      callback_data: "ENTER_NEW_DATA",
                    },
                  ],
                ],
              },
            },
          );
        } else {
          u.state = "WAIT_SH_ID_P";
          await ydb.saveUser(u);
          return ctx.reply(
            "Пришли цифровой ID для привязки к этому боту (только цифры):",
            { protect_content: true },
          );
        }
      } catch (e) {
        return ctx.reply(
          "❌ Ошибка сети при проверке токена. Попробуй позже.",
          { protect_content: true },
        );
      }
    }

    if (u.state === "WAIT_SH_ID_P") {
      u.session.tmp_shui = txt;
      u.state = "WAIT_SH_TAIL_P";
      await ydb.saveUser(u);
      return ctx.reply(
        "Пришли свою ссылку для приглашений полностью (например: https://sethubble.com/ru/p_xyt):",
        { protect_content: true },
      );
    }

    if (u.state === "WAIT_SH_TAIL_P") {
      let tail = txt.trim();
      if (tail.includes("sethubble.com")) {
        tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
      }
      u.session.tmp_shrt = tail;
      await ydb.saveUser(u);

      const productId = u.bought_tripwire
        ? process.env.PRODUCT_ID_PRO || "103_97999"
        : process.env.PRODUCT_ID_FREE || "140_9d5d2";

      const info = await (token === MAIN_TOKEN
        ? Promise.resolve({ sh_user_id: process.env.MY_SH_USER_ID || "1123" })
        : ydb.getBotInfo(token));

      const partnerId = info?.sh_user_id || "1123";
      const regLink = `https://sethubble.com/ru/?s=${productId}&afid=${partnerId}`;
      u.state = "WAIT_PARTNER_REG";
      await ydb.saveUser(u);

      return ctx.reply(
        `🎯 <b>ШАГ 3: СТАНЬ ПАРТНЁРОМ PROДУКТА</b>\n\n` +
          `Чтобы ты мог получать деньги с продаж, тебе нужно добавить этот продукт в свой личный кабинет SetHubble.\n\n` +
          `<b>ЧТО ДЕЛАТЬ:</b>\n` +
          `1. Перейди по ссылке своего пригласителя:\n` +
          `<a href="${regLink}">${regLink}</a>\n\n` +
          `2. Зарегистрируйся/войди в свой аккаунт\n` +
          `3. Продукт автоматически добавится в твой кабинет\n` +
          `4. После этого у тебя появятся личные ссылки на продажу и регистрацию агентов\n\n` +
          `<i>💡 Это займёт 1-2 минуты. После регистрации вернись в бота и напиши любое слово (например, "готов"):</i>`,
        {
          parse_mode: "HTML",
          protect_content: true,
          disable_web_page_preview: true,
        },
      );
    }

    if (u.state === "WAIT_PARTNER_REG") {
      const botToken = u.saved_state;
      const shUserId = u.session.tmp_shui;
      const shRefTail = u.session.tmp_shrt;

      u.sh_user_id = shUserId;
      u.sh_ref_tail = shRefTail;
      u.saved_state = "";

      // === TRIAL PERIOD: 3 дня бесплатного ИИ для новых партнёров ===
      if (!u.ai_active_until || u.ai_active_until < Date.now()) {
        u.ai_active_until = Date.now() + 3 * 24 * 60 * 60 * 1000;
        log.info("[TRIAL PERIOD] Added 3 days AI trial for new partner", {
          userId: u.user_id,
          aiUntil: new Date(u.ai_active_until).toISOString(),
        });
      }

      try {
        const res = await fetch(
          `https://api.telegram.org/bot${botToken}/getMe`,
        ).then((r) => r.json());

        if (res.ok) {
          u.session.bot_username = res.result.username;

          await ydb.registerPartnerBot(
            ctx.from.id,
            botToken,
            res.result.username,
            shUserId,
            shRefTail,
            "",
          );

          const host =
            event.headers.Host || event.headers.host || process.env.API_GW_HOST;
          if (host) {
            await fetch(
              `https://api.telegram.org/bot${botToken}/setWebhook?url=https://${host}/?bot_token=${botToken}`,
            );
          }

          const pBot = new Telegraf(botToken);
          await pBot.telegram
            .setMyCommands([
              { command: "start", description: "🚀 Запустить систему" },
              { command: "menu", description: "🏠 Главное меню" },
              { command: "stats", description: "📊 Моя статистика" },
            ])
            .catch(() => {});

          u.saved_state = "";

          if (
            isMainBot &&
            ctx.from.id.toString() === process.env.ADMIN_TELEGRAM_ID
          ) {
            u.state = "Module_3_Offline";
            await ydb.saveUser(u);
            await ctx.reply(
              `🎉 Твой системный бот @${res.result.username} готов!`,
              { protect_content: true },
            );
            return renderStep(ctx, "Module_3_Offline", botToken);
          } else {
            u.bot_token = botToken;
            if (!u.session.mod2_done) u.session.mod2_done = true;

            if (u.bought_tripwire) {
              u.state = "Training_Pro_P1_1";
              await ydb.saveUser(u);
              await ctx.reply(
                `🎉 <b>ТВОЯ PRO-СИСТЕМА ОБНОВЛЕНА!</b>\n\n` +
                  `🤖 Бот: @${res.result.username}\n\n` +
                  `Мы успешно вшили твою PRO-ссылку (50% комиссии) во все кнопки твоего клона.\n` +
                  `Теперь давай запустим на него трафик 👇`,
                {
                  parse_mode: "HTML",
                  protect_content: true,
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "➡️ ПРОДОЛЖИТЬ PRO-ОБУЧЕНИЕ",
                          callback_data: "Training_Pro_P1_1",
                        },
                      ],
                      [{ text: "🏠 В МЕНЮ", callback_data: "MAIN_MENU" }],
                    ],
                  },
                },
              );
            } else {
              u.state = "Module_3_Offline";
              await ydb.saveUser(u);

              const botName = res.result.username;
              const apiGw =
                process.env.API_GW_HOST ||
                "d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net";
              const promoKitUrl =
                process.env.PROMO_KIT_URL ||
                "https://novokreschennih.github.io/neurogen-promo-kit/";

              await ctx.reply(
                `🎉 <b>ТВОЙ ИИ-КЛОН УСПЕШНО ЗАПУЩЕН!</b>\n\n` +
                  `🤖 Бот: @${botName}\n` +
                  `🔗 Ссылка: https://t.me/${botName}\n\n` +
                  `🔥 <b>ТВОЙ БИЗНЕС УЖЕ ОЦИФРОВАН!</b>\n` +
                  `Пока ты читаешь это сообщение, нейросеть уже сгенерировала для тебя личный сайт-визитку, динамические QR-коды и рекламные посты для соцсетей.\n\n` +
                  `Никаких конструкторов и дизайнеров. Ты дал токен — мы выдали готовый инструмент для захвата рынка.\n\n` +
                  `Нажми кнопку <b>«📲 ОТКРЫТЬ PROMO-KIT»</b> ниже, чтобы увидеть свою готовую империю своими глазами!\n\n` +
                  `<i>💡 Как посмотришь — возвращайся сюда и переходи к Модулю 3 👇</i>`,
                {
                  parse_mode: "HTML",
                  protect_content: true,
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "📲 ОТКРЫТЬ PROMO-KIT (ВАШ САЙТ)",
                          web_app: {
                            url: `${promoKitUrl}?bot=${botName}&api=https://${apiGw}`,
                          },
                        },
                      ],
                      [
                        {
                          text: "➡️ ПЕРЕЙТИ К МОДУЛЮ 3",
                          callback_data: "GO_TO_MODULE_3",
                        },
                      ],
                    ],
                  },
                },
              );
            }
            return;
          }
        } else {
          return ctx.reply("❌ Неверный токен.", { protect_content: true });
        }
      } catch (e) {
        return ctx.reply("❌ Ошибка при регистрации бота.", {
          protect_content: true,
        });
      }
    }

    // === ОБРАБОТКА СВОБОДНОГО ТЕКСТА (AI) ===
    try {
      // v7.1: Получаем настройки из bots (per-bot limits) и owner settings из users (AI config)
      const botSettings = await ydb.getBotInfo(token);
      let ownerSettings = { custom_prompt: "", ai_provider: "polza", ai_model: "openai/gpt-4o-mini", custom_api_key: "", user_daily_limit: 0 };

      if (botSettings?.owner_id) {
        const owner = await ydb.getUser(botSettings.owner_id);
        if (owner) {
          ownerSettings = {
            custom_prompt: owner.custom_prompt || "",
            ai_provider: owner.ai_provider || "polza",
            ai_model: owner.ai_model || "openai/gpt-4o-mini",
            custom_api_key: owner.custom_api_key || "",
            user_daily_limit: owner.user_daily_limit || 0,
          };
        }
      }

      // v7.0: Проверка доступа к ИИ — личный ключ партнёра ИЛИ активная подписка
      const hasCustomKey = !!ownerSettings.custom_api_key;
      const isOwnerAiActive = await ydb.isOwnerAiActive(u, token, null);
      const hasAiAccess =
        hasCustomKey || isOwnerAiActive || u.ai_active_until > Date.now();

      if (!hasAiAccess) {
        return ctx.reply(
          `🤖 <b>Интеллект бота не активирован.</b>\n\n` +
            `Чтобы я мог отвечать вашим клиентам, выберите действие в меню <b>Мой профиль -> Настройка ИИ</b>:\n\n` +
            `1️⃣ Оплатите подписку (100 руб/мес)\n` +
            `2️⃣ Подключите личный API-ключ Polza.ai (ваша реф. ссылка)\n\n` +
            `📖 <i>Подробнее: Мой профиль -> Настройка ИИ</i>`,
          {
            parse_mode: "HTML",
            protect_content: true,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback_data: "MAIN_MENU" }],
              ],
            },
          },
        );
      }

const today = new Date().toISOString().split("T")[0];

      if (u.session.ai_count === undefined) u.session.ai_count = 0;
      if (u.session.ai_date !== today) {
        u.session.ai_count = 0;
        u.session.ai_date = today;
      }

      // v7.1: Вычисляем лимит (owner -> bot -> global)
      const defaultLimit = u.bought_tripwire ? AI_PRO_LIMIT : AI_FREE_LIMIT;
      const currentLimit = (ownerSettings.user_daily_limit || botSettings?.user_daily_limit) || defaultLimit;

      if (u.session.ai_count >= currentLimit) {
        const limitMsg = u.bought_tripwire
          ? `📚 <b>Лимит консультаций на сегодня.</b>\n\nДневной лимит (${AI_PRO_LIMIT} вопросов) достигнут. Завтра продолжим отвечать на вопросы. А пока — применяй знания на практике 👇`
          : `📚 <b>Лимит вопросов консультанту.</b>\n\nТы использовал ${AI_FREE_LIMIT} бесплатных вопроса. Если нужно больше - активируй PRO-статус.`;

        return ctx.reply(limitMsg, {
          parse_mode: "HTML",
          protect_content: true,
          reply_markup: {
            inline_keyboard: [
              u.bought_tripwire
                ? []
                : [
                    {
                      text: "💎 АКТИВИРОВАТЬ PRO",
                      callback_data: "Offer_Tripwire",
                    },
                  ],
              [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback_data: "MAIN_MENU" }],
            ].filter((row) => row.length > 0),
          },
        });
      }

      u.session.ai_count += 1;
      await ydb.saveUser(u);

      log.info("[AI HANDLER] Processing request", {
        userId: u.user_id,
        aiCount: u.session.ai_count,
        limit: currentLimit,
        hasPro: u.bought_tripwire,
      });

      log.info("[AI HANDLER] Processing request", {
        userId: u.user_id,
        aiCount: u.session.ai_count,
        limit: currentLimit,
        hasPro: u.bought_tripwire,
        provider: botConfig.ai_provider,
        model: botConfig.ai_model,
        hasCustomKey: hasCustomKey,
      });

      // v7.1: Формируем botConfig для AI Engine v3.0 (приоритет — ownerSettings, fallback — botSettings для лимитов)
      const botConfig = {
        ai_provider: ownerSettings.ai_provider || botSettings?.ai_provider || "polza",
        ai_model: ownerSettings.ai_model || botSettings?.ai_model || "openai/gpt-4o-mini",
        custom_api_key: ownerSettings.custom_api_key || "",
        custom_prompt: ownerSettings.custom_prompt || "",
      };

      await ctx.telegram.sendChatAction(ctx.from.id, "typing").catch(() => {});
      const aiResponse = await askNeuroGenAI(txt, u, botConfig);

      log.info("[AI HANDLER] Response status", {
        hasResponse: !!aiResponse,
        responseLength: aiResponse?.length || 0,
      });

      if (aiResponse) {
        return ctx.reply(aiResponse, {
          parse_mode: "HTML",
          protect_content: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: "⚡️ ВЕРНУТЬСЯ К РАБОТЕ", callback_data: "MAIN_MENU" }],
            ],
          },
        });
      }
    } catch (e) {
      console.error("[AI REPLY ERROR]", e);
    }

    return ctx
      .reply(
        `🤖 <b>Связь с нейроядром прервана.</b>\n\nВоспользуйся меню навигации 👇`,
        {
          parse_mode: "HTML",
          protect_content: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback_data: "MAIN_MENU" }],
            ],
          },
        },
      )
      .catch(() => {});
  });

  // ============================================================
  // 8. START (bot.start)
  // ============================================================
  bot.start(async (ctx) => {
    const waitStates = [
      "WAIT_REG_ID",
      "WAIT_REG_TAIL",
      "WAIT_VERIFICATION",
      "WAIT_BOT_TOKEN",
      "WAIT_SH_ID_P",
      "WAIT_SH_TAIL_P",
      "WAIT_BROADCAST",
      "WAIT_TRIPWIRE_LINK",
      "WAIT_SECRET_1",
      "WAIT_SECRET_2",
      "WAIT_SECRET_3",
      "CONFIRM_BOT_DATA",
    ];

    if (waitStates.includes(ctx.dbUser.state)) {
      ctx.dbUser.state = "START";
      ctx.dbUser.saved_state = "";
    }

    if (ctx.dbUser.saved_state && ctx.dbUser.state !== "START") {
      await renderStep(ctx, "RESUME_GATE", token);
    } else {
      await renderStep(ctx, "START", token);
    }
  });

  // ============================================================
  // 9. CALLBACK QUERY (bot.on("callback_query"))
  // ============================================================
  bot.on("callback_query", async (ctx) => {
    if (!ctx.dbUser) {
      log.error(`[CALLBACK] dbUser not loaded!`, { userId: ctx.from?.id });
      await ctx.answerCbQuery().catch(() => {});
      return;
    }

    const action = ctx.callbackQuery.data;

    log.info(`[CALLBACK] Processing`, { data: action, userId: ctx.from.id });

    // === ГЕЙМИФИКАЦИЯ: ПЕРЕХОД К ВВОДУ СЕКРЕТА ===
    if (action.startsWith("ENTER_SECRET_")) {
      const level = action.split("_")[2];
      ctx.dbUser.state = `WAIT_SECRET_${level}`;
      await ydb.saveUser(ctx.dbUser);
      await ctx.answerCbQuery().catch(() => {});
      return ctx
        .reply(
          `✍️ <b>ВВОД КОДА: МОДУЛЬ ${level}</b>\n\nОтправь мне секретное слово из статьи ответным сообщением:`,
          { parse_mode: "HTML", protect_content: true },
        )
        .catch(() => {});
    }

    // === PRO APPS ===
    if (action === "apps_menu") {
      await ctx.answerCbQuery();
      return await handleAppsCommandLocal(ctx, token);
    }

    // === ПЕРЕХОД К МОДУЛЯМ ===
    if (action === "GO_TO_MODULE_2")
      return renderStep(ctx, "Module_2_Online", token);
    if (action === "GO_TO_MODULE_3")
      return renderStep(ctx, "Module_3_Offline", token);
    if (action === "Module_3_Offline")
      return renderStep(ctx, "Module_3_Offline", token);
    if (action === "GO_TO_FINAL")
      return renderStep(ctx, "Lesson_Final_Comparison", token);

    // === ТЕОРЕТИЧЕСКИЙ КУРС ===
    if (action === "THEORY_COURSE_COMPLETE") {
      if (!ctx.dbUser.session.theory_complete) {
        ctx.dbUser.session.theory_complete = true;
        ctx.dbUser.session.xp = (ctx.dbUser.session.xp || 0) + 10;
        await ydb.saveUser(ctx.dbUser);
        await ctx.answerCbQuery("✅ Начислено +10 NeuroCoins!");
      } else {
        await ctx.answerCbQuery("✅ Теория уже пройдена!");
      }
      return renderStep(ctx, "Theory_Reward_Spoilers", token);
    }

    // === ИЗМЕНИТЬ ТОКЕН БОТА ===
    if (action === "CHANGE_BOT_TOKEN") {
      ctx.dbUser.state = "WAIT_BOT_TOKEN";
      ctx.dbUser.session.old_bot_token = ctx.dbUser.bot_token;
      ctx.dbUser.saved_state = "";
      ctx.dbUser.session.is_changing_token = true;
      await ydb.saveUser(ctx.dbUser);
      return ctx.reply(
        "🔄 <b>ИЗМЕНЕНИЕ ТОКЕНА БОТА</b>\n\nПришли мне <b>НОВЫЙ API TOKEN</b> из @BotFather.\n\n<i>Старый токен будет заменён, бот обновится.</i>",
        { parse_mode: "HTML", protect_content: true },
      );
    }

    if (action === "CONTINUE_WITH_CURRENT_BOT") {
      ctx.dbUser.state = "Module_3_Offline";
      await ydb.saveUser(ctx.dbUser);
      return renderStep(ctx, "Module_3_Offline", token);
    }

    if (action === "CREATE_NEW_BOT") {
      ctx.dbUser.state = "WAIT_BOT_TOKEN";
      ctx.dbUser.saved_state = "";
      await ydb.saveUser(ctx.dbUser);
      return ctx.reply(
        "🔄 <b>СОЗДАНИЕ НОВОГО БОТА</b>\n\nПришли мне <b>API TOKEN</b> нового бота из @BotFather.\n\n<i>Старый бот останется в системе, но для обучения будем использовать новый.</i>",
        { parse_mode: "HTML", protect_content: true },
      );
    }

    // === ГЕЙМИФИКАЦИЯ: ОТКРЫТИЕ СУНДУКОВ ===
    if (action.startsWith("GET_REWARD_")) {
      let productType = "";
      let appName = "";
      let appUrl = "";

      if (action === "GET_REWARD_1") {
        if (!ctx.dbUser.session?.bot_username)
          return ctx.answerCbQuery("❌ Сначала создай бота-клона!", {
            show_alert: true,
          });
        productType = "viral_video";
        appName = "NeuroGen: Viral Video";
        appUrl =
          process.env.NEUROGEN_VIRAL_VIDEO_URL ||
          "https://neurogen-viral-video.vercel.app";
      } else if (action === "GET_REWARD_2") {
        if (ctx.dbUser.session.xp < 100)
          return ctx.answerCbQuery("❌ Не хватает монет! Пройди все уроки.", {
            show_alert: true,
          });
        productType = "bot_scenarios";
        appName = "NeuroGen: Bot Scenarios";
        appUrl =
          process.env.NEUROGEN_BOT_SCENARIOS_URL ||
          "https://telegram-bot-script-factory.vercel.app";
      } else if (action === "GET_REWARD_3") {
        if (!ctx.dbUser.bought_tripwire)
          return ctx.answerCbQuery("❌ Доступно только на тарифе PRO!", {
            show_alert: true,
          });
        productType = "master_architect";
        appName = "NeuroGen: Master Architect";
        appUrl =
          process.env.NEUROGEN_MASTER_ARCHITECT_URL ||
          "https://funnel-ai-rho.vercel.app";
      }

      const pin = await getOrCreatePin(productType, ctx.from.id);

      if (pin === "ERROR") {
        await ctx.answerCbQuery();
        return ctx.reply(
          `⚠️ <b>СВЯЗЬ С ЯДРОМ ПРЕРВАНА</b>\n\n` +
            `Из-за высокой нагрузки на нейросеть не удалось сгенерировать твой личный PIN-код.\n` +
            `Твоя награда никуда не пропадет. Пожалуйста, повтори попытку через минуту.`,
          {
            parse_mode: "HTML",
            protect_content: true,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 ПОВТОРИТЬ ЗАПРОС", callback_data: action }],
                [{ text: "🔙 В ПРОФИЛЬ", callback_data: "EDIT_PROFILE" }],
              ],
            },
          },
        );
      }

      await ctx.reply(
        `🎁 <b>СУНДУК ОТКРЫТ!</b>\n\n` +
          `Твой инструмент: <b>${appName}</b>\n\n` +
          `🔗 Ссылка: ${appUrl}/?pin=${pin}\n` +
          `🔑 Твой личный PIN: <code>${pin}</code>\n\n` +
          `<i>(Можно просто кликнуть по ссылке, PIN подставится сам)</i>`,
        { parse_mode: "HTML" },
      );
      return ctx.answerCbQuery("Сундук успешно открыт!");
    }

    // === ПОДТВЕРЖДЕНИЕ СТАРЫХ ДАННЫХ ===
    if (
      action === "USE_EXISTING_DATA" &&
      ctx.dbUser.state === "CONFIRM_BOT_DATA"
    ) {
      ctx.dbUser.session.tmp_shui = ctx.dbUser.sh_user_id;
      ctx.dbUser.session.tmp_shrt = ctx.dbUser.sh_ref_tail;

      const productId = ctx.dbUser.bought_tripwire
        ? process.env.PRODUCT_ID_PRO || "103_97999"
        : process.env.PRODUCT_ID_FREE || "140_9d5d2";

      const info = await (token === MAIN_TOKEN
        ? Promise.resolve({ sh_user_id: process.env.MY_SH_USER_ID || "1123" })
        : ydb.getBotInfo(token));

      const partnerId = info?.sh_user_id || "1123";
      const regLink = `https://sethubble.com/ru/?s=${productId}&afid=${partnerId}`;

      ctx.dbUser.state = "WAIT_PARTNER_REG";
      await ydb.saveUser(ctx.dbUser);

      return ctx
        .editMessageText(
          `✅ <b>ДАННЫЕ ПОДТВЕРЖДЕНЫ</b>\n\n` +
            `🎯 <b>ШАГ 3: СТАНЬ ПАРТНЁРОМ PROДУКТА</b>\n\n` +
            `Чтобы ты мог получать деньги с продаж, тебе нужно добавить этот продукт в свой личный кабинет SetHubble.\n\n` +
            `<b>ЧТО ДЕЛАТЬ:</b>\n` +
            `1. Перейди по ссылке своего пригласителя:\n` +
            `<a href="${regLink}">${regLink}</a>\n\n` +
            `2. Зарегистрируйся/войди в свой аккаунт\n` +
            `3. Продукт автоматически добавится в твой кабинет\n\n` +
            `<i>💡 После регистрации напиши мне любое слово (например, "готов"):</i>`,
          { parse_mode: "HTML", disable_web_page_preview: true },
        )
        .catch(() => {});
    }

    // === ВВОД НОВЫХ ДАННЫХ ===
    if (
      action === "ENTER_NEW_DATA" &&
      ctx.dbUser.state === "CONFIRM_BOT_DATA"
    ) {
      ctx.dbUser.state = "WAIT_SH_ID_P";
      await ydb.saveUser(ctx.dbUser);
      return ctx
        .editMessageText("✏️ Понял. Пришли НОВЫЙ цифровой ID для этого бота:")
        .catch(() => {});
    }

    // === УМНЫЕ ЗАМКИ ===
    const lockedActions = [
      "LOCKED_CRM",
      "LOCKED_PROMO",
      "LOCKED_KNOWLEDGE",
      "LOCKED_AI_APPS",
    ];

    if (lockedActions.includes(action)) {
      const isPro = ctx.dbUser.bought_tripwire;
      const hasMod3 = ctx.dbUser.session?.mod3_done || isPro;

      if (
        (action === "LOCKED_PROMO" || action === "LOCKED_KNOWLEDGE") &&
        hasMod3
      ) {
        await ctx.answerCbQuery(
          "✨ Уровень пройден! Доступ уже открыт. Обновляю меню...",
          { show_alert: true },
        );
        return renderStep(ctx, "TOOLS_MENU", token);
      }

      if ((action === "LOCKED_CRM" || action === "LOCKED_AI_APPS") && isPro) {
        await ctx.answerCbQuery(
          "💎 У тебя PRO-статус! Замки сняты. Обновляю меню...",
          { show_alert: true },
        );
        return renderStep(ctx, "TOOLS_MENU", token);
      }
    }

    try {
      if (scenario.steps[action]) {
        const navSteps = [
          "START",
          "RESUME_GATE",
          "MAIN_MENU",
          "Pre_Training_Logic",
          "EDIT_PROFILE",
        ];
        if (!navSteps.includes(ctx.dbUser.state)) {
          ctx.dbUser.saved_state = ctx.dbUser.state;
        }
        await renderStep(ctx, action, token);
      }
      await ctx.answerCbQuery().catch(() => {});
    } catch (e) {
      log.error(`[CALLBACK ERROR]`, e, { data: action });
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  return { handleAppsCommand: handleAppsCommandLocal };
}
