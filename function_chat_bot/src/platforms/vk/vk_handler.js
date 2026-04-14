/**
 * VK Webhook Handler
 * Обрабатывает входящие запросы от VK Callback API
 *
 * Зависимости (передаются через context):
 * - ydb: модуль работы с базой данных
 * - scenarioVK: сценарий для VK (с callback кнопками)
 * - log: логгер
 * - processedUpdates: Map для защиты от дублей
 * - renderStep: функция рендера шага сценария
 * - corsHeaders: CORS заголовки
 * - channelManager: менеджер каналов
 * - sendEmail: функция отправки email
 */

/**
 * Генерирует клавиатуру главного меню в зависимости от прогресса пользователя
 * @param {object} user - объект пользователя из YDB
 * @param {string} userId - VK user ID
 * @returns {string} JSON строка клавиатуры
 */
function getVkMainMenuKeyboard(user, userId) {
  const hasData = !!user.sh_ref_tail;
  const isPro = user.bought_tripwire;
  const hasMod3 = user.session?.mod3_done || isPro;
  const seenPlans = user.session?.tags?.includes("seen_plans");

  const buttons = [];

  // --- БЛОК 1: ТОЛЬКО ДЛЯ НОВИЧКОВ ---
  if (!hasData) {
    buttons.push([
      {
        action: {
          type: "callback",
          payload: JSON.stringify({ callback_data: "Agent_1_Pain" }),
          label: "🚀 ПУТЬ АГЕНТА",
        },
        color: "primary",
      },
    ]);
    buttons.push([
      {
        action: {
          type: "callback",
          payload: JSON.stringify({ callback_data: "Business_Online_Pain" }),
          label: "💻 ДЛЯ ОНЛАЙН-БИЗНЕСА",
        },
        color: "default",
      },
    ]);
    buttons.push([
      {
        action: {
          type: "callback",
          payload: JSON.stringify({ callback_data: "Business_Offline_Pain" }),
          label: "🏢 ДЛЯ ОФЛАЙН-БИЗНЕСА",
        },
        color: "default",
      },
    ]);
  } else {
    // --- БЛОК 2: ЗАРЕГИСТРИРОВАНЫ ---
    if (isPro) {
      buttons.push([
        {
          action: {
            type: "callback",
            payload: JSON.stringify({ callback_data: "Training_Pro_Main" }),
            label: "💎 PRO-ИНСТРУМЕНТЫ",
          },
          color: "primary",
        },
      ]);
      const setupStep =
        user.bot_token === "VK_CENTRAL_GROUP" ? "MY_AI_BOT" : "SYSTEM_SETUP";
      buttons.push([
        {
          action: {
            type: "callback",
            payload: JSON.stringify({ callback_data: setupStep }),
            label: "⚙️ НАСТРОЙКА СИСТЕМЫ",
          },
          color: "default",
        },
      ]);
    } else if (hasMod3 || seenPlans) {
      buttons.push([
        {
          action: {
            type: "callback",
            payload: JSON.stringify({ callback_data: "Rocket_Limits" }),
            label: "💎 МАСШТАБ",
          },
          color: "primary",
        },
      ]);
      const setupStep =
        user.bot_token === "VK_CENTRAL_GROUP" ? "MY_AI_BOT" : "SYSTEM_SETUP";
      buttons.push([
        {
          action: {
            type: "callback",
            payload: JSON.stringify({ callback_data: setupStep }),
            label: "⚙️ НАСТРОЙКА СИСТЕМЫ",
          },
          color: "default",
        },
      ]);
    } else {
      // В процессе обучения
      const savedState = user.saved_state || "Training_Main";
      buttons.push([
        {
          action: {
            type: "callback",
            payload: JSON.stringify({ callback_data: savedState }),
            label: "📚 ПРОДОЛЖИТЬ ОБУЧЕНИЕ",
          },
          color: "primary",
        },
      ]);
      buttons.push([
        {
          action: {
            type: "callback",
            payload: JSON.stringify({ callback_data: "Training_Main" }),
            label: "🔄 НАЧАТЬ ЗАНОВО",
          },
          color: "default",
        },
      ]);
    }
  }

  // --- ОБЩИЕ КНОПКИ ---
  buttons.push([
    {
      action: {
        type: "callback",
        payload: JSON.stringify({ callback_data: "VK_STATISTIKA" }),
        label: "📊 СТАТИСТИКА",
      },
      color: "default",
    },
  ]);
  buttons.push([
    {
      action: {
        type: "callback",
        payload: JSON.stringify({ callback_data: "SUPPORT_ASK" }),
        label: "📞 ПОДДЕРЖКА",
      },
      color: "default",
    },
  ]);

  return JSON.stringify({
    inline: false,
    one_time: false,
    buttons,
  });
}

export async function handleVkWebhook(event, context) {
  const {
    ydb,
    scenarioVK,
    log,
    processedUpdates,
    renderStep,
    corsHeaders,
    channelManager,
    sendEmail,
  } = context;

  const action =
    event.httpMethod === "GET"
      ? new URL(event.path, "http://example.com").searchParams.get("action")
      : null;

  const isVkRequest =
    event.body &&
    (event.body.includes('"type":"confirmation"') ||
      event.body.includes('"type":"message_new"') ||
      event.body.includes('"type":"message_event"'));

  if (action === "vk-webhook" || isVkRequest) {
    log.info(`[VK WEBHOOK] Request received`);

    /**
     * Уведомление владельца VK-бота о новом лиде
     */
    async function notifyVkBotOwner(groupId, leadName, leadId) {
      try {
        // Ищем бота по group_id
        const botInfo = await ydb.getBotInfoByVkGroup(groupId);
        if (!botInfo || !botInfo.owner_id) return;

        // Отправляем уведомление владельцу через VK
        if (process.env.VK_SERVICE_TOKEN) {
          const notifyParams = new URLSearchParams({
            access_token: process.env.VK_SERVICE_TOKEN,
            v: "5.199",
            user_id: String(botInfo.owner_id),
            random_id: String(Math.floor(Math.random() * 2147483647)),
            message: `🔔 <b>НОВЫЙ ЛИД!</b>\n\n${leadName} (ID: ${leadId}) зашёл в твой бот.\n\nСистема автоматически ведёт его по воронке.`,
          });
          await fetch("https://api.vk.com/method/messages.send", {
            method: "POST",
            body: notifyParams,
          });
        }
      } catch (e) {
        log.warn("[VK NOTIFY ERROR]", e.message);
      }
    }

    try {
      const payloadStr = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body || "{}";
      const payload = JSON.parse(payloadStr);

      if (payload.type === "confirmation") {
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/plain" },
          body: process.env.VK_CONFIRM_CODE || "ТВОЙ_КОД_ИЗ_НАСТРОЕК_ВК",
        };
      }

      if (
        process.env.VK_SECRET_KEY &&
        payload.secret !== process.env.VK_SECRET_KEY
      ) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "text/plain" },
          body: "Forbidden",
        };
      }

      // === MESSAGE_EVENT (callback кнопка нажата) ===
      if (payload.type === "message_event") {
        const rawPayload = payload.object?.payload;

        // VK шлёт user_id на разных уровнях
        const userId =
          payload.object?.user_id || payload.user_id || payload.group_id;
        const peerId = payload.object?.peer_id || userId;

        // ⚠️ СТРОГО из object! payload.event_id — это ID вебхука (доставки),
        // а payload.object.event_id — ID нажатия кнопки
        const eventId = payload.object?.event_id;

        log.info(`[VK] message_event received`, {
          resolvedUserId: userId,
          resolvedPeerId: peerId,
          eventId,
          rawPayloadPreview: rawPayload
            ? typeof rawPayload === "string"
              ? rawPayload.substring(0, 200)
              : JSON.stringify(rawPayload).substring(0, 200)
            : null,
        });

        // VK может прислать payload как строку ИЛИ как объект
        let parsed;
        try {
          if (typeof rawPayload === "string") {
            parsed = JSON.parse(rawPayload);
          } else if (typeof rawPayload === "object") {
            parsed = rawPayload;
          }
        } catch (e) {
          return { statusCode: 200, body: "ok" };
        }

        const callbackData = parsed?.callback_data;

        if (!callbackData || !userId || !eventId) {
          log.warn(`[VK] message_event missing data`, {
            hasCallbackData: !!callbackData,
            hasUserId: !!userId,
            hasEventId: !!eventId,
          });
          return { statusCode: 200, body: "ok" };
        }

        // Убираем спиннер НЕМЕДЛЕННО
        const stopBody = new URLSearchParams();
        stopBody.append("access_token", process.env.VK_GROUP_TOKEN);
        stopBody.append("v", "5.199");
        stopBody.append("event_id", eventId);
        stopBody.append("user_id", String(userId));
        stopBody.append("peer_id", String(peerId));
        // event_data НЕ передаём — ВК просто снимет спиннер

        try {
          const stopResp = await fetch(
            "https://api.vk.com/method/messages.sendMessageEventAnswer",
            { method: "POST", body: stopBody },
          );
          const stopData = await stopResp.json();
          if (stopData.error) {
            log.error(
              `[VK] Ошибка API при остановке спиннера:`,
              JSON.stringify(stopData.error),
            );
          } else {
            log.info(`[VK] Спиннер остановлен`, {
              response: stopData.response,
            });
          }
        } catch (e) {
          log.warn(`[VK] Сетевая ошибка спиннера`, e.message);
        }

        const vkUserId = Number(userId);
        log.info(`[VK] Fetching user`, { vkId: vkUserId });
        const vkUser = await ydb.findUser({ vk_id: vkUserId });
        log.info(`[VK] findUser result`, {
          found: !!vkUser,
          userId: vkUser?.id,
          vkId: vkUser?.vk_id,
          state: vkUser?.state,
        });
        if (!vkUser || !vkUser.id) {
          log.warn(`[VK] User not found after button press`, {
            vkUserId,
          });
          return { statusCode: 200, body: "ok" };
        }

        const translateKb = (tgOpts, addMainMenu = true) => {
          if (!tgOpts?.reply_markup?.inline_keyboard) return null;
          const vkBtns = tgOpts.reply_markup.inline_keyboard.map((row) =>
            row
              .map((btn) => {
                const cbData = btn.callback_data || btn.callback;
                if (btn.url)
                  return {
                    action: {
                      type: "open_link",
                      link: btn.url,
                      label: btn.text.substring(0, 40),
                    },
                  };
                else if (btn.web_app?.url)
                  return {
                    action: {
                      type: "open_link",
                      link: btn.web_app.url,
                      label: btn.text.substring(0, 40),
                    },
                  };
                else if (cbData)
                  return {
                    action: {
                      type: "callback",
                      payload: JSON.stringify({
                        callback_data: cbData,
                      }),
                      label: btn.text.substring(0, 40),
                    },
                    color: "default",
                  };
                return null;
              })
              .filter(Boolean),
          );
          return JSON.stringify({ inline: true, buttons: vkBtns });
        };

        const vkCtx = {
          isVk: true,
          from: { id: userId },
          message: { text: "" },
          dbUser: vkUser,
          callbackQuery: {
            data: callbackData,
            message: { text: "", caption: "", reply_markup: null },
          },
          telegram: { sendChatAction: async () => {} },
          reply: async (replyText, opts = {}) => {
            const msg = (replyText || "").replace(/<[^>]*>?/gm, "");
            const params = new URLSearchParams();
            params.append("access_token", process.env.VK_GROUP_TOKEN);
            params.append("v", "5.199");
            params.append("user_id", String(userId));
            params.append(
              "random_id",
              String(Math.floor(Math.random() * 2147483647)),
            );
            params.append("message", msg);
            const kb = translateKb(opts);
            if (kb) {
              params.append("keyboard", kb);
            } else {
              // Persistent main menu keyboard
              const mainMenuKb = getVkMainMenuKeyboard(vkUser, userId);
              params.append("keyboard", mainMenuKb);
            }
            await fetch("https://api.vk.com/method/messages.send", {
              method: "POST",
              body: params,
            });
          },
          replyWithPhoto: async (photoUrl, opts = {}) => {
            const cap = (opts.caption || "").replace(/<[^>]*>?/gm, "");

            try {
              // Скачиваем фото
              log.info(`[VK PHOTO EVENT] Downloading photo`, { url: photoUrl });
              const photoResp = await fetch(photoUrl);
              if (!photoResp.ok) throw new Error(`HTTP ${photoResp.status}`);
              const photoBuffer = Buffer.from(await photoResp.arrayBuffer());

              // Получаем URL для загрузки
              const uploadResp = await fetch(
                `https://api.vk.com/method/photos.getMessagesUploadServer?access_token=${process.env.VK_GROUP_TOKEN}&v=5.199`,
              );
              const uploadData = await uploadResp.json();
              const uploadUrl = uploadData.response?.upload_url;
              if (!uploadUrl) throw new Error("No upload URL");

              // Загружаем фото через multipart/form-data (ручное формирование без form-data пакета)
              const boundary = `----VKBoundary${Math.random().toString(36).slice(2)}`;
              const header = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
              const footer = `\r\n--${boundary}--\r\n`;
              const formBuffer = Buffer.concat([
                Buffer.from(header),
                photoBuffer,
                Buffer.from(footer),
              ]);
              const contentType = `multipart/form-data; boundary=${boundary}`;

              const upResp = await fetch(uploadUrl, {
                method: "POST",
                headers: { "Content-Type": contentType },
                body: formBuffer,
              });
              const uploadResult = await upResp.json();
              log.info(`[VK PHOTO EVENT] Upload result`, {
                status: upResp.status,
                hasPhoto: !!uploadResult.photo,
                hasServer: !!uploadResult.server,
                hasHash: !!uploadResult.hash,
                error: uploadResult.error || null,
              });

              if (
                uploadResult.photo &&
                uploadResult.server &&
                uploadResult.hash
              ) {
                // Сохраняем фото
                const saveResp = await fetch(
                  `https://api.vk.com/method/photos.saveMessagesPhoto?access_token=${process.env.VK_GROUP_TOKEN}&v=5.199&server=${uploadResult.server}&photo=${uploadResult.photo}&hash=${uploadResult.hash}`,
                  { method: "POST" },
                );
                const saveData = await saveResp.json();
                log.info(`[VK PHOTO EVENT] saveMessagesPhoto result`, {
                  hasResponse: !!saveData.response,
                  responseLength: Array.isArray(saveData.response)
                    ? saveData.response.length
                    : 0,
                  rawResponse: JSON.stringify(saveData.response).substring(
                    0,
                    300,
                  ),
                  error: saveData.error || null,
                });
                const savedPhoto = saveData.response?.[0];
                log.info(`[VK PHOTO EVENT] savedPhoto check`, {
                  hasId: !!savedPhoto?.id,
                  id: savedPhoto?.id,
                  ownerId: savedPhoto?.owner_id,
                  accessKey: savedPhoto?.access_key,
                });

                if (savedPhoto?.id) {
                  // Формат: photo{owner_id}_{media_id} (access_key не нужен для своих фото)
                  const attachment = `photo${savedPhoto.owner_id}_${savedPhoto.id}`;
                  const sendParams = new URLSearchParams();
                  sendParams.append("access_token", process.env.VK_GROUP_TOKEN);
                  sendParams.append("v", "5.199");
                  sendParams.append("user_id", String(userId));
                  sendParams.append(
                    "random_id",
                    String(Math.floor(Math.random() * 2147483647)),
                  );
                  sendParams.append("attachment", attachment);
                  if (cap) sendParams.append("message", cap);

                  // VK поддерживает attachment + keyboard в одном сообщении!
                  if (opts?.reply_markup?.inline_keyboard) {
                    const vkKb = translateKb(opts);
                    if (vkKb) sendParams.append("keyboard", vkKb);
                  }

                  log.info(`[VK PHOTO EVENT] Sending photo`, {
                    attachment,
                    hasAccessKey: !!savedPhoto.access_key,
                    hasKeyboard: !!opts?.reply_markup?.inline_keyboard,
                  });

                  const sendResp = await fetch(
                    "https://api.vk.com/method/messages.send",
                    { method: "POST", body: sendParams },
                  );
                  const sendResult = await sendResp.json();
                  if (sendResult.error) {
                    log.warn(`[VK PHOTO EVENT] Send error`, sendResult.error);
                    throw new Error(
                      `VK send error: ${sendResult.error.error_msg}`,
                    );
                  }

                  log.info(`[VK PHOTO EVENT] Photo + keyboard sent`, {
                    photoId: savedPhoto.id,
                    msgId: sendResult.response,
                  });
                  return;
                }
              }
            } catch (e) {
              log.warn("[VK PHOTO EVENT] Upload failed:", e.message);
            }

            // Фолбэк: просто текст
            await vkCtx.reply(`${cap}\n\n${photoUrl}`, opts);
          },
          editMessageText: async () => {},
          editMessageCaption: async () => {},
          answerCbQuery: async () => {},
        };

        const vkToken = "VK_CENTRAL_GROUP";

        // Выполняем callback
        if (callbackData?.startsWith("ENTER_SECRET_")) {
          const level = callbackData.split("_")[2];
          vkUser.state = `WAIT_SECRET_${level}`;
          await ydb.saveUser(vkUser);
          return await vkCtx.reply(
            `✍️ ВВОД КОДА: МОДУЛЬ ${level}\n\nОтправь мне секретное слово:`,
            {},
          );
        }

        if (callbackData === "CLICK_REG_ID") {
          if (vkUser.sh_user_id && vkUser.sh_ref_tail)
            return await renderStep(vkCtx, "REGISTRATION_EXIST", vkToken);
          vkUser.state = "WAIT_REG_ID";
          await ydb.saveUser(vkUser);
          return await vkCtx.reply(
            "✍️ Введи ТВОЙ цифровой ID\n\nПришли мне номер, который ты получил в личном кабинете SetHubble после регистрации (например: 1234).",
            {},
          );
        }
        if (callbackData === "FORCE_REG_UPDATE") {
          vkUser.state = "WAIT_REG_ID";
          await ydb.saveUser(vkUser);
          return await vkCtx.reply(
            "✍️ Обновление данных\n\nХорошо, введи новый цифровой ID:",
            {},
          );
        }
        if (
          callbackData === "SETUP_BOT_START" ||
          callbackData === "CHANGE_BOT_TOKEN"
        ) {
          // В центральном VK боте нечего менять — показываем статус
          return await renderStep(vkCtx, "MY_AI_BOT", vkToken);
        }
        if (callbackData === "CONFIRM_UPGRADE") {
          if (!vkUser.session.tags.includes("seen_plans"))
            vkUser.session.tags.push("seen_plans");
          await ydb.saveUser(vkUser);
          return await renderStep(vkCtx, "UPGRADE_CONFIRMED", vkToken);
        }
        if (callbackData === "RESTART_FUNNEL") {
          vkUser.saved_state = "";
          vkUser.state = "START";
          vkUser.reminders_count = 0;
          vkUser.last_reminder_time = 0;
          vkUser.session = {
            tags: vkUser.session?.tags || [],
            last_activity: Date.now(),
          };
          await ydb.saveUser(vkUser);
          return await renderStep(vkCtx, "START", vkToken);
        }
        if (callbackData === "MAIN_MENU") {
          vkUser.reminders_count = 0;
          vkUser.last_reminder_time = 0;
          return await renderStep(vkCtx, "MAIN_MENU", vkToken);
        }
        if (callbackData === "RESUME_LAST") {
          return await renderStep(
            vkCtx,
            vkUser.saved_state || "START",
            vkToken,
          );
        }
        if (callbackData === "LOCKED_NEED_ID")
          return await renderStep(vkCtx, "LOCKED_TRAINING_INFO", vkToken);
        if (callbackData === "LOCKED_NEED_PRO")
          return await renderStep(vkCtx, "LOCKED_CRM_INFO", vkToken);
        if (callbackData === "LOCKED_NEED_TRAINING")
          return await renderStep(vkCtx, "LOCKED_PRO_TRAINING_INFO", vkToken);
        if (callbackData === "LOCKED_NEED_PLANS")
          return await renderStep(vkCtx, "LOCKED_PLANS_INFO", vkToken);
        if (callbackData === "CONTINUE_WITH_CURRENT_BOT") {
          vkUser.state = "Module_3_Offline";
          await ydb.saveUser(vkUser);
          return await renderStep(vkCtx, "Module_3_Offline", vkToken);
        }
        if (callbackData === "CREATE_NEW_BOT") {
          vkUser.state = "WAIT_BOT_TOKEN";
          vkUser.saved_state = "";
          await ydb.saveUser(vkUser);
          return await vkCtx.reply(
            "🔄 СОЗДАНИЕ НОВОГО БОТА\n\nПришли мне API TOKEN нового бота из @BotFather.",
            {},
          );
        }
        if (callbackData === "THEORY_COURSE_COMPLETE") {
          if (!vkUser.session.theory_complete) {
            vkUser.session.theory_complete = true;
            vkUser.session.xp = (vkUser.session.xp || 0) + 10;
            await ydb.saveUser(vkUser);
          }
          return await renderStep(vkCtx, "Theory_Reward_Spoilers", vkToken);
        }
        if (callbackData === "USE_EXISTING_DATA") {
          vkUser.session.tmp_shui = vkUser.sh_user_id;
          vkUser.session.tmp_shrt = vkUser.sh_ref_tail;
          vkUser.state = "WAIT_PARTNER_REG";
          await ydb.saveUser(vkUser);
          return await vkCtx.reply(
            `✅ ДАННЫЕ ПОДТВЕРЖДЕНЫ\n\n🎯 Перейди по ссылке для регистрации и напиши "готов"`,
            {},
          );
        }
        if (callbackData === "ENTER_NEW_DATA") {
          vkUser.state = "WAIT_SH_ID_P";
          await ydb.saveUser(vkUser);
          return await vkCtx.reply(
            "✏️ Пришли НОВЫЙ цифровой ID для этого бота:",
            {},
          );
        }
        if (callbackData === "EDIT_PROFILE")
          return await renderStep(vkCtx, "EDIT_PROFILE", vkToken);
        if (callbackData === "GO_TO_MODULE_2")
          return await renderStep(vkCtx, "Module_2_Online", vkToken);
        if (callbackData === "GO_TO_MODULE_3")
          return await renderStep(vkCtx, "Module_3_Offline", vkToken);
        if (callbackData === "GO_TO_FINAL")
          return await renderStep(vkCtx, "Lesson_Final_Comparison", vkToken);

        if (scenarioVK.steps[callbackData]) {
          log.info(`[VK] renderStep via scenarioVK.steps`, {
            callbackData,
            userState: vkUser.state,
            userId: vkUser.user_id,
          });
          const navSteps = [
            "START",
            "RESUME_GATE",
            "MAIN_MENU",
            "Pre_Training_Logic",
            "EDIT_PROFILE",
          ];
          if (!navSteps.includes(vkUser.state))
            vkUser.saved_state = vkUser.state;
          vkUser.session.last_vk_step = callbackData;
          await ydb.saveUser(vkUser);
          log.info(`[VK] Calling renderStep`, { step: callbackData });
          try {
            return await renderStep(vkCtx, callbackData, vkToken);
          } catch (renderErr) {
            log.error(`[VK] renderStep FAILED`, renderErr);
            await vkCtx.reply(
              `⚡ Ошибка при обработке шага "${callbackData}". Попробуй ещё раз или напиши /menu`,
            );
          }
        }

        return { statusCode: 200, body: "ok" };
      }

      if (payload.type === "message_new") {
        const message = payload.object.message;
        const vkUserId = `vk:${message.from_id}`;

        const vkUpdateId = `${message.from_id}_${message.conversation_message_id || message.id || message.date}`;
        if (processedUpdates.has(vkUpdateId)) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/plain" },
            body: "ok",
          };
        }
        processedUpdates.set(vkUpdateId, Date.now());

        const text = message.text || "";
        // v6.0: Ищем по vk_id (без префиксов)
        let vkUser = await ydb.findUser({ vk_id: vkUserId });

        // v6.0: Auto-detect channels from DB columns
        if (vkUser) {
          channelManager.autoDetectChannels(vkUser);
        }

        if (!vkUser || typeof vkUser !== "object" || !vkUser.id) {
          let partnerId = process.env.MY_PARTNER_ID || "p_qdr";

          // v5.0: Поддержка partner_id из разных источников
          // 0. Из VK deep link (message.ref при переходе по ссылке vk.me/club?ref=xxx)
          if (message.ref) {
            partnerId = message.ref;
            log.info(`[VK REF] Caught referral from deep link:`, { partnerId });
          }
          // 1. Из message.payload (JSON с command или ref)
          else if (message.payload) {
            try {
              const parsedPayload = JSON.parse(message.payload);
              if (parsedPayload.command) {
                partnerId = parsedPayload.command;
              } else if (parsedPayload.ref) {
                partnerId = parsedPayload.ref;
              }
            } catch (e) {}
          }

          // 2. Из текста сообщения (если пользователь ввёл ref-хвост вручную)
          if (partnerId === (process.env.MY_PARTNER_ID || "p_qdr")) {
            const refMatch = text.match(/^([a-zA-Z0-9_]+)$/);
            if (refMatch && refMatch[1].length > 1) partnerId = refMatch[1];
          }

          let firstName = "VK Lead";
          if (process.env.VK_GROUP_TOKEN) {
            try {
              const url = `https://api.vk.com/method/users.get?user_ids=${message.from_id}&access_token=${process.env.VK_GROUP_TOKEN}&v=5.199`;
              const resp = await fetch(url);
              const data = await resp.json();
              if (data.response && data.response[0])
                firstName = data.response[0].first_name;
            } catch (e) {}
          }

          vkUser = {
            vk_id: vkUserId,
            partner_id: partnerId,
            state: "START",
            bought_tripwire: false,
            session: {
              source: "vkontakte",
              last_activity: Date.now(),
              tags: [],
            },
            last_seen: Date.now(),
            bot_token: "VK_CENTRAL_GROUP",
            tariff: "",
            sh_user_id: "",
            sh_ref_tail: "",
            purchases: [],
            first_name: firstName,
            reminders_count: 0,
            last_reminder_time: 0,
          };
          const result = await ydb.saveUser(vkUser);
          vkUser.id = result.id;
          log.info(`[VK] New user created`, {
            vkId: vkUserId,
            userId: result.id,
            partnerId,
          });
        }

        if (!vkUser.session || typeof vkUser.session !== "object")
          vkUser.session = { tags: [], source: "vkontakte" };
        vkUser.session.last_activity = Date.now();
        vkUser.last_seen = Date.now();

        // === DEBUG: Логируем состояние пользователя ===
        log.info(`[VK] User state`, {
          userId: vkUserId,
          state: vkUser.state,
          shUserId: vkUser.sh_user_id,
          shRefTail: vkUser.sh_ref_tail,
          boughtTripwire: vkUser.bought_tripwire,
        });

        let callbackData = null;
        if (message.payload) {
          try {
            const parsed = JSON.parse(message.payload);
            log.info(`[VK] Parsed payload`, { parsed });
            if (parsed.callback_data) callbackData = parsed.callback_data;
          } catch (e) {
            log.warn(`[VK] Failed to parse payload`, {
              rawPayload: message.payload,
              error: e.message,
            });
            // VK может отправлять callback_data напрямую как строку
            callbackData = message.payload;
          }
        } else {
          log.warn(`[VK] No payload in message`, {
            text,
            hasPayload: !!message.payload,
          });
        }

        const translateKeyboard = (tgOpts, addMainMenu = true) => {
          if (
            !tgOpts ||
            !tgOpts.reply_markup ||
            !tgOpts.reply_markup.inline_keyboard
          )
            return null;
          const vkButtonsArr = tgOpts.reply_markup.inline_keyboard.map(
            (row) => {
              return row
                .map((btn) => {
                  const cbData = btn.callback_data || btn.callback;
                  if (btn.url)
                    return {
                      action: {
                        type: "open_link",
                        link: btn.url,
                        label: btn.text.substring(0, 40),
                      },
                    };
                  else if (btn.web_app?.url)
                    return {
                      action: {
                        type: "open_link",
                        link: btn.web_app.url,
                        label: btn.text.substring(0, 40),
                      },
                    };
                  else if (cbData)
                    return {
                      action: {
                        type: "callback",
                        payload: JSON.stringify({
                          callback_data: cbData,
                        }),
                        label: btn.text.substring(0, 40),
                      },
                      color: "default",
                    };
                  return null;
                })
                .filter(Boolean);
            },
          );
          return JSON.stringify({ inline: true, buttons: vkButtonsArr });
        };

        const vkCtx = {
          isVk: true, // МАРКЕР ДЛЯ ОТКЛЮЧЕНИЯ "ВЫБРАНО"
          from: { id: message.from_id },
          message: { text: text },
          dbUser: vkUser,
          callbackQuery: callbackData
            ? {
                data: callbackData,
                message: { text: text, caption: text, reply_markup: null },
              }
            : null,
          telegram: { sendChatAction: async () => {} },
          reply: async (replyText, opts = {}) => {
            const params = new URLSearchParams();
            params.append("access_token", process.env.VK_GROUP_TOKEN);
            params.append("v", "5.199");
            params.append("user_id", String(message.from_id));
            params.append(
              "random_id",
              String(Math.floor(Math.random() * 2147483647)),
            );

            let finalMessage = replyText || "";
            if (opts.caption) finalMessage = opts.caption;

            // --- УБИРАЕМ HTML ТЕГИ ДЛЯ ВК ---
            finalMessage = finalMessage.replace(/<[^>]*>?/gm, "");
            params.append("message", finalMessage);

            const vkKb = translateKeyboard(opts);
            if (vkKb) {
              params.append("keyboard", vkKb);
            } else {
              // Persistent main menu keyboard
              const mainMenuKb = getVkMainMenuKeyboard(vkUser, message.from_id);
              params.append("keyboard", mainMenuKb);
            }

            try {
              await fetch("https://api.vk.com/method/messages.send", {
                method: "POST",
                body: params,
              });
            } catch (sendErr) {}
          },
          replyWithPhoto: async (photoUrl, opts = {}) => {
            let captionText = opts.caption || "";
            captionText = captionText.replace(/<[^>]*>?/gm, "");

            try {
              // Скачиваем фото
              log.info(`[VK PHOTO] Downloading photo`, { url: photoUrl });
              const photoResp = await fetch(photoUrl);
              if (!photoResp.ok) throw new Error(`HTTP ${photoResp.status}`);
              const photoBuffer = Buffer.from(await photoResp.arrayBuffer());
              log.info(`[VK PHOTO] Downloaded`, { size: photoBuffer.length });

              // Получаем URL для загрузки
              const uploadResp = await fetch(
                `https://api.vk.com/method/photos.getMessagesUploadServer?access_token=${process.env.VK_GROUP_TOKEN}&v=5.199`,
              );
              const uploadData = await uploadResp.json();
              const uploadUrl = uploadData.response?.upload_url;
              if (!uploadUrl) {
                log.warn(`[VK PHOTO] No upload URL from VK API`, {
                  uploadData: JSON.stringify(uploadData).substring(0, 300),
                });
                throw new Error("No upload URL");
              }
              log.info(`[VK PHOTO] Got upload URL`);

              // Загружаем фото через multipart/form-data (ручное формирование без form-data пакета)
              const boundary = `----VKBoundary${Math.random().toString(36).slice(2)}`;
              const header = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
              const footer = `\r\n--${boundary}--\r\n`;
              const formBuffer = Buffer.concat([
                Buffer.from(header),
                photoBuffer,
                Buffer.from(footer),
              ]);
              const contentType = `multipart/form-data; boundary=${boundary}`;

              const upResp = await fetch(uploadUrl, {
                method: "POST",
                headers: { "Content-Type": contentType },
                body: formBuffer,
              });
              const uploadResult = await upResp.json();
              log.info(`[VK PHOTO] Upload result`, {
                status: upResp.status,
                hasPhoto: !!uploadResult.photo,
                hasServer: !!uploadResult.server,
                hasHash: !!uploadResult.hash,
                error: uploadResult.error || null,
              });

              if (
                uploadResult.photo &&
                uploadResult.server &&
                uploadResult.hash
              ) {
                // Сохраняем фото
                const saveResp = await fetch(
                  `https://api.vk.com/method/photos.saveMessagesPhoto?access_token=${process.env.VK_GROUP_TOKEN}&v=5.199&server=${uploadResult.server}&photo=${uploadResult.photo}&hash=${uploadResult.hash}`,
                  { method: "POST" },
                );
                const saveData = await saveResp.json();
                const savedPhoto = saveData.response?.[0];

                if (savedPhoto?.id) {
                  // Формат: photo{owner_id}_{media_id} (access_key не нужен для своих фото)
                  const attachment = `photo${savedPhoto.owner_id}_${savedPhoto.id}`;
                  const sendParams = new URLSearchParams();
                  sendParams.append("access_token", process.env.VK_GROUP_TOKEN);
                  sendParams.append("v", "5.199");
                  sendParams.append("user_id", String(message.from_id));
                  sendParams.append(
                    "random_id",
                    String(Math.floor(Math.random() * 2147483647)),
                  );
                  sendParams.append("attachment", attachment);
                  if (captionText) sendParams.append("message", captionText);

                  // Keyboard в том же сообщении
                  if (opts?.reply_markup?.inline_keyboard) {
                    const vkKb = translateKeyboard(opts);
                    if (vkKb) sendParams.append("keyboard", vkKb);
                  }

                  log.info(`[VK PHOTO] Sending photo + caption + keyboard`, {
                    attachment,
                    captionLength: captionText?.length || 0,
                    hasKeyboard: !!opts?.reply_markup?.inline_keyboard,
                  });

                  const sendResp = await fetch(
                    "https://api.vk.com/method/messages.send",
                    { method: "POST", body: sendParams },
                  );
                  const sendResult = await sendResp.json();
                  if (sendResult.error) {
                    log.warn(`[VK PHOTO] Send error`, sendResult.error);
                    throw new Error(
                      `VK send error: ${sendResult.error.error_msg}`,
                    );
                  }

                  log.info(`[VK] Photo + keyboard sent`, {
                    msgId: sendResult.response,
                  });
                  return;
                }
              }
            } catch (e) {
              log.warn("[VK] Photo upload failed:", e.message, {
                photoUrl,
                stack: e.stack,
              });
            }

            // Фолбэк: просто текст (без фото)
            log.info(`[VK PHOTO] Fallback to text`, { photoUrl });
            await vkCtx.reply(captionText, opts);
          },
          editMessageText: async (replyText, opts = {}) =>
            await vkCtx.reply(replyText, opts),
          editMessageCaption: async (replyText, opts = {}) =>
            await vkCtx.reply(replyText, opts),
          answerCbQuery: async () => {},
        };

        // Оборачиваем логику в функцию для гарантированного возврата 200 OK
        const runVkRouter = async () => {
          try {
            const vkToken = "VK_CENTRAL_GROUP";
            const txt = (text || "").trim();

            // === МАРШРУТИЗАЦИЯ ТЕКСТОВЫХ КНОПОК ГЛАВНОГО МЕНЮ ===
            // Пользователь нажал текстовую кнопку в persistent keyboard
            const textBtnRoutes = {
              "📊 СТАТИСТИКА": "VK_STATISTIKA",
              "📞 ПОДДЕРЖКА": "SUPPORT_ASK",
            };
            if (textBtnRoutes[txt]) {
              log.info(
                `[VK] Text button pressed: ${txt} -> ${textBtnRoutes[txt]}`,
              );
              callbackData = textBtnRoutes[txt];
            }

            log.info(`[VK ROUTER] Enter`, {
              callbackData,
              text: txt,
              userState: vkUser.state,
            });

            if (callbackData) {
              if (callbackData.startsWith("ENTER_SECRET_")) {
                const level = callbackData.split("_")[2];
                vkUser.state = `WAIT_SECRET_${level}`;
                await ydb.saveUser(vkUser);
                return await vkCtx.reply(
                  `✍️ ВВОД КОДА: МОДУЛЬ ${level}\n\nОтправь мне секретное слово:`,
                );
              }
              switch (callbackData) {
                case "apps_menu":
                  return await vkCtx.reply(
                    "🎒 ИИ-ПРИЛОЖЕНИЯ\n\nДоступны в PRO-режиме. Подробности на сайте.",
                  );
                case "GO_TO_MODULE_2":
                  return await renderStep(vkCtx, "Module_2_Online", vkToken);
                case "GO_TO_MODULE_3":
                case "Module_3_Offline":
                  return await renderStep(vkCtx, "Module_3_Offline", vkToken);
                case "GO_TO_FINAL":
                  return await renderStep(
                    vkCtx,
                    "Lesson_Final_Comparison",
                    vkToken,
                  );
                case "CHANGE_BOT_TOKEN":
                  vkUser.state = "WAIT_BOT_TOKEN";
                  vkUser.session.old_bot_token = vkUser.bot_token;
                  vkUser.saved_state = "";
                  vkUser.session.is_changing_token = true;
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    "🔄 ИЗМЕНЕНИЕ ТОКЕНА БОТА\n\nПришли мне НОВЫЙ API TOKEN из @BotFather.",
                  );
                case "CONTINUE_WITH_CURRENT_BOT":
                  vkUser.state = "Module_3_Offline";
                  await ydb.saveUser(vkUser);
                  return await renderStep(vkCtx, "Module_3_Offline", vkToken);
                case "CREATE_NEW_BOT":
                  vkUser.state = "WAIT_BOT_TOKEN";
                  vkUser.saved_state = "";
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    "🔄 СОЗДАНИЕ НОВОГО БОТА\n\nПришли мне API TOKEN нового бота из @BotFather.",
                  );
                case "THEORY_COURSE_COMPLETE":
                  if (!vkUser.session.theory_complete) {
                    vkUser.session.theory_complete = true;
                    vkUser.session.xp = (vkUser.session.xp || 0) + 10;
                    await ydb.saveUser(vkUser);
                  }
                  return await renderStep(
                    vkCtx,
                    "Theory_Reward_Spoilers",
                    vkToken,
                  );
                case "USE_EXISTING_DATA":
                  vkUser.session.tmp_shui = vkUser.sh_user_id;
                  vkUser.session.tmp_shrt = vkUser.sh_ref_tail;
                  vkUser.state = "WAIT_PARTNER_REG";
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    `✅ ДАННЫЕ ПОДТВЕРЖДЕНЫ\n\n🎯 Перейди по ссылке для регистрации и напиши "готов"`,
                  );
                case "ENTER_NEW_DATA":
                  vkUser.state = "WAIT_SH_ID_P";
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    "✏️ Пришли НОВЫЙ цифровой ID для этого бота:",
                  );
                case "EDIT_PROFILE":
                  return await renderStep(vkCtx, "EDIT_PROFILE", vkToken);

                // === РЕГИСТРАЦИЯ И НАВИГАЦИЯ ===
                case "CLICK_REG_ID":
                  log.info(`[VK] CLICK_REG_ID clicked`, {
                    currentShUserId: vkUser.sh_user_id,
                    currentShRefTail: vkUser.sh_ref_tail,
                  });
                  if (vkUser.sh_user_id && vkUser.sh_ref_tail)
                    return await renderStep(
                      vkCtx,
                      "REGISTRATION_EXIST",
                      vkToken,
                    );
                  vkUser.state = "WAIT_REG_ID";
                  log.info(`[VK] Setting state to WAIT_REG_ID`, {
                    userId: vkUser.user_id,
                  });
                  await ydb.saveUser(vkUser);
                  log.info(`[VK] saveUser completed`, {
                    userId: vkUser.user_id,
                    savedState: "WAIT_REG_ID",
                  });
                  return await vkCtx.reply(
                    "✍️ <b>Введи ТВОЙ цифровой ID</b>\n\nПришли мне номер, который ты получил в личном кабинете SetHubble после регистрации (например: 1234).",
                    {},
                  );
                case "FORCE_REG_UPDATE":
                  vkUser.state = "WAIT_REG_ID";
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    "✍️ <b>Обновление данных</b>\n\nХорошо, введи новый цифровой ID:",
                    {},
                  );
                case "SETUP_BOT_START":
                  vkUser.state = "WAIT_BOT_TOKEN";
                  if (vkUser.bot_token) vkUser.session.is_changing_token = true;
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    "🚀 <b>НАСТРОЙКА БОТА-КЛОНА</b>\n\nПришли мне <b>API TOKEN</b> твоего бота из @BotFather.",
                    {},
                  );
                case "CONFIRM_UPGRADE":
                  if (!vkUser.session.tags.includes("seen_plans"))
                    vkUser.session.tags.push("seen_plans");
                  await ydb.saveUser(vkUser);
                  return await renderStep(vkCtx, "UPGRADE_CONFIRMED", vkToken);
                case "RESTART_FUNNEL":
                  vkUser.saved_state = "";
                  vkUser.state = "START";
                  vkUser.reminders_count = 0;
                  vkUser.last_reminder_time = 0;
                  vkUser.session = {
                    tags: vkUser.session?.tags || [],
                    last_activity: Date.now(),
                    bot_username: vkUser.session?.bot_username,
                    old_bot_token: vkUser.session?.old_bot_token,
                    ai_count: vkUser.session?.ai_count,
                    ai_date: vkUser.session?.ai_date,
                  };
                  await ydb.saveUser(vkUser);
                  return await renderStep(vkCtx, "START", vkToken);
                case "MAIN_MENU":
                  vkUser.reminders_count = 0;
                  vkUser.last_reminder_time = 0;
                  return await renderStep(vkCtx, "MAIN_MENU", vkToken);
                case "RESUME_LAST":
                  return await renderStep(
                    vkCtx,
                    vkUser.saved_state || "START",
                    vkToken,
                  );
                case "LOCKED_NEED_ID":
                  return await renderStep(
                    vkCtx,
                    "LOCKED_TRAINING_INFO",
                    vkToken,
                  );
                case "LOCKED_NEED_PRO":
                  return await renderStep(vkCtx, "LOCKED_CRM_INFO", vkToken);
                case "LOCKED_NEED_TRAINING":
                  return await renderStep(
                    vkCtx,
                    "LOCKED_PRO_TRAINING_INFO",
                    vkToken,
                  );
                case "LOCKED_NEED_PLANS":
                  return await renderStep(vkCtx, "LOCKED_PLANS_INFO", vkToken);
                case "PROMO_KIT": {
                  const botName =
                    vkUser.session?.bot_username || "sethubble_biz_bot";
                  const apiGw =
                    process.env.API_GW_HOST ||
                    "d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net";
                  const promoKitUrl =
                    process.env.PROMO_KIT_URL ||
                    "https://novokreschennih.github.io/neurogen-promo-kit/";
                  const mod3Param =
                    vkUser.session?.mod3_done || vkUser.bought_tripwire
                      ? "&mod3=1"
                      : "";
                  return await vkCtx.reply(
                    `🚀 <b>Promo-Kit</b>\n\nТвой генератор маркетинговых материалов:\n${promoKitUrl}?bot=${botName}&api=https://${apiGw}${mod3Param}`,
                    {},
                  );
                }
                case "REMINDER_1H_RESUME":
                case "REMINDER_3H_RESUME":
                case "REMINDER_24H_RESUME":
                case "REMINDER_48H_RESUME":
                  return await renderStep(
                    vkCtx,
                    vkUser.saved_state || "START",
                    vkToken,
                  );

                // === MULTI_CHANNEL: Выбор дополнительных каналов ===
                case "MULTI_CHANNEL_SELECT":
                  return await renderStep(
                    vkCtx,
                    "MULTI_CHANNEL_SELECT",
                    vkToken,
                  );
                case "MULTI_CHANNEL_TG":
                  // Пользователь VK хочет подключить Telegram
                  vkUser.state = "WAIT_TG_SETUP";
                  await ydb.saveUser(vkUser);
                  return await vkCtx.reply(
                    `📱 <b>ПОДКЛЮЧЕНИЕ TELEGRAM</b>\n\n` +
                      `Чтобы подключить Telegram:\n\n` +
                      `1️⃣ Открой бота @BotFather в Telegram\n` +
                      `2️⃣ Отправь /newbot (или используй существующего)\n` +
                      `3️⃣ Скопируй токен бота\n` +
                      `4️⃣ Отправь токен сюда сообщением\n\n` +
                      `<i>Токен выглядит так: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz</i>`,
                    {},
                  );
                case "CHANNEL_SETUP_VK":
                  vkUser.state = "WAIT_VK_GROUP_ID";
                  await ydb.saveUser(vkUser);
                  return await renderStep(vkCtx, "CHANNEL_SETUP_VK", vkToken);
                case "CHANNEL_SETUP_WEB":
                  return await renderStep(vkCtx, "CHANNEL_SETUP_WEB", vkToken);
                case "CHANNEL_SETUP_EMAIL":
                  const email = vkUser.session?.email;
                  if (!email) {
                    vkUser.state = "WAIT_EMAIL_INPUT";
                    await ydb.saveUser(vkUser);
                    return await vkCtx.reply(
                      "📧 Введи свой email для подключения рассылки:",
                      {},
                    );
                  }
                  return await renderStep(
                    vkCtx,
                    "CHANNEL_SETUP_EMAIL",
                    vkToken,
                  );
                case "CHANNEL_SKIPPED":
                  return await renderStep(vkCtx, "CHANNEL_SKIPPED", vkToken);
                case "CHANNEL_SETUP_COMPLETE":
                  channelManager.configureChannel(vkUser, "vk", {
                    enabled: true,
                    configured: true,
                    configured_at: Date.now(),
                  });
                  await ydb.saveUser(vkUser);
                  return await renderStep(
                    vkCtx,
                    "CHANNEL_SETUP_COMPLETE",
                    vkToken,
                  );
                case "VK_HELP":
                  return await vkCtx.reply(
                    `❓ <b>Как найти ID сообщества VK:</b>\n\n` +
                      `1️⃣ Открой своё сообщество VK\n` +
                      `2️⃣ Нажми «Управление»\n` +
                      `3️⃣ В адресной строке увидишь: vk.com/club<b>123456789</b>\n` +
                      `4️⃣ Число после "club" — это и есть ID\n\n` +
                      `Или: «Управление» → «Работа с API» → ID указан там.\n\n` +
                      `Напиши ID (только цифры):`,
                    {},
                  );

                // === KEYWORD COMMANDS (аналоги команд Telegram) ===
                case "VK_STATS":
                case "VK_STATISTIKA":
                  // Аналог /stats
                  const stats = await ydb.getPartnerStats(message.from_id);
                  return await vkCtx.reply(
                    `📊 <b>ТВОЯ СТАТИСТИКА</b>\n\n` +
                      `👥 Всего в сети: ${stats.total || 0}\n` +
                      `💰 Оплатили: ${stats.sales || 0}\n` +
                      `🪙 NeuroCoins: ${vkUser.session?.xp || 0}\n\n` +
                      `${vkUser.bought_tripwire ? "✅ PRO-статус активен" : "🔒 Для CRM нужен PRO-статус"}`,
                    {},
                  );
                case "VK_TOOLS":
                case "VK_INSTRUMENTY":
                  // Аналог /tools
                  return await renderStep(vkCtx, "TOOLS_MENU", vkToken);
                case "VK_MENU":
                  // Аналог /menu
                  vkUser.reminders_count = 0;
                  vkUser.last_reminder_time = 0;
                  return await renderStep(vkCtx, "MAIN_MENU", vkToken);
              }
              if (scenarioVK.steps[callbackData]) {
                const navSteps = [
                  "START",
                  "RESUME_GATE",
                  "MAIN_MENU",
                  "Pre_Training_Logic",
                  "EDIT_PROFILE",
                ];
                if (!navSteps.includes(vkUser.state))
                  vkUser.saved_state = vkUser.state;
                vkUser.session.last_vk_step = callbackData;
                await ydb.saveUser(vkUser);
                return await renderStep(vkCtx, callbackData, vkToken);
              }
              return await vkCtx.reply(
                "⚡ Система обрабатывает твой запрос...",
              );
            }

            if (
              txt.toLowerCase() === "старт" ||
              txt.toLowerCase() === "/start" ||
              txt.toLowerCase() === "начать"
            ) {
              vkUser.state = "START";
              await ydb.saveUser(vkUser);
              return await renderStep(vkCtx, "START", vkToken);
            }

            // === KEYWORD COMMANDS (текстовые команды) ===
            if (
              txt.toLowerCase() === "статистика" ||
              txt.toLowerCase() === "стата"
            ) {
              const stats = await ydb.getPartnerStats(message.from_id);
              return await vkCtx.reply(
                `📊 <b>ТВОЯ СТАТИСТИКА</b>\n\n` +
                  `👥 Всего в сети: ${stats.total || 0}\n` +
                  `💰 Оплатили: ${stats.sales || 0}\n` +
                  `🪙 NeuroCoins: ${vkUser.session?.xp || 0}\n\n` +
                  `${vkUser.bought_tripwire ? "✅ PRO-статус активен" : "🔒 Для CRM нужен PRO-статус"}`,
                {},
              );
            }
            if (
              txt.toLowerCase() === "инструменты" ||
              txt.toLowerCase() === "tools"
            ) {
              return await renderStep(vkCtx, "TOOLS_MENU", vkToken);
            }
            if (txt.toLowerCase() === "меню" || txt.toLowerCase() === "menu") {
              vkUser.reminders_count = 0;
              vkUser.last_reminder_time = 0;
              return await renderStep(vkCtx, "MAIN_MENU", vkToken);
            }

            // === ОБРАБОТКА ВВОДА В СОСТОЯНИЯХ ОЖИДАНИЯ ===
            if (vkUser.state === "WAIT_REG_ID") {
              log.info(`[VK] WAIT_REG_ID input`, {
                txt,
                userId: vkUser.user_id,
              });
              if (isNaN(txt))
                return await vkCtx.reply("❌ Пришли только цифры.", {});
              vkUser.sh_user_id = txt;
              vkUser.state = "WAIT_REG_TAIL";
              await ydb.saveUser(vkUser);
              return await vkCtx.reply(
                "✅ Принято! Теперь скопируй и пришли свою <b>Ссылку для приглашений</b> полностью (например: https://sethubble.com/ru/p_xyt):",
                {},
              );
            }

            if (vkUser.state === "WAIT_REG_TAIL") {
              let tail = txt.trim();
              if (tail.includes("sethubble.com")) {
                tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
              }
              vkUser.sh_ref_tail = tail;
              vkUser.state = "Training_Main";
              await ydb.saveUser(vkUser);
              await vkCtx.reply(
                "✨ <b>Аккаунт привязан!</b>\n\nЯ открыл для тебя доступ к материалам. В Главном Меню теперь разблокирован раздел «Обучение».\n\nА сейчас переходим сразу к делу 👇",
                {},
              );
              return await renderStep(vkCtx, "Training_Main", vkToken);
            }

            if (vkUser.state === "WAIT_SH_ID_P") {
              vkUser.session.tmp_shui = txt;
              vkUser.state = "WAIT_SH_TAIL_P";
              await ydb.saveUser(vkUser);
              return await vkCtx.reply(
                "Пришли свою ссылку для приглашений полностью (например: https://sethubble.com/ru/p_xyt):",
                {},
              );
            }

            if (vkUser.state === "WAIT_SH_TAIL_P") {
              let tail = txt.trim();
              if (tail.includes("sethubble.com")) {
                tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
              }
              vkUser.session.tmp_shrt = tail;
              await ydb.saveUser(vkUser);

              const productId = vkUser.bought_tripwire
                ? process.env.PRODUCT_ID_PRO || "103_97999"
                : process.env.PRODUCT_ID_FREE || "140_9d5d2";

              const info = await ydb.getBotInfo("VK_CENTRAL_GROUP");
              const partnerId = info?.sh_user_id || "1123";
              const regLink = `https://sethubble.com/ru/?s=${productId}&afid=${partnerId}`;
              vkUser.state = "WAIT_PARTNER_REG";
              await ydb.saveUser(vkUser);

              return await vkCtx.reply(
                `🎯 <b>ШАГ 3: СТАНЬ ПАРТНЁРОМ PROДУКТА</b>\n\n` +
                  `Чтобы ты мог получать деньги с продаж, тебе нужно добавить этот продукт в свой личный кабинет SetHubble.\n\n` +
                  `<b>ЧТО ДЕЛАТЬ:</b>\n` +
                  `1. Перейди по ссылке своего пригласителя:\n` +
                  `<a href="${regLink}">${regLink}</a>\n\n` +
                  `2. Зарегистрируйся/войди в свой аккаунт\n` +
                  `3. Продукт автоматически добавится в твой кабинет\n\n` +
                  `<i>💡 Это займёт 1-2 минуты. После регистрации вернись в бота и напиши любое слово (например, "готов"):</i>`,
                {},
              );
            }

            if (vkUser.state === "WAIT_PARTNER_REG") {
              // Пользователь написал любое слово после регистрации
              const shUserId = vkUser.session.tmp_shui;
              const shRefTail = vkUser.session.tmp_shrt;

              vkUser.sh_user_id = shUserId;
              vkUser.sh_ref_tail = shRefTail;
              vkUser.saved_state = "";
              vkUser.state = "Module_3_Offline";
              await ydb.saveUser(vkUser);

              await vkCtx.reply(
                `🎉 Данные сохранены! Переходим к следующему шагу 👇`,
                {},
              );
              return await renderStep(vkCtx, "Module_3_Offline", vkToken);
            }

            // === MULTI_CHANNEL: Настройка VK сообщества ===
            if (vkUser.state === "WAIT_VK_GROUP_ID") {
              if (isNaN(txt))
                return await vkCtx.reply(
                  "❌ ID сообщества — только цифры. Попробуй ещё раз:",
                  {},
                );
              channelManager.enableChannel(vkUser, "vk");
              channelManager.setChannelConfig(vkUser, "vk", {
                group_id: txt,
                enabled: true,
                configured: true,
                configured_at: Date.now(),
              });
              channelManager.setChannelState(
                vkUser,
                "vk",
                "CHANNEL_SETUP_VK_SUCCESS",
              );
              await ydb.saveUser(vkUser);
              return await renderStep(
                vkCtx,
                "CHANNEL_SETUP_VK_SUCCESS",
                vkToken,
              );
            }

            // === MULTI_CHANNEL: Настройка Telegram (из VK) ===
            if (vkUser.state === "WAIT_TG_SETUP") {
              const tokenMatch = txt.match(/^(\d+:[A-Za-z0-9_-]+)$/);
              if (!tokenMatch) {
                return await vkCtx.reply(
                  "❌ Это не похоже на токен бота. Токен должен быть в формате: 123456789:ABCdefGHIjkl...\n\nПопробуй ещё раз:",
                  {},
                );
              }
              channelManager.enableChannel(vkUser, "telegram");
              channelManager.setChannelConfig(vkUser, "telegram", {
                bot_token: txt,
                enabled: true,
                configured: true,
                configured_at: Date.now(),
              });
              channelManager.setChannelState(
                vkUser,
                "telegram",
                "CHANNEL_SETUP_TG_SUCCESS",
              );
              await ydb.saveUser(vkUser);
              return await renderStep(
                vkCtx,
                "CHANNEL_SETUP_TG_SUCCESS",
                vkToken,
              );
            }

            // === MULTI_CHANNEL: Ввод email ===
            if (vkUser.state === "WAIT_EMAIL_INPUT") {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(txt)) {
                return await vkCtx.reply(
                  "❌ Это не похоже на email. Попробуй ещё раз:",
                  {},
                );
              }

              // v6.0: Ищем пользователя по email для merge
              const emailRecord = await ydb.findUser({ email: txt });

              vkUser.email = txt;
              vkUser.session.email_verified = true;
              vkUser.session.channels = vkUser.session.channels || {};
              vkUser.session.channels.email = {
                enabled: true,
                configured: true,
                subscribed: true,
              };
              vkUser.session.channel_states = vkUser.session.channel_states || {};
              vkUser.session.channel_states.email = "START";
              await ydb.saveUser(vkUser);

              // v6.0: MERGE — если нашли другого пользователя с таким email
              if (emailRecord && emailRecord.id !== vkUser.id) {
                log.info("[VK] Merging email record into VK user", {
                  email: txt,
                  vkUserId: vkUser.id,
                  emailRecordId: emailRecord.id,
                });

                // Обновляем основной профиль: добавляем vk_id
                emailRecord.vk_id = vkUserId;
                emailRecord.session.channels = emailRecord.session.channels || {};
                emailRecord.session.channels.vk = {
                  enabled: true,
                  configured: true,
                  linked_at: Date.now(),
                };
                emailRecord.session.channel_states = emailRecord.session.channel_states || {};
                emailRecord.session.channel_states.vk = "START";

                // Мержим dialog_history
                if (vkUser.session?.dialog_history?.length) {
                  emailRecord.session.dialog_history = emailRecord.session.dialog_history || [];
                  emailRecord.session.dialog_history.push(
                    ...vkUser.session.dialog_history.slice(-10),
                  );
                  if (emailRecord.session.dialog_history.length > 20) {
                    emailRecord.session.dialog_history = emailRecord.session.dialog_history.slice(-20);
                  }
                }

                await ydb.mergeUsers(emailRecord, vkUser.id, "email_match");
                // vkUser теперь удалён, основной профиль — emailRecord
              }

              // Отправляем приветственное письмо
              if (sendEmail) {
                const { templates } =
                  await import("../../core/email/email_service.js");
                const tpl = templates.welcome(vkUser);
                await sendEmail({
                  to: txt,
                  subject: tpl.subject,
                  text: tpl.text,
                  html: tpl.html,
                });
              }

              return await renderStep(
                vkCtx,
                "CHANNEL_SETUP_EMAIL_SUCCESS",
                vkToken,
              );
            }

            // === СЕКРЕТНЫЕ СЛОВА ===
            const secretsConfig = {
              WAIT_SECRET_1: {
                word: "гибрид",
                xp: 20,
                next: "Module_2_Online",
                flag: "mod1_done",
                awardKey: "mod1_awarded",
              },
              WAIT_SECRET_2: {
                word: "облако",
                xp: 30,
                next: "WAIT_BOT_TOKEN",
                flag: "mod2_done",
                awardKey: "mod2",
              },
              WAIT_SECRET_3: {
                word: "сарафан",
                xp: 40,
                next: "Lesson_Final_Comparison",
                flag: "mod3_done",
                awardKey: "mod3_awarded",
              },
            };

            if (secretsConfig[vkUser.state]) {
              const config = secretsConfig[vkUser.state];
              if (txt.toLowerCase().trim() === config.word.toLowerCase()) {
                if (!vkUser.session.xp_awarded) vkUser.session.xp_awarded = {};
                const alreadyAwarded =
                  vkUser.session.xp_awarded[config.awardKey];

                if (!alreadyAwarded) {
                  vkUser.session.xp = (vkUser.session.xp || 0) + config.xp;
                  vkUser.session.xp_awarded[config.awardKey] = true;
                  vkUser.session[config.flag] = true;
                }

                if (!alreadyAwarded) {
                  await vkCtx.reply(
                    `✅ <b>КОД ПРИНЯТ!</b>\n\n🪙 Тебе начислено +${config.xp} NeuroCoins! Твой баланс: ${vkUser.session.xp}\n\nПродолжаем путь 👇`,
                    {},
                  );
                }

                if (config.next === "WAIT_BOT_TOKEN") {
                  // Для VK пропускаем создание бота — сразу к Модулю 3
                  vkUser.state = "Module_3_Offline";
                  await ydb.saveUser(vkUser);
                  return await renderStep(vkCtx, "Module_3_Offline", vkToken);
                }

                vkUser.state = config.next;
                await ydb.saveUser(vkUser);
                return await renderStep(vkCtx, config.next, vkToken);
              } else {
                return await vkCtx.reply(
                  "❌ <b>Неверное слово.</b>\n\nЗагляни в конец статьи еще раз, найди правильное слово и пришли его мне.",
                  {},
                );
              }
            }

            // Для VK WAIT_BOT_TOKEN больше не используется — сразу к Модулю 3
            if (vkUser.state === "WAIT_BOT_TOKEN") {
              vkUser.state = "Module_3_Offline";
              await ydb.saveUser(vkUser);
              return await renderStep(vkCtx, "Module_3_Offline", vkToken);
            }

            // === ДЕФОЛТ: Если состояние не распознано — показать START ===
            if (!vkUser.state || vkUser.state === "VK_LEAD") {
              vkUser.state = "START";
              await ydb.saveUser(vkUser);
              return await renderStep(vkCtx, "START", vkToken);
            }
            await renderStep(vkCtx, vkUser.state, vkToken);
          } catch (e) {
            log.error("[VK ROUTER ERROR]", e);
          }
        };

        await runVkRouter();
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/plain" },
          body: "ok",
        };
      }
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: "ok",
      };
    } catch (err) {
      log.error("[VK WEBHOOK ERROR]", err);
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: "ok",
      };
    }
  }

  // Не VK запрос — возвращаем null чтобы index.js продолжил обработку
  return null;
}
