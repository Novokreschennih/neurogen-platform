/**
 * Web Chat Handler
 * Обрабатывает запросы с сайта через виджет чата
 * action: "web-chat"
 */

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
      log.info(`[WEB LEAD] ${payload.email}`, { ref: payload.referrer });
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

    log.info("[WEB CHAT] Received message", {
      sessionId: payload.sessionId,
      messageLength: payload.message.length,
      historyLength: payload.history?.length || 0,
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
• O2O-генератор для офлайн-бизнеса (QR-коды для B2O-встреч)

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
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "API key missing",
          answer: "⚠️ Сервер временно занят. Попробуй через секунду!",
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
          "X-Title": "SetHubble NeuroGen Web Chat v1",
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
        }),
      };
    }

    log.info("[WEB CHAT] Response sent", {
      sessionId: payload.sessionId,
      answerLength: aiAnswer.length,
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ answer: aiAnswer }),
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
