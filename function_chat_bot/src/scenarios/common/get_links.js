/**
 * Генерация реферальных ссылок (общая для всех платформ)
 */

import {
  PRODUCT_ID_FREE,
  PRODUCT_ID_PRO,
  PRODUCT_ID_PRO_40,
  PAYMENT_DOMAIN,
  SUPPORT_CHAT_URL,
} from "./constants.js";
import { buildStartPayload } from "./deeplink.js";

/**
 * Сгенерировать набор ссылок для кнопок воронки
 *
 * @param {string} sh_ref_tail - Партнёрский хвост (p_xxx)
 * @param {string} custom_pay_link - Кастомная ссылка на оплату (для владельцев ботов)
 * @param {string} sh_user_id - SetHubble user ID пригласителя
 * @param {boolean} boughtTripwire - Купил ли tripwire (PRO-статус)
 * @param {object} user - Объект пользователя (для омниканальных ссылок)
 * @returns {object} Набор готовых ссылок
 */
export function getLinks(
  sh_ref_tail,
  custom_pay_link,
  sh_user_id,
  boughtTripwire = false,
  user = null,
) {
  const productId = boughtTripwire ? PRODUCT_ID_PRO : PRODUCT_ID_FREE;
  const regUrl = `https://sethubble.com/ru/${sh_ref_tail}`;
  const resellerUrl = sh_user_id
    ? `https://sethubble.com/ru/?s=${productId}&afid=${sh_user_id}`
    : `https://sethubble.com/ru/?s=${productId}`;

  const partnerId = sh_user_id || process.env.MY_SH_USER_ID || "1123";

  const startPayload = user ? buildStartPayload(user) : sh_ref_tail;

  const vkGroupId = process.env.VK_CENTRAL_GROUP || "";
  const vkBotLink = sh_ref_tail
    ? `https://vk.me/club${vkGroupId}?ref=${startPayload}`
    : `https://vk.me/club${vkGroupId}`;

  const joinUrl = `https://sethubble.ru/join/?page=${sh_ref_tail || startPayload}`;

  return {
    reg: regUrl,
    reg_free: `https://sethubble.com/ru/?s=${PRODUCT_ID_FREE}&afid=${partnerId}`,
    pay_20:
      custom_pay_link ||
      `https://${PAYMENT_DOMAIN}/${PRODUCT_ID_PRO}&afid=${partnerId}`,
    pay_40: `https://${PAYMENT_DOMAIN}/${PRODUCT_ID_PRO_40}&afid=${partnerId}`,
    pay:
      custom_pay_link ||
      `https://${PAYMENT_DOMAIN}/${PRODUCT_ID_PRO}&afid=${partnerId}`,
    reseller: resellerUrl,
    rocket: regUrl,
    support: SUPPORT_CHAT_URL,
    pro_disk:
      process.env.DISK_LINK || "https://disk.yandex.ru/d/auId7HugR0sdzA",
    free_disk:
      process.env.FREE_DISK_LINK || "https://disk.yandex.ru/d/a2Gsuwnu32eJKg",
    vk_bot: vkBotLink,
    start_payload: startPayload,
    join: joinUrl,
  };
}
