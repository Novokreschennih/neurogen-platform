/**
 * Web Chat Handler — v7.0 Highly Optimized
 * Оптимизация: Минимизация запросов к YDB (1 saveUser на запрос, 1 getOwner вместо 2).
 */
import crypto from "crypto";
import {
  validateEmail,
  validatePartnerId,
  validateWebSessionId,
} from "../../utils/validator.js";
import scenario from "../../scenarios/scenario_tg.js";
import { resolveUser } from "../../core/omni_resolver.js";
import { adaptStateForChannel } from "../../scenarios/common/step_order.js";
import {
  SECRETS_CONFIG,
  getNextStateAfterSecret,
} from "../../scenarios/common/constants.js";
import { getSecretWordErrorResponse } from "../../utils/ux_helpers.js";
import { generateToken } from "../../utils/jwt_utils.js";
import channelManager from "../../core/channels/channel_manager.js";
export async function handleWebChat(event, context) {
  const { action, log, corsHeaders, ydb } = context;
  if (action !== "web-chat") return null;

  try {
    const payloadStr = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "{}";
    const payload = JSON.parse(payloadStr);

    // --- 0. БЫСТРАЯ ЗАГРУЗКА ИЛИ СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ ---
    const webSessionId = validateWebSessionId(payload.sessionId);
    if (!webSessionId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid Session ID" }),
      };
    }
    const payloadEmail = payload.email ? validateEmail(payload.email) : null;
    const partnerId = payload.partner_id || payload.referrer || "p_qdr";
    const firstName = payloadEmail ? payloadEmail.split("@")[0] : "WebUser";

    // 1 быстрый запрос по индексу
    let webUser = await ydb.findUser({ web_id: webSessionId });
    let needsSave = false;

    if (!webUser || (payloadEmail && !webUser.email)) {
      log.info(
        "[WEB CHAT] User not found or new email. Running Omni-Resolver.",
      );
      webUser = await resolveUser("web", {
        web_id: webSessionId,
        email: payloadEmail,
        partner_id: partnerId,
        first_name: firstName,
      });
      needsSave = true;
    }

    const oldState = webUser.state;
    adaptStateForChannel(webUser, "web");
    if (oldState !== webUser.state) needsSave = true;

    if (!webUser.first_name) {
      webUser.first_name = firstName;
      needsSave = true;
    }
    if (!webUser.session) {
      webUser.session = {};
      needsSave = true;
    }
    if (!Array.isArray(webUser.session.tags)) {
      webUser.session.tags = [];
      needsSave = true;
    }
    if (!Array.isArray(webUser.session.dialog_history)) {
      webUser.session.dialog_history = [];
      needsSave = true;
    }
    if (!webUser.session.channel_states) {
      webUser.session.channel_states = {};
      needsSave = true;
    }

    webUser.last_seen = Date.now();
    needsSave = true;

    // ОПТИМИЗАЦИЯ: Асинхронная запись клика (Fire-and-forget)
    if (!webUser.session.click_recorded && partnerId && partnerId !== "p_qdr") {
      ydb
        .recordLinkClick(partnerId, webUser.id, "WEB_LEAD")
        .catch((e) => log.warn("[REF CLICK ERR]", e.message));
      webUser.session.click_recorded = true;
      needsSave = true;
    }

    // === B2B MODE: маршрутизация ЛПР (офлайн-бизнес) ===
    // Если в payload пришёл role=b2b (из /join/?role=b2b), ставим пользователю
    // соответствующую роль и начальный шаг B2B_START (только для новых сессий)
    if (
      payload.role === "b2b" &&
      (!webUser.session.role || webUser.state === "START")
    ) {
      webUser.session.role = "b2b";
      webUser.state = "B2B_START";
      webUser.saved_state = "B2B_START";
      webUser.session.last_activity = Date.now();
      needsSave = true;
      log.info(`[WEB CHAT B2B] User ${webUser.id} routed to B2B_START`);
    }

    // ============================================================
    // 1. ЛОГИКА КНОПОК ВОРОНКИ (RENDER STEPS)
    // ============================================================
    if (
      payload.action === "get-web-step" ||
      payload.action === "click-button"
    ) {
      let targetCallback = payload.callback_data;

      // --- ПЕРЕХВАТ ТЕХНИЧЕСКИХ КНОПОК ---
      if (targetCallback) {
        if (targetCallback.startsWith("ENTER_SECRET_")) {
          const level = targetCallback.split("_")[2];
          webUser.state = `WAIT_SECRET_${level}`;
          if (needsSave) await ydb.saveUser(webUser);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: `✍️ <b>ВВОД КОДА: МОДУЛЬ ${level}</b>\n\nОтправь мне секретное слово из статьи ответным сообщением прямо здесь:`,
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
            }),
          };
        }
        if (
          targetCallback === "CLICK_REG_ID" ||
          targetCallback === "FORCE_REG_UPDATE"
        ) {
          webUser.state = "WAIT_REG_ID";
          if (needsSave) await ydb.saveUser(webUser);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: "✍️ <b>Введи ТВОЙ цифровой ID</b>\n\nПришли мне номер, который ты получил в личном кабинете SetHubble после регистрации (например: 1234):",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
            }),
          };
        }
        if (targetCallback === "GO_TO_MODULE_2") {
          targetCallback = "Module_2_Online";
          needsSave = true;
        }
        if (targetCallback === "GO_TO_MODULE_3") {
          targetCallback = "Module_3_Offline";
          needsSave = true;
        }
        if (targetCallback === "GO_TO_FINAL") {
          targetCallback = "Lesson_Final_Comparison";
          needsSave = true;
        }
        if (targetCallback === "SETUP_BOT_START") {
          targetCallback = "Module_2_Reward_PromoKit";
          needsSave = true;
        }
        if (targetCallback === "THEORY_COURSE_COMPLETE") {
          if (!webUser.session.theory_complete) {
            webUser.session.theory_complete = true;
            webUser.session.xp = (webUser.session.xp || 0) + 10;
          }
          // Перенаправляем на Theory_Reward_Spoilers вместо прямого action
          targetCallback = "Theory_Reward_Spoilers";
          needsSave = true;
        }
      }

      // Обычный переход по шагам
      if (payload.action === "click-button" && targetCallback) {
        webUser.state = targetCallback;
        webUser.saved_state = targetCallback;
        webUser.session.last_activity = Date.now();
        needsSave = true;
      }

      const stepKey = webUser.state || "START";
      const step = scenario.steps[stepKey];

      const info = {
        sh_ref_tail: webUser.sh_ref_tail || webUser.partner_id || "p_qdr",
        sh_user_id: webUser.sh_user_id,
        bot_username: webUser.session?.bot_username || "sethubble_biz_bot",
      };
      const links = scenario.getLinks(
        info.sh_ref_tail,
        "",
        info.sh_user_id,
        webUser.bought_tripwire,
        webUser,
      );

      const webAppToken = generateToken(
          { uid: webUser.id, first_name: webUser.first_name },
          { expiresIn: "24h" }
        );

      const formatButtons = (stepButtons) => {
        if (!stepButtons) return [];
        const btns =
          typeof stepButtons === "function"
            ? stepButtons(links, webUser, info)
            : stepButtons;
        return btns?.map((row) =>
          row.map((btn) => {
            let targetUrl = btn.url || (btn.web_app ? btn.web_app.url : null);
            
            if (targetUrl) {
              if (targetUrl.includes("neurogen-promo-kit") || targetUrl.includes("crm-dashboard")) {
                const separator = targetUrl.includes("?") ? "&" : "?";
                targetUrl = `${targetUrl}${separator}token=${webAppToken}`;
              }
              
              if (targetUrl.includes("module-")) {
                const separator = targetUrl.includes("?") ? "&" : "?";
                targetUrl = `${targetUrl}${separator}web=1`;
              }
              
              if (btn.web_app) {
                return { ...btn, web_app: { url: targetUrl } };
              } else {
                return { ...btn, url: targetUrl };
              }
            }
            return btn;
          }),
        );
      };

      const responseStep = step || scenario.steps.START;
      const responseStepKey = step ? stepKey : "START";

      // ОПТИМИЗАЦИЯ: Единственное сохранение перед выдачей кнопок
      if (needsSave) await ydb.saveUser(webUser);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          stepKey: responseStepKey,
          text:
            typeof responseStep.text === "function"
              ? responseStep.text(links, webUser, info)
              : responseStep.text,
          image: responseStep.image,
          buttons: formatButtons(responseStep.buttons),
          neuroCoins: webUser.session?.xp || 0,
        }),
      };
    }

    // ============================================================
    // 2. ОБРАБОТКА ЛИДОВ (Email Form из /join/)
    // ============================================================
    if (
      payload.isEmail ||
      (payload.email && !payload.message && payload.action !== "get-web-step")
    ) {
      const email = validateEmail(payload.email);
      if (!email)
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid email" }),
        };

      const verificationCode = crypto.randomUUID().split("-")[0].toUpperCase();
      const codeExpires = Date.now() + 24 * 60 * 60 * 1000;

      const user = await resolveUser("email", {
        email: email,
        partner_id: partnerId,
        first_name: email.split("@")[0],
      });

      user.session.email_verification_code = verificationCode;
      user.session.email_verification_expires = codeExpires;
      user.session.channels = user.session.channels || {};
      user.session.channels.email = {
        ...user.session.channels.email,
        enabled: true,
        configured: true,
        subscribed: false,
        verified: false,
      };

      // Оптимизация: сохранение и асинхронная отправка письма
      await ydb.saveUser(user);
      const { sendEmail, templates } =
        await import("../email/email_service.js");

      sendEmail({
        to: email,
        ...templates.emailVerification(user, verificationCode),
      }).catch((e) => log.error("Email send error", e));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, emailSent: true }),
      };
    }

    // ============================================================
    // 3. ОБРАБОТКА ТЕКСТА (WAIT STATES + AI)
    // ============================================================
    if (payload.message) {
      const txt = payload.message.trim();
      const u = webUser;

      // --- А. Состояние ожидания ID ---
      if (u.state === "WAIT_REG_ID") {
        if (isNaN(txt))
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer: "❌ Пришли только цифры. Твой ID из кабинета SetHubble:",
            }),
          };
        u.sh_user_id = txt;
        u.state = "WAIT_REG_TAIL";
        if (needsSave) await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "✅ Принято! Теперь пришли свою <b>Ссылку для приглашений</b> полностью (например: https://sethubble.com/ru/p_xyt):",
          }),
        };
      }

      // --- Б. Состояние ожидания Ссылки + Верификация (ВОПРОСЫ) ---
      if (u.state === "WAIT_REG_TAIL") {
        let tail = txt;
        if (tail.includes("sethubble.com"))
          tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
        u.sh_ref_tail = tail;

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
          {
            q: "Какая комиссия (%) на тарифе 'Ракета'?",
            a: ["3", "3%", "три"],
          },
          {
            q: "Какая комиссия (%) на тарифе 'Шаттл'?",
            a: ["1", "1%", "один"],
          },
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

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: `🔐 <b>ПОДТВЕРЖДЕНИЕ ВЛАДЕНИЯ АККАУНТОМ</b>\n\nЧтобы убедиться, что у тебя есть доступ к личному кабинету SetHubble, ответь на вопрос:\n\n<b>${randomQ.q}</b>\n\n<i>(Подсказка: эти данные есть в таблице тарифов в твоем личном кабинете)</i>`,
            sessionId: webSessionId,
          }),
        };
      }

      // --- В. Проверка верификации ---
      if (u.state === "WAIT_VERIFICATION") {
        const expected = u.session.verification_answers || [];
        const isCorrect = expected.some((ans) =>
          txt.toLowerCase().includes(ans.toLowerCase()),
        );
        if (!isCorrect)
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer: `❌ <b>Неверный ответ.</b>\n\n<b>Вопрос:</b> ${u.session.verification_question}`,
            }),
          };

        u.state = "Training_Main";
        delete u.session.verification_question;
        delete u.session.verification_answers;

        if (!u.ai_active_until || u.ai_active_until < Date.now()) {
          u.ai_active_until = Date.now() + 3 * 24 * 60 * 60 * 1000;
        }

        await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "✅ Аккаунт подтвержден! Открываю доступ к обучению...",
            loadNextStep: true,
            sessionId: webSessionId,
          }),
        };
      }

      // --- Г. СЕКРЕТНЫЕ СЛОВА (ИЗ СТАТЕЙ) ---
      if (SECRETS_CONFIG[u.state]) {
        const config = SECRETS_CONFIG[u.state];
        const nextState = getNextStateAfterSecret(u.state, "web");

        if (txt.toLowerCase() === config.word.toLowerCase()) {
          if (!u.session.xp_awarded) u.session.xp_awarded = {};

          if (!u.session.xp_awarded[config.awardKey]) {
            u.session.xp = (u.session.xp || 0) + config.xp;
            u.session.xp_awarded[config.awardKey] = true;
            u.session[config.flag] = true;
            u.state = nextState;
            await ydb.saveUser(u);
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({
                answer: `✅ <b>КОД ПРИНЯТ!</b>\n\n🪙 Тебе начислено +${config.xp} NeuroCoins! Твой баланс: ${u.session.xp}\n\nПродолжаем путь 👇`,
                loadNextStep: true,
                sessionId: webSessionId,
              }),
            };
          } else {
            u.state = nextState;
            await ydb.saveUser(u);
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({
                answer: `✅ <b>ТЫ УЖЕ ПРОШЁЛ ЭТОТ МОДУЛЬ!</b>\n\nПродолжаем путь 👇`,
                loadNextStep: true,
                sessionId: webSessionId,
              }),
            };
          }
        } else {
          // Track failed attempts
          if (!u.session.secret_attempts) u.session.secret_attempts = {};
          u.session.secret_attempts[u.state] =
            (u.session.secret_attempts[u.state] || 0) + 1;
          await ydb.saveUser(u);

          const attempts = u.session.secret_attempts[u.state];
          const errorMsg = getSecretWordErrorResponse(u.state, attempts);

          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer: errorMsg,
              sessionId: webSessionId,
            }),
          };
        }
      }

      // --- Г. Настройка Telegram (MULTI-CHANNEL) ---
      if (u.state === "WAIT_TG_SETUP") {
        const tokenMatch = txt.match(/^(\d+:[A-Za-z0-9_-]+)$/);
        if (!tokenMatch) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer:
                "❌ Неверный формат токена. Токен должен выглядеть так: 123456789:ABCdefGHIjkl... Попробуй еще раз:",
            }),
          };
        }
        const cm = new ChannelManager(u, ydb);
        cm.enableChannel("telegram");
        cm.setChannelConfig("telegram", {
          bot_token: txt,
          enabled: true,
          configured: true,
          configured_at: Date.now(),
        });
        u.state = "CHANNEL_SETUP_TG_SUCCESS";
        await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "✅ <b>TELEGRAM ПОДКЛЮЧЕН!</b>\n\nТвой токен сохранен. Теперь бот сможет принимать лидов из Telegram.",
            loadNextStep: true,
          }),
        };
      }

      // --- Д. Настройка VK (MULTI-CHANNEL) ---
      if (u.state === "WAIT_VK_GROUP_ID") {
        if (isNaN(txt)) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer:
                "❌ ID сообщества VK должен состоять только из цифр. Попробуй еще раз:",
            }),
          };
        }
        const cm = new ChannelManager(u, ydb);
        cm.enableChannel("vk");
        cm.setChannelConfig("vk", {
          group_id: txt,
          enabled: true,
          configured: true,
          configured_at: Date.now(),
        });
        u.state = "CHANNEL_SETUP_VK_SUCCESS";
        await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: `✅ <b>PRO-РЕЖИМ: VK ПОДКЛЮЧЕН!</b>\n\nТвоя группа (ID: ${txt}) привязана к системе.\n\n⚠️ Не забудь настроить Callback API в сообществе VK, указав адрес нашего сервера, иначе бот не сможет отвечать.`,
            loadNextStep: true,
          }),
        };
      }

      // --- Е. Чат с ИИ (Универсальный AI Engine v3.0) ---

      // ОПТИМИЗАЦИЯ: 1 запрос к владельцу вместо 2-х!
      let isOwnerAiActive = false;
      let ownerSettings = {
        custom_prompt: "",
        ai_provider: "polza",
        ai_model: "deepseek/deepseek-v4-flash",
        custom_api_key: "",
        user_daily_limit: 0,
      };

      if (webUser.partner_id && webUser.partner_id !== "p_qdr") {
        try {
          const owner = await ydb.getUserByRefTail(webUser.partner_id);
          if (owner) {
            isOwnerAiActive = owner.ai_active_until > Date.now();
            ownerSettings = {
              custom_prompt: owner.custom_prompt || "",
              ai_provider: owner.ai_provider || "polza",
              ai_model: owner.ai_model || "deepseek/deepseek-v4-flash",
              custom_api_key: owner.custom_api_key || "",
              user_daily_limit: owner.user_daily_limit || 0,
            };
          }
        } catch (e) {
          log.warn("[WEB AI OWNER LOOKUP ERROR]", e.message);
        }
      } else {
        // Если это системный бот (p_qdr), ИИ работает всегда
        isOwnerAiActive = true;
      }

      if (!isOwnerAiActive) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "🤖 <b>ИИ-консультант в режиме ожидания</b>\n\nВладелец системы ещё не активировал нейромозг (SaaS-подписку).\n\nВоспользуйтесь меню навигации 👇",
            sessionId: webSessionId,
          }),
        };
      }

      const hasCustomKey = !!ownerSettings.custom_api_key;
      let currentLimit = ownerSettings.user_daily_limit;

      if (!hasCustomKey) {
        currentLimit = webUser.bought_tripwire ? 30 : 3;
      } else if (!currentLimit) {
        currentLimit = 99999;
      }

      const today = new Date().toISOString().split("T")[0];
      if (webUser.session.ai_date !== today) {
        webUser.session.ai_count = 0;
        webUser.session.ai_date = today;
        needsSave = true;
      }

      if (webUser.session.ai_count >= currentLimit) {
        if (needsSave) await ydb.saveUser(webUser);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "⏳ <b>Лимит консультаций исчерпан.</b> На сегодня я ответил на все вопросы. Возвращайтесь завтра!",
            sessionId: webSessionId,
          }),
        };
      }

      const botConfig = {
        ai_provider: ownerSettings.ai_provider,
        ai_model: ownerSettings.ai_model,
        custom_api_key: ownerSettings.custom_api_key,
        custom_prompt: ownerSettings.custom_prompt,
      };

      const aiEngineModule = await import("../../ai_engine.js");

      const currentHistory = webUser.session?.dialog_history || [];
      const cleanedHistory = aiEngineModule.cleanupDialogHistory(
        currentHistory,
        24,
      );

      try {
        webUser.session.ai_count = (webUser.session.ai_count || 0) + 1;
        needsSave = true;

        const aiResponse = await aiEngineModule.generateAIResponse(
          txt,
          webUser,
          webUser.state,
          cleanedHistory,
          botConfig,
        );

        const aiAnswer =
          aiResponse || "🤖 Я немного задумался. Повтори еще раз!";

        const updatedHistory = aiEngineModule.addToDialogHistory(
          cleanedHistory,
          "user",
          txt,
          10,
        );
        const finalHistory = aiEngineModule.addToDialogHistory(
          updatedHistory,
          "assistant",
          aiAnswer,
          10,
        );
        webUser.session.dialog_history = finalHistory;

        // ОПТИМИЗАЦИЯ: Сохраняем 1 раз в самом конце
        if (needsSave) await ydb.saveUser(webUser);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ answer: aiAnswer, sessionId: webSessionId }),
        };
      } catch (aiErr) {
        log.error("[WEB AI FETCH ERROR]", aiErr);
        if (needsSave) await ydb.saveUser(webUser);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "⚠️ Нейроядро временно недоступно. Попробуйте позже.",
            sessionId: webSessionId,
          }),
        };
      }
    }

    // Фолбэк, если ничего не сработало, но состояние поменялось
    if (needsSave) await ydb.saveUser(webUser);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, status: "no_action" }),
    };
  } catch (err) {
    log.error("[WEB CHAT ERROR]", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
}
