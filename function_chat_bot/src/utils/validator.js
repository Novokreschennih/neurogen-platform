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
 * Валидировать start payload (partner_id или partner_id|encodedEmail)
 * @returns {{ partnerId: string, email?: string } | null}
 */
export function validateStartPayload(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const parts = trimmed.split("|");

  const partnerId = validatePartnerId(parts[0]);
  if (!partnerId) return null;

  const result = { partnerId };

  if (parts[1]) {
    // Декодируем base64url email
    try {
      const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      const email = validateEmail(decoded);
      if (email) {
        result.email = email;
      }
    } catch (e) {
      // Не удалось декодировать — игнорируем email
    }
  }

  return result;
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

/**
 * Safe JSON → HTML для вывода в CRM без XSS
 */
export function safeJsonToHtml(obj, indent = 0) {
  if (obj === null || obj === undefined) return '<span class="text-gray-400">null</span>';
  if (typeof obj === "string") return `<span class="text-green-400">"${escapeHtml(obj)}"</span>`;
  if (typeof obj === "number") return `<span class="text-cyan-400">${obj}</span>`;
  if (typeof obj === "boolean") return `<span class="text-yellow-400">${obj}</span>`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    const items = obj.map((item) => safeJsonToHtml(item, indent + 1)).join(",\n");
    return `[\n${"  ".repeat(indent + 1)}${items}\n${"  ".repeat(indent)}]`;
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj);
    if (entries.length === 0) return "{}";
    const items = entries
      .map(
        ([k, v]) =>
          `${"  ".repeat(indent + 1)}<span class="text-purple-400">"${escapeHtml(k)}"</span>: ${safeJsonToHtml(v, indent + 1)}`,
      )
      .join(",\n");
    return `{\n${items}\n${"  ".repeat(indent)}}`;
  }
  return escapeHtml(String(obj));
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
  safeJsonToHtml,
};
