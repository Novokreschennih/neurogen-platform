/**
 * Web Chat Handler — v6.8 Full Production Version
 * Обрабатывает всё: Email-лиды, кнопки воронки, верификацию и умный чат с ИИ.
 */
import crypto from "crypto";
import { validateEmail, validatePartnerId } from "../../utils/validator.js";
import scenario from "../../scenarios/scenario_tg.js";

export async function handleWebChat(event, context) {
  const { action, log, corsHeaders, ydb } = context;
  if (action !== "web-chat") return null;

  try {
    const payloadStr = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "{}";
    const payload = JSON.parse(payloadStr);
    const webSessionId = payload.sessionId;

    // --- 0. ЗАГРУЗКА ИЛИ СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ ---
    let webUser = await ydb?.findUser({ web_id: webSessionId });

    if (!webUser && ydb && webSessionId) {
      log.info(`[WEB] Initializing new session: ${webSessionId}`);
      webUser = {
        web_id: webSessionId,
        partner_id: payload.partner_id || payload.referrer || "p_qdr",
        state: "START",
        first_name: "Друг",
        last_seen: Date.now(),
        session: {
          source: "web",
          channels: { web: { enabled: true, configured: true } },
          tags: [],
          dialog_history: [],
          xp: 0,
          last_activity: Date.now(),
        },
      };
      const res = await ydb.saveUser(webUser);
      webUser.id = res.id;
    }

    if (!webUser)
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Database error" }),
      };

    // Лечим сессию, если она пустая или битая
    webUser.first_name = webUser.first_name || "Друг";
    if (!webUser.session) webUser.session = {};
    if (!Array.isArray(webUser.session.tags)) webUser.session.tags = [];
    if (!Array.isArray(webUser.session.dialog_history))
      webUser.session.dialog_history = [];
    if (!webUser.session.channel_states) webUser.session.channel_states = {};

    // ============================================================
    // 1. ЛОГИКА КНОПОК ВОРОНКИ (RENDER STEPS)
    // ============================================================
    if (
      payload.action === "get-web-step" ||
      payload.action === "click-button"
    ) {
      let targetCallback = payload.callback_data;

      // --- ПЕРЕХВАТ ТЕХНИЧЕСКИХ КНОПОК (Эмуляция действий из ТГ) ---
      if (targetCallback) {
        // А. Секретные слова
        if (targetCallback.startsWith("ENTER_SECRET_")) {
          const level = targetCallback.split("_")[2];
          webUser.state = `WAIT_SECRET_${level}`;
          await ydb.saveUser(webUser);
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
        // Б. Кнопки регистрации
        if (
          targetCallback === "CLICK_REG_ID" ||
          targetCallback === "FORCE_REG_UPDATE"
        ) {
          webUser.state = "WAIT_REG_ID";
          await ydb.saveUser(webUser);
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
        // В. Кнопка создания бота
        if (targetCallback === "SETUP_BOT_START") {
          webUser.state = "WAIT_BOT_TOKEN";
          await ydb.saveUser(webUser);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: "🚀 <b>НАСТРОЙКА БОТА-КЛОНА</b>\n\nПришли мне <b>API TOKEN</b> твоего нового бота из @BotFather.",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
            }),
          };
        }
      }

      // Обычный переход по шагам
      if (payload.action === "click-button" && targetCallback) {
        webUser.state = targetCallback;
        webUser.saved_state = targetCallback;
        webUser.session.last_activity = Date.now();
        await ydb.saveUser(webUser);
      }

      const stepKey = webUser.state || "START";
      const step = scenario.steps[stepKey];

      // Ссылки (динамика)
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
      );

      // Если шага нет в сценарии — фолбэк на START (чтобы не было undefined)
      if (!step) {
        const startStep = scenario.steps.START;
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            stepKey: "START",
            text: startStep.text(links, webUser, info),
            image: startStep.image,
            buttons:
              typeof startStep.buttons === "function"
                ? startStep.buttons(links, webUser, info)
                : startStep.buttons,
            neuroCoins: webUser.session?.xp || 0,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          stepKey,
          text:
            typeof step.text === "function"
              ? step.text(links, webUser, info)
              : step.text,
          image: step.image,
          buttons:
            typeof step.buttons === "function"
              ? step.buttons(links, webUser, info)
              : step.buttons,
          neuroCoins: webUser.session?.xp || 0,
        }),
      };
    }

    // ============================================================
    // 2. ОБРАБОТКА ЛИДОВ (Email Form из /join/)
    // ============================================================
    if (payload.isEmail) {
      const email = validateEmail(payload.email);
      if (!email)
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid email" }),
        };

      const verificationCode = crypto.randomUUID().split("-")[0].toUpperCase();
      const codeExpires = Date.now() + 24 * 60 * 60 * 1000;

      let existingEmailUser = await ydb.findUser({ email });
      if (existingEmailUser) {
        existingEmailUser.session.email_verification_code = verificationCode;
        existingEmailUser.session.email_verification_expires = codeExpires;
        await ydb.saveUser(existingEmailUser);
        const { sendEmail, templates } = await import("../email/email_service.js");
        await sendEmail({ to: email, ...templates.emailVerification(existingEmailUser, verificationCode) });
      } else {
        webUser.email = email;
        webUser.first_name = email.split("@")[0];
        webUser.session.channels = {
          email: {
            enabled: true,
            configured: true,
            subscribed: false,
            verified: false,
          },
        };
        webUser.session.email_verification_code = verificationCode;
        webUser.session.email_verification_expires = codeExpires;
        await ydb.saveUser(webUser);
        const { sendEmail, templates } = await import("../email/email_service.js");
        await sendEmail({ to: email, ...templates.emailVerification(webUser, verificationCode) });
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, emailSent: true, emailAlreadyRegistered: !!existingEmailUser }),
      };
    }

    // ============================================================
    // 3. ОБРАБОТКА ТЕКСТА (WAIT STATES + AI)
    // ============================================================
    if (payload.message) {
      const txt = payload.message.trim();
      const u = webUser; // Используем полную модель юзера, загруженную из базы

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
        await ydb.saveUser(u); // <-- Здесь u уже содержит tg_id и vk_id из БД, так что они не затрутся
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

        // ВАЖНО: Сохраняем пользователя (все старые данные + новые)
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
        // Чистим временные данные, не трогая старые
        delete u.session.verification_question;
        delete u.session.verification_answers;

        // === TRIAL PERIOD: 3 дня бесплатного ИИ для новых партнёров ===
        if (!u.ai_active_until || u.ai_active_until < Date.now()) {
          u.ai_active_until = Date.now() + (3 * 24 * 60 * 60 * 1000);
          log.info("[TRIAL PERIOD] Added 3 days AI trial for new partner", { userId: u.id, aiUntil: new Date(u.ai_active_until).toISOString() });
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
        const config = secretsConfig[u.state];
        if (txt.toLowerCase() === config.word.toLowerCase()) {
          if (!u.session.xp_awarded) u.session.xp_awarded = {};

          if (!u.session.xp_awarded[config.awardKey]) {
            u.session.xp = (u.session.xp || 0) + config.xp;
            u.session.xp_awarded[config.awardKey] = true;
            u.session[config.flag] = true;
            u.state = config.next;
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
            u.state = config.next;
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
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer:
                "❌ <b>Неверное слово.</b>\n\nЗагляни в конец статьи еще раз, найди правильное слово и пришли его мне.",
              sessionId: webSessionId,
            }),
          };
        }
      }

      // --- Д. Чат с ИИ (Универсальный AI Engine v3.0) ---

      // 1. Проверка активности ИИ-подписки владельца канала (SaaS)
      const isAiActive = await ydb.isOwnerAiActive(webUser, null, null);

      // 2. Получаем настройки владельца (по partner_id)
      let ownerSettings = { custom_prompt: "", ai_provider: "polza", ai_model: "openai/gpt-4o-mini", custom_api_key: "", user_daily_limit: 0 };

      if (webUser.partner_id) {
        try {
          const ownerRows = await ydb.driver.tableClient.withSession(async (session) => {
              const { resultSets } = await session.executeQuery(
                  `DECLARE $tail AS Utf8; SELECT custom_prompt, ai_provider, ai_model, custom_api_key, user_daily_limit FROM users WHERE sh_ref_tail = $tail LIMIT 1;`,
                  { $tail: ydb.driver.TypedValues.utf8(String(webUser.partner_id)) }
              );
              return resultSets[0]?.rows || [];
          });
          
          if (ownerRows.length > 0) {
            const r = ownerRows[0];
            ownerSettings = {
              custom_prompt: r.items[0]?.textValue || "",
              ai_provider: r.items[1]?.textValue || "polza",
              ai_model: r.items[2]?.textValue || "openai/gpt-4o-mini",
              custom_api_key: r.items[3]?.textValue || "",
              user_daily_limit: r.items[4]?.uint64Value ? Number(r.items[4].uint64Value) : 0
            };
          }
        } catch (e) {
          log.warn("[WEB AI OWNER LOOKUP ERROR]", e.message);
        }
      }

      // Проверяем допуск: либо личный ключ, либо оплачена подписка
      const hasCustomKey = !!ownerSettings.custom_api_key;
      if (!isAiActive && !hasCustomKey) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "🤖 <b>ИИ-консультант в режиме ожидания</b>\n\nВладелец системы ещё не активировал подписку на ИИ-консультанта.\n\nОбратитесь к владельцу для активации 👇",
            sessionId: webSessionId,
          }),
        };
      }

      // 3. Проверка дневных лимитов (Web-лимит)
      const today = new Date().toISOString().split("T")[0];
      if (webUser.session.ai_date !== today) {
        webUser.session.ai_count = 0;
        webUser.session.ai_date = today;
      }

      const currentLimit = ownerSettings.user_daily_limit || (webUser.bought_tripwire ? 30 : 3);
      if (webUser.session.ai_count >= currentLimit) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "⏳ <b>Лимит консультаций исчерпан.</b> На сегодня я ответил на все вопросы. Возвращайтесь завтра!",
            sessionId: webSessionId,
          }),
        };
      }

      // 4. Формируем конфиг и вызываем единый AI Engine
      const botConfig = {
        ai_provider: ownerSettings.ai_provider,
        ai_model: ownerSettings.ai_model,
        custom_api_key: ownerSettings.custom_api_key,
        custom_prompt: ownerSettings.custom_prompt
      };

      const aiEngineModule = await import("../../ai_engine.js");

      // Очистка истории
      const currentHistory = webUser.session?.dialog_history || [];
      const cleanedHistory = aiEngineModule.cleanupDialogHistory(currentHistory, 24);

      try {
        // Увеличиваем счетчик
        webUser.session.ai_count = (webUser.session.ai_count || 0) + 1;

        const aiResponse = await aiEngineModule.generateAIResponse(txt, webUser, webUser.state, cleanedHistory, botConfig);

        const aiAnswer = aiResponse || "🤖 Я немного задумался. Повтори еще раз!";

        // Сохраняем историю
        const updatedHistory = aiEngineModule.addToDialogHistory(cleanedHistory, "user", txt, 10);
        const finalHistory = aiEngineModule.addToDialogHistory(updatedHistory, "assistant", aiAnswer, 10);
        webUser.session.dialog_history = finalHistory;
        await ydb.saveUser(webUser);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ answer: aiAnswer, sessionId: webSessionId }),
        };
      } catch (aiErr) {
        log.error("[WEB AI FETCH ERROR]", aiErr);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "⚠️ Нейроядро временно недоступно. Попробуйте позже.",
            sessionId: webSessionId,
          }),
        };
      }
    } // Закрывает if (payload.message)
  } catch (err) {
    // Закрывает основной try в начале файла
    log.error("[WEB CHAT ERROR]", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
} // Закрывает функцию handleWebChat
