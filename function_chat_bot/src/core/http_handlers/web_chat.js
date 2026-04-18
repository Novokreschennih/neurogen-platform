/**
 * Web Chat Handler — v6.0 Omnichannel
 * Обрабатывает запросы с сайта через виджет чата и форму сбора Email.
 *
 * Логика:
 * 1. Обработка формы Email (isEmail): поиск существующего юзера и мердж сессий.
 * 2. Обработка сообщений: распознавание Email в тексте и диалог с ИИ через OpenRouter.
 */

import crypto from "crypto";
import { validateEmail, validatePartnerId } from "../../utils/validator.js";

export async function handleWebChat(event, context) {
  const { action, log, corsHeaders, ydb } = context;

  if (action !== "web-chat") return null;

  try {
    const payloadStr = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "{}";
    const payload = JSON.parse(payloadStr);

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
          // Если нашли юзера по Email - привязываем ему текущий webId
          existingEmailUser.web_id = webId || existingEmailUser.web_id;

          // Активируем веб-канал в сессии, если его еще нет
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
            // Если была временная сессия - мержим
            await ydb.mergeUsers(
              existingEmailUser,
              currentWebUser.id,
              "web_form_merge",
            );
          } else {
            await ydb.saveUser(existingEmailUser);
          }
          log.info(`[WEB LINK] Linked webId to existing email: ${email}`);
        } else if (currentWebUser) {
          // Если юзера нет, но есть сессия - просто добавляем email
          currentWebUser.email = email;
          currentWebUser.session.channels.email = {
            enabled: true,
            configured: true,
            subscribed: true,
          };
          await ydb.saveUser(currentWebUser);
        } else {
          // Полностью новый
          const newUser = {
            email,
            web_id: webId,
            partner_id: partnerId,
            state: "START",
            first_name: email.split("@")[0],
            session: {
              source: "web",
              channels: {
                email: { enabled: true, configured: true },
                web: { enabled: true, configured: true },
              },
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
    // 2. ОБРАБОТКА СООБЩЕНИЙ ЧАТА
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

    // Загружаем или создаем пользователя
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
          channel_states: { web: "START" },
          tags: [],
          dialog_history: [],
          xp: 0,
        },
      };
      const res = await ydb.saveUser(webUser);
      webUser.id = res.id;
    }

    // Обновляем время активности
    if (webUser) {
      webUser.last_seen = Date.now();
      webUser.session.last_activity = Date.now();
    }

    // --- ПЕРЕХВАТ EMAIL В ТЕКСТЕ СООБЩЕНИЯ (МЕРДЖ) ---
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = payload.message.match(emailRegex);

    if (emailMatch && webUser && ydb) {
      const foundEmail = emailMatch[0].toLowerCase();
      let existingEmailUser = await ydb.findUser({ email: foundEmail });

      if (!existingEmailUser) {
        // Просто сохраняем email текущему юзеру
        webUser.email = foundEmail;
        webUser.session.channels.email = {
          enabled: true,
          configured: true,
          subscribed: true,
        };
        webUser.session.channel_states.email = "START";
        await ydb.saveUser(webUser);
      } else if (existingEmailUser.id !== webUser.id) {
        // МЕРДЖ: Найден другой профиль с этим email
        log.info(
          `[WEB CHAT MERGE] Merging session into ${existingEmailUser.id}`,
        );
        existingEmailUser.web_id = webSessionId;
        existingEmailUser.session.channels.web = {
          enabled: true,
          configured: true,
          linked_at: Date.now(),
        };

        // Переносим историю (последние 10 сообщений)
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
          answer: `✅ Email <b>${foundEmail}</b> сохранён! Теперь ты в системе. Продолжим?`,
          sessionId: webSessionId,
          email_saved: true,
        }),
      };
    }

    // ============================================================
    // 3. ГЕНЕРАЦИЯ ОТВЕТА ИИ (OpenRouter)
    // ============================================================
    const webSystemPrompt = `Ты — NeuroGen, харизматичный ИИ-архитектор экосистемы SetHubble.
🎭 РОЛЬ:
- Эксперт по IT-бизнесу и пассивному доходу.
- Отвечай кратко (2-4 предложения), используй эмодзи.
- Форматируй HTML: <b>, <i>.
- Если у юзера нет Email, в конце каждого ответа проси его: <b>Оставь свой email, чтобы я прислал детали 👇</b>

💡 БАЗА:
SetHubble — гибридная IT-платформа. ИИ-боты продают 24/7. Доход в USDT до 10 уровней. 
PRO ($20 со скидкой): 50% комиссия, CRM, 6 ИИ-приложений.`;

    const messages = [{ role: "system", content: webSystemPrompt }];

    // Добавляем историю
    if (payload.history?.length) {
      payload.history
        .slice(-10)
        .forEach((msg) =>
          messages.push({ role: msg.role, content: msg.content }),
        );
    }
    messages.push({ role: "user", content: payload.message });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("API key missing");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://sethubble.ru",
          "X-Title": "NeuroGen Web Chat v6.0",
        },
        body: JSON.stringify({
          model: process.env.WEB_CHAT_MODEL || "deepseek/deepseek-v3.2",
          messages,
          max_tokens: 500,
          temperature: 0.75,
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);
    const aiData = await response.json();
    const aiAnswer =
      aiData.choices?.[0]?.message?.content ||
      "🤖 Я немного задумался. Повтори, пожалуйста!";

    // Сохраняем историю
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
      body: JSON.stringify({
        error: "Server error",
        answer: "⚠️ Нейроядро временно перегружено. Попробуй через минуту!",
      }),
    };
  }
}
