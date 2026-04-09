/**
 * TTL Cache для защиты от дублирующихся update_id
 * Обёртка над LRUCache с автоматической очисткой по времени жизни
 */

import { LRUCache } from "lru-cache";
import { log } from "./logger.js";

/**
 * Создать TTL-кэш для отслеживания обработанных обновлений
 *
 * @param {Object} options - Настройки
 * @param {number} options.max - Максимальное количество элементов (default: 1000)
 * @param {number} options.ttlMs - Время жизни элемента в миллисекундах (default: 5 минут)
 * @param {number} options.cleanupIntervalMs - Интервал очистки (default: 1 минута)
 * @returns {Object} Объект с методами кэша
 */
export function createUpdateCache(options = {}) {
  const {
    max = parseInt(process.env.MAX_STORED_UPDATES) || 1000,
    ttlMs = parseInt(process.env.UPDATE_TTL_MS) || 5 * 60 * 1000,
    cleanupIntervalMs = parseInt(process.env.UPDATE_CLEANUP_INTERVAL_MS) || 60 * 1000,
  } = options;

  const cache = new LRUCache({
    max,
    ttl: ttlMs,
    dispose: (value, key) => {
      log.debug(`[LRU-CACHE] Expired update ${key}`);
    },
  });

  let cleanupInterval = null;

  /**
   * Проверить, был ли уже обработан данный update
   * @param {string} updateId - Уникальный идентификатор обновления
   * @returns {boolean} true если update уже обработан
   */
  function isProcessed(updateId) {
    return cache.has(updateId);
  }

  /**
   * Отметить update как обработанный
   * @param {string} updateId - Уникальный идентификатор обновления
   */
  function markProcessed(updateId) {
    cache.set(updateId, Date.now());
  }

  /**
   * Периодическая очистка устаревших записей
   * LRUCache делает это автоматически при доступе,
   * но эта функция полезна для мониторинга
   */
  function cleanup() {
    const stats = cache.stats;
    log.debug(`[UPDATE CLEANUP] LRU-CACHE stats`, {
      size: cache.size,
      maxSize: cache.max,
      ...stats,
    });
  }

  /**
   * Запустить периодическую очистку
   */
  function startCleanup() {
    if (!cleanupInterval) {
      cleanupInterval = setInterval(cleanup, cleanupIntervalMs);
      log.info(`[UPDATE CLEANUP] Started with interval ${cleanupIntervalMs}ms, TTL ${ttlMs}ms`);
    }
  }

  /**
   * Остановить периодическую очистку
   */
  function stopCleanup() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
      log.info(`[UPDATE CLEANUP] Stopped`);
    }
  }

  /**
   * Получить статистику кэша
   */
  function getStats() {
    return {
      size: cache.size,
      maxSize: cache.max,
      stats: cache.stats,
    };
  }

  return {
    isProcessed,
    markProcessed,
    cleanup,
    startCleanup,
    stopCleanup,
    getStats,
  };
}
