/**
 * Cron Jobs Handler — v5.0 Multi-Channel
 * Обрабатывает плановые напоминания и дожимы через все каналы:
 * - Telegram (Telegraf)
 * - VK (VK API messages.send)
 * - Email (Yandex Cloud Postbox)
 *
 * action: params.action === "cron"
 */

import { templates as emailTemplates } from "../email/email_service.js";
import channelManager from "../channels/channel_manager.js";

export async function handleCronJobs(event, context) {
  const {
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
  } = context;

  if (params.action !== "cron") return null;

  log.info(`[CRON] ========== ЗАПУСК CRON (v5.0 Multi-Channel) ==========`);
  log.info(
    `[CRON] Критерии: неактивны > ${CRON_STALE_HOURS}ч, макс. пользователей: ${CRON_MAX_USERS_PER_RUN}`,
  );

  const stale = await ydb.getStaleUsers(CRON_STALE_HOURS, CRON_BATCH_SIZE);
  const usersToProcess = stale.slice(0, CRON_MAX_USERS_PER_RUN);

  log.info(`[CRON] Найдено неактивных пользователей: ${stale.length}`);
  log.info(`[CRON] Будет обработано в этом запуске: ${usersToProcess.length}`);

  if (usersToProcess.length === 0) {
    log.info(`[CRON] ⚠️ В базе нет пользователей для дожимов/напоминаний`);
  } else {
    // Группировка по каналам для логирования
    const byChannel = { telegram: 0, vk: 0, email: 0, web: 0, unknown: 0 };
    usersToProcess.forEach((u) => {
      const ch = channelManager.getPrimaryChannel(u) || "unknown";
      byChannel[ch] = (byChannel[ch] || 0) + 1;
    });
    log.info(`[CRON] Распределение по каналам:`, byChannel);
  }

  const shouldSendReminder = (user) => {
    if (user.state.startsWith("REMINDER_") || !REMIND_MAP[user.state])
      return false;
    const count = user.reminders_count || 0;
    if (count >= REMINDER_INTERVALS.length) return false;

    const realLastSeen = user.session?.last_activity || user.last_seen;
    const lastTime = user.last_reminder_time || realLastSeen;
    const timeDiff = (Date.now() - lastTime) / (1000 * 60 * 60);
    return timeDiff >= REMINDER_INTERVALS[count];
  };

  const shouldSendDozhim = (user) => {
    const rule = DOZHIM_MAP[user.state];
    if (!rule) return false;

    const isDozhimStep =
      user.state.includes("Tripwire") ||
      user.state.includes("Plan") ||
      user.state.includes("Offer") ||
      user.state === "Training_Pro_P2_4";
    if (!isDozhimStep && typeof rule === "string") return false;

    const anchorTime =
      user.session?.last_dozhim_time ||
      user.session?.last_activity ||
      user.last_seen;
    const hoursInactive = (Date.now() - anchorTime) / (1000 * 60 * 60);
    const requiredDelay =
      typeof rule === "object" && rule !== null
        ? rule.delay
        : DOZHIM_DELAY_HOURS;

    if (hoursInactive < requiredDelay) return false;
    return true;
  };

  const checkTripwirePurchase = async (user) => {
    const freshUser = await ydb.findUser({ id: user.id });
    if (freshUser && freshUser.bought_tripwire) return true;
    return false;
  };

  /**
   * Отправка напоминания через Email (фолбэк если основной канал недоступен)
   */
  async function sendEmailReminder(user, step) {
    const email = user.session?.email;
    if (!email) return { sent: false, error: "No email", channel: "email" };

    const tpl = emailTemplates.reminder(user, step);
    const { sendEmail } = await import("../email/email_service.js");
    const result = await sendEmail({ to: email, ...tpl });

    return {
      sent: result.success,
      error: result.error,
      errorCode: result.success ? null : 500,
      channel: "email",
    };
  }

  /**
   * Отправка дожима через Email
   */
  async function sendEmailDozhim(user, nextStep, offerType) {
    const email = user.session?.email;
    if (!email) return { sent: false, error: "No email", channel: "email" };

    const tpl = emailTemplates.followup(user, offerType || "tripwire");
    const { sendEmail } = await import("../email/email_service.js");
    const result = await sendEmail({ to: email, ...tpl });

    return {
      sent: result.success,
      error: result.error,
      errorCode: result.success ? null : 500,
      channel: "email",
    };
  }

  /**
   * Мультиканальная отправка: пробуем основной канал, при неудаче — фолбэк на email
   */
  async function sendWithFallback(user, stepKey, maxRetries) {
    // Основная отправка через sendStepToUser (автоматически определяет канал)
    let result = await sendStepToUser(
      user.bot_token,
      user.user_id,
      stepKey,
      user,
      maxRetries,
    );

    // Если основной канал не сработал и есть email — пробуем email
    if (
      !result.sent &&
      user.session?.email &&
      user.session?.channels?.email?.configured
    ) {
      log.info(`[CRON FALLBACK] Primary channel failed, trying email`, {
        userId: user.user_id,
        primaryChannel: result.channel,
      });

      const isReminder = stepKey.startsWith("REMINDER_");
      if (isReminder) {
        result = await sendEmailReminder(user, stepKey);
      } else {
        const offerType =
          stepKey.includes("Tripwire") || stepKey.includes("FollowUp_Tripwire")
            ? "tripwire"
            : stepKey.includes("Plan") || stepKey.includes("FollowUp_Plan")
              ? "tariff"
              : "tripwire";
        result = await sendEmailDozhim(user, stepKey, offerType);
      }
    }

    return result;
  }

  // === СТАТИСТИКА ПО КАНАЛАМ ===
  const stats = {
    total: usersToProcess.length,
    reminded: 0,
    dozhim: 0,
    tripwire_bought: 0,
    skipped: 0,
    failed: 0,
    // По каналам
    byChannel: {
      telegram: { sent: 0, failed: 0 },
      vk: { sent: 0, failed: 0 },
      email: { sent: 0, failed: 0 },
      web: { sent: 0, failed: 0 },
    },
  };

  for (const u of usersToProcess) {
    try {
      if (u.session?.is_banned) {
        stats.skipped++;
        continue;
      }

      if (u.session?.is_migrating) {
        log.debug(`[CRON] Skip user during token migration`, {
          userId: u.user_id,
        });
        stats.skipped++;
        continue;
      }

      // v6.0: Пропускаем пользователей без настроенных каналов
      // (пользователи с пустыми tg_id, vk_id, web_id, email — это дубликаты после мерджа)
      const hasChannel = u.tg_id || u.vk_id || u.web_id || u.email;
      if (!hasChannel) {
        log.debug(`[CRON] Skip user without channels (likely merge artifact)`, {
          userId: u.id,
        });
        stats.skipped++;
        continue;
      }

      // Определяем основной канал пользователя
      const primaryChannel = channelManager.getPrimaryChannel(u) || "telegram";

      // v6.0: Логируем контекст для отладки
      const hoursInactive = ((Date.now() - (u.session?.last_activity || u.last_seen)) / (1000 * 60 * 60)).toFixed(1);
      log.debug(`[CRON CONTEXT]`, {
        userId: u.id,
        firstName: u.first_name,
        state: u.state,
        channel: primaryChannel,
        hoursInactive,
        channels: Object.keys(u.session?.channels || {}).filter(ch => u.session.channels[ch]?.configured),
      });

      let actionTaken = false;
      let sendResult = null;

      // === A. НАПОМИНАНИЯ ===
      if (shouldSendReminder(u)) {
        const step = `REMINDER_${REMINDER_INTERVALS[u.reminders_count || 0]}H`;
        if (!u.saved_state) u.saved_state = u.state;

        sendResult = await sendWithFallback(u, step, MAX_RETRIES);

        if (sendResult.sent) {
          u.last_reminder_time = Date.now();
          u.reminders_count = (u.reminders_count || 0) + 1;
          stats.reminded++;
          actionTaken = true;

          // Статистика по каналу
          const ch = sendResult.channel || primaryChannel;
          if (stats.byChannel[ch]) stats.byChannel[ch].sent++;

          log.info(`[REMINDER] Sent`, {
            userId: u.user_id,
            step,
            channel: ch,
          });
        } else {
          if (sendResult.errorCode === 403) {
            u.session.is_banned = true;
            u.session.banned_at = Date.now();
            u.session.ban_reason = sendResult.error || "Bot blocked";
            log.warn(`[CRON] User blocked`, {
              userId: u.user_id,
              channel: primaryChannel,
            });
            stats.skipped++;
          } else {
            stats.failed++;
            const ch = sendResult.channel || primaryChannel;
            if (stats.byChannel[ch]) stats.byChannel[ch].failed++;

            log.error(`[REMINDER] Failed`, {
              userId: u.user_id,
              error: sendResult.error,
              code: sendResult.errorCode,
              channel: ch,
            });
          }
        }
      }
      // === B. ДОЖИМЫ ===
      else if (shouldSendDozhim(u)) {
        const boughtTripwire = await checkTripwirePurchase(u);
        const isTripwireDozhim =
          u.state.includes("Tripwire") ||
          u.state === "FAQ_PRO" ||
          u.state === "Offer_Tripwire";

        if (boughtTripwire && isTripwireDozhim) {
          sendResult = await sendWithFallback(
            u,
            "Training_Pro_Main",
            MAX_RETRIES,
          );
          if (sendResult.sent) {
            u.state = "Training_Pro_Main";
            stats.tripwire_bought++;
            actionTaken = true;

            const ch = sendResult.channel || primaryChannel;
            if (stats.byChannel[ch]) stats.byChannel[ch].sent++;

            log.info(`[DOZHIM] User bought Tripwire! Redirected to PRO`, {
              userId: u.user_id,
              channel: ch,
            });
          } else {
            if (sendResult.errorCode === 403) {
              u.session.is_banned = true;
              u.session.banned_at = Date.now();
              u.session.ban_reason = sendResult.error || "Bot blocked";
              stats.skipped++;
            } else {
              stats.failed++;
              const ch = sendResult.channel || primaryChannel;
              if (stats.byChannel[ch]) stats.byChannel[ch].failed++;
            }
          }
        } else if (u.state.includes("Plan") && u.tariff === "PAID") {
          stats.skipped++;
        } else {
          const rule = DOZHIM_MAP[u.state];
          let next =
            typeof rule === "object" && rule !== null ? rule.next : rule;

          if (next) {
            if (next.includes("Tripwire") && u.bought_tripwire) {
              stats.skipped++;
            } else {
              sendResult = await sendWithFallback(u, next, MAX_RETRIES);
              if (sendResult.sent) {
                u.state = next;
                u.session.last_dozhim_time = Date.now();
                stats.dozhim++;
                actionTaken = true;

                const ch = sendResult.channel || primaryChannel;
                if (stats.byChannel[ch]) stats.byChannel[ch].sent++;

                log.info(`[DOZHIM] Sent`, {
                  userId: u.user_id,
                  nextStep: next,
                  channel: ch,
                });
              } else {
                if (sendResult.errorCode === 403) {
                  u.session.is_banned = true;
                  u.session.banned_at = Date.now();
                  u.session.ban_reason = sendResult.error || "Bot blocked";
                  stats.skipped++;
                } else {
                  stats.failed++;
                  const ch = sendResult.channel || primaryChannel;
                  if (stats.byChannel[ch]) stats.byChannel[ch].failed++;
                }
              }
            }
          } else {
            stats.skipped++;
          }
        }
      } else {
        stats.skipped++;
      }

      let attemptMade = shouldSendReminder(u) || shouldSendDozhim(u);

      if (actionTaken || u.session.is_banned || attemptMade) {
        u.last_seen = Date.now();
        await ydb.saveUser(u);
      }

      await new Promise((res) => setTimeout(res, CRON_USER_PAUSE_MS));
    } catch (e) {
      log.error(`[CRON ERROR User ${u.user_id}]`, e, { state: u.state });
      stats.failed++;
    }
  }

  log.info(`[CRON] ========== ИТОГИ CRON ==========`);
  log.info(`[CRON] Всего обработано: ${stats.total}`);
  log.info(`[CRON] ✅ Отправлено напоминаний: ${stats.reminded}`);
  log.info(`[CRON] 🔥 Отправлено дожимов: ${stats.dozhim}`);
  log.info(`[CRON] 💰 Куплено Tripwire: ${stats.tripwire_bought}`);
  log.info(`[CRON] ⏭️ Пропущено: ${stats.skipped}`);
  log.info(`[CRON] ❌ Ошибок: ${stats.failed}`);
  log.info(`[CRON] По каналам:`, stats.byChannel);
  log.info(`[CRON] =================================`);

  return response(200, "ok");
}
