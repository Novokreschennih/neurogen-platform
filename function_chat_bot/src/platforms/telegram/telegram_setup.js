/**
 * Telegram Handlers Setup — v7.2 Fixed Syntax
 */

import TelegrafPkg from "telegraf";
const { Telegraf, Markup } = TelegrafPkg;
import { registerTelegramActions } from "./telegram_actions.js";
import { validateStartPayload } from "../../utils/validator.js";
import {
  formatTrainingProgress,
  detectLoop,
  getLoopHint,
} from "../../utils/ux_helpers.js";
import { resolveUser } from '../../core/omni_resolver.js';
import { getAdaptedState } from '../../scenarios/common/step_order.js';

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

  const isMainBot = bot.token === MAIN_TOKEN;
  const token = bot.token || MAIN_TOKEN;

  const getKeyboard = (step, links, user, info) => {
    if (!step || !step.buttons) return null;
    const btns = typeof step.buttons === "function" ? step.buttons(links, user, info) : step.buttons;
    const filteredBtns = btns
      .map((row) => row.filter((b) => b.callback_data || b.callback || b.url || b.web_app))
      .filter((row) => row.length > 0);

    if (filteredBtns.length === 0) return null;

    return Markup.inlineKeyboard(
      filteredBtns.map((r) =>
        r.map((b) => {
          const cbData = b.callback_data || b.callback;
          if (b.url) return Markup.button.url(b.text, b.url);
          if (b.web_app) return Markup.button.webApp(b.text, b.web_app.url);
          if (cbData) return Markup.button.callback(b.text, cbData);
          return null;
        }).filter(Boolean)
      )
    );
  };

  const renderStep = async (ctx, stepKey, token, isAuto = false) => {
    const user = ctx.dbUser;
    const step = scenario.steps[stepKey];
    if (!step) return;

    if (!user.session) user.session = {};
    if (!Array.isArray(user.session.tags)) user.session.tags = [];

    if (stepKey.startsWith("Training_") && !user.sh_ref_tail) {
      return renderStep(ctx, "Pre_Training_Logic", token, isAuto);
    }

    user.state = stepKey;
    // ИСПРАВЛЕНИЕ (M5): обновляем per-channel state
    if (!user.session.channel_states) user.session.channel_states = {};
    user.session.channel_states.telegram = stepKey;
    if (step.tag && !user.session.tags.includes(step.tag)) {
      user.session.tags.push(step.tag);
    }

    const info = await (token === MAIN_TOKEN
      ? Promise.resolve({ sh_user_id: process.env.MY_SH_USER_ID, sh_ref_tail: process.env.MY_PARTNER_ID, bot_username: "sethubble_biz_bot" })
      : ydb.getBotInfo(token));

    const links = scenario.getLinks(info?.sh_ref_tail || "p_qdr", info?.tripwire_link, info?.sh_user_id, user.bought_tripwire, user);
    const messageText = typeof step.text === "function" ? step.text(links, user, info) : step.text;
    const progress = formatTrainingProgress(stepKey, user);
    const finalText = progress ? `${progress}${messageText}` : messageText;
    const keyboard = getKeyboard(step, links, user, info);

    try {
      const opts = { caption: finalText, parse_mode: "HTML", protect_content: true, ...keyboard };
      if (step.image) {
        await ctx.replyWithPhoto(step.image, opts).catch(() => ctx.reply(finalText, opts));
      } else {
        await ctx.reply(finalText, opts);
      }

      if (step.delay && step.next_step) {
        setTimeout(() => renderStep(ctx, step.next_step, token, true), step.delay * 1000);
      }
    } catch (e) {
      log.error(`[RENDER ERROR]`, e);
    }
  };

  // ============================================================
  // MIDDLEWARE: CORE OMNICHANNEL LOGIC
  // ============================================================
  bot.use(async (ctx, next) => {
    if (!ctx.from || !ctx.from.id) return;
    const tgId = Number(ctx.from.id);

    let payloadWebId = null, payloadEmail = null, payloadPartnerId = process.env.MY_PARTNER_ID || "p_qdr";
    if (ctx.message?.text?.startsWith("/start ")) {
      const rawRef = ctx.message.text.split(" ")[1];
      const parsed = validateStartPayload(rawRef);
      if (parsed) {
        payloadPartnerId = parsed.partnerId || payloadPartnerId;
        payloadWebId = parsed.webId;
        payloadEmail = parsed.email;
      }
    }

    let user = await resolveUser('telegram', {
      tg_id: tgId,
      web_id: payloadWebId,
      email: payloadEmail,
      partner_id: payloadPartnerId,
      first_name: ctx.from.first_name
    });

    // ИСПРАВЛЕНИЕ (M1): не мутируем user.state — используем адаптированный стейт
    const adaptedState = getAdaptedState(user.state, 'telegram');
    if (user.state !== adaptedState) user.state = adaptedState;

    // ИСПРАВЛЕНИЕ (M5): восстанавливаем per-channel state если есть
    if (user.session?.channel_states?.telegram) {
      const chState = user.session.channel_states.telegram;
      const { getFunnelIndex } = await import('../../scenarios/common/step_order.js');
      if (getFunnelIndex(chState) > getFunnelIndex(user.state)) {
        user.state = chState;
      }
    }

    // ИСПРАВЛЕНИЕ (M5): синхронизируем channel_states с текущим стейтом
    if (!user.session.channel_states) user.session.channel_states = {};
    user.session.channel_states.telegram = user.state;

    user.bot_token = token;
    user.last_seen = Date.now();

    if (!user.tg_id || user.tg_id === 0) {
      user.tg_id = tgId;
      log.info(`[OMNI-LINK] Successfully linked Telegram ID ${tgId} to Web User ${user.web_id}`);
    }

    ctx.dbUser = user;

    // ИСПРАВЛЕНИЕ: resolveUser уже делает saveUser внутри себя.
    // Дополнительный saveUser здесь не нужен — он вызывается в telegram_actions.js
    // там, где данные действительно изменились после обработки действия.
    // Это устраняет race condition между resolveUser-save и последующим saveUser
    // который мог бы перезаписать слитые данные старой версией объекта.

    await next();
  });

  // ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК: Удаляем кнопки после нажатия
  bot.on("callback_query", async (ctx, next) => {
    try {
      // Стираем клавиатуру у сообщения, на которое нажал пользователь
      await ctx.editMessageReplyMarkup(undefined);
    } catch (e) {
      // Игнорируем ошибку (если сообщение старое или кнопки уже нет)
    }
    return next(); // Передаем управление дальше экшенам
  });

  // Регистрация команд и действий
  const actionsContext = { renderStep, getKeyboard, ydb, scenario, log, MAIN_TOKEN, isMainBot, token, AI_PRO_LIMIT: context.AI_PRO_LIMIT, AI_FREE_LIMIT: context.AI_FREE_LIMIT, askNeuroGenAI: context.askNeuroGenAI, getOrCreatePin, generateToken, notifyBotOwner, event: context.event };
  registerTelegramActions(bot, actionsContext);

  // Мягкий старт
  bot.start(async (ctx) => {
    if (ctx.dbUser.state && ctx.dbUser.state !== "START" && !ctx.dbUser.state.startsWith("WAIT_")) {
      ctx.dbUser.saved_state = ctx.dbUser.state;
      // ИСПРАВЛЕНИЕ: не вызываем saveUser здесь — resolveUser уже сохранил.
      // saved_state будет сохранён при следующем действии пользователя.
      return renderStep(ctx, "RESUME_GATE", token);
    }
    ctx.dbUser.saved_state = "";
    await renderStep(ctx, "START", token);
  });

  return { renderStep };
}