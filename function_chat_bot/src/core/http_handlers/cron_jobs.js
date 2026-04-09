/**
 * Cron Jobs Handler
 * Обрабатывает плановые напоминания и дожимы
 * action: params.action === "cron"
 */

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

  log.info(`[CRON] ========== ЗАПУСК CRON ==========`);
  log.info(
    `[CRON] Критерии: неактивны > ${CRON_STALE_HOURS}ч, макс. пользователей: ${CRON_MAX_USERS_PER_RUN}`,
  );

  const stale = await ydb.getStaleUsers(CRON_STALE_HOURS, CRON_BATCH_SIZE);
  const usersToProcess = stale.slice(0, CRON_MAX_USERS_PER_RUN);

  log.info(`[CRON] Найдено неактивных пользователей: ${stale.length}`);
  log.info(`[CRON] Будет обработано в этом запуске: ${usersToProcess.length}`);

  if (stale.length > CRON_MAX_USERS_PER_RUN) {
    log.info(
      `[CRON] ⚠️ Очередь большая! Оставшиеся ${stale.length - CRON_MAX_USERS_PER_RUN} пользователей будут обработаны в следующем запуске`,
    );
  }

  if (usersToProcess.length === 0) {
    log.info(`[CRON] ⚠️ В базе нет пользователей для дожимов/напоминаний`);
  } else {
    log.info(`[CRON] Пользователи в обработке (первые 10):`);
    usersToProcess.slice(0, 10).forEach((u, idx) => {
      log.info(
        `  [${idx + 1}] User ${u.user_id}: state=${u.state}, last_seen=${Math.round((Date.now() - (u.last_seen || 0)) / 3600000)}ч назад, bot=${u.bot_token?.substring(0, 20) || "N/A"}...`,
      );
    });
    if (usersToProcess.length > 10) {
      log.info(`  ... и ещё ${usersToProcess.length - 10} пользователей`);
    }
  }

  const shouldSendReminder = (user) => {
    if (user.state.startsWith("REMINDER_") || !REMIND_MAP[user.state]) return false;
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
      user.session?.last_dozhim_time || user.session?.last_activity || user.last_seen;
    const hoursInactive = (Date.now() - anchorTime) / (1000 * 60 * 60);
    const requiredDelay =
      typeof rule === "object" && rule !== null ? rule.delay : DOZHIM_DELAY_HOURS;

    if (hoursInactive < requiredDelay) return false;
    return true;
  };

  const checkTripwirePurchase = async (user) => {
    const freshUser = await ydb.getUser(user.user_id);
    if (freshUser && freshUser.bought_tripwire) return true;
    return false;
  };

  const stats = {
    total: usersToProcess.length,
    reminded: 0,
    dozhim: 0,
    tripwire_bought: 0,
    skipped: 0,
    failed: 0,
  };

  for (const u of usersToProcess) {
    try {
      if (u.session?.is_banned) {
        stats.skipped++;
        continue;
      }

      if (u.session?.is_migrating) {
        log.debug(`[CRON] Skip user during token migration`, { userId: u.user_id });
        stats.skipped++;
        continue;
      }

      let actionTaken = false;
      let sendResult = null;

      // === A. НАПОМИНАНИЯ ===
      if (shouldSendReminder(u)) {
        const step = `REMINDER_${REMINDER_INTERVALS[u.reminders_count || 0]}H`;
        if (!u.saved_state) u.saved_state = u.state;

        sendResult = await sendStepToUser(u.bot_token, u.user_id, step, u, MAX_RETRIES);

        if (sendResult.sent) {
          u.last_reminder_time = Date.now();
          u.reminders_count = (u.reminders_count || 0) + 1;
          stats.reminded++;
          actionTaken = true;
          log.info(`[REMINDER] Sent`, { userId: u.user_id, step });
        } else {
          if (sendResult.errorCode === 403) {
            u.session.is_banned = true;
            u.session.banned_at = Date.now();
            u.session.ban_reason = sendResult.error || "Bot blocked";
            log.warn(`[CRON] User blocked bot`, { userId: u.user_id });
            stats.skipped++;
          } else {
            stats.failed++;
            log.error(`[REMINDER] Failed`, {
              userId: u.user_id,
              error: sendResult.error,
              code: sendResult.errorCode,
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
          sendResult = await sendStepToUser(
            u.bot_token, u.user_id, "Training_Pro_Main", u, MAX_RETRIES,
          );
          if (sendResult.sent) {
            u.state = "Training_Pro_Main";
            stats.tripwire_bought++;
            actionTaken = true;
            log.info(`[DOZHIM] User bought Tripwire! Redirected to PRO`, { userId: u.user_id });
          } else {
            if (sendResult.errorCode === 403) {
              u.session.is_banned = true;
              u.session.banned_at = Date.now();
              u.session.ban_reason = sendResult.error || "Bot blocked";
              stats.skipped++;
            } else {
              stats.failed++;
            }
          }
        } else if (u.state.includes("Plan") && u.tariff === "PAID") {
          stats.skipped++;
        } else {
          const rule = DOZHIM_MAP[u.state];
          let next = typeof rule === "object" && rule !== null ? rule.next : rule;

          if (next) {
            if (next.includes("Tripwire") && u.bought_tripwire) {
              stats.skipped++;
            } else {
              sendResult = await sendStepToUser(u.bot_token, u.user_id, next, u, MAX_RETRIES);
              if (sendResult.sent) {
                u.state = next;
                u.session.last_dozhim_time = Date.now();
                stats.dozhim++;
                actionTaken = true;
                log.info(`[DOZHIM] Sent`, { userId: u.user_id, nextStep: next });
              } else {
                if (sendResult.errorCode === 403) {
                  u.session.is_banned = true;
                  u.session.banned_at = Date.now();
                  u.session.ban_reason = sendResult.error || "Bot blocked";
                  stats.skipped++;
                } else {
                  stats.failed++;
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
  log.info(`[CRON] =================================`);

  return response(200, "ok");
}
