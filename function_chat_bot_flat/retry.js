/**
 * Retry Logic для обработки 429 Too Many Requests
 * Экспоненциальный backoff с учётом retry_after от Telegram/VK API
 */

import { log } from "./logger.js";

/**
 * Выполнить асинхронную операцию с повторными попытками при 429 ошибке
 *
 * @param {Function} fn - Асинхронная функция для выполнения
 * @param {Object} options - Настройки
 * @param {number} options.maxRetries - Максимум попыток (default: 2)
 * @param {number} options.maxDelaySec - Максимальная задержка в секундах (default: 10)
 * @param {string} options.context - Контекст для логирования (default: "API")
 * @returns {Promise<any>} Результат выполнения fn
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 2,
    maxDelaySec = 10,
    context = "API",
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;

      // Извлекаем код ошибки из разных форматов (Telegram, VK, fetch)
      const errorCode =
        error.response?.body?.error_code ||
        error.response?.body?.parameters?.retry_after ||
        error.code ||
        null;

      const errorMsg =
        error.response?.body?.description || error.message || "Unknown error";

      // 429 — пробуем снова с экспоненциальной задержкой
      if (errorCode === 429 && attempt < maxRetries) {
        const retryAfter = error.response?.body?.parameters?.retry_after || 1;
        const delay = Math.min(retryAfter * Math.pow(2, attempt), maxDelaySec) * 1000;

        log.warn(`[${context}] 429 detected, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxRetries,
          retryAfter,
        });

        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      // Пользователь заблокировал бота (403)
      if (
        errorCode === 403 ||
        errorMsg.includes("bot was blocked") ||
        errorMsg.includes("chat not found")
      ) {
        log.warn(`[${context}] User blocked bot`, {
          errorCode,
          errorMsg,
        });
        throw Object.assign(new Error(`Blocked: ${errorMsg}`), {
          code: 403,
          isBlocked: true,
        });
      }

      // Другие ошибки
      log.warn(`[${context}] Request failed`, {
        errorCode,
        errorMsg,
        attempt: attempt + 1,
      });

      // Если это последняя попытка — бросаем ошибку
      if (attempt >= maxRetries) {
        throw Object.assign(
          new Error(`Max retries exceeded: ${errorMsg}`),
          { code: errorCode, originalError: error },
        );
      }
    }
  }

  // Теоретически недостижимый код, но для типобезопасности
  throw lastError;
}

/**
 * Обработать результат отправки сообщения
 * Возвращает объект { sent: boolean, error?: string, errorCode?: number, isBlocked?: boolean }
 */
export function parseSendResult(result) {
  if (result && !result.error) {
    return { sent: true, error: null, errorCode: null };
  }

  const error = result?.error || result;
  const errorCode = error?.code || error?.response?.body?.error_code || null;
  const errorMsg = error?.message || error?.response?.body?.description || "Unknown error";
  const isBlocked = error?.isBlocked || errorCode === 403;

  return {
    sent: false,
    error: errorMsg,
    errorCode,
    isBlocked,
  };
}
