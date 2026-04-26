/**
 * Input Validator — защита от инъекций и невалидных данных
 *
 * Валидирует все входящие данные:
 * - partner_id, user_id, email, bot_token
 * - callback_data, start payload
 * - HTML escape для CRM
 */

// ============================================================
// Константы и Regex
// ============================================================

// partner_id: буквы, цифры, подчёркивание, дефис, 2-64 символа
const PARTNER_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{5,64}$/;

// user_id: только цифры (Telegram/VK numeric ID)
const NUMERIC_ID_RE = /^\d{3,20}$/;

// email: стандартный формат
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// bot_token: формат Telegram (ID:HASH)
const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;

// ref-хвост в start payload: буквы, цифры, подчёркивание, дефис
const REF_TAIL_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// callback_data: безопасные символы, макс 64 байта (ограничение Telegram)
const CALLBACK_DATA_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// state name: только буквы, цифры, подчёркивание
const STATE_RE = /^[a-zA-Z0-9_]{1,128}$/;

// ============================================================
// Функции валидации
// ============================================================

/**
 * Валидировать partner_id
 * @returns {string|null} — очищенный partner_id или null
 */
export function validatePartnerId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return PARTNER_ID_RE.test(trimmed) ? trimmed : null;
}

export function validateWebSessionId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return SESSION_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Валидировать user_id
 * @returns {string|null}
 */
export function validateUserId(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  // Telegram ID: числовой
  if (NUMERIC_ID_RE.test(str)) return str;
  // Специальные префиксы: vk:, email:, web:
  const specialMatch = str.match(/^(vk|email|web):(.+)$/);
  if (specialMatch) {
    const prefix = specialMatch[1];
    const value = specialMatch[2];
    if (prefix === "vk" && NUMERIC_ID_RE.test(value)) return str;
    if (prefix === "email" && EMAIL_RE.test(value)) return str;
    if (prefix === "web" && value.length > 5 && value.length < 100) return str;
  }
  return null;
}

/**
 * Валидировать email
 * @returns {string|null}
 */
export function validateEmail(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

/**
 * Валидировать bot_token
 * @returns {string|null}
 */
export function validateBotToken(raw) {
  if (!raw || typeof raw !== "string") return null;
  return BOT_TOKEN_RE.test(raw.trim()) ? raw.trim() : null;
}

/**
 * Валидировать callback_data (кнопки)
 * @returns {string|null}
 */
export function validateCallbackData(raw) {
  if (!raw || typeof raw !== "string") return null;
  return CALLBACK_DATA_RE.test(raw) ? raw : null;
}

/**
 * Валидировать start payload
 * Новый компактный формат: partnerId__w[webId] ИЛИ partnerId__e[emailBase64]
 * @returns {{ partnerId: string, email?: string, webId?: string } | null}
 */
export function validateStartPayload(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();

  let parts;
  if (trimmed.includes("__")) {
    parts = trimmed.split("__");
  } else if (trimmed.includes("-")) {
    parts = trimmed.split("-");
  } else {
    parts = [trimmed];
  }

  const partnerId = validatePartnerId(parts[0]);
  const result = { partnerId: partnerId || parts[0] };

  if (parts[1]) {
    const content = parts[1];

    if (content.startsWith("w")) {
      const wId = content.substring(1);
      if (wId.length > 5) result.webId = wId;
    }
    else if (content.startsWith("e")) {
      try {
        let enc = content.substring(1).replace(/-/g, "+").replace(/_/g, "/");
        const padded = enc + "=".repeat((4 - (enc.length % 4)) % 4);
        const decoded = Buffer.from(padded, "base64").toString("utf8");
        const email = validateEmail(decoded);
        if (email) result.email = email;
      } catch (e) {}
    }
    else if (content.startsWith("web_") || content.length > 15) {
      result.webId = content;
    }
  }

  if (parts[2] && parts[2] !== "noemail") {
    try {
      const enc = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = enc + "=".repeat((4 - (enc.length % 4)) % 4);
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      const email = validateEmail(decoded);
      if (email) result.email = email;
    } catch (e) {}
  }

  return result;
}

/**
 * Валидировать state name
 * @returns {string|null}
 */
export function validateState(raw) {
  if (!raw || typeof raw !== "string") return null;
  return STATE_RE.test(raw.trim()) ? raw.trim() : null;
}

// ============================================================
// HTML Sanitizer — защита от XSS в CRM
// ============================================================

/**
 * Escape HTML для безопасного вывода в браузере
 */
export function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ============================================================
// Экспорт
// ============================================================

export default {
  validatePartnerId,
  validateUserId,
  validateEmail,
  validateBotToken,
  validateStartPayload,
  validateCallbackData,
  validateState,
  escapeHtml,
};
