/**
 * Web Chat Handler — v6.5 Omnichannel + Integrated Funnel
 * Обрабатывает запросы с сайта: форму Email, клики по кнопкам воронки и чат с ИИ.
 */

import crypto from "crypto";
import { validateEmail, validatePartnerId } from "../../utils/validator.js";
import scenario from "../../scenarios/scenario_tg.js"; // ВАЖНО: Импортируем сценарий

export async function handleWebChat(event, context) {
  const { action, log, corsHeaders, ydb } = context;

  if (action !== "web-chat") return null;

  try {
    const payloadStr = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "{}";
    const payload = JSON.parse(payloadStr);

    // === 0. ЛОГИКА ШАГОВ ВОРОНКИ ===
    if (
      payload.action === "get-web-step" ||
      payload.action === "click-button"
    ) {
      const webSessionId = payload.sessionId;
      const partnerId = payload.partner_id || payload.referrer || "p_qdr";

      let webUser = await ydb?.findUser({ web_id: webSessionId });

      // ИСПРАВЛЕНИЕ: Если пользователя нет, создаем его (вместо 404)
      if (!webUser && ydb) {
        log.info(`[WEB] Creating auto-session for step: ${webSessionId}`);
        webUser = {
          web_id: webSessionId,
          partner_id: partnerId,
          state: "START",
          first_name: "Web User",
          last_seen: Date.now(),
          session: {
            source: "web",
            channels: { web: { enabled: true, configured: true } },
            channel_states: { web: "START" },
            tags: [],
            dialog_history: [],
            xp: 0,
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

      // Защита структуры сессии
      if (!webUser.session) webUser.session = {};
      if (!Array.isArray(webUser.session.tags)) webUser.session.tags = [];

      // ПЕРЕХВАТ ТЕХНИЧЕСКИХ КНОПОК (Секретные слова)
      let targetCallback = payload.callback_data;
      if (targetCallback && targetCallback.startsWith("ENTER_SECRET_")) {
        const level = targetCallback.split("_")[2];
        webUser.state = `WAIT_SECRET_${level}`;
        webUser.saved_state = webUser.state;
        await ydb.saveUser(webUser);

        // Возвращаем виртуальный шаг "Ввод слова"
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            stepKey: webUser.state,
            text: `✍️ <b>ВВОД КОДА: МОДУЛЬ ${level}</b>\n\nОтправь мне секретное слово из статьи ответным сообщением:`,
            buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
          }),
        };
      }

      // Обычная логика кнопок
      if (payload.action === "click-button" && targetCallback) {
        webUser.state = targetCallback;
        webUser.saved_state = targetCallback;
        webUser.session.last_activity = Date.now();
        await ydb.saveUser(webUser);
      }

      const stepKey = webUser.state || "START";
      const step = scenario.steps[stepKey];

      if (!step) {
        log.warn(`[WEB] Step not found: ${stepKey}, falling back to START`);
        // Вместо 404 возвращаем START шаг, чтобы воронка не ломалась
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            stepKey: "START",
            text: scenario.steps.START?.text || "Добро пожаловать!",
            image: scenario.steps.START?.image,
            buttons: scenario.steps.START?.buttons || [],
            neuroCoins: webUser.session?.xp || 0,
          }),
        };
      }

      // Генерируем ссылки и данные для ответа (как в боте)
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

      const messageText =
        typeof step.text === "function"
          ? step.text(links, webUser, info)
          : step.text;
      const buttons =
        typeof step.buttons === "function"
          ? step.buttons(links, webUser, info)
          : step.buttons;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          stepKey,
          text: messageText,
          image: step.image,
          buttons: buttons,
          neuroCoins: webUser.session?.xp || 0,
        }),
      };
    }

    // ============================================================
    // 1. ОБРАБОТКА ЛИДОВ (Форма ввода Email на первом экране)
    // ============================================================
    if (payload.isEmail) {
      const email = validateEmail(payload.email);
      const partnerId = validatePartnerId(payload.partner_id) || "p_qdr";
      const webId = payload.sessionId;

      if (!email)
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid email" }),
        };

      if (ydb) {
        let existingEmailUser = await ydb.findUser({ email });
        let currentWebUser = webId
          ? await ydb.findUser({ web_id: webId })
          : null;

        if (existingEmailUser) {
          existingEmailUser.web_id = webId || existingEmailUser.web_id;
          existingEmailUser.session.channels =
            existingEmailUser.session.channels || {};
          if (!existingEmailUser.session.channels.web) {
            existingEmailUser.session.channels.web = {
              enabled: true,
              configured: true,
              linked_at: Date.now(),
            };
          }

          if (currentWebUser && currentWebUser.id !== existingEmailUser.id) {
            await ydb.mergeUsers(
              existingEmailUser,
              currentWebUser.id,
              "web_form_merge",
            );
          } else {
            await ydb.saveUser(existingEmailUser);
          }
        } else if (currentWebUser) {
          currentWebUser.email = email;
          currentWebUser.session.channels.email = {
            enabled: true,
            configured: true,
            subscribed: true,
          };
          await ydb.saveUser(currentWebUser);
        } else {
          const newUser = {
            email,
            web_id: webId,
            partner_id: partnerId,
            state: "START",
            first_name: email.split("@")[0],
            last_seen: Date.now(),
            session: {
              source: "web",
              tags: [],
              dialog_history: [],
              channels: { web: { enabled: true, configured: true } },
            },
          };
          await ydb.saveUser(newUser);
        }
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    // ============================================================
    // 2. ОБРАБОТКА СООБЩЕНИЙ ЧАТА (OpenRouter)
    // ============================================================
    if (!payload.message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Message required" }),
      };
    }

    let webSessionId = payload.sessionId || crypto.randomUUID();
    const partnerId = payload.partner_id || payload.referrer || "p_qdr";
    let webUser = await ydb?.findUser({ web_id: webSessionId });

    if (!webUser && ydb) {
      webUser = {
        web_id: webSessionId,
        partner_id: partnerId,
        state: "START",
        first_name: "Web User",
        last_seen: Date.now(),
        session: {
          source: "web",
          channels: { web: { enabled: true, configured: true } },
          tags: [],
          dialog_history: [],
          xp: 0,
        },
      };
      const res = await ydb.saveUser(webUser);
      webUser.id = res.id;
    }

    if (webUser) {
      webUser.last_seen = Date.now();
      webUser.session.last_activity = Date.now();
    }

    // ============================================================
    // 2.5. ПЕРЕХВАТ ВВОДА ДАННЫХ (WAIT STATES)
    // ============================================================
    const txt = payload.message.trim();
    const u = webUser; // Для совместимости с кодом Телеграма

    // 1. Сбор цифрового ID
    if (u && u.state === "WAIT_REG_ID") {
      if (isNaN(txt)) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "❌ Пришли только цифры.",
            sessionId: webSessionId,
          }),
        };
      }
      u.sh_user_id = txt;
      u.state = "WAIT_REG_TAIL";
      await ydb.saveUser(u);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer:
            "✅ Принято! Теперь скопируй и пришли свою <b>Ссылку для приглашений</b> полностью (например: https://sethubble.com/ru/p_xyt ):",
          sessionId: webSessionId,
        }),
      };
    }

    // 2. Сбор реферальной ссылки
    if (u && u.state === "WAIT_REG_TAIL") {
      let tail = txt;
      if (tail.includes("sethubble.com")) {
        tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
      }
      u.sh_ref_tail = tail;

      // Возвращаем верификацию
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

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: `🔐 <b>ПОДТВЕРЖДЕНИЕ ВЛАДЕНИЯ АККАУНТОМ</b>\n\nЧтобы убедиться, что у тебя есть доступ к личному кабинету SetHubble, ответь на вопрос:\n\n<b>${randomQ.q}</b>\n\n<i>(Подсказка: эти данные есть в таблице тарифов в твоем личном кабинете)</i>`,
          sessionId: webSessionId,
        }),
      };
    }

    // 3. Проверка ответа верификации
    if (u && u.state === "WAIT_VERIFICATION") {
      const expectedAnswers = u.session.verification_answers || [];
      const userAnswer = txt.toLowerCase().trim();

      const isCorrect = expectedAnswers.some(
        (ans) => userAnswer.includes(ans) || ans.includes(userAnswer),
      );

      if (!isCorrect) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: `❌ <b>Неверный ответ.</b>\n\nЗагляни в таблицу тарифов в личном кабинете SetHubble и попробуй еще раз.\n\n<b>Вопрос:</b> ${u.session.verification_question}`,
            sessionId: webSessionId,
          }),
        };
      }

      // Очистка и перевод на обучение
      delete u.session.verification_question;
      delete u.session.verification_answers;
      u.state = "Training_Main";
      await ydb.saveUser(u);

      // ВАЖНО: Возвращаем не просто текст ответа, а флаг, чтобы фронтенд загрузил следующий шаг с кнопками!
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: `✅ <b>Аккаунт подтверждён!</b>\n\nЯ открыл для тебя доступ к материалам.`,
          loadNextStep: true,
          sessionId: webSessionId,
        }),
      };
    }

    // --- ИНТЕРЦЕПТОР EMAIL В ТЕКСТЕ СООБЩЕНИЯ (Оставляем как было) ---
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = payload.message.match(emailRegex);

    if (emailMatch && webUser && ydb) {
      const foundEmail = emailMatch[0].toLowerCase();
      let existingEmailUser = await ydb.findUser({ email: foundEmail });

      if (!existingEmailUser) {
        webUser.email = foundEmail;
        webUser.session.channels.email = {
          enabled: true,
          configured: true,
          subscribed: true,
        };
        await ydb.saveUser(webUser);
      } else if (existingEmailUser.id !== webUser.id) {
        existingEmailUser.web_id = webSessionId;
        existingEmailUser.session.channels.web = {
          enabled: true,
          configured: true,
          linked_at: Date.now(),
        };
        if (webUser.session?.dialog_history?.length) {
          existingEmailUser.session.dialog_history.push(
            ...webUser.session.dialog_history.slice(-10),
          );
          existingEmailUser.session.dialog_history =
            existingEmailUser.session.dialog_history.slice(-20);
        }
        await ydb.mergeUsers(existingEmailUser, webUser.id, "web_chat_merge");
        webUser = existingEmailUser;
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: `✅ Email <b>${foundEmail}</b> сохранён!`,
          sessionId: webSessionId,
          email_saved: true,
        }),
      };
    }

    // --- ОТВЕТ ИИ ---
    const webSystemPrompt = `Ты — NeuroGen, харизматичный ИИ-архитектор экосистемы SetHubble. Эксперт по IT-бизнесу. Тон: кратко, по делу, с эмодзи.`;
    const messages = [{ role: "system", content: webSystemPrompt }];
    if (payload.history?.length) {
      payload.history
        .slice(-10)
        .forEach((msg) =>
          messages.push({ role: msg.role, content: msg.content }),
        );
    }
    messages.push({ role: "user", content: payload.message });

    const apiKey = process.env.OPENROUTER_API_KEY;
    const aiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.WEB_CHAT_MODEL || "deepseek/deepseek-v3.2",
          messages,
          max_tokens: 500,
        }),
      },
    );

    const aiData = await aiResponse.json();
    const aiAnswer = aiData.choices?.[0]?.message?.content || "🤖 Я думаю...";

    if (webUser && ydb) {
      webUser.session.dialog_history.push(
        { role: "user", content: payload.message, timestamp: Date.now() },
        { role: "assistant", content: aiAnswer, timestamp: Date.now() },
      );
      webUser.session.dialog_history =
        webUser.session.dialog_history.slice(-20);
      await ydb.saveUser(webUser);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ answer: aiAnswer, sessionId: webSessionId }),
    };
  } catch (err) {
    log.error("[WEB CHAT ERROR]", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal Error" }),
    };
  }
}
