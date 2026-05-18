/**
 * Web Chat Handler — v7.9 Highly Optimized & Patched
 * Оптимизация: Фикс TDZ ошибки webAppToken, защита Promo-Kit, фикс CRM.
 */
import crypto from "crypto";
import {
  validateEmail,
  validatePartnerId,
  validateWebSessionId,
} from "../../utils/validator.js";
import scenario from "../../scenarios/scenario_web.js";
import { resolveUser } from "../../core/omni_resolver.js";
import { getAdaptedState } from "../../scenarios/common/step_order.js";
import {
  SECRETS_CONFIG,
  getNextStateAfterSecret,
  SECRET_MAX_ATTEMPTS_BEFORE_SKIP
} from "../../scenarios/common/constants.js";
import { getSecretWordErrorResponse } from "../../utils/ux_helpers.js";
import { generateToken } from "../../utils/jwt_utils.js";
import channelManager from "../../core/channels/channel_manager.js";

export async function handleWebChat(event, context) {
  const { action, log, corsHeaders, ydb } = context;
  if (action !== "web-chat") return null;

  try {
    const payloadStr = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "{}";
    const payload = JSON.parse(payloadStr);

    // --- 0. БЫСТРАЯ ЗАГРУЗКА ИЛИ СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ ---
    const webSessionId = validateWebSessionId(payload.sessionId);
    if (!webSessionId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid Session ID" }),
      };
    }
    const payloadEmail = payload.email ? validateEmail(payload.email) : null;
    const partnerId = payload.partner_id || payload.referrer || "p_qdr";
    const firstName = payload.first_name || (payloadEmail ? payloadEmail.split("@")[0] : "WebUser");

    let webUser = await ydb.findUser({ web_id: webSessionId });
    let needsSave = false;

    if (!webUser || (payloadEmail && !webUser.email)) {
      log.info(
        "[WEB CHAT] User not found or new email. Running Omni-Resolver.",
      );
      webUser = await resolveUser("web", {
        web_id: webSessionId,
        email: payloadEmail,
        partner_id: partnerId,
        first_name: firstName,
      });
      // resolveUser уже вызвал saveUser — не дублируем
    }

    const oldState = webUser.state;
    const adaptedState = getAdaptedState(webUser.state, "web");
    if (oldState !== adaptedState) {
      webUser.state = adaptedState;
      needsSave = true;
    }

    if (!webUser.first_name) {
      webUser.first_name = firstName;
      needsSave = true;
    }
    if (!webUser.session) {
      webUser.session = {};
      needsSave = true;
    }
    if (!Array.isArray(webUser.session.tags)) {
      webUser.session.tags = [];
      needsSave = true;
    }
    if (!Array.isArray(webUser.session.dialog_history)) {
      webUser.session.dialog_history = [];
      needsSave = true;
    }
    if (!webUser.session.channel_states) {
      webUser.session.channel_states = {};
      needsSave = true;
    }

    webUser.last_seen = Date.now();
    needsSave = true;

    // ОПТИМИЗАЦИЯ: Асинхронная запись клика (Fire-and-forget)
    if (!webUser.session.click_recorded && partnerId && partnerId !== "p_qdr") {
      ydb
        .recordLinkClick(partnerId, webUser.id, "WEB_LEAD")
        .catch((e) => log.warn("[REF CLICK ERR]", e.message));
      webUser.session.click_recorded = true;
      needsSave = true;
    }

    // === B2B MODE: маршрутизация ЛПР (офлайн-бизнес) ===
    if (
      payload.role === "b2b" &&
      (!webUser.session.role || webUser.state === "START")
    ) {
      webUser.session.role = "b2b";
      webUser.state = "B2B_START";
      webUser.saved_state = "B2B_START";
      webUser.session.last_activity = Date.now();
      needsSave = true;
      log.info(`[WEB CHAT B2B] User ${webUser.id} routed to B2B_START`);
    }

    // ============================================================
    // 1. ЛОГИКА КНОПОК ВОРОНКИ (RENDER STEPS)
    // ============================================================
    if (
      payload.action === "get-web-step" ||
      payload.action === "click-button"
    ) {
      let targetCallback = payload.callback_data;

      // ИСПРАВЛЕНИЕ v7.9: Генерируем токен заранее ОДИН раз, чтобы избежать TDZ
      const webAppToken = generateToken(
        { uid: webUser.id, first_name: webUser.first_name },
        { expiresIn: "24h" }
      );

      // --- ПЕРЕХВАТ ТЕХНИЧЕСКИХ КНОПОК ---
      if (targetCallback) {
        if (targetCallback.startsWith("ENTER_SECRET_")) {
          const level = targetCallback.split("_")[2];
          targetCallback = `WAIT_SECRET_${level}`;
          needsSave = true;
        }
        
        if (
          targetCallback === "CLICK_REG_ID" ||
          targetCallback === "FORCE_REG_UPDATE"
        ) {
          webUser.state = "WAIT_REG_ID";
          await ydb.saveUser(webUser);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: "✍️ <b>Введи ТВОЙ цифровой ID</b>\n\nПришли мне номер из личного кабинета SetHubble (например: 1234).\n\n⚠️ <b>ВАЖНО:</b> Сразу после я попрошу прислать твою реферальную ссылку из SetHubble. ID и ссылка должны быть от ОДНОГО аккаунта. Именно хвост этой ссылки станет твоей персональной реферальной ссылкой в NeuroGen.",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
            }),
          };
        }
        
        if (targetCallback === "EDIT_NAME") {
          webUser.state = "WAIT_EDIT_NAME";
          await ydb.saveUser(webUser);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: "✍️ <b>Смена имени</b>\n\nПришли новое имя:",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "EDIT_PROFILE" }]],
            }),
          };
        }
        
        if (targetCallback === "EDIT_TAIL") {
          webUser.state = "WAIT_EDIT_TAIL";
          await ydb.saveUser(webUser);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              success: true,
              stepKey: webUser.state,
              text: "✍️ <b>Смена реферального хвоста</b>\n\nПришли новую ссылку или хвост:",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "EDIT_PROFILE" }]],
            }),
          };
        }
        
        if (targetCallback === "GO_TO_MODULE_2") {
          targetCallback = "Module_2_Online";
          needsSave = true;
        }
        
        if (targetCallback === "GO_TO_MODULE_3") {
          targetCallback = "Module_3_Offline";
          needsSave = true;
        }
        
        if (targetCallback === "GO_TO_FINAL") {
          targetCallback = "Lesson_Final_Comparison";
          needsSave = true;
        }
        
        if (targetCallback === "SETUP_BOT_START") {
          if (!webUser.bought_tripwire) {
            targetCallback = "Offer_Tripwire";
          } else {
            webUser.state = "WAIT_BOT_TOKEN";
            await ydb.saveUser(webUser);
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({
                success: true,
                stepKey: webUser.state,
                text: "🚀 <b>НАСТРОЙКА БОТА-КЛОНА</b>\n\nПришли мне <b>API TOKEN</b> твоего бота из @BotFather (он выглядит как набор букв и цифр).",
                buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]]
              })
            };
          }
          needsSave = true;
        }

        if (targetCallback === "THEORY_COURSE_COMPLETE") {
          if (!webUser.session.theory_complete) {
            webUser.session.theory_complete = true;
            webUser.session.xp = (webUser.session.xp || 0) + 10;
          }
          targetCallback = "Theory_Reward_Spoilers";
          needsSave = true;
        }

        // ЗАЩИТА PROMO_KIT 
        if (targetCallback === "PROMO_KIT") {
          const hasMod2 = webUser.session?.mod2_done || webUser.bought_tripwire;
          if (!webUser.sh_ref_tail) {
             // Жесткая блокировка, если нет ID
             targetCallback = "WAIT_REG_ID";
             needsSave = true;
             return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                  success: true,
                  stepKey: webUser.state,
                  text: "⚠️ <b>ДОСТУП ЗАКРЫТ</b>\n\nДля генерации личных ссылок и материалов в Promo-Kit, необходимо привязать свой SetHubble ID.\n\n✍️ <b>Введи ТВОЙ цифровой ID</b> из личного кабинета SetHubble (например: 1234).\n\n⚠️ <b>ВАЖНО:</b> Сразу после я попрошу прислать твою реферальную ссылку из SetHubble. ID и ссылка должны быть от ОДНОГО аккаунта. Именно хвост этой ссылки станет твоей персональной реферальной ссылкой в NeuroGen.",
                  buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]]
                })
             };
          } else if (!hasMod2) {
             targetCallback = "LOCKED_PROMO";
             needsSave = true;
          } else {
            const apiGw = process.env.API_GW_HOST || "d5dsbah1d4ju0glmp9d0.3zvepvee.apigw.yandexcloud.net";
            const promoKitUrl = `https://neuro-gen.ru/promo-kit/?token=${webAppToken}&api=https://${apiGw}`;
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({
                success: true,
                text: "🚀 <b>Твой Promo-Kit готов.</b>\nВсе инструменты для захвата рынка по ссылке ниже:",
                buttons: [[{ text: "📲 ОТКРЫТЬ PROMO-KIT", url: promoKitUrl }]],
              }),
            };
          }
        }
      }

      // Обычный переход по шагам
      if (payload.action === "click-button" && targetCallback) {
        webUser.state = targetCallback;
        webUser.saved_state = targetCallback;
        webUser.session.last_activity = Date.now();
        if (payload.message) {
          if (!Array.isArray(webUser.session.dialog_history)) {
            webUser.session.dialog_history = [];
          }
          webUser.session.dialog_history.push({
            role: "user",
            content: payload.message,
          });
        }
        needsSave = true;
      }

      const stepKey = webUser.state || "START";
      const step = scenario.steps[stepKey];

      const info = {
        sh_ref_tail: webUser.sh_ref_tail || "p_qdr",
        sh_user_id: webUser.sh_user_id,
        bot_username: webUser.session?.bot_username || "sethubble_biz_bot",
      };
      const links = scenario.getLinks(
        info.sh_ref_tail,
        "",
        info.sh_user_id,
        webUser.bought_tripwire,
        webUser,
      );

      // Форматирование кнопок 
      const formatButtons = (stepButtons) => {
        if (!stepButtons) return [];
        const btns =
          typeof stepButtons === "function"
            ? stepButtons(links, webUser, info)
            : stepButtons;

        return btns?.map((row) =>
          row.map((btn) => {
            const newBtn = { ...btn };
            let targetUrl = newBtn.url || (newBtn.web_app ? newBtn.web_app.url : null);

            if (targetUrl) {
              const lowerUrl = targetUrl.toLowerCase();

              // Добавляем токен к нашим инструментам
              if (lowerUrl.includes("promo-kit") || lowerUrl.includes("crm-dashboard") || lowerUrl.includes("qr2pdf")) {
                if (!lowerUrl.includes("token=")) {
                  let [baseUrl, queryString] = targetUrl.split('?');
                  if (!baseUrl.endsWith('/')) baseUrl += '/';
                  const sep = queryString ? "&" : "";
                  const qs = queryString ? `?${queryString}` : "?";
                  targetUrl = `${baseUrl}${qs}${sep}token=${webAppToken}`;
                  targetUrl = targetUrl.replace('??', '?');
                }
              }

              if (lowerUrl.includes("hubblepay.net")) {
                targetUrl = targetUrl.replace('?afid=', '&afid=');
              }

              if (lowerUrl.includes("module-")) {
                const sep = targetUrl.includes("?") ? "&" : "?";
                targetUrl = `${targetUrl}${sep}web=1`;
              }

              return { text: newBtn.text, url: targetUrl };
            }
            return newBtn;
          }),
        );
      };

      const responseStep = step || scenario.steps.START;
      const responseStepKey = step ? stepKey : "START";

      if (needsSave) await ydb.saveUser(webUser);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          stepKey: responseStepKey,
          text:
            typeof responseStep.text === "function"
              ? responseStep.text(links, webUser, info)
              : responseStep.text,
          image: responseStep.image,
          buttons: formatButtons(responseStep.buttons),
          neuroCoins: webUser.session?.xp || 0,
        }),
      };
    }

    // ============================================================
    // 2. ОБРАБОТКА ЛИДОВ (Email Form из /join/)
    // ============================================================
    if (
      payload.isEmail ||
      (payload.email && !payload.message && payload.action !== "get-web-step")
    ) {
      const email = validateEmail(payload.email);
      if (!email)
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid email" }),
        };

      const verificationCode = crypto.randomUUID().split("-")[0].toUpperCase();
      const codeExpires = Date.now() + 24 * 60 * 60 * 1000;

      const inputName = payload.first_name || email.split("@")[0];

      const user = await resolveUser("email", {
        email: email,
        partner_id: partnerId,
        first_name: inputName,
        web_id: webSessionId
      });

      if (payload.first_name) {
        user.first_name = payload.first_name;
      }

      user.session.email_verification_code = verificationCode;
      user.session.email_verification_expires = codeExpires;
      user.session.email = email;
      user.session.channels = user.session.channels || {};
      user.session.channels.email = {
        ...user.session.channels.email,
        enabled: true,
        configured: true,
        subscribed: true,
        verified: false,
      };

      await ydb.saveUser(user);
      const { sendEmail, templates } = await import("../email/email_service.js");

      sendEmail({
        to: email,
        ...templates.emailVerification(user, verificationCode),
      }).catch((e) => log.error("Email send error", e));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, emailSent: true }),
      };
    }

    // ============================================================
    // 2.5. ГЕНЕРАТОР КОНТЕНТА ДЛЯ PROMO-KIT (ИЗОЛИРОВАННЫЙ ИИ)
    // ============================================================
    if (payload.action === "generate-post") {
      const topic = payload.topic || "предприниматели";
      const refLink = payload.link || "https://neuro-gen.ru";
      
      const genLimit = webUser.bought_tripwire ? 30 : 5;
      const today = new Date().toISOString().split("T")[0];
      
      if (webUser.session.post_gen_date !== today) {
        webUser.session.post_gen_count = 0;
        webUser.session.post_gen_date = today;
        needsSave = true;
      }

      if (webUser.session.post_gen_count >= genLimit) {
        if (needsSave) await ydb.saveUser(webUser);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ answer: `⏳ Лимит генераций на сегодня исчерпан (${genLimit}/${genLimit}). Активируйте PRO для увеличения лимитов.` })
        };
      }

      webUser.session.post_gen_count = (webUser.session.post_gen_count || 0) + 1;
      needsSave = true;

      let ownerSettings = { ai_provider: "polza", ai_model: "deepseek/deepseek-v4-flash", custom_api_key: "" };
      if (webUser.partner_id && webUser.partner_id !== "p_qdr") {
        try {
          const owner = await ydb.getUserByRefTail(webUser.partner_id);
          if (owner) {
            ownerSettings = {
              ai_provider: owner.ai_provider || "polza",
              ai_model: owner.ai_model || "deepseek/deepseek-v4-flash",
              custom_api_key: owner.custom_api_key || ""
            };
          }
        } catch(e) {}
      }

      const apiKey = ownerSettings.custom_api_key || process.env.POLZA_API_KEY || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        if (needsSave) await ydb.saveUser(webUser);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ answer: "⚠️ Системный API ключ не настроен" }) };
      }

      const baseURL = ownerSettings.ai_provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://polza.ai/api/v1";
      
      const systemPrompt = `Ты — профессиональный SMM-копирайтер.
Твоя единственная задача: написать ОДИН короткий, вирусный, привлекательный пост для соцсетей.
Аудитория поста: ${topic}.
Продвигаем IT-платформу NeuroGen / SetHubble.
ПРАВИЛА:
1. Пиши живо, с эмодзи, разбивай на короткие абзацы.
2. Не более 600 символов! Без воды и долгих вступлений.
3. НИКАКИХ хештегов. НИКАКИХ кавычек вокруг текста.
4. В самом конце обязательно вставь призыв к действию и эту ссылку: ${refLink}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://neuro-gen.ru"
          },
          body: JSON.stringify({
            model: ownerSettings.ai_model || "deepseek/deepseek-v4-flash", 
            messages:[
              { role: "system", content: systemPrompt },
              { role: "user", content: "Сгенерируй пост для соцсетей." }
            ],
            max_tokens: 1000, 
            temperature: 0.7
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        
        if (!text) throw new Error("Empty response");

        if (needsSave) await ydb.saveUser(webUser);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ answer: text }) };
        
      } catch (e) {
        if (needsSave) await ydb.saveUser(webUser);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ answer: "⚠️ Сбой нейросети или таймаут. Попробуйте нажать еще раз." }) };
      }
    }

    // ============================================================
    // 3. ОБРАБОТКА ТЕКСТА (WAIT STATES + AI)
    // ============================================================
    if (payload.message) {
      const txt = payload.message.trim();
      const u = webUser;

      // --- А. Состояние ожидания ID ---
      if (u.state === "WAIT_REG_ID") {
        if (isNaN(txt))
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer: "❌ Это не похоже на цифровой ID. Пожалуйста, пришли только цифры из кабинета SetHubble.\n\n<i>💡 Если хочешь задать вопрос нейросети — нажми кнопку «Отмена» ниже.</i>",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
            }),
          };
        u.sh_user_id = txt;
        u.state = "WAIT_REG_TAIL";
        if (needsSave) await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "✅ <b>Цифровой ID принят!</b> Теперь пришли свою реферальную ссылку из SetHubble ПОЛНОСТЬЮ.\nНапример: https://sethubble.com/ru/p_xyt\n\n⚠️ <b>ВАЖНО:</b> Именно хвост этой ссылки (часть после /ru/) ляжет в основу твоей личной реферальной ссылки в NeuroGen. По ней будут переходить твои клиенты в бота и на лендинг.\n\nЕсли ID и ссылка НЕ совпадают (например, с разных аккаунтов) — реферальная цепочка не замкнётся, и твой Promo-Kit не будет работать.\n\nСкопируй ссылку из SetHubble целиком:",
          }),
        };
      }

      // Смена Имени
      if (u.state === "WAIT_EDIT_NAME") {
        u.first_name = txt;
        u.state = "EDIT_PROFILE";
        if (needsSave) await ydb.saveUser(u);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ answer: "✅ Имя успешно обновлено!", loadNextStep: true }) };
      }
      // Смена Хвоста
      if (u.state === "WAIT_EDIT_TAIL") {
        let tail = txt;
        if (tail.includes("sethubble.com")) tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
        u.sh_ref_tail = tail;
        u.state = "EDIT_PROFILE";
        if (needsSave) await ydb.saveUser(u);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ answer: "✅ Реферальный хвост обновлен!", loadNextStep: true }) };
      }

      // --- Б. Состояние ожидания Ссылки + Верификация (ВОПРОСЫ) ---
      if (u.state === "WAIT_REG_TAIL") {
        let tail = txt;
        if (tail.includes("sethubble.com"))
          tail = tail.split("?")[0].replace(/\/$/, "").split("/").pop();
        u.sh_ref_tail = tail;

        const tariffQuestions = [
          { q: "Сколько компаний можно создать на тарифе 'Самолет'?", a: ["1", "один"] },
          { q: "Максимальная цена товара ($) на тарифе 'Ракета'?", a: ["5000", "5000$"] },
          { q: "Сколько уровней партнерских программ доступно на тарифе 'Шаттл'?", a: ["10", "десять"] },
          { q: "Какая комиссия (%) на тарифе 'Самолет'?", a: ["5", "5%", "пять"] },
          { q: "Какая комиссия (%) на тарифе 'Ракета'?", a: ["3", "3%", "три"] },
          { q: "Какая комиссия (%) на тарифе 'Шаттл'?", a: ["1", "1%", "один"] }
        ];

        const randomQ = tariffQuestions[Math.floor(Math.random() * tariffQuestions.length)];
        u.session.verification_question = randomQ.q;
        u.session.verification_answers = randomQ.a;
        u.state = "WAIT_VERIFICATION";

        await ydb.saveUser(u);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: `🔐 <b>ПОДТВЕРЖДЕНИЕ ВЛАДЕНИЯ АККАУНТОМ</b>\n\nЧтобы убедиться, что у тебя есть доступ к личному кабинету SetHubble, ответь на вопрос:\n\n<b>${randomQ.q}</b>\n\n<i>(Подсказка: эти данные есть в таблице тарифов в твоем личном кабинете)</i>`,
            sessionId: webSessionId,
          }),
        };
      }

      // --- В. Проверка верификации ---
      if (u.state === "WAIT_VERIFICATION") {
        const expected = u.session.verification_answers || [];
        const isCorrect = expected.some((ans) =>
          txt.toLowerCase().includes(ans.toLowerCase()),
        );
        if (!isCorrect)
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer: `❌ <b>Неверный ответ.</b>\n\n<b>Вопрос:</b> ${u.session.verification_question}`,
            }),
          };

        u.state = "Training_Main";
        delete u.session.verification_question;
        delete u.session.verification_answers;

        if (!u.ai_active_until || u.ai_active_until < Date.now()) {
          u.ai_active_until = Date.now() + 3 * 24 * 60 * 60 * 1000;
        }

        await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "✅ Аккаунт подтвержден! Открываю доступ к обучению...",
            loadNextStep: true,
            sessionId: webSessionId,
          }),
        };
      }

      // 3.2. СЕКРЕТНЫЕ СЛОВА (ПРИОРИТЕТ!)
      if (SECRETS_CONFIG[webUser.state]) {
        const config = SECRETS_CONFIG[webUser.state];
        const normalizedInput = txt.toLowerCase().trim();

        if (normalizedInput === config.word.toLowerCase()) {
          // --- ЛОГИКА УСПЕХА ---
          if (!webUser.session.xp_awarded) webUser.session.xp_awarded = {};
          if (!webUser.session.xp_awarded[config.awardKey]) {
            webUser.session.xp = (webUser.session.xp || 0) + config.xp;
            webUser.session.xp_awarded[config.awardKey] = true;
            webUser.session[config.flag] = true;
          }
          if (webUser.session.secret_attempts) delete webUser.session.secret_attempts[webUser.state];

          webUser.state = getNextStateAfterSecret(webUser.state, "web");
          await ydb.saveUser(webUser);
          
          return { 
            statusCode: 200, 
            headers: corsHeaders, 
            body: JSON.stringify({ 
              answer: `✅ <b>КОД ПРИНЯТ!</b>\n\n🪙 Тебе начислено +${config.xp} NeuroCoins!`, 
              loadNextStep: true 
            }) 
          };

        } else {
          // --- ЛОГИКА ОШИБКИ ---
          if (!webUser.session.secret_attempts) webUser.session.secret_attempts = {};
          webUser.session.secret_attempts[webUser.state] = (webUser.session.secret_attempts[webUser.state] || 0) + 1;

          const attempts = webUser.session.secret_attempts[webUser.state];
          const errorMsg = getSecretWordErrorResponse(webUser.state, attempts);

          if (attempts >= SECRET_MAX_ATTEMPTS_BEFORE_SKIP) {
            const nextState = getNextStateAfterSecret(webUser.state, "web");
            webUser.session[config.flag] = true; 
            webUser.session.skipped_modules = webUser.session.skipped_modules || [];
            webUser.session.skipped_modules.push(webUser.state);
            webUser.state = nextState;
            await ydb.saveUser(webUser);
            
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({ 
                answer: `${errorMsg}\n\n⚠️ <i>Лимит попыток исчерпан. Модуль пропущен без начисления монет.</i>`, 
                loadNextStep: true 
              })
            };
          }

          await ydb.saveUser(webUser);
          
          // КРИТИЧЕСКИ ВАЖНЫЙ RETURN: возвращаем текст ошибки вместо того чтобы идти к ИИ
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ answer: errorMsg })
          }; 
        }
      }

      // --- Г. Настройка Telegram (MULTI-CHANNEL) ---
      if (u.state === "WAIT_TG_SETUP") {
        const tokenMatch = txt.match(/^(\d+:[A-Za-z0-9_-]+)$/);
        if (!tokenMatch) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer:
                "❌ Неверный формат токена. Токен должен выглядеть так: 123456789:ABCdefGHIjkl...\n\n<i>💡 Чтобы задать вопрос ИИ, нажми «Отмена» или вернись в Главное меню.</i>",
              buttons: [[{ text: "🔙 ОТМЕНА", callback_data: "MAIN_MENU" }]],
            }),
          };
        }
        channelManager.enableChannel(u, "telegram");
        channelManager.setChannelConfig(u, "telegram", {
          bot_token: txt,
          enabled: true,
          configured: true,
          configured_at: Date.now(),
        });
        u.state = "CHANNEL_SETUP_TG_SUCCESS";
        await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "✅ <b>TELEGRAM ПОДКЛЮЧЕН!</b>\n\nТвой токен сохранен. Теперь бот сможет принимать лидов из Telegram.",
            loadNextStep: true,
          }),
        };
      }

      // --- Д. Настройка VK (MULTI-CHANNEL) ---
      if (u.state === "WAIT_VK_GROUP_ID") {
        if (isNaN(txt)) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              answer:
                "❌ ID сообщества VK должен состоять только из цифр.\n\n<i>💡 Если передумал настраивать канал, вернись в Главное меню.</i>",
              buttons: [[{ text: "🔙 В ГЛАВНОЕ МЕНЮ", callback_data: "MAIN_MENU" }]],
            }),
          };
        }
        channelManager.enableChannel(u, "vk");
        channelManager.setChannelConfig(u, "vk", {
          group_id: txt,
          enabled: true,
          configured: true,
          configured_at: Date.now(),
        });
        u.state = "CHANNEL_SETUP_VK_SUCCESS";
        await ydb.saveUser(u);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: `✅ <b>PRO-РЕЖИМ: VK ПОДКЛЮЧЕН!</b>\n\nТвоя группа (ID: ${txt}) привязана к системе.\n\n⚠️ Не забудь настроить Callback API в сообществе VK, указав адрес нашего сервера, иначе бот не сможет отвечать.`,
            loadNextStep: true,
          }),
        };
      }

      // --- Е. Чат с ИИ (Универсальный AI Engine v3.0) ---

      let isOwnerAiActive = false;
      let ownerSettings = {
        custom_prompt: "",
        ai_provider: "polza",
        ai_model: "deepseek/deepseek-v4-flash",
        custom_api_key: "",
        user_daily_limit: 0,
      };

      if (webUser.partner_id && webUser.partner_id !== "p_qdr") {
        try {
          const owner = await ydb.getUserByRefTail(webUser.partner_id);
          if (owner) {
            isOwnerAiActive = owner.ai_active_until > Date.now();
            ownerSettings = {
              custom_prompt: owner.custom_prompt || "",
              ai_provider: owner.ai_provider || "polza",
              ai_model: owner.ai_model || "deepseek/deepseek-v4-flash",
              custom_api_key: owner.custom_api_key || "",
              user_daily_limit: owner.user_daily_limit || 0,
            };
          }
        } catch (e) {
          log.warn("[WEB AI OWNER LOOKUP ERROR]", e.message);
        }
      } else {
        isOwnerAiActive = true;
      }

      if (!isOwnerAiActive) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "🤖 <b>ИИ-консультант в режиме ожидания</b>\n\nВладелец системы ещё не активировал нейромозг (SaaS-подписку).\n\nВоспользуйтесь меню навигации 👇",
            sessionId: webSessionId,
          }),
        };
      }

      const hasCustomKey = !!ownerSettings.custom_api_key;
      let currentLimit = ownerSettings.user_daily_limit;

      if (!hasCustomKey) {
        currentLimit = webUser.bought_tripwire ? 30 : 3;
      } else if (!currentLimit) {
        currentLimit = 99999;
      }

      const today = new Date().toISOString().split("T")[0];
      if (webUser.session.ai_date !== today) {
        webUser.session.ai_count = 0;
        webUser.session.ai_date = today;
        needsSave = true;
      }

      if (webUser.session.ai_count >= currentLimit) {
        if (needsSave) await ydb.saveUser(webUser);
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer:
              "⏳ <b>Лимит консультаций исчерпан.</b> На сегодня я ответил на все вопросы. Возвращайтесь завтра!",
            sessionId: webSessionId,
          }),
        };
      }

      const botConfig = {
        ai_provider: ownerSettings.ai_provider,
        ai_model: ownerSettings.ai_model,
        custom_api_key: ownerSettings.custom_api_key,
        custom_prompt: ownerSettings.custom_prompt,
      };

      const aiEngineModule = await import("../../../ai_engine.js");

      const currentHistory = webUser.session?.dialog_history || [];
      const cleanedHistory = aiEngineModule.cleanupDialogHistory(
        currentHistory,
        24,
      );

      try {
        webUser.session.ai_count = (webUser.session.ai_count || 0) + 1;
        needsSave = true;

        const aiResponse = await aiEngineModule.generateAIResponse(
          txt,
          webUser,
          webUser.state,
          cleanedHistory,
          botConfig,
        );

        const aiAnswer =
          aiResponse || "🤖 Я немного задумался. Повтори еще раз!";

        const updatedHistory = aiEngineModule.addToDialogHistory(
          cleanedHistory,
          "user",
          txt,
          10,
        );
        const finalHistory = aiEngineModule.addToDialogHistory(
          updatedHistory,
          "assistant",
          aiAnswer,
          10,
        );
        webUser.session.dialog_history = finalHistory;

        if (needsSave) await ydb.saveUser(webUser);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ answer: aiAnswer, sessionId: webSessionId }),
        };
      } catch (aiErr) {
        log.error("[WEB AI FETCH ERROR]", aiErr);
        if (needsSave) await ydb.saveUser(webUser);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            answer: "⚠️ Нейроядро временно недоступно. Попробуйте позже.",
            sessionId: webSessionId,
          }),
        };
      }
    }

    if (needsSave) await ydb.saveUser(webUser);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, status: "no_action" }),
    };
  } catch (err) {
    log.error("[WEB CHAT ERROR]", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
}