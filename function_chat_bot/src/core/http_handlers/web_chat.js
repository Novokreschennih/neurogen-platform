/**
 * Web Chat Handler
 * Обрабатывает запросы с сайта через виджет чата
 * action: "web-chat"
 *
 * v5.0: Сохраняет пользователей в YDB для CRON и CRM
 */

import crypto from "crypto";
import { validateEmail, validatePartnerId } from "../../utils/validator.js";

export async function handleWebChat(event, context) {
  const { action, log, corsHeaders } = context;

  if (action !== "web-chat") return null;

  try {
    const payloadStr = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "{}";
    const payload = JSON.parse(payloadStr);

    // Обработка лидов (сбор email)
    if (payload.isEmail) {
      // v5.0: Валидируем partner_id — защита от инъекций
      const partnerId =
        validatePartnerId(payload.partner_id) ||
        validatePartnerId(payload.referrer) ||
        "p_qdr";

      // Валидируем email
      const email = validateEmail(payload.email);
      if (!email) {
        log.warn("[WEB LEAD] Invalid email", { email: payload.email });
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid email" }),
        };
      }

      log.info(`[WEB LEAD] ${email}`, { partnerId });

      // Сохраняем email-пользователя в YDB
      if (context.ydb) {
        const emailUserId = `email:${email}`;
        let emailUser = await context.ydb.getUser(emailUserId);
        if (!emailUser) {
          emailUser = {
            user_id: emailUserId,
            partner_id: partnerId,
            state: "START",
            bought_tripwire: false,
            session: {
              source: "email",
              email: payload.email,
              email_verified: false,
              channels: {
                email: { enabled: true, configured: true, subscribed: true },
              },
              channel_states: { email: "START" },
              last_activity: Date.now(),
              tags: [],
              dialog_history: [],
            },
            last_seen: Date.now(),
            bot_token: "",
            tariff: "",
            sh_user_id: "",
            sh_ref_tail: "",
            purchases: [],
            first_name: payload.email.split("@")[0],
            reminders_count: 0,
            last_reminder_time: 0,
          };
          await context.ydb.saveUser(emailUser);
          log.info(`[WEB LEAD] Saved email user to YDB`, {
            userId: emailUserId,
            partnerId,
          });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    if (!payload.message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Message required" }),
      };
    }

    // === v5.0: Создание/загрузка веб-пользователя ===
    let webUserId = payload.sessionId;
    if (!webUserId) {
      webUserId = `web:${crypto.randomUUID()}`;
    }

    // v5.0: partner_id приоритетнее referrer
    const partnerId = payload.partner_id || payload.referrer || "p_qdr";

    let webUser = await context.ydb?.getUser(webUserId);
    const isNewUser = !webUser;

    // Создаём нового пользователя, если не найден
    if (!webUser && context.ydb) {
      webUser = {
        user_id: webUserId,
        partner_id: partnerId,
        state: "START",
        bought_tripwire: false,
        session: {
          source: "web",
          session_id: webUserId,
          channels: {
            web: { enabled: true, configured: true, session_id: webUserId },
          },
          channel_states: { web: "START" },
          last_activity: Date.now(),
          tags: [],
          dialog_history: [],
          xp: 0,
        },
        last_seen: Date.now(),
        bot_token: "",
        tariff: "",
        sh_user_id: "",
        sh_ref_tail: "",
        purchases: [],
        first_name: "Web User",
        reminders_count: 0,
        last_reminder_time: 0,
      };
      await context.ydb.saveUser(webUser);
      log.info(`[WEB CHAT] New web user created`, {
        userId: webUserId,
        partnerId,
      });
    }

    // Фолбэк если ydb недоступен — AI чат работает без сохранения
    if (!webUser) {
      webUser = {
        user_id: webUserId,
        partner_id: partnerId,
        state: "START",
        bought_tripwire: false,
        session: {
          source: "web",
          session_id: webUserId,
          last_activity: Date.now(),
          tags: [],
          dialog_history: [],
          xp: 0,
        },
        last_seen: Date.now(),
        bot_token: "",
        tariff: "",
        sh_user_id: "",
        sh_ref_tail: "",
        purchases: [],
        first_name: "Web User",
        reminders_count: 0,
        last_reminder_time: 0,
      };
    }

    // Обновляем активность
    if (webUser) {
      webUser.session = webUser.session || { tags: [], dialog_history: [] };
      webUser.session.last_activity = Date.now();
      webUser.last_seen = Date.now();
    }

    // Email interceptor — если пользователь ввёл email
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = payload.message.match(emailRegex);
    if (emailMatch && webUser) {
      const email = emailMatch[0];
      webUser.session.email = email;

      // v5.0: MERGE — ищем существующую email-запись
      if (context.ydb) {
        const emailUserId = `email:${email}`;
        let existingEmail = await context.ydb.getUser(emailUserId);

        if (!existingEmail) {
          // Email-записи нет — создаём новую
          const emailUser = {
            user_id: emailUserId,
            partner_id: partnerId,
            state: "START",
            bought_tripwire: false,
            session: {
              source: "web_email",
              email,
              email_verified: true,
              web_session_id: webUserId,
              channels: {
                email: { enabled: true, configured: true, subscribed: true },
                web: { enabled: true, configured: true, session_id: webUserId },
              },
              channel_states: { email: "START", web: "START" },
              last_activity: Date.now(),
              tags: [],
              dialog_history: [],
              xp: 0,
            },
            last_seen: Date.now(),
            bot_token: "",
            tariff: "",
            sh_user_id: "",
            sh_ref_tail: "",
            purchases: [],
            first_name: email.split("@")[0],
            reminders_count: 0,
            last_reminder_time: 0,
          };
          await context.ydb.saveUser(emailUser);
        } else {
          // v5.0: Email-запись уже есть — MERGE с текущей web-сессией
          existingEmail.session.web_session_id = webUserId;

          // Если у email-записи есть merged_to — значит она уже связана с Telegram/VK
          if (existingEmail.session.merged_to) {
            log.info("[WEB] Email already merged", {
              email,
              mergedTo: existingEmail.session.merged_to,
              webSessionId: webUserId,
            });
          }

          // Добавляем web-канал к email-записи
          existingEmail.session.channels = existingEmail.session.channels || {};
          existingEmail.session.channels.web = {
            enabled: true,
            configured: true,
            session_id: webUserId,
            linked_at: Date.now(),
          };
          existingEmail.session.channel_states =
            existingEmail.session.channel_states || {};
          existingEmail.session.channel_states.web = "START";

          await context.ydb.saveUser(existingEmail);

          // Обновляем web-пользователя: связываем с email-записью
          webUser.session.email_record_id = emailUserId;
          webUser.session.channels = webUser.session.channels || {};
          webUser.session.channels.email = {
            enabled: true,
            configured: true,
            subscribed: true,
          };
          webUser.session.channel_states = webUser.session.channel_states || {};
          webUser.session.channel_states.email = "START";
        }
      }

      await context.ydb?.saveUser(webUser);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: `✅ Email <b>${email}</b> сохранён!\n\nТеперь ты будешь получать уведомления и напоминания. Продолжим?`,
          sessionId: webUserId,
          email_saved: true,
        }),
      };
    }

    log.info("[WEB CHAT] Received message", {
      sessionId: webUserId,
      messageLength: payload.message.length,
      historyLength: payload.history?.length || 0,
      isNewUser,
    });

    const webSystemPrompt = `Ты — NeuroGen, харизматичный ИИ-архитектор экосистемы SetHubble.

🎭 РОЛЬ:
- Ты эксперт по IT-бизнесу, автоматизации и пассивному доходу
- Отвечай кратко, по-деловому, без воды (2-4 предложения)
- Используй эмодзи для акцентов
- Форматируй ответ HTML-тегами: <b>, <i>, <br>
- Всегда заканчивай призывом к действию (CTA) — попросить email или зарегистрироваться

💡 БАЗА ЗНАНИЙ:
SetHubble — гибридная IT-платформа и крипто-платежный шлюз с многоуровневой партнерской программой.
• ИИ-боты продают за пользователя 24/7
• 6 нейросетей NeuroGen (создание лендингов, видео, скриптов)
• Пассивный доход в USDT со всех уровней сети (до 10 уровней)
• FREE: 25% лично, 3% до 3 уровня
• PRO ($20 по скидке): 50% лично, 5% до 5 уровня + CRM + ИИ-лаборатория
• Прием USDT, BTC, ETH, TON от $1
• O2O-генератор для офлайн-бизнеса (QR-коды для B2B-встреч)
• Мультиканальность: Telegram, VK, веб-чат, email

🎯 ПРАВИЛА:
1. Отвечай на вопросы о SetHubble, заработке, автоматизации, MLM, криптовалюте
2. Если вопрос не по теме — мягко верни к SetHubble
3. Не выдумывай цифры — если не уверен, скажи "детали уточни после регистрации"
4. Будь энергичным и убедительным
5. В конце каждого ответа проси оставить email для связи: <b>Оставь свой email — свяжемся с персональным предложением 👇</b>`;

    const messages = [{ role: "system", content: webSystemPrompt }];

    if (payload.history?.length) {
      const recentHistory = payload.history.slice(-10);
      for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: payload.message });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      log.warn("[WEB CHAT] OPENROUTER_API_KEY not set");
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "API key missing",
          answer: "⚠️ Сервер временно занят. Попробуй через пару секунд!",
          sessionId: webUserId,
        }),
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const openRouterResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://sethubble.com",
          "X-Title": "SetHubble NeuroGen Web Chat v5.0",
        },
        body: JSON.stringify({
          model: process.env.WEB_CHAT_MODEL || "deepseek/deepseek-v3.2",
          messages,
          max_tokens: 500,
          temperature: 0.75,
          top_p: 0.9,
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      log.error("[WEB CHAT API ERROR]", openRouterResponse.status, errorText);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: "⚠️ Сервер временно занят. Попробуй через пару секунд!",
          sessionId: webUserId,
        }),
      };
    }

    const data = await openRouterResponse.json();
    const aiAnswer = data.choices?.[0]?.message?.content;

    if (!aiAnswer) {
      log.warn("[WEB CHAT] Empty AI response");
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: "⚠️ Сервер думает. Попробуй через пару секунд!",
          sessionId: webUserId,
        }),
      };
    }

    // Сохраняем обновлённого пользователя
    if (webUser && context.ydb) {
      webUser.session.dialog_history = webUser.session.dialog_history || [];
      webUser.session.dialog_history.push(
        { role: "user", content: payload.message, timestamp: Date.now() },
        { role: "assistant", content: aiAnswer, timestamp: Date.now() },
      );
      // Ограничиваем историю 20 сообщениями
      if (webUser.session.dialog_history.length > 20) {
        webUser.session.dialog_history =
          webUser.session.dialog_history.slice(-20);
      }
      await context.ydb.saveUser(webUser);
    }

    log.info("[WEB CHAT] Response sent", {
      sessionId: webUserId,
      answerLength: aiAnswer.length,
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ answer: aiAnswer, sessionId: webUserId }),
    };
  } catch (err) {
    log.error("[WEB CHAT ERROR]", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Server error",
        answer: "⚠️ Сервер думает. Попробуй через пару секунд!",
      }),
    };
  }
}
