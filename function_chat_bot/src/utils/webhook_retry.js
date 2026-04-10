/**
 * Webhook Retry Logic — повторная обработка входящих вебхуков
 *
 * Если обработка webhook провалилась (YDB недоступен, таймаут и т.д.),
 * повторяем с экспоненциальным backoff: 5s → 30s → 5min
 *
 * Используется для Telegram webhook, VK callback, и других входящих событий.
 */

import { log } from "./logger.js";

// Настройки по умолчанию
const DEFAULT_DELAYS = [5_000, 30_000, 300_000]; // 5s, 30s, 5min
const DEFAULT_MAX_RETRIES = DEFAULT_DELAYS.length;

/**
 * Обработать webhook с повторными попытками
 *
 * @param {Function} handlerFn - Асинхронная функция обработки webhook
 * @param {Object} options - Настройки
 * @param {number[]} options.delays - Массив задержек в мс между попытками
 * @param {string} options.context - Контекст для логирования
 * @param {Function} options.onRetry - Callback при каждой retry-попытке
 * @returns {Promise<{ success: boolean, error?: string, attempts: number }>}
 */
export async function retryWebhook(handlerFn, options = {}) {
  const delays = options.delays || DEFAULT_DELAYS;
  const context = options.context || "WEBHOOK";
  const onRetry = options.onRetry || (() => {});

  let lastError = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const result = await handlerFn();
      if (attempt > 0) {
        log.info(`[${context}] Webhook succeeded after ${attempt} retries`);
      }
      return { success: true, result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;

      if (attempt < delays.length) {
        const delay = delays[attempt];
        log.warn(`[${context}] Webhook failed, retrying in ${delay / 1000}s`, {
          attempt: attempt + 1,
          maxRetries: delays.length,
          error: error.message || String(error),
        });

        onRetry(attempt + 1, delay);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        log.error(`[${context}] Webhook failed after ${delays.length} retries`, {
          error: error.message || String(error),
          stack: error.stack?.split("\n").slice(0, 3).join(" "),
        });
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || String(lastError),
    attempts: delays.length + 1,
  };
}

/**
 * Обёртка для Express/YC API handler — автоматически ретраит
 * если handlerFn возвращает { success: false }
 *
 * Используется как middleware перед основной логикой.
 */
export function createWebhookRetry(handlerFn, options = {}) {
  return async function (event, context) {
    return retryWebhook(async () => {
      const result = await handlerFn(event, context);
      if (result && result.success === false) {
        throw new Error(result.error || "Handler returned success: false");
      }
      return result;
    }, options);
  };
}

export default { retryWebhook, createWebhookRetry, DEFAULT_DELAYS };
