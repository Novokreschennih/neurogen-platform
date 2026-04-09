/**
 * JWT утилиты для генерации и валидации токенов
 */

import jwt from "jsonwebtoken";
import { log } from "./logger.js";

/**
 * Получить JWT_SECRET из environment с валидацией
 * В production фолбэк на BOT_TOKEN запрещён — это критическая уязвимость
 *
 * @returns {string} JWT secret
 * @throws {Error} В production при отсутствии JWT_SECRET
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      log.warn("[SECURITY] JWT_SECRET not set, using development fallback");
      log.warn("[SECURITY] Please set JWT_SECRET environment variable!");
      // В development допускаем заглушку
      return process.env.BOT_TOKEN || "dev-secret";
    } else {
      throw new Error(
        "[SECURITY] JWT_SECRET is not set! " +
          "This is a critical security requirement. " +
          "Please set JWT_SECRET environment variable to a random secure value (e.g., openssl rand -hex 32). " +
          "Falling back to BOT_TOKEN is prohibited in production.",
      );
    }
  }

  return secret;
}

/**
 * Сгенерировать JWT токен
 *
 * @param {Object} payload - Данные для кодирования
 * @param {Object} options - Дополнительные опции (expiresIn и т.д.)
 * @returns {string} Подписанный JWT токен
 */
export function generateToken(payload, options = {}) {
  const secret = getJwtSecret();
  const { expiresIn = "24h", ...restOptions } = options;

  return jwt.sign(payload, secret, { expiresIn, ...restOptions });
}

/**
 * Валидировать JWT токен
 *
 * @param {string} token - JWT токен для проверки
 * @returns {Object|null} Payload токена или null при ошибке
 */
export function verifyToken(token) {
  if (!token) return null;

  try {
    const secret = getJwtSecret();
    return jwt.verify(token, secret);
  } catch (error) {
    log.warn("[JWT] Token verification failed", { error: error.message });
    return null;
  }
}

/**
 * Безопасно декодировать JWT токен без валидации
 * Используется только для извлечения данных (не для авторизации!)
 *
 * @param {string} token - JWT токен
 * @returns {Object|null} Payload или null
 */
export function decodeToken(token) {
  if (!token) return null;

  try {
    return jwt.decode(token);
  } catch (error) {
    log.warn("[JWT] Token decode failed", { error: error.message });
    return null;
  }
}
