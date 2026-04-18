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
    if (payload.action === "get-web-step" || payload.action === "click-button") {
      const webSessionId = payload.sessionId;
      const partnerId = payload.partner_id || payload.referrer || "p_qdr";
      
      let webUser = await ydb?.findUser({ web_id: webSessionId });

      if (!webUser && ydb) {
        log.info(`[WEB] Creating auto-session for step: ${webSessionId}`);
        webUser = {
          web_id: webSessionId,
          partner_id: partnerId,
          state: "START",
          first_name: "Web User", // ИСПРАВЛЕНИЕ: Обязательно передаем дефолтное имя
          last_seen: Date.now(),
          session: {
            source: "web",
            channels: { web: { enabled: true, configured: true } },
            channel_states: { web: "START" },
            tags: [],
            dialog_history: [],
            xp: 0
          }
        };
        const res = await ydb.saveUser(webUser);
        webUser.id = res.id;
      }

      if (!webUser) return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Database error" }) };

      // Гарантируем, что first_name всегда строка
      webUser.first_name = webUser.first_name || "друг";
      
      // Защита структуры сессии
      if (!webUser.session) webUser.session = {};
      if (!Array.isArray(webUser.session.tags)) webUser.session.tags = [];

      let targetCallback = payload.callback_data;

      // =========================================================
      // ПЕРЕХВАТ ТЕХНИЧЕСКИХ КНОПОК (которые не являются шагами)
      // =========================================================
      if (targetCallback) {
        if (targetCallback.startsWith("ENTER_SECRET_")) {
          const level = targetCallback.split("_")[2];
          webUser.state = `WAIT_SECRET_${level}`;
          webUser.saved_state = webUser.state;
          await ydb.saveUser(webUser);
          
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: `✍️ <b>ВВОД КОДА: МОДУЛЬ ${level}</b>\n\nОтправь мне секретное слово из статьи ответным сообщением (прямо в этот чат):`,
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]]
            })
          };
        }

        if (targetCallback === "CLICK_REG_ID" || targetCallback === "FORCE_REG_UPDATE") {
          webUser.state = "WAIT_REG_ID";
          await ydb.saveUser(webUser);
          return {
            statusCode: 200, headers: corsHeaders,
            body: JSON.stringify({
              success: true, stepKey: webUser.state,
              text: "✍️ <b>Введи ТВОЙ цифровой ID</b>\n\nПришли мне номер, который ты получил в личном кабинете SetHubble после регистрации (прямо в этот чат).",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]]
            })
          };
        }

        if (targetCallback === "SETUP_BOT_START") {
          webUser.state = "WAIT_BOT_TOKEN";
          await ydb.saveUser(webUser);
          return {
            statusCode: 200, headers: corsHeaders,
            body: JSON.stringify({
              success: true, stepKey: webUser.state,
              text: "🚀 <b>НАСТРОЙКА БОТА-КЛОНА</b>\n\nПришли мне <b>API TOKEN</b> твоего бота из @BotFather.",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]]
            })
          };
        }

        // Обычная логика кнопок (смена статуса на следующий шаг)
        if (payload.action === "click-button") {
          webUser.state = targetCallback;
          webUser.saved_state = targetCallback;
          webUser.session.last_activity = Date.now();
          await ydb.saveUser(webUser);
        }
      }
      // =========================================================

      const stepKey = webUser.state || "START";
      const step = scenario.steps[stepKey];

      if (!step) {
        log.warn(`[WEB] Step not found: ${stepKey}, falling back to START`);
        return {
          statusCode: 200, headers: corsHeaders,
          body: JSON.stringify({
            success: true, stepKey: "START",
            text: scenario.steps.START?.text(scenario.getLinks("p_qdr", "", ""), webUser, {}) || "Добро пожаловать!",
            image: scenario.steps.START?.image,
            buttons: scenario.steps.START?.buttons || [],
            neuroCoins: webUser.session?.xp || 0,
          })
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

      const messageText = typeof step.text === "function" ? step.text(links, webUser, info) : step.text;
      const buttons = typeof step.buttons === "function" ? step.buttons(links, webUser, info) : step.buttons;

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

    // --- ИНТЕРЦЕПТОР EMAIL В ТЕКСТЕ ---
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
