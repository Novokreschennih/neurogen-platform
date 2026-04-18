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

    // === ОБРАБОТКА ЛИДОВ (сбор email из формы на первом экране) ===
    if (payload.isEmail) {
      const email = validateEmail(payload.email);
      const partnerId = validatePartnerId(payload.partner_id) || "p_qdr";
      const webId = payload.sessionId; // ID текущей сессии с фронтенда

      if (!email) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid email" }) };

      if (context.ydb) {
        // 1. Ищем, существует ли уже профиль с таким Email (например, из Telegram)
        let existingEmailUser = await context.ydb.findUser({ email });
        
        // 2. Ищем текущую временную запись, которую бэкенд мог создать при открытии страницы
        let currentWebUser = webId ? await context.ydb.findUser({ web_id: webId }) : null;

        if (existingEmailUser) {
          // СЛУЧАЙ А: Пользователь с таким Email уже есть.
          if (currentWebUser && currentWebUser.id !== existingEmailUser.id) {
            // МЕРДЖ: Приклеиваем web_id к существующему профилю и удаляем временный
            existingEmailUser.web_id = webId;
            existingEmailUser.session.channels = existingEmailUser.session.channels || {};
            existingEmailUser.session.channels.web = { 
              enabled: true, 
              configured: true, 
              linked_at: Date.now() 
            };
            existingEmailUser.session.channel_states = existingEmailUser.session.channel_states || {};
            existingEmailUser.session.channel_states.web = "START";

            await context.ydb.mergeUsers(existingEmailUser, currentWebUser.id, "web_form_merge");
            log.info(`[WEB MERGE] Form email link success`, { email, webId });
          } else {
            // Просто обновляем Email-профиль (если временного юзера еще не было)
            existingEmailUser.web_id = webId || existingEmailUser.web_id;
            await context.ydb.saveUser(existingEmailUser);
          }
        } else if (currentWebUser) {
          // СЛУЧАЙ Б: Такого Email нет, но есть временный веб-юзер. Просто приписываем ему почту.
          currentWebUser.email = email;
          currentWebUser.session.channels = currentWebUser.session.channels || {};
          currentWebUser.session.channels.email = { enabled: true, configured: true, subscribed: true };
          currentWebUser.session.channel_states = currentWebUser.session.channel_states || {};
          currentWebUser.session.channel_states.email = "START";
          
          await context.ydb.saveUser(currentWebUser);
          log.info(`[WEB] Email added to current web session`, { email, webId });
        } else {
          // СЛУЧАЙ В: Полностью новый пользователь
          const newUser = {
            email: email,
            web_id: webId,
            partner_id: partnerId,
            state: "START",
            first_name: email.split('@')[0],
            last_seen: Date.now(),
            session: { 
              source: "web", 
              channels: { 
                email: { enabled: true, configured: true, subscribed: true },
                web: { enabled: true, configured: true }
              },
              channel_states: { email: "START", web: "START" },
              tags: [],
              dialog_history: []
            }
          };
          await context.ydb.saveUser(newUser);
          log.info(`[WEB] New user created via form`, { email, webId });
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true })
      };
    }

    if (!payload.message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Message required" }),
      };
    }

    // === v6.0: Создание/загрузка веб-пользователя ===
    // v6.0: web_id — это UUID сессии (без префикса)
    let webSessionId = payload.sessionId || crypto.randomUUID();

    // v6.0: partner_id приоритетнее referrer
    const partnerId = payload.partner_id || payload.referrer || "p_qdr";

    // v6.0: Ищем пользователя по web_id
    let webUser = await context.ydb?.findUser({ web_id: webSessionId });
    const isNewUser = !webUser;

    // Создаём нового пользователя, если не найден
    if (!webUser && context.ydb) {
      webUser = {
        web_id: webSessionId,
        partner_id: partnerId,
        state: "START",
        bought_tripwire: false,
        session: {
          source: "web",
          channels: {
            web: { enabled: true, configured: true },
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
      const result = await context.ydb.saveUser(webUser);
      webUser.id = result.id;
      webUser.web_id = webSessionId;
      log.info(`[WEB CHAT] New web user created`, {
        userId: result.id,
        webId: webSessionId,
        partnerId,
      });
    }

    // Фолбэк если ydb недоступен — AI чат работает без сохранения
    if (!webUser) {
      webUser = {
        id: "temp-" + crypto.randomUUID(),
        web_id: webSessionId,
        partner_id: partnerId,
        state: "START",
        bought_tripwire: false,
        session: {
          source: "web",
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

      // v6.0: MERGE — ищем существующего пользователя по email
      if (context.ydb) {
        let existingEmailUser = await context.ydb.findUser({ email });

        if (!existingEmailUser) {
          // Email-пользователя нет — просто обновляем текущего web-пользователя
          webUser.email = email;
          webUser.session.channels = webUser.session.channels || {};
          webUser.session.channels.email = {
            enabled: true,
            configured: true,
            subscribed: true,
          };
          webUser.session.channel_states = webUser.session.channel_states || {};
          webUser.session.channel_states.email = "START";
          await context.ydb.saveUser(webUser);
        } else if (existingEmailUser.id !== webUser.id) {
          // v6.0: Нашли другого пользователя с таким email — MERGE
          log.info("[WEB] Merging web user into existing email user", {
            webUserId: webUser.id,
            existingUserId: existingEmailUser.id,
            email,
          });

          // Обновляем основной профиль: добавляем web_id
          existingEmailUser.web_id = webSessionId;
          existingEmailUser.session.channels =
            existingEmailUser.session.channels || {};
          existingEmailUser.session.channels.web = {
            enabled: true,
            configured: true,
            linked_at: Date.now(),
          };
          existingEmailUser.session.channel_states =
            existingEmailUser.session.channel_states || {};
          existingEmailUser.session.channel_states.web = "START";

          // Мержим dialog_history
          if (webUser.session?.dialog_history?.length) {
            existingEmailUser.session.dialog_history =
              existingEmailUser.session.dialog_history || [];
            existingEmailUser.session.dialog_history.push(
              ...webUser.session.dialog_history.slice(-10),
            );
            if (existingEmailUser.session.dialog_history.length > 20) {
              existingEmailUser.session.dialog_history =
                existingEmailUser.session.dialog_history.slice(-20);
            }
          }

          await context.ydb.mergeUsers(
            existingEmailUser,
            webUser.id,
            "web_merge",
          );

          // Возвращаем обновлённый основной профиль
          webUser = existingEmailUser;
        }
        // Если existingEmailUser.id === webUser.id — это тот же пользователь, ничего делать не нужно
      }

      await context.ydb?.saveUser(webUser);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          answer: `✅ Email <b>${email}</b> сохранён!\n\nТеперь ты будешь получать уведомления и напоминания. Продолжим?`,
          sessionId: webSessionId,
          email_saved: true,
        }),
      };
    }

    log.info("[WEB CHAT] Received message", {
      sessionId: webSessionId,
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
          sessionId: webSessionId,
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
          sessionId: webSessionId,
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
          sessionId: webSessionId,
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
      sessionId: webSessionId,
      answerLength: aiAnswer.length,
    });

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
        answer: "⚠️ Сервер думает. Попробуй через пару секунд!",
      }),
    };
  }
}
