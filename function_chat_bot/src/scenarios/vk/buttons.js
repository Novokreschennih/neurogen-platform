/**
 * Кнопки для VK
 * Сгенерировано автоматически: scripts/convert_scenario.js
 *
 * VK API формат отличается:
 * - callback_data → callback (здесь уже заменено)
 * - url → open_link (конвертируется в vk_handler.js при отправке)
 * - web_app → open_app (конвертируется в vk_handler.js при отправке)
 */

import {
  PROMO_KIT_URL,
  CRM_DEMO_URL,
  TRIPWIRE_PRICE,
  ACADEMY_BASE_URL,
  STORAGE_BUCKET_URL,
} from "../common/constants.js";

/**
 * Кнопки VK для каждого шага воронки
 * Формат кнопок тот же, что и в Telegram, но callback_data → callback
 */
export const vkButtons = {
  // === START ===
  START: [[{ text: "ДА, ПОКАЖИ МНЕ ЭТО!", callback: "Start_Choice" }]],

  // === Start_Choice ===
  Start_Choice: [
    [
      {
        text: "💻 Я В ОНЛАЙНЕ (БЛОГЕР, ИНФОБИЗ)",
        callback: "Business_Online_Pain",
      },
    ],
    [
      {
        text: "🏢 МОЙ БИЗНЕС (ОФЛАЙН)",
        callback: "Business_Offline_Pain",
      },
    ],
    [
      {
        text: "🚀 Я АГЕНТ (ХОЧУ ЗАРАБОТАТЬ С НУЛЯ)",
        callback: "Agent_1_Pain",
      },
    ],
    [{ text: "❓ ЭТО ПИРАМИДА / СКАМ?", callback: "AntiMLM" }],
  ],

  // === AntiMLM ===
  AntiMLM: [
    [{ text: "🚀 ПОНЯТНО, Я АГЕНТ", callback: "Agent_1_Pain" }],
    [{ text: "🏢 Я БИЗНЕСМЕН", callback: "Business_Offline_Pain" }],
  ],

  // === Agent_1_Pain ===
  Agent_1_Pain: [
    [
      {
        text: "🏙 ОФЛАЙН (МАГАЗИНЫ, СТО, КАФЕ)",
        callback: "Agent_2_Offline",
      },
    ],
    [
      {
        text: "🤳 ОНЛАЙН (БЛОГЕРЫ, КУРСЫ)",
        callback: "Agent_2_Online",
      },
    ],
  ],

  // === Agent_2_Offline ===
  Agent_2_Offline: [
    [
      {
        text: "📊 ГДЕ ДЕНЬГИ? КЕЙС АНТОНА",
        callback: "Agent_3_Case_Anton",
      },
    ],
    [{ text: "🔙 НАЗАД К ВЫБОРУ", callback: "Agent_1_Pain" }],
  ],

  // === Agent_3_Case_Anton ===
  Agent_3_Case_Anton: [
    [
      {
        text: "💰 ХОЧУ ТАКУЮ ЖЕ СИСТЕМУ",
        callback: "Pre_Training_Logic",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Agent_2_Offline" }],
  ],

  // === Agent_2_Online ===
  Agent_2_Online: [
    [{ text: "💸 ПОКАЖИ МАТЕМАТИКУ", callback: "Agent_Math" }],
    [{ text: "🔙 НАЗАД К ВЫБОРУ", callback: "Agent_1_Pain" }],
  ],

  // === Agent_Math ===
  Agent_Math: [
    [
      {
        text: "🚀 ДА, ДАЙТЕ МНЕ ИНСТРУМЕНТЫ!",
        callback: "Pre_Training_Logic",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Agent_2_Online" }],
  ],

  // === Business_Offline_Pain ===
  Business_Offline_Pain: [
    [
      {
        text: "КАК ЭТО ВОЗМОЖНО? ПОКАЖИ!",
        callback: "Business_Offline_Solution",
      },
    ],
    [{ text: "🔙 НАЗАД К ВЫБОРУ РОЛИ", callback: "Start_Choice" }],
  ],

  // === Business_Offline_Solution ===
  Business_Offline_Solution: [
    [
      {
        text: "📊 ПОКАЖИ КЕЙС САЛОНА КРАСОТЫ",
        callback: "Business_Offline_Case",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Business_Offline_Pain" }],
  ],

  // === Business_Offline_Case ===
  Business_Offline_Case: [
    [
      {
        text: "🪂 ХОЧУ ТАКУЮ ЖЕ КЛИЕНТСКУЮ БАЗУ",
        callback: "Business_Offline_Parachute",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Business_Offline_Solution" }],
  ],

  // === Business_Offline_Parachute ===
  Business_Offline_Parachute: [
    [
      {
        text: "🚀 ДА, ДАЙТЕ МНЕ ИНСТРУМЕНТЫ!",
        callback: "Pre_Training_Logic",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Business_Offline_Case" }],
  ],

  // === Business_Online_Pain ===
  Business_Online_Pain: [
    [
      {
        text: "ДА, ЧТО ВЫ ПРЕДЛАГАЕТЕ?",
        callback: "Business_Online_Solution",
      },
    ],
    [{ text: "🔙 НАЗАД К ВЫБОРУ РОЛИ", callback: "Start_Choice" }],
  ],

  // === Business_Online_Solution ===
  Business_Online_Solution: [
    [
      {
        text: "📊 ПОКАЖИ КЕЙС БЛОГЕРА МАКСА",
        callback: "Business_Online_Case",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Business_Online_Pain" }],
  ],

  // === Business_Online_Case ===
  Business_Online_Case: [
    [
      {
        text: "💎 ПОКАЖИ, КАК ЭТО РАБОТАЕТ",
        callback: "Pre_Training_Logic",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Business_Online_Solution" }],
  ],

  // === REGISTRATION_EXIST ===
  REGISTRATION_EXIST: [
    [{ text: "✅ ИСПОЛЬЗОВАТЬ ТЕКУЩИЙ", callback: "Training_Main" }],
    [{ text: "✏️ ВВЕСТИ НОВЫЙ ID", callback: "FORCE_REG_UPDATE" }],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Pre_Training_Logic ===
  Pre_Training_Logic: (links) => [
    [{ text: "🔗 ЗАРЕГИСТРИРОВАТЬСЯ", url: links.reg }],
    [{ text: "✅ Я ЗАРЕГИСТРИРОВАН", callback: "CLICK_REG_ID" }],
  ],

  // === Theory_Mod1 ===
  Theory_Mod1: [
    [{ text: "➡️ ЭТАП 2: ТЕНЕВОЙ ПАРТНЕР", callback: "Theory_Mod2" }],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Theory_Mod2 ===
  Theory_Mod2: [
    [{ text: "➡️ УРОК 3: ОНЛАЙН-БИЗНЕС", callback: "Theory_Mod3" }],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Theory_Mod3 ===
  Theory_Mod3: [
    [{ text: "➡️ УРОК 4: ОФЛАЙН-БИЗНЕС", callback: "Theory_Mod4" }],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Theory_Mod4 ===
  Theory_Mod4: [
    [
      {
        text: "➡️ УРОК 5: ФИНАНСЫ И СТРУКТУРА",
        callback: "Theory_Mod5",
      },
    ],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Theory_Mod5 ===
  Theory_Mod5: [
    [
      {
        text: "🚀 ЗАВЕРШИТЬ ТЕОРИЮ (+10 🪙)",
        callback: "THEORY_COURSE_COMPLETE",
      },
    ],
  ],

  // === Theory_Reward_Spoilers ===
  Theory_Reward_Spoilers: (links, user) => [
    [
      {
        text: "🔥 НАЧАТЬ НАСТРОЙКУ (МОДУЛЬ 1)",
        callback: "Module_1_Strategy",
      },
    ],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Training_Main ===
  Training_Main: (links, user) => {
    const r = [];
    r.push([{ text: "📖 ВВОДНАЯ БАЗА (10%)", callback: "Theory_Mod1" }]);
    r.push([{ text: "🔥 ПРАКТИКА (90%)", callback: "Module_1_Strategy" }]);

    if (user.session?.mod3_done || user.bought_tripwire) {
      r.push([{ text: "📥 БАЗА ЗНАНИЙ B2B (PDF)", url: links.free_disk }]);
    } else {
      r.push([
        {
          text: "🔒 БАЗА ЗНАНИЙ (После Модуля 3)",
          callback: "LOCKED_B2B_INFO",
        },
      ]);
    }

    r.push([{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]);
    return r;
  },

  // === Module_1_Strategy ===
  Module_1_Strategy: (links, user, info) => {
    const botName = info?.bot_username || "sethubble_biz_bot";
    const isCompleted = user.session?.mod1_done;
    return [
      [
        {
          text: `📖 ЧИТАТЬ СТАТЬЮ ${isCompleted ? "✅" : ""}`,
          url: `${ACADEMY_BASE_URL}/module-1/?bot=${botName}`,
        },
      ],
      isCompleted
        ? [
            {
              text: "➡️ ПЕРЕЙТИ К МОДУЛЮ 2",
              callback: "GO_TO_MODULE_2",
            },
          ]
        : [
            {
              text: "🔑 ВВЕСТИ СЕКРЕТНОЕ СЛОВО (+20 🪙)",
              callback: "ENTER_SECRET_1",
            },
          ],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === Module_2_Online ===
  Module_2_Online: (links, user, info) => {
    const botName = info?.bot_username || "sethubble_biz_bot";
    const isCompleted = user.session?.mod2_done;

    if (isCompleted) {
      return [
        [
          {
            text: "📘 ЧИТАТЬ УРОК 2 ✅",
            url: `${ACADEMY_BASE_URL}/module-2/?bot=${botName}`,
          },
        ],
        [
          {
            text: "➡️ ПОЛУЧИТЬ ИНСТРУМЕНТЫ",
            callback: "Module_2_Reward_PromoKit",
          },
        ],
        [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
      ];
    } else {
      return [
        [
          {
            text: "📖 ОТКРЫТЬ УРОК 2",
            url: `${ACADEMY_BASE_URL}/module-2/?bot=${botName}`,
          },
        ],
        [
          {
            text: "🔑 ВВЕСТИ СЕКРЕТНОЕ СЛОВО",
            callback: "ENTER_SECRET_2",
          },
        ],
        [
          {
            text: "🔙 НАЗАД (К Стратегии)",
            callback: "Module_1_Strategy",
          },
        ],
      ];
    }
  },

  // === Module_2_Reward_PromoKit ===
  Module_2_Reward_PromoKit: (links, user) => {
    const botName = user.session?.bot_username || "sethubble_biz_bot";
    const apiGw =
      process.env.API_GW_HOST ||
      "d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net";

    // === ИСПРАВЛЕНИЕ v4.3.6: Добавляем параметр mod3=1 для прошедших Модуль 3 ===
    const mod3Done = user.session?.mod3_done;
    const isPro = user.bought_tripwire;
    const mod3Param = mod3Done || isPro ? "&mod3=1" : "";

    return [
      [
        {
          text: "📲 ОТКРЫТЬ PROMO-KIT",
          web_app: {
            url: `${PROMO_KIT_URL}?bot=${botName}&api=https://${apiGw}${mod3Param}`,
          },
        },
      ],
      [
        {
          text: "➡️ Я ИЗУЧИЛ, ВЕДИ НА МОДУЛЬ 3",
          callback: "Module_3_Offline",
        },
      ],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === Module_3_Offline ===
  Module_3_Offline: (links, user, info) => {
    const botName = info?.bot_username || "sethubble_biz_bot";
    const isCompleted = user.session?.mod3_done;

    if (isCompleted) {
      return [
        [
          {
            text: "📖 ЧИТАТЬ СТАТЬЮ ✅",
            url: `${ACADEMY_BASE_URL}/module-3/?bot=${botName}`,
          },
        ],
        [
          {
            text: "➡️ К ФИНАЛЬНОМУ ОФФЕРУ",
            callback: "Lesson_Final_Comparison",
          },
        ],
        [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
      ];
    } else {
      return [
        [
          {
            text: "📖 ОТКРЫТЬ УРОК 3",
            url: `${ACADEMY_BASE_URL}/module-3/?bot=${botName}`,
          },
        ],
        [
          {
            text: "🔑 ВВЕСТИ СЕКРЕТНОЕ СЛОВО",
            callback: "ENTER_SECRET_3",
          },
        ],
        [
          {
            text: "🔙 НАЗАД (К Promo-Kit)",
            callback: "Module_2_Reward_PromoKit",
          },
        ],
      ];
    }
  },

  // === LOCKED_B2B_INFO ===
  LOCKED_B2B_INFO: [
    [{ text: "⚙️ ПРОДОЛЖИТЬ НАСТРОЙКУ", callback: "Training_Main" }],
    [{ text: "🔙 НАЗАД", callback: "MAIN_MENU" }],
  ],

  // === Lesson_Final_Comparison ===
  Lesson_Final_Comparison: (links, user) => {
    const xp = user.session?.xp || 0;

    if (xp >= 100) {
      return [
        [
          {
            text: "🎟 ОБМЕНЯТЬ 100 🪙 НА PRO (-50%)",
            callback: "Offer_Tripwire",
          },
        ],
        [
          {
            text: "🏠 В МЕНЮ (Остаться на FREE 31%)",
            callback: "MAIN_MENU",
          },
        ],
      ];
    } else {
      return [
        [
          {
            text: "💎 АКТИВИРОВАТЬ PRO ($40)",
            callback: "Offer_Tripwire",
          },
        ],
        [
          {
            text: "🏠 В МЕНЮ (Остаться на FREE 31%)",
            callback: "MAIN_MENU",
          },
        ],
      ];
    }
  },

  // === Offer_Tripwire ===
  Offer_Tripwire: (links, user) => {
    const xp = user.session?.xp || 0;
    const price = xp >= 100 ? TRIPWIRE_PRICE : TRIPWIRE_BASE_PRICE;
    const payLink = xp >= 100 ? links.pay_20 : links.pay_40;
    return [
      [{ text: `💎 АКТИВИРОВАТЬ PRO ЗА $${price}`, url: payLink }],
      [{ text: "❓ У меня остались вопросы", callback: "FAQ_PRO" }],
    ];
  },

  // === FAQ_PRO ===
  FAQ_PRO: (links, user) => {
    const xp = user.session?.xp || 0;
    const price = xp >= 100 ? TRIPWIRE_PRICE : TRIPWIRE_BASE_PRICE;
    const payLink = xp >= 100 ? links.pay_20 : links.pay_40;
    return [
      [{ text: `💎 АКТИВИРОВАТЬ PRO ЗА $${price}`, url: payLink }],
      [{ text: "🔙 Назад к офферу", callback: "Offer_Tripwire" }],
    ];
  },

  // === Tripwire_Features ===
  Tripwire_Features: [
    [{ text: "💰 СКОЛЬКО ЭТО СТОИТ?", callback: "Tripwire_Math" }],
  ],

  // === Tripwire_Math ===
  Tripwire_Math: (links) => [
    [
      {
        text: `🚀 ЗАБРАТЬ ПАКЕТ NEUROGEN ($${TRIPWIRE_PRICE})`,
        url: links.pay,
      },
    ],
    [{ text: "➡️ ДАЛЕЕ (ПЛАНЫ И БИНАР)", callback: "Rocket_Limits" }],
    [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === SYSTEM_SETUP ===
  SYSTEM_SETUP: (links, user) => {
    const r = [];
    const hasBot = !!user.bot_token;

    // Кнопка «Повторить обучение» (всегда доступна для зарегистрированных)
    r.push([{ text: "📚 ПОВТОРИТЬ ОБУЧЕНИЕ", callback: "Training_Main" }]);

    if (!hasBot) {
      // Если бота нет — предлагаем настроить
      r.push([
        {
          text: "🚀 НАСТРОИТЬ БОТА СЕЙЧАС",
          callback: "SETUP_BOT_START",
        },
      ]);
    }

    // Кнопка смены данных SetHubble (всегда доступна)
    r.push([
      {
        text: "🔄 ОБНОВИТЬ ДАННЫЕ SETHUBBLE",
        callback: "CLICK_REG_ID",
      },
    ]);

    // Кнопка возврата в меню
    r.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]);

    return r;
  },

  // === MULTI_CHANNEL_SELECT: Выбор дополнительных каналов (v6.0 — показываем только не-настроенные) ===
  MULTI_CHANNEL_SELECT: (links, user) => {
    const channels = user.session?.channels || {};
    const r = [];
    let anyAvailable = false;

    // Telegram (v6.0: может быть уже настроен из tg_id)
    const tgConfigured = channels.telegram?.configured;
    if (!tgConfigured) {
      r.push([
        {
          text: "📱 ПОДКЛЮЧИТЬ TELEGRAM",
          callback: "MULTI_CHANNEL_TG",
        },
      ]);
      anyAvailable = true;
    }

    // VK
    const vkConfigured = channels.vk?.configured;
    if (!vkConfigured) {
      r.push([
        {
          text: "💬 ПОДКЛЮЧИТЬ VK",
          callback: "CHANNEL_SETUP_VK",
        },
      ]);
      anyAvailable = true;
    }

    // Web (v6.0: обычно уже настроен автоматически из web_id)
    const webConfigured = channels.web?.configured;
    if (!webConfigured) {
      r.push([
        {
          text: "🌐 ЧАТ НА САЙТЕ",
          callback: "CHANNEL_SETUP_WEB",
        },
      ]);
      anyAvailable = true;
    }

    // Email (v6.0: обычно уже настроен автоматически из email)
    const emailConfigured = channels.email?.configured;
    if (!emailConfigured) {
      r.push([
        {
          text: "📧 EMAIL-РАССЫЛКА",
          callback: "CHANNEL_SETUP_EMAIL",
        },
      ]);
      anyAvailable = true;
    }

    // Если все каналы уже настроены — показываем сообщение
    if (!anyAvailable) {
      r.push([{ text: "✅ ВСЕ КАНАЛЫ ПОДКЛЮЧЕНЫ", callback: "CHANNEL_SKIPPED" }]);
    } else {
      r.push([{ text: "⏭ ПРОПУСТИТЬ", callback: "CHANNEL_SKIPPED" }]);
    }

    return r;
  },

  // === CHANNEL_SETUP_VK ===
  CHANNEL_SETUP_VK: (links, user) => {
    const r = [];
    r.push([{ text: "❓ КАК НАЙТИ ID СООБЩЕСТВА?", callback: "VK_HELP" }]);
    r.push([{ text: "⏭ НАЗАД", callback: "MULTI_CHANNEL_SELECT" }]);
    return r;
  },

  // === MULTI_CHANNEL_TG (для VK users, которые хотят подключить TG) ===
  MULTI_CHANNEL_TG: (links, user) => {
    const r = [];
    r.push([{ text: "📱 НАСТРОИТЬ TELEGRAM", callback: "CHANNEL_SETUP_TG" }]);
    r.push([{ text: "⏭ НАЗАД", callback: "MULTI_CHANNEL_SELECT" }]);
    return r;
  },

  // === CHANNEL_SETUP_WEB ===
  CHANNEL_SETUP_WEB: (links, user) => {
    const r = [];
    r.push([
      { text: "⏭ НАЗАД К ВЫБОРУ КАНАЛОВ", callback: "MULTI_CHANNEL_SELECT" },
    ]);
    r.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]);
    return r;
  },

  // === CHANNEL_SETUP_EMAIL ===
  CHANNEL_SETUP_EMAIL: (links, user) => {
    const r = [];
    r.push([
      { text: "⏭ НАЗАД К ВЫБОРУ КАНАЛОВ", callback: "MULTI_CHANNEL_SELECT" },
    ]);
    return r;
  },

  // === CHANNEL_SETUP_COMPLETE ===
  CHANNEL_SETUP_COMPLETE: (links, user) => {
    const r = [];
    r.push([{ text: "🚀 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "Training_Main" }]);
    r.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]);
    return r;
  },

  // === CHANNEL_SKIPPED ===
  CHANNEL_SKIPPED: (links, user) => {
    const r = [];
    r.push([{ text: "🚀 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "Training_Main" }]);
    return r;
  },

  // === CHANNEL_SETUP_VK_SUCCESS ===
  CHANNEL_SETUP_VK_SUCCESS: (links, user) => {
    const r = [];
    r.push([
      { text: "🌐 ПОДКЛЮЧИТЬ ЕЩЁ КАНАЛЫ", callback: "MULTI_CHANNEL_SELECT" },
    ]);
    r.push([{ text: "🚀 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "Training_Main" }]);
    return r;
  },

  // === CHANNEL_SETUP_EMAIL_SUCCESS ===
  CHANNEL_SETUP_EMAIL_SUCCESS: (links, user) => {
    const r = [];
    r.push([
      { text: "🌐 ПОДКЛЮЧИТЬ ЕЩЁ КАНАЛЫ", callback: "MULTI_CHANNEL_SELECT" },
    ]);
    r.push([{ text: "🚀 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "Training_Main" }]);
    return r;
  },

  // === CHANNEL_SETUP_TG_SUCCESS: Telegram подключён (из VK) ===
  CHANNEL_SETUP_TG_SUCCESS: (links, user) => {
    const r = [];
    r.push([
      { text: "🌐 ПОДКЛЮЧИТЬ ЕЩЁ КАНАЛЫ", callback: "MULTI_CHANNEL_SELECT" },
    ]);
    r.push([{ text: "🚀 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "Training_Main" }]);
    return r;
  },

  // === TOOLS_MENU ===
  TOOLS_MENU: (links, user) => {
    const isPro = user.bought_tripwire;
    const hasMod3 = user.session?.mod3_done || isPro;

    const r = [];

    // 1. Твои клиенты (CRM)
    if (isPro) {
      const webAppUrl =
        process.env.CRM_WEB_APP_URL ||
        "https://novokreschennih.github.io/crm-dashboard/";
      r.push([
        {
          text: "👥 ТВОИ КЛИЕНТЫ",
          web_app: {
            url: `${webAppUrl}?bot_token=${user.bot_token || ""}`,
          },
        },
      ]);
    } else {
      r.push([{ text: "🔒 ТВОИ КЛИЕНТЫ", callback: "LOCKED_CRM" }]);
    }

    // 2. Промо-кит
    if (hasMod3) {
      r.push([{ text: "📦 ПРОМО-КИТ", callback: "PROMO_KIT" }]);
    } else {
      r.push([{ text: "🔒 ПРОМО-КИТ", callback: "LOCKED_PROMO" }]);
    }

    // 3. База знаний (Яндекс.Диск)
    if (hasMod3) {
      r.push([
        {
          text: "📥 БАЗА ЗНАНИЙ",
          url: links.free_disk || "https://disk.yandex.ru/d/...",
        },
      ]);
    } else {
      r.push([{ text: "🔒 БАЗА ЗНАНИЙ", callback: "LOCKED_KNOWLEDGE" }]);
    }

    // 4. ИИ-приложения (только PRO)
    if (isPro) {
      r.push([{ text: "🤖 NEUROGEN APPS", callback: "apps_menu" }]);
    } else {
      r.push([{ text: "🔒 NEUROGEN APPS", callback: "LOCKED_AI_APPS" }]);
    }

    // 5. Назад
    r.push([{ text: "🔙 НАЗАД", callback: "MAIN_MENU" }]);

    return r;
  },

  // === LOCKED_CRM ===
  LOCKED_CRM: [
    [{ text: "💎 ХОЧУ PRO-СТАТУС", callback: "Offer_Tripwire" }],
    [{ text: "🔙 К ИНСТРУМЕНТАМ", callback: "TOOLS_MENU" }],
  ],

  // === LOCKED_PROMO ===
  LOCKED_PROMO: [
    [{ text: "🎓 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "RESUME_LAST" }],
    [{ text: "🔙 К ИНСТРУМЕНТАМ", callback: "TOOLS_MENU" }],
  ],

  // === LOCKED_KNOWLEDGE ===
  LOCKED_KNOWLEDGE: [
    [{ text: "🎓 ПРОДОЛЖИТЬ ОБУЧЕНИЕ", callback: "RESUME_LAST" }],
    [{ text: "🔙 К ИНСТРУМЕНТАМ", callback: "TOOLS_MENU" }],
  ],

  // === LOCKED_AI_APPS ===
  LOCKED_AI_APPS: [
    [{ text: "💎 ХОЧУ PRO-СТАТУС", callback: "Offer_Tripwire" }],
    [{ text: "🔙 К ИНСТРУМЕНТАМ", callback: "TOOLS_MENU" }],
  ],

  // === MY_AI_BOT ===
  MY_AI_BOT: (links, user) => {
    const r = [];
    r.push([{ text: "🔙 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]);
    return r;
  },

  // === Delivery_1 ===
  Delivery_1: (links) => [
    [
      {
        text: "🚀 СКОПИРОВАТЬ СИСТЕМУ (ОБЯЗАТЕЛЬНО)",
        callback: "SETUP_BOT_START",
      },
    ],
    [{ text: "📥 СКАЧАТЬ ИНСТРУМЕНТЫ NEUROGEN", url: links.pro_disk }],
    [
      {
        text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
        callback: "Training_Pro_Main",
      },
    ],
  ],

  // === Training_Pro_Main ===
  Training_Pro_Main: [
    [
      {
        text: "🟢 ЧАСТЬ 1: БЫСТРЫЙ ЗАПУСК",
        callback: "Training_Pro_P1_1",
      },
    ],
    [
      {
        text: "🟣 ЧАСТЬ 2: ИИ-МАСТЕРСТВО",
        callback: "Training_Pro_P2_1",
      },
    ],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Training_Pro_P1_1 ===
  Training_Pro_P1_1: [
    [{ text: "➡️ УРОК 2: ЛЕНДИНГ", callback: "Training_Pro_P1_2" }],
    [{ text: "🔙 НАЗАД К ВЫБОРУ", callback: "Training_Pro_Main" }],
  ],

  // === Training_Pro_P1_2 ===
  Training_Pro_P1_2: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 2",
          url: `${ACADEMY_BASE_URL}/pro-lesson-2-landing?token=${token}`,
        },
      ],
      [
        {
          text: "✅ Я СДЕЛАЛ САЙТ. ЧТО ДАЛЬШЕ?",
          callback: "Training_Pro_P1_3",
        },
      ],
      [{ text: "🔙 НАЗАД", callback: "Training_Pro_P1_1" }],
    ];
  },

  // === Training_Pro_P1_3 ===
  Training_Pro_P1_3: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 3",
          url: `${ACADEMY_BASE_URL}/pro-lesson-3-deploy?token=${token}`,
        },
      ],
      [
        {
          text: "✅ Я УПАКОВАЛ. ЧТО ДАЛЬШЕ?",
          callback: "Training_Pro_P1_4",
        },
      ],
      [{ text: "🔙 НАЗАД", callback: "Training_Pro_P1_2" }],
    ];
  },

  // === Training_Pro_P1_4 ===
  Training_Pro_P1_4: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 4",
          url: `${ACADEMY_BASE_URL}/pro-lesson-4-github?token=${token}`,
        },
      ],
      [
        {
          text: "✅ Я ОПУБЛИКОВАЛ. ЧТО ДАЛЬШЕ?",
          callback: "Training_Pro_P1_5",
        },
      ],
      [{ text: "🔙 НАЗАД", callback: "Training_Pro_P1_3" }],
    ];
  },

  // === Training_Pro_P1_5 ===
  Training_Pro_P1_5: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 5",
          url: `${ACADEMY_BASE_URL}/pro-lesson-5-yandex-ads?token=${token}`,
        },
      ],
      [
        {
          text: "🟣 ПЕРЕЙТИ К ЧАСТИ 2",
          callback: "Training_Pro_P2_1",
        },
      ],
      [{ text: "🏠 В МЕНЮ PRO", callback: "Training_Pro_Main" }],
    ];
  },

  // === Training_Pro_P2_1 ===
  Training_Pro_P2_1: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 6",
          url: `${ACADEMY_BASE_URL}/pro-lesson-6-strategy?token=${token}`,
        },
      ],
      [
        {
          text: "➡️ УРОК 7: СЦЕНАРИИ И n8n",
          callback: "Training_Pro_P2_2",
        },
      ],
      [{ text: "🔙 НАЗАД", callback: "Training_Pro_P1_5" }],
    ];
  },

  // === Training_Pro_P2_2 ===
  Training_Pro_P2_2: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 7",
          url: `${ACADEMY_BASE_URL}/pro-lesson-7-automation?token=${token}`,
        },
      ],
      [
        {
          text: "➡️ УРОК 8: ВИРАЛЬНЫЙ ТРАФИК",
          callback: "Training_Pro_P2_3",
        },
      ],
      [{ text: "🔙 НАЗАД", callback: "Training_Pro_P2_1" }],
    ];
  },

  // === Training_Pro_P2_3 ===
  Training_Pro_P2_3: (links, user) => {
    const token = jwt.sign({ uid: user.user_id, isPro: true }, JWT_SECRET, {
      expiresIn: "3h",
    });
    return [
      [
        {
          text: "🖥 СМОТРЕТЬ УРОК 8",
          url: `${ACADEMY_BASE_URL}/pro-lesson-8-viral-video?token=${token}`,
        },
      ],
      [
        {
          text: "➡️ УРОК 9: МАСШТАБ SETHUBBLE",
          callback: "Training_Pro_P2_4",
        },
      ],
      [{ text: "🔙 НАЗАД", callback: "Training_Pro_P2_2" }],
    ];
  },

  // === Training_Pro_P2_4 ===
  Training_Pro_P2_4: [
    [{ text: "🚀 В ЦЕНТР УПРАВЛЕНИЯ", callback: "MAIN_MENU" }],
  ],

  // === Training_Bot_Success ===
  Training_Bot_Success: [
    [
      {
        text: "🎁 ОТКРЫТЬ ИНВЕНТАРЬ (ЗАБРАТЬ PIN)",
        callback: "CHESTS_INVENTORY",
      },
    ],
    [{ text: "🏬 ПЕРЕЙТИ К МОДУЛЮ 3", callback: "Module_3_Offline" }],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === Token_Success ===
  Token_Success: [
    [{ text: "📦 ОТКРЫТЬ ИНВЕНТАРЬ", callback: "CHESTS_INVENTORY" }],
    [
      {
        text: "⚙️ ПРОДОЛЖИТЬ НАСТРОЙКУ (МОДУЛЬ 3)",
        callback: "Module_3_Offline",
      },
    ],
  ],

  // === Rocket_Limits ===
  Rocket_Limits: (links) => [
    [{ text: "🚀 ВЗЯТЬ РАКЕТУ (САЙТ SETHUBBLE)", url: links.rocket }],
    [
      {
        text: "🛸 УЗНАТЬ ПРО SHUTTLE (БЕЗЛИМИТ)",
        callback: "Shuttle_Offer",
      },
    ],
    [{ text: "🔙 НАЗАД", callback: "Lesson_Final_Comparison" }],
  ],

  // === Shuttle_Offer ===
  Shuttle_Offer: (links) => [
    [{ text: "🛸 ВЗЯТЬ SHUTTLE (САЙТ SETHUBBLE)", url: links.rocket }],
    [{ text: "✅ Я УЖЕ ОПЛАТИЛ ТАРИФ", callback: "CONFIRM_UPGRADE" }],
    [{ text: "🔙 НАЗАД К ROCKET", callback: "Rocket_Limits" }],
  ],

  // === UPGRADE_CONFIRMED ===
  UPGRADE_CONFIRMED: [[{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]],

  // === SUPPORT_ASK ===
  SUPPORT_ASK: [[{ text: "🔙 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]],

  // === FollowUp_Tripwire_1 ===
  FollowUp_Tripwire_1: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: `💰 КУПИТЬ PRO ЗА $${TRIPWIRE_PRICE}`, url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_2 ===
  FollowUp_Tripwire_2: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "🚀 ЗАБРАТЬ ИИ-ТРАФИК", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_3 ===
  FollowUp_Tripwire_3: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "💎 СТАТЬ АРХИТЕКТОРОМ", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_4 ===
  FollowUp_Tripwire_4: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "🎨 ЗАБРАТЬ STYLE TRANSFER", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_5 ===
  FollowUp_Tripwire_5: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "💰 ХОЧУ ПАССИВ", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_6 ===
  FollowUp_Tripwire_6: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "🚀 АКТИВИРОВАТЬ ИИ-БОТ", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_7 ===
  FollowUp_Tripwire_7: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "💎 ЗАБРАТЬ ИТ-ОТДЕЛ", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_8 ===
  FollowUp_Tripwire_8: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "📊 ПОЛУЧИТЬ CRM", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_9 ===
  FollowUp_Tripwire_9: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: "🚀 НАЧАТЬ С БАЗЫ", url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Tripwire_10 ===
  FollowUp_Tripwire_10: (links, user) => {
    if (user.bought_tripwire) {
      return [
        [
          {
            text: "🎓 ПЕРЕЙТИ К PRO-ОБУЧЕНИЮ",
            callback: "Training_Pro_Main",
          },
        ],
      ];
    }
    return [
      [{ text: `💰 ЗАБРАТЬ ВСЁ ЗА $${TRIPWIRE_PRICE}`, url: links.pay }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_1 ===
  FollowUp_Plan_1: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🛰 ВЗЯТЬ ROCKET", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_2 ===
  FollowUp_Plan_2: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🛸 ВЗЯТЬ SHUTTLE", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_3 ===
  FollowUp_Plan_3: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🚀 МОНЕТИЗИРОВАТЬ ТРАФИК", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_4 ===
  FollowUp_Plan_4: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "💎 ЗАБРАТЬ КОМПРЕССИЮ", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_5 ===
  FollowUp_Plan_5: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🚀 ДОЛЯ ОТ РЫНКА", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_6 ===
  FollowUp_Plan_6: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🛸 ЗАРАБАТЫВАТЬ НА КОНКУРЕНТАХ", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_7 ===
  FollowUp_Plan_7: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🚀 СТРОИТЬ ИМПЕРИЮ", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_8 ===
  FollowUp_Plan_8: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "⚡️ АВТОМАТИЗИРОВАТЬ ВЫПЛАТЫ", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_9 ===
  FollowUp_Plan_9: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "🚀 ВЫБРАТЬ ТАРИФ", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === FollowUp_Plan_10 ===
  FollowUp_Plan_10: (links, user) => {
    if (user.tariff === "PAID") {
      return [[{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }]];
    }
    return [
      [{ text: "💎 АКТИВИРОВАТЬ ТАРИФ", url: links.rocket }],
      [{ text: "🏠 В МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === REMINDER_1H ===
  REMINDER_1H: [
    [{ text: "▶️ ПРОДОЛЖИТЬ", callback: "REMINDER_1H_RESUME" }],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === REMINDER_3H ===
  REMINDER_3H: [
    [{ text: "▶️ ПРОДОЛЖИТЬ", callback: "REMINDER_3H_RESUME" }],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === REMINDER_24H ===
  REMINDER_24H: [
    [{ text: "▶️ ПРОДОЛЖИТЬ", callback: "REMINDER_24H_RESUME" }],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === REMINDER_48H ===
  REMINDER_48H: [
    [
      {
        text: "▶️ ХОЧУ ТАК ЖЕ (ПРОДОЛЖИТЬ)",
        callback: "REMINDER_48H_RESUME",
      },
    ],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === RESUME_GATE ===
  RESUME_GATE: (links, user) => [
    [{ text: "▶️ ПРОДОЛЖИТЬ ПУТЬ", callback: "RESUME_LAST" }],
    [{ text: "🏠 ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    [{ text: "🔄 НАЧАТЬ СНАЧАЛА", callback: "RESTART_FUNNEL" }],
  ],

  // === REMINDER_1H_RESUME ===
  REMINDER_1H_RESUME: (links, user) => {
    const lastState = user.state || "START";
    return [
      [{ text: "✅ ДА, ПРОДОЛЖИТЬ", callback: lastState }],
      [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === REMINDER_3H_RESUME ===
  REMINDER_3H_RESUME: (links, user) => {
    const lastState = user.state || "START";
    return [
      [{ text: "✅ ДА, ВПЕРЁД", callback: lastState }],
      [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === REMINDER_24H_RESUME ===
  REMINDER_24H_RESUME: (links, user) => {
    const lastState = user.state || "START";
    return [
      [{ text: "✅ ДА, ЗАБРАТЬ ДЕНЬГИ", callback: lastState }],
      [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === REMINDER_48H_RESUME ===
  REMINDER_48H_RESUME: (links, user) => {
    const lastState = user.state || "START";
    return [
      [{ text: "✅ ДА, ХОЧУ ДЕНЬГИ", callback: lastState }],
      [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === RESUME_LAST ===
  RESUME_LAST: (links, user) => {
    const lastState = user.state || "START";
    return [
      [{ text: "🔄 ВЕРНУТЬСЯ К ШАГУ", callback: lastState }],
      [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === MAIN_MENU ===
  MAIN_MENU: (links, user) => {
    const r = [];
    const hasData = !!user.sh_ref_tail;
    const isPro = user.bought_tripwire;
    const hasMod3 = user.session?.mod3_done || isPro;
    const seenPlans = user.session?.tags?.includes("seen_plans");

    // --- БЛОК 1: ТОЛЬКО ДЛЯ НОВИЧКОВ (У кого еще нет аккаунта) ---
    if (!hasData) {
      r.push([
        {
          text: "🚀 ПУТЬ АГЕНТА (Старт без вложений)",
          callback: "Agent_1_Pain",
        },
      ]);
      r.push([
        {
          text: "💻 ДЛЯ ОНЛАЙН-БИЗНЕСА",
          callback: "Business_Online_Pain",
        },
      ]);
      r.push([
        {
          text: "🏢 ДЛЯ ОФЛАЙН-БИЗНЕСА",
          callback: "Business_Offline_Pain",
        },
      ]);
      r.push([{ text: "📞 ПОДДЕРЖКА", callback: "SUPPORT_ASK" }]);
      return r;
    }

    // --- БЛОК 2: ЗАРЕГИСТРИРОВАНЫ (ID есть) ---
    // Верхняя кнопка меняется в зависимости от прогресса
    if (isPro) {
      // PRO — показываем PRO-инструменты
      r.push([{ text: "💎 PRO-ИНСТРУМЕНТЫ", callback: "Training_Pro_Main" }]);
      // Настройка системы (для PRO)
      const setupStep = user.bot_token ? "SYSTEM_SETUP" : "Training_Main";
      r.push([{ text: "⚙️ НАСТРОЙКА СИСТЕМЫ", callback: setupStep }]);
    } else if (hasMod3 || seenPlans) {
      // Прошёл 3 модуля или видел оффер — показываем Масштаб
      r.push([{ text: "💎 МАСШТАБ", callback: "Rocket_Limits" }]);
      // Настройка системы (после 3 модулей)
      const setupStep = user.bot_token ? "SYSTEM_SETUP" : "Training_Main";
      r.push([{ text: "⚙️ НАСТРОЙКА СИСТЕМЫ", callback: setupStep }]);
    } else {
      // В процессе — продолжаем обучение с того места где остановился
      // Проверяем, является ли saved_state шагом обучения
      const trainingSteps = [
        "Training_Main",
        "Theory_Mod1",
        "Module_1_Strategy",
        "Module_2_Online",
        "Module_3_Offline",
        "Lesson_Final_Comparison",
        "Offer_Tripwire",
      ];
      const resumeStep =
        user.saved_state && trainingSteps.includes(user.saved_state)
          ? user.saved_state
          : "Training_Main";
      r.push([{ text: "🎓 ПРОДОЛЖИТЬ НАСТРОЙКУ", callback: resumeStep }]);
    }

    // Инструменты (всегда для зарегистрированных)
    r.push([{ text: "🎒 ИНСТРУМЕНТЫ", callback: "TOOLS_MENU" }]);

    // Профиль (всегда для зарегистрированных)
    r.push([{ text: "👤 ПРОФИЛЬ", callback: "EDIT_PROFILE" }]);

    // Поддержка (всегда внизу)
    r.push([{ text: "📞 ПОДДЕРЖКА", callback: "SUPPORT_ASK" }]);

    return r;
  },

  // === LOCKED_TRAINING_INFO ===
  LOCKED_TRAINING_INFO: (links) => [
    [
      {
        text: "🔗 ЗАРЕГИСТРИРОВАТЬСЯ В SETHUBBLE",
        url: links.reg,
      },
    ],
    [
      {
        text: "✅ Я ЗАРЕГИСТРИРОВАЛСЯ",
        callback: "Pre_Training_Logic",
      },
    ],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === LOCKED_CRM_INFO ===
  LOCKED_CRM_INFO: (links, user) => {
    // Подтягиваем ссылку на демо (если нет в env, берем дефолтную)
    const crmDemoUrl =
      process.env.CRM_DEMO_URL ||
      "https://novokreschennih.github.io/crm-dashboard/crm_demo.html";

    return [
      [
        {
          text: "💎 АКТИВИРОВАТЬ PRO",
          url: links.pay,
        },
      ],
      [
        {
          text: "📱 ОТКРЫТЬ ДЕМО-ДАШБОРД",
          web_app: { url: crmDemoUrl },
        },
      ],
      [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
    ];
  },

  // === LOCKED_PRO_TRAINING_INFO ===
  LOCKED_PRO_TRAINING_INFO: [
    [
      {
        text: "🎓 ПРОЙТИ БАЗОВОЕ ОБУЧЕНИЕ",
        callback: "Training_Main",
      },
    ],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === LOCKED_PLANS_INFO ===
  LOCKED_PLANS_INFO: () => [
    [
      {
        text: "🎓 НАЧАТЬ ОБУЧЕНИЕ",
        callback: "Training_Main",
      },
    ],
    [{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }],
  ],

  // === EDIT_PROFILE ===
  EDIT_PROFILE: [[{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]],

  // === CHESTS_INVENTORY ===
  CHESTS_INVENTORY: (links, user) => {
    const r = [];
    const isPro = user.bought_tripwire;
    const mod3Done = user.session?.mod3_done;

    // 1. Promo-Kit добавляем ВСЕМ, у кого есть бот (и FREE, и PRO)
    if (!!user.session?.bot_username) {
      const botName = user.session?.bot_username || "";
      const apiGw =
        process.env.API_GW_HOST ||
        "d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net";
      // Если пройден модуль 3, передаем параметр mod3=1 во фронтенд
      const mod3Param = mod3Done || isPro ? "&mod3=1" : "";
      r.push([
        {
          text: "📲 ОТКРЫТЬ PROMO-KIT",
          web_app: {
            url: `${PROMO_KIT_URL}?bot=${botName}&api=https://${apiGw}${mod3Param}`,
          },
        },
      ]);
    }

    // 2. Если юзер PRO — закрываем список кнопок (ему не нужен купон на скидку)
    if (isPro) {
      r.push([{ text: "📥 СКАЧАТЬ БАЗУ ЗНАНИЙ B2B", url: links.free_disk }]);
      r.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]);
      return r;
    }

    // 3. База знаний B2B (только после Модуля 3)
    if (mod3Done) {
      r.push([{ text: "📥 СКАЧАТЬ БАЗУ ЗНАНИЙ B2B", url: links.free_disk }]);
    }

    // 4. Купон на скидку (только если набрал 100 монет)
    if (user.session?.xp >= 100) {
      r.push([
        {
          text: "🎟 ИСПОЛЬЗОВАТЬ КУПОН (-50%)",
          callback: "Offer_Tripwire",
        },
      ]);
    }

    r.push([{ text: "🏠 В ГЛАВНОЕ МЕНЮ", callback: "MAIN_MENU" }]);
    return r;
  },
};
