/**
 * Email Service — Yandex Cloud Postbox Integration
 * 
 * Sends transactional and marketing emails via Postbox HTTP API.
 * Authentication: API key with role `postbox.messageCreator`.
 * 
 * Environment variables required:
 *   YANDEX_CLOUD_API_KEY   — YC API key
 *   YANDEX_CLOUD_FOLDER_ID — YC folder ID containing Postbox
 *   POSTBOX_FROM_EMAIL     — Verified sender email (e.g., noreply@yourdomain.com)
 *   POSTBOX_FROM_NAME      — Sender display name (default: "NeuroGen")
 */

const POSTBOX_ENDPOINT = "https://postbox.api.cloud.yandex.net/postbox/v1/messages:send";

/**
 * Send a single email via Yandex Cloud Postbox
 * @param {object} params
 * @param {string} params.to — Recipient email
 * @param {string} params.subject — Email subject
 * @param {string} params.text — Plain text body
 * @param {string} [params.html] — HTML body (optional, falls back to text)
 * @param {string} [params.fromEmail] — Override sender email
 * @param {string} [params.fromName] — Override sender name
 * @returns {Promise<object>} Postbox API response
 */
export async function sendEmail({ to, subject, text, html, fromEmail, fromName }) {
  const apiKey = process.env.YANDEX_CLOUD_API_KEY;
  const folderId = process.env.YANDEX_CLOUD_FOLDER_ID;
  const defaultFromEmail = process.env.POSTBOX_FROM_EMAIL;
  const defaultFromName = process.env.POSTBOX_FROM_NAME || "NeuroGen";

  if (!apiKey || !folderId || !defaultFromEmail) {
    console.error("[POSTBOX] Missing required env vars", {
      hasApiKey: !!apiKey,
      hasFolderId: !!folderId,
      hasFromEmail: !!defaultFromEmail,
    });
    return { success: false, error: "Postbox not configured" };
  }

  const payload = {
    folderId,
    messages: [
      {
        to: [{ email: to }],
        from: {
          email: fromEmail || defaultFromEmail,
          name: fromName || defaultFromName,
        },
        subject,
        text,
        ...(html ? { html } : {}),
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(POSTBOX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[POSTBOX] API error", {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
      });
      return {
        success: false,
        error: `Postbox API error: ${response.status}`,
        details: errorBody,
      };
    }

    const data = await response.json();
    console.info("[POSTBOX] Email sent successfully", { to, subject });
    return { success: true, data };
  } catch (err) {
    console.error("[POSTBOX] Network error", { to, error: err.message });
    return { success: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Send emails in batch with rate limiting
 * Respects Postbox TPS limits via configurable rate
 * 
 * @param {Array<object>} emails — Array of { to, subject, text, html }
 * @param {object} options
 * @param {number} [options.tps=5] — Max emails per second (Postbox TPS limit)
 * @param {number} [options.pauseBetweenMs=200] — Pause between emails in ms
 * @param {function} [options.onProgress] — Callback({ sent, failed, total })
 * @returns {Promise<object>} { sent, failed, errors: [{ email, error }] }
 */
export async function sendEmailBatch(emails, { tps = 5, pauseBetweenMs = 200, onProgress } = {}) {
  const results = { sent: 0, failed: 0, errors: [] };
  const total = emails.length;

  console.info("[POSTBOX] Starting batch send", { total, tps, pauseBetweenMs });

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const result = await sendEmail(email);

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ email: email.to, error: result.error });
    }

    // Progress callback
    if (onProgress) {
      onProgress({ sent: results.sent, failed: results.failed, total });
    }

    // Rate limiting: pause between emails
    if (i < emails.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, pauseBetweenMs));
    }
  }

  console.info("[POSTBOX] Batch send complete", {
    total,
    sent: results.sent,
    failed: results.failed,
    successRate: `${((results.sent / total) * 100).toFixed(1)}%`,
  });

  return results;
}

/**
 * Email templates for common scenarios
 */
export const templates = {
  /**
   * Welcome email — sent when user completes registration
   */
  welcome(user) {
    return {
      subject: "🚀 Добро пожаловать в NeuroGen!",
      text: `Привет, ${user.first_name || "друг"}!\n\n` +
        `Вы успешно зарегистрировались в экосистеме SetHubble.\n\n` +
        `Ваш партнёрский ID: ${user.sh_user_id || "N/A"}\n` +
        `Реферальная ссылка: https://t.me/sethubble_biz_bot?start=${user.sh_ref_tail || "p_qdr"}\n\n` +
        `Продолжайте обучение в боте — впереди много интересного!\n\n` +
        `— Команда NeuroGen`,
      html: `<p>Привет, <b>${user.first_name || "друг"}</b>!</p>` +
        `<p>Вы успешно зарегистрировались в экосистеме SetHubble.</p>` +
        `<p>Ваш партнёрский ID: <b>${user.sh_user_id || "N/A"}</b><br>` +
        `Реферальная ссылка: <a href="https://t.me/sethubble_biz_bot?start=${user.sh_ref_tail || "p_qdr"}">открыть бота</a></p>` +
        `<p>Продолжайте обучение в боте — впереди много интересного!</p>` +
        `<p><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Reminder email — sent when user is inactive
   */
  reminder(user, stepName) {
    return {
      subject: "⏰ Напоминание: продолжите обучение в NeuroGen",
      text: `${user.first_name || "Друг"}, вы остановились на шаге "${stepName}".\n\n` +
        `Система ждёт вас! Продолжайте движение к своей ИИ-системе.\n\n` +
        `Откройте бота: https://t.me/sethubble_biz_bot\n\n` +
        `— Команда NeuroGen`,
      html: `<p><b>${user.first_name || "Друг"}</b>, вы остановились на шаге <i>"${stepName}"</i>.</p>` +
        `<p>Система ждёт вас! Продолжайте движение к своей ИИ-системе.</p>` +
        `<p><a href="https://t.me/sethubble_biz_bot">Открыть бота →</a></p>` +
        `<p><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Follow-up (dozhim) email — sent for inactive prospects
   */
  followup(user, offerType) {
    return {
      subject: offerType === "tripwire"
        ? "🔥 Специальное предложение: PRO-статус со скидкой 50%"
        : "🚀 Масштабируйте свой бизнес с NeuroGen",
      text: `${user.first_name || "Друг"}, не упустите возможность!\n\n` +
        (offerType === "tripwire"
          ? `PRO-статус всего за $20 (вместо $40). 50% комиссия, CRM, 6 ИИ-приложений.\n\n`
          : `Тарифы Rocket и Shuttle — неограниченный рост и бинарная система.\n\n`) +
        `Активируйте сейчас: https://t.me/sethubble_biz_bot\n\n` +
        `— Команда NeuroGen`,
      html: `<p><b>${user.first_name || "Друг"}</b>, не упустите возможность!</p>` +
        (offerType === "tripwire"
          ? `<p>PRO-статус всего за <b>$20</b> (вместо $40). 50% комиссия, CRM, 6 ИИ-приложений.</p>`
          : `<p>Тарифы <b>Rocket</b> и <b>Shuttle</b> — неограниченный рост и бинарная система.</p>`) +
        `<p><a href="https://t.me/sethubble_biz_bot">Активировать →</a></p>` +
        `<p><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Email verification — sent to verify email address
   */
  verifyEmail(code) {
    return {
      subject: "🔐 Подтверждение email — NeuroGen",
      text: `Ваш код подтверждения: ${code}\n\n` +
        `Введите этот код в боте или на сайте для подтверждения email.\n\n` +
        `— Команда NeuroGen`,
      html: `<p>Ваш код подтверждения: <b style="font-size:24px">${code}</b></p>` +
        `<p>Введите этот код в боте или на сайте для подтверждения email.</p>` +
        `<p><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Channel setup complete — confirmation email
   */
  channelSetupComplete(user, channelName) {
    const channelEmojis = { telegram: "📱", vk: "💬", web: "🌐", email: "📧" };
    const emoji = channelEmojis[channelName] || "✅";

    return {
      subject: `${emoji} ${channelName} подключён! — NeuroGen`,
      text: `${user.first_name || "Друг"}, канал "${channelName}" успешно настроен!\n\n` +
        `Теперь вы можете получать лидов и управлять своей системой через ${channelName}.\n\n` +
        `— Команда NeuroGen`,
      html: `<p>${emoji} <b>${channelName}</b> успешно подключён!</p>` +
        `<p>Теперь вы можете получать лидов и управлять своей системой через ${channelName}.</p>` +
        `<p><i>— Команда NeuroGen</i></p>`,
    };
  },
};

export default {
  sendEmail,
  sendEmailBatch,
  templates,
};
