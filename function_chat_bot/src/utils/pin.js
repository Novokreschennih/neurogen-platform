/**
 * Генерация PIN-кодов
 */

/**
 * Сгенерировать числовой PIN-код заданной длины
 *
 * @param {number} length - Длина PIN-кода (default: 4)
 * @returns {string} PIN-код из цифр
 */
export function generatePin(length = 4) {
  const chars = "0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
