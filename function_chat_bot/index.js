import TelegrafPkg from "telegraf";
const { Telegraf, Markup } = TelegrafPkg;
import * as querystring from "querystring";
import * as ydb from "./ydb_helper.js";
import scenario from "./src/scenarios/scenario_tg.js";
import scenarioVK from "./src/scenarios/scenario_vk.js";
import aiEngine, {
  addToDialogHistory,
  cleanupDialogHistory,
} from "./ai_engine.js";

// === УТИЛИТЫ ===
import { log, setTraceId } from "./src/utils/logger.js";
import { withRetry, parseSendResult } from "./src/utils/retry.js";
import { createUpdateCache } from "./src/utils/ttl_cache.js";
import {
  getJwtSecret,
  generateToken,
  verifyToken,
} from "./src/utils/jwt_utils.js";
import { generatePin, generateNeuroPin } from "./src/utils/pin.js";

// === КАНАЛЫ И EMAIL ===
import channelManager from "./src/core/channels/channel_manager.js";
import {
  sendEmail,
  templates as emailTemplates,
} from "./src/core/email/email_service.js";

// === ПЛАТФОРМЫ ===
import { setupTelegramHandlers } from "./src/platforms/telegram/telegram_setup.js";
import { handleVkWebhook } from "./src/platforms/vk/vk_handler.js";

// === HTTP HANDLERS ===
import { handleWebChat } from "./src/core/http_handlers/web_chat.js";
import { handleCrmApi } from "./src/core/http_handlers/crm_api.js";
import { handleAppAuth } from "./src/core/http_handlers/app_auth.js";
import { handlePaymentWebhook } from "./src/core/http_handlers/payment_webhook.js";
import { handleCronJobs } from "./src/core/http_handlers/cron_jobs.js";
import { handlePartnerApi } from "./src/core/http_handlers/partner_api.js";

// === БАЗОВЫЕ КОНСТАНТЫ ===
const MAIN_TOKEN = process.env.BOT_TOKEN;
const PRODUCT_ID_FREE = process.env.PRODUCT_ID_FREE || "140_9d5d2";
const PRODUCT_ID_PRO = process.env.PRODUCT_ID_PRO || "103_97999"; // $20 (со скидкой)
// === ИСПРАВЛЕНИЕ: Безопасный откат к PRODUCT_ID_PRO, если _40 не задан ===
const PRODUCT_ID_PRO_40 = process.env.PRODUCT_ID_PRO_40 || PRODUCT_ID_PRO;

// === JWT SECRET — ВАЛИДАЦИЯ ПРИ ИМПОРТЕ (см. src/utils/jwt_utils.js) ===
// JWT_SECRET проверяется автоматически при первом вызове getJwtSecret()
// В production фолбэк на BOT_TOKEN запрещён — это критическая уязвимость

// === НАСТРАИВАЕМЫЕ ЛИМИТЫ И ПАРАМЕТРЫ ===
const MAX_STORED_UPDATES = parseInt(process.env.MAX_STORED_UPDATES) || 100;
const AI_FREE_LIMIT = parseInt(process.env.AI_FREE_LIMIT) || 3;
const AI_PRO_LIMIT = parseInt(process.env.AI_PRO_LIMIT) || 30;
const DOZHIM_DELAY_HOURS = parseInt(process.env.DOZHIM_DELAY_HOURS) || 20;
const CRON_BATCH_SIZE = parseInt(process.env.CRON_BATCH_SIZE) || 50;
const BROADCAST_RATE_LIMIT = parseInt(process.env.BROADCAST_RATE_LIMIT) || 30;

// === НАСТРОЙКИ RETRY LOGIC (429 Too Many Requests) ===
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 2; // Максимум попыток отправки
const MAX_RETRY_DELAY_SEC = parseInt(process.env.MAX_RETRY_DELAY_SEC) || 10; // Макс. задержка в секундах

// Парсим интервалы напоминаний (например: "1,3,24" → [1, 3, 24])
// Добавляем 48 часов в цепочку
const REMINDER_INTERVALS = (process.env.REMINDER_INTERVALS || "1,3,24,48")
  .split(",")
  .map((n) => parseInt(n.trim()))
  .filter((n) => !isNaN(n));

// === НАСТРОЙКИ CRON ===
const CRON_STALE_HOURS = parseInt(process.env.CRON_STALE_HOURS) || 1; // Как давно не активен (1 час)
const CRON_USER_PAUSE_MS = parseInt(process.env.CRON_USER_PAUSE_MS) || 35; // Пауза между пользователями (мс)
const CRON_BROADCAST_PAUSE_SEC =
  parseInt(process.env.CRON_BROADCAST_PAUSE_SEC) || 1; // Пауза между пачками (сек)
// === ИСПРАВЛЕНИЕ v4.3: Лимит пользователей за один запуск CRON (защита от долгих выполнений) ===
const CRON_MAX_USERS_PER_RUN =
  parseInt(process.env.CRON_MAX_USERS_PER_RUN) || 200;

// === TTL КЭШ ДЛЯ ОБРАБОТАННЫХ UPDATE (защита от дублей) ===
const updateCache = createUpdateCache({
  max: parseInt(process.env.MAX_STORED_UPDATES) || 1000,
  ttlMs: parseInt(process.env.UPDATE_TTL_MS) || 5 * 60 * 1000,
  cleanupIntervalMs:
    parseInt(process.env.UPDATE_CLEANUP_INTERVAL_MS) || 60 * 1000,
});

// Обратная совместимость — aliases для старого кода
const processedUpdates = {
  has: (id) => updateCache.isProcessed(id),
  set: (id, val) => updateCache.markProcessed(id),
  get: (id) => null, // больше не используется
};
const startUpdateCleanup = () => updateCache.startCleanup();
const cleanupProcessedUpdates = () => updateCache.cleanup();

// === v5.0: RATE LIMITING для HTTP endpoint (защита от спама) ===
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 60; // запросов
const RATE_LIMIT_WINDOW_MS =
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000; // 1 минута
const rateLimitMap = new Map(); // { ip: { count, resetTime } }

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    // Первое обращение или окно истекло
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// Очистка устаревших записей каждые 5 минут
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime + 60_000) {
        rateLimitMap.delete(ip);
      }
    }
  },
  5 * 60 * 1000,
);

// === ФЛАГ ДЛЯ УСТАНОВКИ МЕНЮ ПРИ ХОЛОДНОМ СТАРТЕ ===
let isMainBotMenuSet = false;

// === ФУНКЦИЯ УСТАНОВКИ СИСТЕМНОГО МЕНЮ ===
async function setupMainBotMenu(botInstance) {
  if (isMainBotMenuSet) return; // Если уже поставили — выходим

  try {
    await botInstance.telegram.setMyCommands([
      { command: "start", description: "🚀 Запустить систему" },
      { command: "tools", description: "🎒 Инструменты" },
      { command: "menu", description: "🏠 Главное меню" },
      { command: "stats", description: "📊 Моя статистика" },
    ]);
    console.log("✅ Системное меню главного бота успешно установлено!");
    isMainBotMenuSet = true;
  } catch (error) {
    console.error("❌ Ошибка при установке меню:", error.message);
  }
}

// === УМНАЯ ФУНКЦИЯ УВЕДОМЛЕНИЯ ВЛАДЕЛЬЦА БОТА ===
// Отправляет пуш владельцу бота-клона или глобальным админам
async function notifyBotOwner(targetBotToken, message, mainBotInstance) {
  try {
    // Если токена нет или это токен главного бота -> уведомляем глобальных админов
    if (!targetBotToken || targetBotToken === process.env.BOT_TOKEN) {
      const adminIds = (process.env.CRM_ADMIN_IDS || "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id);

      for (const adminId of adminIds) {
        await mainBotInstance.telegram
          .sendMessage(adminId, message, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          })
          .catch(() => {});
      }
    } else {
      // Это бот-клон -> ищем его владельца в БД
      const botInfo = await ydb.getBotInfo(targetBotToken);

      if (botInfo && botInfo.owner_id) {
        // Пробуем отправить пуш от имени ГЛАВНОГО бота (партнер точно на него подписан)
        await mainBotInstance.telegram
          .sendMessage(botInfo.owner_id, message, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          })
          .catch(async () => {
            // Фолбэк: если он заблокировал главного бота, шлем пуш от имени его собственного клона
            const cloneBot = new Telegraf(targetBotToken);
            await cloneBot.telegram
              .sendMessage(botInfo.owner_id, message, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
              })
              .catch((e) =>
                log.error(
                  `[NOTIFY ERROR] Не удалось отправить пуш владельцу ${botInfo.owner_id}`,
                  e.message,
                ),
              );
          });
      }
    }
  } catch (err) {
    log.error(`[NOTIFY ERROR] Ошибка в функции notifyBotOwner`, err.message);
  }
}

// === CORS HEADERS (ВАЖНО ДЛЯ GITHUB PAGES / WEB APP) ===
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, x-telegram-initdata, x-payment-key, x-crm-key",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
};

// === ИНТЕГРАЦИЯ SUPABASE (ГЕНЕРАЦИЯ ПИН-КОДОВ) ===
async function getOrCreatePin(productType, telegramUserId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ ОШИБКА: Не заданы ключи Supabase!");
    return "ОШИБКА_СЕРВЕРА";
  }

  try {
    // Устанавливаем таймаут в 3 секунды, чтобы функция не висела и не жгла деньги
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // 1. Проверяем, есть ли уже ПИН
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/pin_codes?product_type=eq.${productType}&user_id=eq.${telegramUserId}&select=pin_code`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);

    if (!checkRes.ok) throw new Error(`Supabase DB Error: ${checkRes.status}`);
    const checkData = await checkRes.json();

    if (checkData && checkData.length > 0) {
      return checkData[0].pin_code;
    }

    // 2. Генерируем новый ПИН
    const newPin =
      "NG-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // 3. Записываем в базу
    const postController = new AbortController();
    const postTimeout = setTimeout(() => postController.abort(), 3000);

    await fetch(`${supabaseUrl}/rest/v1/pin_codes`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pin_code: newPin,
        product_type: productType,
        user_id: telegramUserId.toString(),
      }),
      signal: postController.signal,
    });
    clearTimeout(postTimeout);

    return newPin;
  } catch (error) {
    console.error("[SUPABASE ERROR]", error.message || error);
    // Отдаем единый маркер ошибки
    return "ERROR";
  }
}

// === ИНТЕГРАЦИЯ OPENROUTER (DEEPSEEK) — НОВАЯ ВЕРСИЯ С AI ENGINE ===
async function askNeuroGenAI(userText, user) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.warn("[AI ENGINE] OPENROUTER_API_KEY not set");
    return null;
  }

  // Очищаем старую историю диалога (старше 24 часов)
  const currentHistory = user.session?.dialog_history || [];
  const cleanedHistory = cleanupDialogHistory(currentHistory, 24);

  log.info("[AI ENGINE] Generating response", {
    userId: user.user_id,
    state: user.state,
    textLength: userText.length,
    historyLength: cleanedHistory.length,
  });

  // Генерируем ответ через AI Engine
  const aiResponse = await aiEngine.generateAIResponse(
    userText,
    user,
    user.state,
    cleanedHistory,
  );

  if (!aiResponse) {
    log.warn("[AI ENGINE] No response from API");
  } else {
    log.info("[AI ENGINE] Response generated", {
      userId: user.user_id,
      responseLength: aiResponse.length,
    });

    // Добавляем сообщение пользователя и ответ ИИ в историю
    const updatedHistory = addToDialogHistory(
      cleanedHistory,
      "user",
      userText,
      10,
    );
    const finalHistory = addToDialogHistory(
      updatedHistory,
      "assistant",
      aiResponse,
      10,
    );

    // Сохраняем обновленную историю в сессии пользователя
    user.session.dialog_history = finalHistory;
    // Не сохраняем здесь — это сделает основной обработчик
  }

  return aiResponse;
}

// Функция для поиска заголовка без учета регистра (x-token, X-Token, X-TOKEN...)
const getHeader = (headers, key) => {
  if (!headers) return null;
  const lowerKey = key.toLowerCase();
  for (const k in headers) {
    if (k.toLowerCase() === lowerKey) return headers[k];
  }
  return null;
};

// === АВТОРИЗАЦИЯ CRM (ФИНАЛ: Case-Insensitive) ===
/**
 * Проверяет авторизацию через Telegram WebApp initData и права администратора
 * @returns {object|null} - { tgData, botToken, botInfo } или null при ошибке
 */
async function authorizeCrmRequest(headers, eventBody, isBase64Encoded) {
  // 1. Ищем заголовок гибко (не важно, X-Telegram-InitData или x-telegram-initdata)
  const initData = getHeader(headers, "x-telegram-initdata");

  if (!initData) {
    console.error(
      "[AUTH FAIL] Missing header x-telegram-initdata. Headers:",
      JSON.stringify(headers),
    );
    return {
      error: {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Telegram authorization required (Header missing)",
        }),
      },
    };
  }

  let bodyStr = eventBody || "";
  if (isBase64Encoded)
    bodyStr = Buffer.from(eventBody, "base64").toString("utf8");

  let data = {};
  try {
    data =
      typeof bodyStr === "string" && bodyStr.startsWith("{")
        ? JSON.parse(bodyStr)
        : querystring.parse(bodyStr);
  } catch (e) {
    return {
      error: {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid JSON body" }),
      },
    };
  }

  const botToken = data.bot_token;
  if (!botToken) {
    return {
      error: {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "bot_token required" }),
      },
    };
  }

  // 2. Валидируем подпись
  const tgData = ydb.validateTelegramInitData(initData, botToken);

  if (!tgData) {
    console.error("[AUTH FAIL] Signature mismatch", {
      botToken,
      initDataShort: initData.substring(0, 20),
    });
    return {
      error: {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Invalid Telegram authorization (Signature mismatch)",
        }),
      },
    };
  }

  if (!tgData.user) {
    return {
      error: {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No user data in initData" }),
      },
    };
  }

  // 3. Получаем инфо о боте из БД
  let botInfo = await ydb.getBotInfo(botToken);

  // Заранее проверяем, является ли юзер Главным Админом
  const isGlobalAdmin = ydb.isAdmin(tgData.user.id);

  // Выводим в лог для отладки
  log.info(
    `[AUTH DEBUG] User ID: ${tgData.user.id}, isGlobalAdmin: ${isGlobalAdmin}, botToken matches: ${botToken === MAIN_TOKEN?.trim()}`,
  );

  if (!botInfo) {
    // === ПУЛЕНЕПРОБИВАЕМЫЙ ПРОПУСК ДЛЯ АДМИНА ===
    // Пускаем, если это Глобальный Админ ИЛИ если токен совпадает (с очисткой от случайных пробелов)
    if (isGlobalAdmin || botToken === MAIN_TOKEN?.trim()) {
      botInfo = { owner_id: String(tgData.user.id) };
      log.info("[CRM AUTH] Admin bypassed bot DB check");
    } else {
      console.error("[AUTH FAIL] Bot not found in DB", {
        botToken: botToken.substring(0, 15) + "...",
      });
      return {
        error: {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Bot not found in DB" }),
        },
      };
    }
  }

  // 4. Проверка прав
  const isBotOwner = botInfo.owner_id === String(tgData.user.id);

  // Если не глобальный админ — проверяем, что владелец бота купил PRO
  if (!isGlobalAdmin) {
    if (!isBotOwner) {
      console.error("[AUTH FAIL] Access denied", {
        userId: tgData.user.id,
        ownerId: botInfo.owner_id,
      });
      return {
        error: {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Access denied: You are not the owner of this bot",
          }),
        },
      };
    }

    // Проверяем PRO-статус владельца бота
    const ownerUser = await ydb.findUser({ tg_id: Number(tgData.user.id) });
    if (!ownerUser || !ownerUser.bought_tripwire) {
      console.error("[AUTH FAIL] PRO required", {
        userId: tgData.user.id,
        hasPro: ownerUser?.bought_tripwire || false,
      });
      return {
        error: {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Access denied: PRO status required for bot owners",
          }),
        },
      };
    }
  }

  return { tgData, botToken, botInfo, data };
}

// === КАРТА ДОЖИМОВ (С ДИНАМИЧЕСКИМИ ИНТЕРВАЛАМИ — 10 ШАГОВ) ===
// Формат: key: { next: "step", delay: hours }
// Если delay не указан, используется DOZHIM_DELAY_HOURS по умолчанию
const DOZHIM_MAP = {
  // --- Дожимы Tripwire ($20) — 10 касаний с нарастающими интервалами ---
  // ИСПРАВЛЕНИЕ: Даем отработать 48-часовому напоминанию, стартуем дожимы на 50-й час
  Offer_Tripwire: { next: "FollowUp_Tripwire_1", delay: 50 }, // 0 → 1: через 50 часов (48h напоминание + 2h запас)
  FAQ_PRO: { next: "FollowUp_Tripwire_1", delay: 50 },
  FollowUp_Tripwire_1: { next: "FollowUp_Tripwire_2", delay: 24 }, // 1 → 2: через 24 часа (1 день)
  FollowUp_Tripwire_2: { next: "FollowUp_Tripwire_3", delay: 48 }, // 2 → 3: через 48 часов (2 дня)
  FollowUp_Tripwire_3: { next: "FollowUp_Tripwire_4", delay: 72 }, // 3 → 4: через 72 часа (3 дня)
  FollowUp_Tripwire_4: { next: "FollowUp_Tripwire_5", delay: 96 }, // 4 → 5: через 96 часов (4 дня)
  FollowUp_Tripwire_5: { next: "FollowUp_Tripwire_6", delay: 120 }, // 5 → 6: через 120 часов (5 дней)
  FollowUp_Tripwire_6: { next: "FollowUp_Tripwire_7", delay: 144 }, // 6 → 7: через 144 часа (6 дней)
  FollowUp_Tripwire_7: { next: "FollowUp_Tripwire_8", delay: 168 }, // 7 → 8: через 168 часов (7 дней/неделя)
  FollowUp_Tripwire_8: { next: "FollowUp_Tripwire_9", delay: 192 }, // 8 → 9: через 192 часа (8 дней)
  FollowUp_Tripwire_9: { next: "FollowUp_Tripwire_10", delay: 216 }, // 9 → 10: через 216 часов (9 дней)

  // После 10 дожима — переход на дожимы тарифов (с паузой в неделю)
  FollowUp_Tripwire_10: { next: "FollowUp_Plan_1", delay: 168 },

  // --- Дожимы Тарифов (Rocket/Shuttle) — 10 шагов ---
  Rocket_Limits: { next: "FollowUp_Plan_1", delay: 20 },
  Shuttle_Offer: { next: "FollowUp_Plan_1", delay: 20 },
  Plan_Selection: { next: "FollowUp_Plan_1", delay: 20 },
  FollowUp_Plan_1: { next: "FollowUp_Plan_2", delay: 24 }, // 1 → 2: через 24 часа (1 день)
  FollowUp_Plan_2: { next: "FollowUp_Plan_3", delay: 48 }, // 2 → 3: через 48 часов (2 дня)
  FollowUp_Plan_3: { next: "FollowUp_Plan_4", delay: 72 }, // 3 → 4: через 72 часа (3 дня)
  FollowUp_Plan_4: { next: "FollowUp_Plan_5", delay: 96 }, // 4 → 5: через 96 часов (4 дня)
  FollowUp_Plan_5: { next: "FollowUp_Plan_6", delay: 120 }, // 5 → 6: через 120 часов (5 дней)
  FollowUp_Plan_6: { next: "FollowUp_Plan_7", delay: 144 }, // 6 → 7: через 144 часа (6 дней)
  FollowUp_Plan_7: { next: "FollowUp_Plan_8", delay: 168 }, // 7 → 8: через 168 часов (7 дней/неделя)
  FollowUp_Plan_8: { next: "FollowUp_Plan_9", delay: 192 }, // 8 → 9: через 192 часа (8 дней)
  FollowUp_Plan_9: { next: "FollowUp_Plan_10", delay: 216 }, // 9 → 10: через 216 часов (9 дней)

  // После 10 дожима — выход из воронки (пользователь уходит в спящий режим)
  FollowUp_Plan_10: null,

  // Обучение (для напоминаний, не дожимов)
  Token_Success: "Module_3_Offline",
  Delivery_1: "Training_Pro_Main",
  Training_Pro_Main: "Training_Pro_P1_1",
  Training_Pro_P1_1: "Training_Pro_P1_2",
  Training_Pro_P1_2: "Training_Pro_P1_3",
  Training_Pro_P1_3: "Training_Pro_P1_4",
  Training_Pro_P1_4: "Training_Pro_P1_5",
  Training_Pro_P1_5: "Training_Pro_P2_1",
  Training_Pro_P2_1: "Training_Pro_P2_2",
  Training_Pro_P2_2: "Training_Pro_P2_3",
  Training_Pro_P2_3: "Training_Pro_P2_4",
  Training_Pro_P2_4: "Shuttle_Offer", // После полного курса → оффер Shuttle

  // Обучение (основная ветка)
  Training_Main: "Module_1_Strategy",
  Module_1_Strategy: "Module_2_Online",
  Module_2_Online: "Module_3_Offline",
  Module_3_Offline: "Lesson_Final_Comparison",
  Lesson_Final_Comparison: "Offer_Tripwire",
};

// === КАРТА ШАГОВ, ГДЕ НУЖНЫ НАПОМИНАНИЯ (1ч, 3ч, 24ч) ===
const REMIND_MAP = {
  Pre_Training_Logic: true,
  Training_Main: true,
  Module_1_Strategy: true,
  Module_2_Online: true,
  Module_3_Offline: true,
  Lesson_Final_Comparison: true,
  Offer_Tripwire: true,
  Delivery_1: true,
  Training_Pro_Main: true,
  Training_Pro_P1_1: true,
  Training_Pro_P1_2: true,
  Training_Pro_P1_3: true,
  Training_Pro_P1_4: true,
  Training_Pro_P1_5: true,
  Training_Pro_P2_1: true,
  Training_Pro_P2_2: true,
  Training_Pro_P2_3: true,
  Training_Pro_P2_4: true,
  Rocket_Limits: true,
};

// === МУЛЬТИКАНАЛЬНАЯ ОТПРАВКА СООБЩЕНИЙ ===

/**
 * VK API: отправить сообщение пользователю
 */
async function sendVkMessage(userId, text, keyboard) {
  if (!process.env.VK_SERVICE_TOKEN) {
    log.warn("[VK SEND] VK_SERVICE_TOKEN not set");
    return { sent: false, error: "VK not configured", errorCode: 500 };
  }

  const apiUrl = "https://api.vk.com/method/messages.send";
  const params = new URLSearchParams({
    user_id: String(userId),
    random_id: String(Date.now()),
    message: text.replace(/<[^>]*>/g, ""), // VK doesn't support HTML
    access_token: process.env.VK_SERVICE_TOKEN,
    v: "5.199",
  });

  if (keyboard) {
    params.set("keyboard", JSON.stringify(keyboard));
  }

  try {
    const response = await fetch(`${apiUrl}?${params}`, { method: "POST" });
    const data = await response.json();

    if (data.error) {
      log.warn(`[VK SEND] Error`, {
        errorCode: data.error.error_code,
        errorMsg: data.error.error_msg,
        userId,
      });
      return {
        sent: false,
        error: data.error.error_msg,
        errorCode: data.error.error_code,
        channel: "vk",
      };
    }

    return { sent: true, error: null, errorCode: null, channel: "vk" };
  } catch (e) {
    log.error(`[VK SEND] Network error`, { userId, error: e.message });
    return { sent: false, error: e.message, errorCode: null, channel: "vk" };
  }
}

/**
 * Unified step sender — dispatches to the right channel
 * @param {string} token - Telegram bot token (for TG channel)
 * @param {string} userId - User identifier (format depends on channel)
 * @param {string} stepKey - Funnel step key
 * @param {object} user - Full user object from YDB
 * @param {number} maxRetries - Max retry attempts
 * @param {string} [forceChannel] - Override channel: "telegram", "vk", "email"
 * @returns {object} { sent: boolean, error?: string, errorCode?: number, channel: string }
 */
const sendStepToUser = async (
  token,
  userId,
  stepKey,
  user,
  maxRetries = 2,
  forceChannel = null,
) => {
  const step = scenario.steps[stepKey];
  if (!step)
    return {
      sent: false,
      error: "Step not found",
      errorCode: null,
      channel: "unknown",
    };

  // Determine which channel to use
  const channel =
    forceChannel || channelManager.getPrimaryChannel(user) || "telegram";

  const info = await (token === MAIN_TOKEN
    ? Promise.resolve({
        sh_user_id: process.env.MY_SH_USER_ID || "1123",
        sh_ref_tail: process.env.MY_PARTNER_ID || "p_qdr",
        tripwire_link: "",
        bot_username: "sethubble_biz_bot",
      })
    : ydb.getBotInfo(token));

  const links = scenario.getLinks(
    info?.sh_ref_tail || user.partner_id || "p_qdr",
    info?.tripwire_link,
    info?.sh_user_id,
    user.bought_tripwire,
  );

  const messageText =
    typeof step.text === "function" ? step.text(links, user, info) : step.text;

  // === TELEGRAM ===
  if (channel === "telegram") {
    return await sendStepViaTelegram(
      token,
      userId,
      stepKey,
      user,
      messageText,
      links,
      info,
      maxRetries,
    );
  }

  // === VK ===
  if (channel === "vk") {
    const keyboard = getVkKeyboard(step, links, user, info);
    const cleanText = messageText.replace(/<[^>]*>/g, ""); // Strip HTML for VK
    return await sendVkMessage(userId, cleanText, keyboard);
  }

  // === EMAIL ===
  if (channel === "email") {
    const email = user.session?.email;
    if (!email) {
      return {
        sent: false,
        error: "No email set",
        errorCode: null,
        channel: "email",
      };
    }
    const tpl = emailTemplates.reminder(user, stepKey);
    const result = await sendEmail({ to: email, ...tpl });
    return {
      sent: result.success,
      error: result.error,
      errorCode: result.success ? null : 500,
      channel: "email",
    };
  }

  // === WEB (no direct push — skip) ===
  return {
    sent: false,
    error: "Web channel has no push notifications",
    errorCode: null,
    channel: "web",
  };
};

/**
 * Telegram-specific step sender (extracted from original sendStepToUser)
 */
const sendStepViaTelegram = async (
  token,
  userId,
  stepKey,
  user,
  messageText,
  links,
  info,
  maxRetries,
) => {
  const step = scenario.steps[stepKey];
  const keyboard = getKeyboard(step, links, user, info);
  const tokenToUse = token || MAIN_TOKEN;
  const apiUrl = `https://api.telegram.org/bot${tokenToUse}/sendMessage`;

  // === RETRY LOGIC ДЛЯ 429 ===
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const opts = {
        chat_id: userId,
        text: messageText,
        parse_mode: "HTML",
        protect_content: true,
        reply_markup: keyboard?.inline_keyboard
          ? JSON.stringify({ inline_keyboard: keyboard.inline_keyboard })
          : undefined,
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });

      const data = await response.json();

      if (!data.ok) {
        const errorCode = data.error_code || response.status;
        const errorMsg = data.description || response.statusText;

        // 429 — пробуем снова с экспоненциальной задержкой
        if (errorCode === 429 && attempt < maxRetries) {
          const retryAfter = data.parameters?.retry_after || 1;
          const delay = Math.min(retryAfter * Math.pow(2, attempt), 10) * 1000;
          log.warn(`[BOT] 429 detected, retrying in ${delay}ms`, {
            userId,
            stepKey,
            attempt: attempt + 1,
            maxRetries,
          });
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        // Пользователь заблокировал бота
        if (
          errorCode === 403 ||
          errorMsg.includes("bot was blocked") ||
          errorMsg.includes("chat not found")
        ) {
          log.warn(`[BOT] User blocked bot`, {
            userId,
            stepKey,
            errorCode,
            errorMsg,
          });
          return {
            sent: false,
            error: errorMsg,
            errorCode: 403,
            channel: "telegram",
          };
        }

        // Другие ошибки
        log.warn(`[BOT] Send failed`, {
          userId,
          stepKey,
          errorCode,
          errorMsg,
          attempt: attempt + 1,
        });
        return { sent: false, error: errorMsg, errorCode, channel: "telegram" };
      }

      return { sent: true, error: null, errorCode: null, channel: "telegram" };
    } catch (e) {
      lastError = e;
      const errorCode = e.code || null;
      const errorMsg = e.message || "Unknown error";

      log.warn(`[BOT] Network error`, {
        userId,
        stepKey,
        errorMsg,
        attempt: attempt + 1,
      });
      return {
        sent: false,
        error: `Network error: ${errorMsg}`,
        errorCode,
        channel: "telegram",
      };
    }
  }

  // Все попытки исчерпаны
  const errorCode = lastError?.code || null;
  const errorMsg = lastError?.message || "Unknown error";
  return {
    sent: false,
    error: `Max retries exceeded: ${errorMsg}`,
    errorCode,
    channel: "telegram",
  };
};

/**
 * Build VK keyboard from step buttons
 */
function getVkKeyboard(step, links, user, info) {
  if (!step || !step.buttons) return null;
  const btns =
    typeof step.buttons === "function"
      ? step.buttons(links, user, info)
      : step.buttons;

  const filteredBtns = btns
    .map((row) =>
      row
        .filter((b) => b.callback_data || b.url)
        .map((b) => ({
          action: {
            type: b.callback_data ? "callback" : "open_link",
            payload: b.callback_data
              ? JSON.stringify({ button: b.callback_data })
              : undefined,
            link: b.url ? { url: b.url } : undefined,
            label: b.text.substring(0, 40),
          },
        })),
    )
    .filter((row) => row.length > 0);

  if (filteredBtns.length === 0) return null;

  return {
    one_time: false,
    inline: true,
    buttons: filteredBtns,
  };
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

const createBotContext = (event) => {
  const params = event.queryStringParameters || {};
  const headers = event.headers || {};
  let token = headers["x-bot-token"] || params.bot_token;
  if (typeof token !== "string" || !token.includes(":")) {
    token = MAIN_TOKEN;
  }
  if (!token) token = "";
  return { token, bot: new Telegraf(token), isMainBot: token === MAIN_TOKEN };
};

const dbInitPromise = ydb.init();

export const handler = async (event) => {
  // === ИСПРАВЛЕНИЕ: Ждем подключения к БД ДО любых действий! ===
  await dbInitPromise;

  // v5.0: Инициализация trace_id для каждого запроса
  const traceId =
    event.headers?.["x-request-id"] ||
    event.headers?.["x-amzn-requestid"] ||
    crypto.randomUUID().slice(0, 16);
  setTraceId(traceId);

  // === ЛОГИРОВАНИЕ ВХОДЯЩЕГО СОБЫТИЯ ===
  const timerData =
    typeof event.details?.payload === "string"
      ? JSON.parse(event.details.payload)
      : event.details || {};

  log.info(
    `[HANDLER] Received event: method=${event.httpMethod || "TIMER"}, action=${timerData.action || event.queryStringParameters?.action || "NONE"}`,
  );

  // === CORS HEADERS ===
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, x-telegram-initdata, x-payment-key, x-crm-key",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    "X-API-Version": "v1", // v5.0: Версия API в заголовке
  };

  // 1. ОБРАБОТКА PREFLIGHT ЗАПРОСОВ (OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  // v5.0: API Versioning — поддержка префикса /api/v1/
  // Если запрос начинается с /api/v1/ — обрабатываем как v1
  // Если запрос без префикса — обратная совместимость (v0)
  const apiVersion = (() => {
    const path = event.path || "";
    if (path.startsWith("/api/v1/")) return "v1";
    if (path.startsWith("/api/")) return "legacy";
    return "v0"; // Telegram webhook, timer, и т.д.
  })();

  // v1-specific headers или валидация
  if (apiVersion === "v1") {
    // В будущем: проверка API ключей, rate limiting, и т.д.
    log.debug("[API v1] Request received", { path: event.path });
  }

  // 2. ИЗВЛЕЧЕНИЕ ACTION РАНЬШЕ (для API handlers)
  const timerDataEarly =
    typeof event.details?.payload === "string"
      ? JSON.parse(event.details.payload)
      : event.details || {};
  const paramsEarly = event.queryStringParameters || timerDataEarly || event;
  const action = paramsEarly.action;

  // === v6.0: RATE LIMITING (защита от DDoS и слива бюджета OpenRouter) ===
  const clientIp =
    event.requestContext?.identity?.sourceIp ||
    event.headers?.["x-real-ip"] ||
    event.headers?.["x-forwarded-for"] ||
    "unknown_ip";

  // Исключаем webhook'и Telegram и VK (у них свои IP, их блочить нельзя)
  const isWebhook =
    event.body &&
    (event.body.includes("update_id") || event.body.includes('type":"message_new"'));

  if (!isWebhook && clientIp !== "unknown_ip") {
    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      log.warn(`[RATE LIMIT] IP blocked: ${clientIp}, retryAfter ${rateCheck.retryAfter}s`);
      return {
        statusCode: 429,
        headers: { ...corsHeaders, "Retry-After": String(rateCheck.retryAfter) },
        body: JSON.stringify({
          error: "Too many requests",
          retryAfter: rateCheck.retryAfter,
        }),
      };
    }
  }

  // === HEALTH CHECK (v5.0) ===
  if (action === "health" || action === "ping") {
    const ydbOk = driverInitialized ? "ok" : "initializing";
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "ok",
        ydb: ydbOk,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: "5.0",
        timestamp: Date.now(),
      }),
    };
  }

  // === WEB-CHAT (делегировано в модуль) ===
  const webChatResponse = await handleWebChat(event, {
    action,
    ydb,
    log,
    corsHeaders,
  });
  if (webChatResponse) return webChatResponse;
  // === КОНЕЦ WEB-CHAT ===

  // === CRM API (делегировано в модуль) ===
  const crmApiResponse = await handleCrmApi(event, {
    action,
    ydb,
    log,
    corsHeaders,
    authorizeCrmRequest,
    BROADCAST_RATE_LIMIT,
  });
  if (crmApiResponse) return crmApiResponse;
  // === КОНЕЦ CRM API ===

  // === ПРОДОЛЖЕНИЕ ОСНОВНОЙ ЛОГИКИ ===

  // === APP AUTH (validate-app-token + validate-pin, делегировано в модуль) ===
  const appAuthResponse = await handleAppAuth(event, {
    action,
    ydb,
    log,
    verifyToken,
    generateToken,
    corsHeaders,
  });
  if (appAuthResponse) return appAuthResponse;
  // === КОНЕЦ APP AUTH ===

  // ==========================================

  try {
    const { token, bot, isMainBot } = createBotContext(event);

    // === ОБРАБОТКА ПАРАМЕТРОВ ===
    // Timer trigger: event.details.payload содержит JSON строку с данными
    const timerData =
      typeof event.details?.payload === "string"
        ? JSON.parse(event.details.payload)
        : event.details || {};
    const params = event.queryStringParameters || timerData || event;
    const headers = event.headers || {};

    // === ОБНОВЛЯЕМ МЕНЮ ТОЛЬКО ДЛЯ ГЛАВНОГО БОТА (ПРИ ХОЛОДНОМ СТАРТЕ) ===
    if (isMainBot) {
      // Вызываем без await, чтобы функция отработала в фоне
      // и не тормозила ответ пользователю
      setupMainBotMenu(bot);
    }
    // =====================================================================

    // Обертка для возврата ответа с CORS (ВЫНЕСЕНО НАВЕРХ)
    const response = (code, bodyData, customHeaders = {}) => ({
      statusCode: code,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...customHeaders,
      },
      body: typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData),
    });

    // --- TELEGRAM HANDLERS (делегировано в модуль) ---
    const {
      renderStep,
      getKeyboard,
      isMainBot: tgIsMainBot,
      token: tgToken,
      handleAppsCommand,
    } = setupTelegramHandlers(bot, {
      ydb,
      scenario,
      log,
      MAIN_TOKEN,
      processedUpdates,
      updateCache,
      corsHeaders,
      aiEngine,
      addToDialogHistory,
      cleanupDialogHistory,
      getOrCreatePin,
      generateToken,
      verifyToken,
      getJwtSecret,
      notifyBotOwner,
      setupMainBotMenu,
      DOZHIM_MAP,
      REMIND_MAP,
      PRODUCT_ID_FREE,
      PRODUCT_ID_PRO,
      PRODUCT_ID_PRO_40,
      REMINDER_INTERVALS,
      CRON_STALE_HOURS,
      CRON_USER_PAUSE_MS,
      CRON_BROADCAST_PAUSE_SEC,
      CRON_MAX_USERS_PER_RUN,
      MAX_RETRIES,
      MAX_RETRY_DELAY_SEC,
      AI_PRO_LIMIT,
      AI_FREE_LIMIT,
      askNeuroGenAI,
      event,
    });
    // --- КОНЕЦ TELEGRAM HANDLERS ---

    // --- PAYMENT ACTION (делегировано в модуль) ---
    const paymentResponse = await handlePaymentWebhook(event, {
      params,
      headers,
      response,
      ydb,
      log,
      bot,
      sendStepToUser,
      notifyBotOwner,
      generatePin,
      MAIN_TOKEN,
      PRODUCT_ID_PRO,
      PRODUCT_ID_PRO_40,
      querystring,
    });
    if (paymentResponse) return paymentResponse;
    // --- КОНЕЦ PAYMENT ACTION ---

    // --- CRON ACTION (делегировано в модуль) ---
    const cronResponse = await handleCronJobs(event, {
      params,
      response,
      ydb,
      log,
      sendStepToUser,
      DOZHIM_MAP,
      REMIND_MAP,
      REMINDER_INTERVALS,
      DOZHIM_DELAY_HOURS,
      CRON_STALE_HOURS,
      CRON_BATCH_SIZE,
      CRON_USER_PAUSE_MS,
      CRON_MAX_USERS_PER_RUN,
      MAX_RETRIES,
    });
    if (cronResponse) return cronResponse;
    // --- КОНЕЦ CRON ACTION ---

    // --- API: GET PARTNER LINK (делегировано в модуль) ---
    const partnerResponse = await handlePartnerApi(event, {
      params,
      headers,
      response,
      ydb,
      log,
      MAIN_TOKEN,
      getHeader,
    });
    if (partnerResponse) return partnerResponse;
    // --- КОНЕЦ PARTNER API ---

    // === VK WEBHOOK (делегировано в модуль, renderStep доступен) ===
    const vkResponse = await handleVkWebhook(event, {
      ydb,
      scenarioVK,
      log,
      processedUpdates,
      renderStep,
      corsHeaders,
      channelManager,
      sendEmail,
    });
    if (vkResponse) return vkResponse;
    // === КОНЕЦ VK WEBHOOK ===

    // Обработка вебхука от Telegram
    const body = event.body
      ? JSON.parse(
          event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString()
            : event.body,
        )
      : {};

    if (body.update_id) {
      log.info(`[WEBHOOK] Received update`, {
        updateId: body.update_id,
        type: body.callback_query ? "callback" : "message",
      });

      // v5.0: Webhook retry — если YDB недоступен, повторяем с backoff
      const { retryWebhook } = await import("./src/utils/webhook_retry.js");
      const retryResult = await retryWebhook(
        async () => {
          await bot.handleUpdate(body);
          return { success: true };
        },
        {
          delays: [5_000, 30_000], // 5s, 30s (5min слишком долго для serverless)
          context: "TG_WEBHOOK",
        },
      );

      if (retryResult.success) {
        return response(200, "ok");
      } else {
        // Все retry попытки провалились — логируем и возвращаем 500
        // Telegram продолжит ретраить ~15min
        log.error("[WEBHOOK] All retries failed", {
          updateId: body.update_id,
          error: retryResult.error,
          attempts: retryResult.attempts,
        });
        return { statusCode: 500, headers: corsHeaders, body: "retry" };
      }
    }

    // Для не-webhook запросов (CORS preflight, CRM API и т.д.)
    return response(200, "ok");
  } catch (err) {
    // v5.0: Определяем тип ошибки для правильного ответа
    const errorMsg = err.message || String(err);
    const isTransient =
      errorMsg.includes("YDB") ||
      errorMsg.includes("timeout") ||
      errorMsg.includes("ECONNREFUSED") ||
      errorMsg.includes("ENOTFOUND") ||
      errorMsg.includes("Unavailable");

    if (isTransient) {
      // Временная ошибка — возвращаем 500, Telegram ретраит
      log.error("[HANDLER] Transient error (will retry)", {
        error: errorMsg,
      });
      return { statusCode: 500, headers: corsHeaders, body: "retry" };
    } else {
      // Постоянная ошибка — логируем и возвращаем 200, чтобы остановить ретраи
      log.error("[HANDLER] Permanent error (stopping retries)", {
        error: errorMsg,
      });
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Internal Server Error handled" }),
      };
    }
  }
};
