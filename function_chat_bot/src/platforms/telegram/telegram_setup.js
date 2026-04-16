/**
 * Telegram Handlers Setup
 * Регистрирует все обработчики Telegram бота (middleware, commands, actions, text, callback)
 *
 * Зависимости (передаются через context):
 * - ydb: модуль работы с базой данных
 * - scenario: сценарий для Telegram (с callback_data кнопками)
 * - log: логгер
 * - MAIN_TOKEN: токен главного бота
 * - processedUpdates: Map для защиты от дублей
 * - updateCache: TTL cache для update_id
 * - corsHeaders: CORS заголовки
 * - aiEngine: AI движок
 * - addToDialogHistory, cleanupDialogHistory: функции для AI диалогов
 * - getOrCreatePin: генерация PIN-кодов
 * - generateToken, verifyToken, getJwtSecret: JWT утилиты
 * - notifyBotOwner: уведомления владельцу бота
 * - setupMainBotMenu: установка команд меню
 * - sendStepToUser: отправка шага через fetch
 * - dozhimMap, remindMap: карты дожимов и напоминаний
 * - PRODUCT_ID_FREE, PRODUCT_ID_PRO, PRODUCT_ID_PRO_40: ID продуктов
 * - REMINDER_INTERVALS: интервалы напоминаний
 * - CRON_*: настройки cron
 * - MAX_RETRIES, MAX_RETRY_DELAY_SEC: настройки retry
 */

import TelegrafPkg from "telegraf";
const { Telegraf, Markup } = TelegrafPkg;
import { registerTelegramActions } from "./telegram_actions.js";
import { validateStartPayload } from "../../utils/validator.js";
import {
  formatTrainingProgress,
  detectLoop,
  getLoopHint,
  buildChannelSummary,
} from "../../utils/ux_helpers.js";

/**
 * Setup all Telegram handlers for a bot instance
 * @param {Telegraf} bot - Telegraf instance
 * @param {Object} context - Dependencies
 * @returns {Object} { renderStep, sendStepToUser } for use in VK handler
 */
export function setupTelegramHandlers(bot, context) {
  const {
    ydb,
    scenario,
    log,
    MAIN_TOKEN,
    processedUpdates,
    updateCache,
    corsHeaders,
    channelManager,
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
  } = context;

  // Определяем isMainBot для текущего бота
  const isMainBot = bot.token === MAIN_TOKEN;
  const token = bot.token || MAIN_TOKEN;

  // Флаг для установки меню при холодном старте (модульный scope)
  let isMainBotMenuSet = false;

  // ============================================================
  // HELPER: getKeyboard
  // ============================================================
  const getKeyboard = (step, links, user, info) => {
    if (!step || !step.buttons) return null;
    const btns =
      typeof step.buttons === "function"
        ? step.buttons(links, user, info)
        : step.buttons;

    log.info(`[getKeyboard]`, {
      hasButtons: !!btns,
      btnsCount: Array.isArray(btns) ? btns.length : "not-array",
      firstRow: btns?.[0]?.length,
      firstButton: btns?.[0]?.[0],
    });

    // v5.0: Поддержка VK callback (callback вместо callback_data)
    const filteredBtns = btns
      .map((row) =>
        row.filter((b) => b.callback_data || b.callback || b.url || b.web_app),
      )
      .filter((row) => row.length > 0);

    if (filteredBtns.length === 0) {
      log.warn(`[getKeyboard] No valid buttons!`, { stepKey: step });
      return null;
    }

    return Markup.inlineKeyboard(
      filteredBtns.map((r) =>
        r
          .map((b) => {
            // v5.0: Поддержка VK callback наряду с Telegram callback_data
            const cbData = b.callback_data || b.callback;
            if (b.url) return Markup.button.url(b.text, b.url);
            if (b.web_app) return Markup.button.webApp(b.text, b.web_app.url);
            if (cbData) return Markup.button.callback(b.text, cbData);
            return null;
          })
          .filter(Boolean),
      ),
    );
  };

  // ============================================================
  // HELPER: renderStep
  // ============================================================
  const renderStep = async (ctx, stepKey, token, isAuto = false) => {
    const user = ctx.dbUser;
    const step = scenario.steps[stepKey];

    log.info(`[renderStep]`, { stepKey, userId: user?.user_id, isAuto });

    if (!step) {
      log.error(`[renderStep] Step not found!`, { stepKey });
      return;
    }

    // Перехват в регистрацию, если нет данных
    if (stepKey.startsWith("Training_") && !user.sh_ref_tail) {
      return renderStep(ctx, "Pre_Training_Logic", token, isAuto);
    }

    user.state = stepKey;
    if (step.tag && !user.session.tags.includes(step.tag)) {
      user.session.tags.push(step.tag);
    }

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
      typeof step.text === "function"
        ? step.text(links, user, info)
        : step.text;

    // v6.0: Добавляем прогресс-бар для обучающих шагов
    const progress = formatTrainingProgress(stepKey, user);
    const finalText = progress ? `${progress}${messageText}` : messageText;

    const keyboard = getKeyboard(step, links, user, info);

    log.info(`[renderStep] Preparing message`, {
      stepKey,
      textLength: messageText?.length,
      hasKeyboard: !!keyboard,
    });

    try {
      // При нажатии на кнопку - добавляем отметку "✅ Выбрано" к старому сообщению
      if (ctx.callbackQuery && !isAuto && !ctx.isVk) {
        const oldKb = ctx.callbackQuery.message.reply_markup?.inline_keyboard;
        let clicked = "Выбрано";
        if (oldKb) {
          oldKb.forEach((r) =>
            r.forEach((b) => {
              if (b.callback_data === ctx.callbackQuery.data) clicked = b.text;
            }),
          );
        }

        const txt = `${ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || ""}\n\n—\n✅ <b>${clicked}</b>`;

        let newKb = [];
        if (oldKb) {
          newKb = oldKb.filter((row) => row.some((btn) => btn.url));
        }

        const editOpts = {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: newKb },
        };

        if (ctx.callbackQuery.message.caption) {
          await ctx
            .editMessageCaption(txt, editOpts)
            .catch((e) => log.warn(`[EDIT MSG WARNING]`, { error: e.message }));
        } else {
          await ctx
            .editMessageText(txt, editOpts)
            .catch((e) => log.warn(`[EDIT MSG WARNING]`, { error: e.message }));
        }
      }

      const opts = {
        caption: finalText,
        parse_mode: "HTML",
        protect_content: true,
        ...keyboard,
      };

      if (step.image) {
        try {
          await ctx.replyWithPhoto(step.image, opts);
          log.info(`[renderStep] Photo sent`, {
            stepKey,
            userId: user.user_id,
            image: step.image,
          });
        } catch (photoError) {
          log.warn(`[PHOTO ERROR] Failed to send image, sending text only`, {
            stepKey,
            userId: user.user_id,
            image: step.image,
            error: photoError.message,
          });
          await ctx.reply(finalText, opts);
        }
      } else {
        await ctx.reply(finalText, opts);
      }

      log.info(`[renderStep] Message sent`, { stepKey, userId: user.user_id });

      // Авто-переход (Delay)
      if (step.delay && step.next_step) {
        try {
          await ctx.telegram.sendChatAction(ctx.from.id, "typing");
        } catch (e) {
          log.debug(`[TYPING ACTION] Failed to send typing`, {
            userId: user.user_id,
            error: e.message,
          });
        }
        await new Promise((r) => setTimeout(r, step.delay * 1000));
        return renderStep(ctx, step.next_step, token, true);
      }
    } catch (e) {
      log.error(`[RENDER ERROR]`, e, { stepKey, userId: user.user_id });
      const opts = { parse_mode: "HTML", protect_content: true, ...keyboard };
      await ctx
        .reply(messageText, opts)
        .catch((err) => log.error(`[FALLBACK ERROR]`, err));
    }

    // Сброс saved_state при выходе из напоминания
    if (!stepKey.startsWith("REMINDER_") && user.saved_state === stepKey) {
      // Ничего не делаем, всё ок
    }
  };

  // ============================================================
  // MIDDLEWARE
  // ============================================================
  bot.use(async (ctx, next) => {
    if (!ctx.from || !ctx.from.id || String(ctx.from.id).includes(":")) return;

    const updateId = ctx.update?.update_id;
    const updateType = ctx.update?.callback_query
      ? "callback"
      : ctx.update?.message
        ? "message"
        : "unknown";

    if (isMainBot) {
      updateCache.startCleanup();
    }

    if (updateId && processedUpdates.has(updateId)) {
      const timestamp = processedUpdates.get(updateId);
      const age = Date.now() - timestamp;
      log.warn(`[DUPLICATE UPDATE] Skipping`, {
        updateId,
        updateType,
        userId: ctx.from.id,
        ageMs: age,
      });
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => {});
      }
      return;
    }

    log.info(`[MIDDLEWARE] Processing update`, {
      updateId,
      updateType,
      userId: ctx.from.id,
    });

    // v6.0: Ищем пользователя по tg_id (без префиксов)
    const tgId = Number(ctx.from.id);
    ctx.dbUser = await ydb.findUser({ tg_id: tgId });

    // v6.0: Auto-detect channels from DB columns (tg_id, vk_id, web_id, email)
    if (ctx.dbUser) {
      channelManager.autoDetectChannels(ctx.dbUser);
    }

    log.info(`[MIDDLEWARE] User loaded`, {
      userId: ctx.from.id,
      hasDbUser: !!ctx.dbUser,
      state: ctx.dbUser?.state,
      dbId: ctx.dbUser?.id,
    });

    if (updateId) {
      processedUpdates.set(updateId, Date.now());
    }

    if (!ctx.dbUser) {
      let pid = process.env.MY_PARTNER_ID || "p_qdr";
      let emailFromJoin = null;
      let webIdFromStart = null;

      if (!isMainBot) {
        const info = await ydb.getBotInfo(token);
        if (info?.sh_ref_tail) pid = info.sh_ref_tail;
      }

      // v6.0: Парсим start payload — может содержать web_id или partnerId|email
      if (ctx.message?.text?.startsWith("/start ")) {
        const rawRef = ctx.message.text.split(" ")[1];
        if (rawRef && isMainBot) {
          const parsed = validateStartPayload(rawRef);
          if (parsed) {
            pid = parsed.partnerId;
            emailFromJoin = parsed.email || null;
            webIdFromStart = parsed.webId || null;
            await ydb.recordLinkClick(pid, String(tgId), token);
          } else {
            log.warn("[TG] Invalid start payload", {
              raw: rawRef.substring(0, 50),
            });
          }
        }
      }

      // v6.0: Пробуем найти пользователя по web_id (пришёл с сайта)
      let existingWebUser = null;
      if (webIdFromStart) {
        existingWebUser = await ydb.findUser({ web_id: webIdFromStart });
      }

      // v6.0: Пробуем найти пользователя по email (пришёл с /join/)
      let existingEmailUser = null;
      if (emailFromJoin) {
        existingEmailUser = await ydb.findUser({ email: emailFromJoin });
      }

      if (existingWebUser || existingEmailUser) {
        // v6.0: Нашли существующего пользователя — привязываем Telegram
        ctx.dbUser = existingWebUser || existingEmailUser;
        ctx.dbUser.tg_id = tgId;
        ctx.dbUser.bot_token = token;
        ctx.dbUser.first_name =
          ctx.from.first_name || ctx.dbUser.first_name || "Друг";
        ctx.dbUser.session.channels = ctx.dbUser.session.channels || {};
        ctx.dbUser.session.channels.telegram = {
          enabled: true,
          configured: true,
          bot_username: ctx.me?.username,
          linked_at: Date.now(),
        };
        ctx.dbUser.session.channel_states =
          ctx.dbUser.session.channel_states || {};
        ctx.dbUser.session.channel_states.telegram = "START";
        await ydb.saveUser(ctx.dbUser);

        log.info("[TG] Merged Telegram ID into existing user", {
          tgId,
          userId: ctx.dbUser.id,
          hadWeb: !!existingWebUser,
          hadEmail: !!existingEmailUser,
        });
      } else {
        // v6.0: Создаём нового пользователя
        ctx.dbUser = {
          tg_id: tgId,
          email: emailFromJoin || "",
          partner_id: pid,
          state: "START",
          saved_state: "",
          session: {
            tags: [],
            channels: {
              telegram: {
                enabled: true,
                configured: true,
                bot_username: ctx.me?.username,
                linked_at: Date.now(),
              },
            },
            channel_states: { telegram: "START" },
          },
          bot_token: token,
          sh_user_id: "",
          sh_ref_tail: "",
          tariff: "",
          bought_tripwire: false,
          purchases: [],
          first_name: ctx.from.first_name || "Друг",
          last_reminder_time: 0,
          reminders_count: 0,
        };

        const result = await ydb.saveUser(ctx.dbUser);
        ctx.dbUser.id = result.id;

        log.info("[TG] New user created", {
          tgId,
          userId: result.id,
          partnerId: pid,
        });
      }

      const refParam = ctx.message?.text?.split(" ")?.[1];
      const source = refParam ? `(Реф: ${refParam})` : "(Органика)";

      const newLeadMsg =
        `👥 <b>У ТЕБЯ НОВЫЙ ЛИД!</b>\n\n` +
        `👤 <b>Имя:</b> <a href="tg://user?id=${tgId}">${ctx.from.first_name || "Без имени"}</a>\n` +
        `🆔 <b>ID:</b> <code>${tgId}</code>\n` +
        (emailFromJoin
          ? `📧 <b>Email:</b> <code>${emailFromJoin}</code>\n`
          : "") +
        `🏁 <b>Источник:</b> ${source}\n\n` +
        `<i>Пользователь запустил бота и начал путь по воронке. Можешь отслеживать его в CRM!</i>`;

      notifyBotOwner(token, newLeadMsg, bot);
    } else {
      if (
        ctx.dbUser.session?.bot_username &&
        !ctx.dbUser.session?.own_bot_token
      ) {
        ctx.dbUser.session.own_bot_token = ctx.dbUser.bot_token;
      }

      if (ctx.dbUser.bot_token !== token) {
        ctx.dbUser.bot_token = token;
      }

      if (ctx.dbUser.session?.is_banned) {
        ctx.dbUser.session.is_banned = false;
        log.info(`[SELF-HEALING] User unblocked`, { userId: ctx.from.id });
      }
    }

    ctx.dbUser.first_name = ctx.from.first_name || "Друг";
    ctx.dbUser.last_seen = Date.now();

    if (!ctx.dbUser.session || typeof ctx.dbUser.session !== "object") {
      ctx.dbUser.session = { tags: [] };
    }

    ctx.dbUser.session.last_activity = Date.now();

    if (!ctx.dbUser.state.startsWith("REMINDER_")) {
      ctx.dbUser.reminders_count = 0;
      ctx.dbUser.last_reminder_time = 0;
    }

    await next();
    await ydb.saveUser(ctx.dbUser);
  });

  // ============================================================
  // РЕГИСТРИРУЕМ ACTIONS, COMMANDS, TEXT, CALLBACK
  // ============================================================
  const actionsContext = {
    renderStep,
    getKeyboard,
    ydb,
    scenario,
    log,
    MAIN_TOKEN,
    isMainBot,
    token,
    AI_PRO_LIMIT: context.AI_PRO_LIMIT,
    AI_FREE_LIMIT: context.AI_FREE_LIMIT,
    askNeuroGenAI: context.askNeuroGenAI,
    getOrCreatePin: context.getOrCreatePin,
    generateToken: context.generateToken,
    handleAppsCommand: null, // будет заполнено после регистрации
    notifyBotOwner: context.notifyBotOwner,
    event: context.event,
  };

  const { handleAppsCommand } = registerTelegramActions(bot, actionsContext);

  // Возвращаем helper функции для использования в других модулях
  return { renderStep, getKeyboard, isMainBot, token, handleAppsCommand };
}
