/**
 * Сценарий для Web-чата: тексты + TG-кнопки + метаданные
 */

import { texts } from "./common/texts.js";
import { stepMeta } from "./common/step_meta.js";
import { telegramButtons } from "./telegram/buttons.js";
import { getLinks } from "./common/get_links.js";

// === WEB СПЕЦИФИЧНЫЕ ТЕКСТЫ (переопределяют общие) ===
const webTextOverrides = {
  // === MY_AI_BOT ===
  MY_AI_BOT: (links, user, info) => {
    const trafficLink = user.sh_ref_tail 
      ? `https://neuro-gen.ru/?page=${user.sh_ref_tail}`
      : "⚠️ Ссылка не сформирована (Не настроен ID)";

    const warningMsg = !user.sh_ref_tail 
      ? `\n\n⚠️ <b>ВНИМАНИЕ:</b> Ты не указал свой SetHubble ID. Promo-Kit заблокирован. Заверши настройку!` 
      : "";

    return (
      `🤖 <b>ТВОЙ ИИ-ПОМОЩНИК УЖЕ В СТРОЮ!</b>\n\n` +
      `✅ <b>Статус:</b> Активен (Веб-чат на сайте)\n` +
      `🚀 <b>ТВОЯ ССЫЛКА (РАЗДАВАЙ ВЕЗДЕ):</b>\n<code>${trafficLink}</code>\n\n` +
      `<i>Именно эту ссылку давай клиентам и вставляй в QR-коды. Она ведёт на лендинг и захватывает контакты.</i>` +
      warningMsg
    );
  },

  // === SYSTEM_SETUP ===
  SYSTEM_SETUP: (links, user, info) => {
    const shUserId = user.sh_user_id || "не указан";
    const shRefTail = user.sh_ref_tail || "не указан";

    return (
      `⚙️ <b>НАСТРОЙКА СИСТЕМЫ</b>\n\n` +
      `✅ <b>Твоя система полностью настроена и работает!</b>\n\n` +
      `<b>ТЕКУЩАЯ КОНФИГУРАЦИЯ:</b>\n` +
      `🌐 Платформа: Веб-чат (Сайт)\n` +
      `🆔 SetHubble ID: <code>${shUserId}</code>\n` +
      `🔗 Реф. хвост: <code>${shRefTail}</code>\n\n` +
      `Система автоматически вшивает твои реферальные данные во все воронки и кнопки.`
    );
  },

  // === Token_Success ===
  Token_Success: (links, user, info) => {
    const botName = info?.bot_username || "твой_бот";
    return (
      `🟢 <b>СИСТЕМА АКТИВИРОВАНА! Твой ИИ-Клон запущен.</b>\n\n` +
      `🔗 <b>Прямая ссылка на твоего Telegram-бота:</b> https://t.me/${botName}\n\n` +
      `<b>Что с этим делать прямо сейчас? Твои 3 шага к первым деньгам:</b>\n\n` +
      `<b>Шаг 1: База (Займет 1 минуту)</b>\n` +
      `Скопируй ссылку на своего бота и поставь её в описание профиля (Bio) во всех своих соцсетях с призывом: <i>"Забрал себе ИИ-систему, которая строит бизнес. Заходи, покажу как работает 👇"</i>.\n\n` +
      `<b>Шаг 2: Онлайн-штурм (Бесплатный трафик)</b>\n` +
      `За подключение бота ты только что разблокировал <b>Инструмент №1 (Магнит Трафика)</b>. Внутри лежит технология создания вирусных видео. Сделай пару роликов, и алгоритмы сами начнут наливать тебе людей в бота.\n\n` +
      `<b>Шаг 3: Офлайн-экспансия</b>\n` +
      `Возвращайся в меню настройки и открывай <b>Модуль 3</b>. Там лежит готовый скрипт, как распечатать QR-код твоего нового бота и поставить его в любую кофейню города, чтобы получать процент с их продаж.`
    );
  }
};

// === WEB СПЕЦИФИЧНЫЕ КНОПКИ (переопределяют telegramButtons — убираем TG/VK-специфику) ===
const webButtonOverrides = {
  // SYSTEM_SETUP — без кнопки настройки бота (SETUP_BOT_START — тупик для web)
  SYSTEM_SETUP: (links, user) => {
    const r = [];
    r.push([{ text: "📚 ПОВТОРИТЬ ОБУЧЕНИЕ", callback_data: "Training_Main" }]);
    r.push([{ text: "🔄 ОБНОВИТЬ ДАННЫЕ SETHUBBLE", callback_data: "CLICK_REG_ID" }]);
    r.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback_data: "MAIN_MENU" }]);
    return r;
  },

  // MY_AI_BOT — без кнопок подключения личного бота
  MY_AI_BOT: (links, user) => {
    const r = [];
    if (user.sh_ref_tail) {
      const refLink = `https://neuro-gen.ru/?page=${user.sh_ref_tail}`;
      r.push([{ text: "📢 ПРИГЛАСИТЬ ДРУГА (+БОНУСЫ)", url: refLink }]);
    } else {
      r.push([{ text: "⚠️ НАСТРОИТЬ SETHUBBLE ID", callback_data: "CLICK_REG_ID" }]);
    }
    r.push([{ text: "💰 МОИ ВЫПЛАТЫ", callback_data: "PARTNER_STATS" }]);
    r.push([{ text: "🏠 НАЗАД", callback_data: "MAIN_MENU" }]);
    return r;
  },

  // Token_Success — без кросс-селла в VK
  Token_Success: [
    [{ text: "📦 ОТКРЫТЬ ИНВЕНТАРЬ", callback_data: "CHESTS_INVENTORY" }],
    [{ text: "⚙️ ПРОДОЛЖИТЬ НАСТРОЙКУ (МОДУЛЬ 3)", callback_data: "Module_3_Offline" }],
  ],
};

function buildSteps() {
  const steps = {};
  for (const key of Object.keys(texts)) {
    steps[key] = {
      text: webTextOverrides[key] || texts[key],
      buttons: webButtonOverrides[key] !== undefined ? webButtonOverrides[key] : telegramButtons[key] || null,
      image: stepMeta[key]?.image || null,
      tag: stepMeta[key]?.tag || null,
    };
  }
  return steps;
}

export default {
  getLinks,
  steps: buildSteps(),
};
