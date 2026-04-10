/**
 * Email Service — Yandex Cloud Postbox Integration (API v2 + AWS SigV4)
 *
 * Sends transactional and marketing emails via Postbox HTTP API.
 * Uses AWS SigV4 authentication (compatible with AWS SES v2).
 *
 * Authentication options (in priority order):
 *   1. IAM-token — for Cloud Functions / Serverless Containers (no keys needed)
 *   2. Static Access Key — for external apps (KEY_ID + SECRET_KEY)
 *
 * Environment variables required:
 *   YANDEX_CLOUD_FOLDER_ID         — YC folder ID containing Postbox
 *   POSTBOX_FROM_EMAIL             — Verified sender email (e.g., noreply@yourdomain.com)
 *   POSTBOX_FROM_NAME              — Sender display name (default: "NeuroGen")
 *
 * Optional (for external apps, not needed in Cloud Functions):
 *   YANDEX_CLOUD_ACCESS_KEY_ID     — Static access key ID
 *   YANDEX_CLOUD_SECRET_KEY        — Static access key secret
 *
 * API docs: https://yandex.cloud/ru/docs/postbox/api-ref/email/outbound-emails/create
 */

import crypto from "crypto";

const POSTBOX_ENDPOINT =
  "https://postbox.cloud.yandex.net/v2/email/outbound-emails";
const REGION = "ru-central1";
const SERVICE = "ses";

// === КОНФИГУРАЦИЯ КАНАЛОВ ===
const DEFAULT_BOT = "sethubble_biz_bot";
const VK_COMMUNITY_URL =
  process.env.VK_COMMUNITY_URL || "https://vk.com/sethubble";
const WEB_BASE_URL = "https://sethubble.ru/ai/";

// ============================================================
// AWS SigV4 + IAM Token helpers
// ============================================================

async function getIamToken() {
  try {
    const resp = await fetch(
      "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (resp.ok) {
      const data = await resp.json();
      return data.access_token;
    }
  } catch {
    // Not running in YC infrastructure
  }
  return null;
}

function signRequest(method, url, body, accessKeyId, secretKey) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const urlObj = new URL(url);
  const canonicalUri = urlObj.pathname;
  const canonicalQuerystring = "";
  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  const headers = {
    "content-type": "application/json",
    host: urlObj.host,
    "x-amz-date": amzDate,
  };

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  function hmacSha256(key, data) {
    return crypto.createHmac("sha256", key).update(data).digest();
  }

  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, REGION);
  const kService = hmacSha256(kRegion, SERVICE);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  const authorizationHeader = [
    `${algorithm} Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Date": amzDate,
      Authorization: authorizationHeader,
    },
  };
}

// ============================================================
// sendEmail
// ============================================================

export async function sendEmail({
  to,
  subject,
  text,
  html,
  fromEmail,
  fromName,
}) {
  const folderId = process.env.YANDEX_CLOUD_FOLDER_ID;
  const defaultFromEmail = process.env.POSTBOX_FROM_EMAIL;
  const defaultFromName = process.env.POSTBOX_FROM_NAME || "NeuroGen";
  const accessKeyId = process.env.YANDEX_CLOUD_ACCESS_KEY_ID;
  const secretKey = process.env.YANDEX_CLOUD_SECRET_KEY;

  if (!folderId || !defaultFromEmail) {
    console.error("[POSTBOX] Missing required env vars", {
      hasFolderId: !!folderId,
      hasFromEmail: !!defaultFromEmail,
    });
    return { success: false, error: "Postbox not configured" };
  }

  const payload = {
    FromEmailAddress: fromEmail || defaultFromEmail,
    Destination: {
      ToAddresses: [to],
    },
    Content: {
      Simple: {
        Subject: {
          Data: subject,
          Charset: "UTF-8",
        },
        Body: {
          Text: {
            Data: text,
            Charset: "UTF-8",
          },
          ...(html
            ? {
                Html: {
                  Data: html,
                  Charset: "UTF-8",
                },
              }
            : {}),
        },
      },
    },
  };

  const body = JSON.stringify(payload);
  let authHeaders = {};

  if (accessKeyId && secretKey) {
    const signed = signRequest(
      "POST",
      POSTBOX_ENDPOINT,
      body,
      accessKeyId,
      secretKey,
    );
    authHeaders = signed.headers;
    console.info("[POSTBOX] Using SigV4 auth", {
      accessKeyId: accessKeyId.slice(0, 8) + "...",
    });
  } else {
    const iamToken = await getIamToken();
    if (iamToken) {
      authHeaders = {
        "Content-Type": "application/json",
        "X-YaCloud-SubjectToken": iamToken,
      };
      console.info("[POSTBOX] Using IAM token auth");
    } else {
      console.error("[POSTBOX] No auth method available");
      return {
        success: false,
        error:
          "Set YANDEX_CLOUD_ACCESS_KEY_ID + YANDEX_CLOUD_SECRET_KEY or run in Cloud Functions",
      };
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(POSTBOX_ENDPOINT, {
      method: "POST",
      headers: authHeaders,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[POSTBOX] API error", {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
        endpoint: POSTBOX_ENDPOINT,
      });
      return {
        success: false,
        error: `Postbox API error: ${response.status}`,
        details: errorBody,
      };
    }

    const data = await response.json();
    console.info("[POSTBOX] Email sent successfully", {
      to,
      subject,
      messageId: data?.MessageId,
    });
    return { success: true, data };
  } catch (err) {
    console.error("[POSTBOX] Network error", { to, error: err.message });
    return { success: false, error: `Network error: ${err.message}` };
  }
}

// ============================================================
// sendEmailBatch
// ============================================================

export async function sendEmailBatch(
  emails,
  { tps = 5, pauseBetweenMs = 200, onProgress } = {},
) {
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

    if (onProgress) {
      onProgress({ sent: results.sent, failed: results.failed, total });
    }

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

// ============================================================
// Мультиканальные шаблоны
// ============================================================

/**
 * Получить ref-хвост из пользователя
 */
function getRef(user) {
  return user.partner_id || user.sh_ref_tail || "p_qdr";
}

/**
 * Получить имя пользователя
 */
function getName(user) {
  return user.first_name || "друг";
}

/**
 * Генерирует ссылки на подключённые каналы
 */
function generateChannelLinks(user) {
  const ref = getRef(user);
  const channels = user?.session?.channels || {};
  const textLinks = [];
  const htmlLinks = [];

  // Telegram
  if (channels.telegram?.enabled) {
    const botName = channels.telegram.bot_username || DEFAULT_BOT;
    textLinks.push(`Telegram: https://t.me/${botName}?start=${ref}`);
    htmlLinks.push(
      `<a href="https://t.me/${botName}?start=${ref}">📱 Telegram-бот</a>`,
    );
  }

  // VK
  if (channels.vk?.enabled) {
    textLinks.push(`VK: ${VK_COMMUNITY_URL}?ref=${ref}`);
    htmlLinks.push(`<a href="${VK_COMMUNITY_URL}?ref=${ref}">💬 ВКонтакте</a>`);
  }

  // Web
  if (channels.web?.enabled) {
    textLinks.push(`Web-чат: ${WEB_BASE_URL}?ref=${ref}`);
    htmlLinks.push(
      `<a href="${WEB_BASE_URL}?ref=${ref}">🌐 Web-чат на сайте</a>`,
    );
  }

  // Фолбэк: если ни один канал не подключён
  if (textLinks.length === 0) {
    textLinks.push(`Telegram: https://t.me/${DEFAULT_BOT}?start=${ref}`);
    htmlLinks.push(
      `<a href="https://t.me/${DEFAULT_BOT}?start=${ref}">📱 Telegram-бот</a>`,
    );
  }

  return {
    text: textLinks.join("\n"),
    html: htmlLinks.join(" &nbsp;|&nbsp; "),
  };
}

/**
 * Мягкое предложение подключить неподключённые каналы (макс. 2)
 */
function generateChannelSuggestions(user) {
  const ref = getRef(user);
  const channels = user?.session?.channels || {};
  const suggestions = [];

  if (!channels.telegram?.enabled) {
    suggestions.push({
      emoji: "📱",
      name: "Telegram",
      url: `https://t.me/${DEFAULT_BOT}?start=${ref}`,
    });
  }
  if (!channels.vk?.enabled) {
    suggestions.push({
      emoji: "💬",
      name: "ВКонтакте",
      url: `${VK_COMMUNITY_URL}?ref=${ref}`,
    });
  }
  if (!channels.web?.enabled) {
    suggestions.push({
      emoji: "🌐",
      name: "Web-чат",
      url: `${WEB_BASE_URL}?ref=${ref}`,
    });
  }

  // Максимум 2 предложения, аккуратно
  const selected = suggestions.slice(0, 2);
  if (selected.length === 0) return { text: "", html: "" };

  const textLines = selected.map((s) => `${s.emoji} ${s.name}: ${s.url}`);
  const htmlItems = selected.map(
    (s) =>
      `<li style="margin: 4px 0"><a href="${s.url}">${s.emoji} ${s.name}</a></li>`,
  );

  return {
    text: `\n💡 Также можешь подключить:\n${textLines.join("\n")}`,
    html:
      `<p style="color: #9ca3af; font-size: 13px; margin-top: 16px">💡 Также можешь подключить:</p>` +
      `<ul style="margin: 0; padding-left: 16px; color: #9ca3af">${htmlItems.join("")}</ul>`,
  };
}

// ============================================================
// Экспорт шаблонов
// ============================================================

export const templates = {
  /**
   * Welcome — после ввода email на /join/
   */
  welcome(user) {
    const name = getName(user);
    const links = generateChannelLinks(user);
    const suggestions = generateChannelSuggestions(user);

    return {
      subject: "🚀 Добро пожаловать в NeuroGen!",
      text:
        `Привет, ${name}!\n\n` +
        `Твой email подтверждён — ты в системе SetHubble.\n\n` +
        `Твои каналы связи:\n${links.text}\n\n` +
        `Продолжай обучение в боте — впереди много интересного!\n` +
        `${suggestions.text}\n\n` +
        `— Команда NeuroGen`,
      html:
        `<p>Привет, <b>${name}</b>!</p>` +
        `<p>Твой email подтверждён — ты в системе SetHubble.</p>` +
        `<p style="margin: 16px 0"><b>Твои каналы связи:</b><br>${links.html}</p>` +
        `<p>Продолжай обучение — впереди много интересного!</p>` +
        `${suggestions.html}` +
        `<p style="margin-top: 20px; color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Reminder — 1-3ч неактивности
   */
  reminder(user, stepName) {
    const name = getName(user);
    const links = generateChannelLinks(user);

    return {
      subject: "⏰ Напоминание: продолжите обучение в NeuroGen",
      text:
        `${name}, вы остановились на шаге "${stepName}".\n\n` +
        `Система ждёт вас! Продолжайте движение к своей ИИ-системе.\n\n` +
        `Ваши каналы:\n${links.text}\n\n` +
        `— Команда NeuroGen`,
      html:
        `<p><b>${name}</b>, вы остановились на шаге <i>"${stepName}"</i>.</p>` +
        `<p>Система ждёт вас! Продолжайте движение к своей ИИ-системе.</p>` +
        `<p style="margin: 16px 0">${links.html}</p>` +
        `<p style="color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Follow-up (dozhim) — 20h+ неактивности на этапе оплаты
   */
  followup(user, offerType) {
    const name = getName(user);
    const links = generateChannelLinks(user);
    const suggestions = generateChannelSuggestions(user);
    const isTripwire = offerType === "tripwire";

    return {
      subject: isTripwire
        ? "🔥 PRO-статус со скидкой 50% — осталось совсем немного"
        : "🚀 Масштабируйте свой бизнес с NeuroGen",
      text:
        `${name}, не упустите возможность!\n\n` +
        (isTripwire
          ? `PRO-статус всего за $20 (вместо $40).\n50% комиссия, CRM, 6 ИИ-приложений.`
          : `Тарифы Rocket и Shuttle — неограниченный рост и бинарная система.`) +
        `\n\nОткройте бота:\n${links.text}` +
        `\n${suggestions.text}` +
        `\n\n— Команда NeuroGen`,
      html:
        `<p><b>${name}</b>, не упустите возможность!</p>` +
        (isTripwire
          ? `<p>PRO-статус всего за <b>$20</b> (вместо $40).</p><p>50% комиссия, CRM, 6 ИИ-приложений.</p>`
          : `<p>Тарифы <b>Rocket</b> и <b>Shuttle</b> — неограниченный рост и бинарная система.</p>`) +
        `<p style="margin: 16px 0">${links.html}</p>` +
        `${suggestions.html}` +
        `<p style="margin-top: 20px; color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Подтверждение покупки PRO
   */
  proPurchased(user) {
    const name = getName(user);
    const links = generateChannelLinks(user);

    return {
      subject: "✅ Поздравляем! PRO-статус активирован",
      text:
        `${name}, PRO-статус активирован!\n\n` +
        `Что теперь доступно:\n` +
        `• 50% комиссия с личных продаж\n` +
        `• 5% до 5 уровней глубины\n` +
        `• CRM-панель для управления\n` +
        `• 6 ИИ-приложений (NeuroGen Apps)\n` +
        `• Приоритетная поддержка\n\n` +
        `Твои каналы:\n${links.text}\n\n` +
        `Продолжай обучение — впереди настройка бота!\n\n` +
        `— Команда NeuroGen`,
      html:
        `<p>🎉 <b>${name}</b>, PRO-статус активирован!</p>` +
        `<p><b>Что теперь доступно:</b></p>` +
        `<ul style="margin: 8px 0; padding-left: 20px">` +
        `<li>50% комиссия с личных продаж</li>` +
        `<li>5% до 5 уровней глубины</li>` +
        `<li>CRM-панель для управления</li>` +
        `<li>6 ИИ-приложений (NeuroGen Apps)</li>` +
        `<li>Приоритетная поддержка</li>` +
        `</ul>` +
        `<p style="margin: 16px 0">${links.html}</p>` +
        `<p>Продолжай обучение — впереди настройка бота!</p>` +
        `<p style="color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Email verification — код подтверждения
   */
  verifyEmail(code) {
    return {
      subject: "🔐 Подтверждение email — NeuroGen",
      text:
        `Ваш код подтверждения: ${code}\n\n` +
        `Введите этот код в боте или на сайте для подтверждения email.\n\n` +
        `— Команда NeuroGen`,
      html:
        `<p>Ваш код подтверждения:</p>` +
        `<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; text-align: center; margin: 20px 0">${code}</p>` +
        `<p>Введите этот код в боте или на сайте.</p>` +
        `<p style="color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Канал подключён — подтверждение
   */
  channelSetupComplete(user, channelName) {
    const name = getName(user);
    const channelEmojis = { telegram: "📱", vk: "💬", web: "🌐", email: "📧" };
    const emoji = channelEmojis[channelName] || "✅";
    const links = generateChannelLinks(user);
    const suggestions = generateChannelSuggestions(user);

    return {
      subject: `${emoji} ${channelName} подключён! — NeuroGen`,
      text:
        `${name}, канал "${channelName}" успешно настроен!\n\n` +
        `Теперь ты получаешь уведомления и управляешь системой через ${channelName}.\n\n` +
        `Все твои каналы:\n${links.text}` +
        `${suggestions.text}` +
        `\n\n— Команда NeuroGen`,
      html:
        `<p>${emoji} <b>${channelName}</b> успешно подключён!</p>` +
        `<p>Теперь ты получаешь уведомления и управляешь системой через ${channelName}.</p>` +
        `<p style="margin: 16px 0"><b>Все твои каналы:</b><br>${links.html}</p>` +
        `${suggestions.html}` +
        `<p style="margin-top: 20px; color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },

  /**
   * Broadcast — массовая рассылка от админа
   */
  broadcast(user, message) {
    const name = getName(user);
    const links = generateChannelLinks(user);

    return {
      subject: "📢 Важное сообщение от команды NeuroGen",
      text:
        `${name},\n\n${message}\n\n` +
        `Твои каналы:\n${links.text}\n\n` +
        `— Команда NeuroGen`,
      html:
        `<p><b>${name}</b>,</p>` +
        `<p>${message.replace(/\n/g, "<br>")}</p>` +
        `<p style="margin: 16px 0">${links.html}</p>` +
        `<p style="color: #6b7280; font-size: 13px"><i>— Команда NeuroGen</i></p>`,
    };
  },
};

export default {
  sendEmail,
  sendEmailBatch,
  templates,
};
