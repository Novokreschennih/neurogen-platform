/**
 * Общие константы для всех платформ (Telegram, VK, и др.)
 */

export const PRODUCT_ID_FREE = process.env.PRODUCT_ID_FREE || "140_9d5d2";
export const PRODUCT_ID_PRO = process.env.PRODUCT_ID_PRO || "103_97999";
export const PRODUCT_ID_PRO_40 = process.env.PRODUCT_ID_PRO_40 || PRODUCT_ID_PRO;

export const TRIPWIRE_PRICE = process.env.TRIPWIRE_PRICE || "20"; // Цена со скидкой
export const TRIPWIRE_BASE_PRICE = process.env.TRIPWIRE_BASE_PRICE || "40"; // Базовая цена

export const STORAGE_BUCKET_URL =
  process.env.STORAGE_BUCKET_URL ||
  "https://storage.yandexcloud.net/sethubble-assets";

export const ACADEMY_BASE_URL =
  process.env.ACADEMY_BASE_URL || "https://sethubble.ru/academy";

export const PAYMENT_DOMAIN = process.env.PAYMENT_DOMAIN || "hubblepay.net";

export const SUPPORT_CHAT_URL =
  process.env.SUPPORT_CHAT_URL || "https://t.me/sethubble_support";

export const NEUROGEN_VIRAL_VIDEO_URL =
  process.env.NEUROGEN_VIRAL_VIDEO_URL ||
  "https://neurogen-viral-video.vercel.app";

export const NEUROGEN_BOT_SCENARIOS_URL =
  process.env.NEUROGEN_BOT_SCENARIOS_URL ||
  "https://telegram-bot-script-factory.vercel.app";

export const NEUROGEN_MASTER_ARCHITECT_URL =
  process.env.NEUROGEN_MASTER_ARCHITECT_URL ||
  "https://funnel-ai-rho.vercel.app";

export const ROCKET_PRICE = process.env.ROCKET_PRICE || "85";
export const SHUTTLE_PRICE = process.env.SHUTTLE_PRICE || "350";

export const PROMO_KIT_URL =
  process.env.PROMO_KIT_URL ||
  "https://novokreschennih.github.io/neurogen-promo-kit/";

export const CRM_DEMO_URL =
  process.env.CRM_DEMO_URL ||
  "https://novokreschennih.github.io/crm-dashboard/crm_demo.html";

/**
 * Прогресс-бар в стиле [████████░░] 80%
 */
export function getProgressBar(percent) {
  const total = 10;
  const filled = Math.round((percent / 100) * total);
  const bar = "█".repeat(filled) + "░".repeat(total - filled);
  return `[${bar}] <b>${percent}%</b>`;
}
