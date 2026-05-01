/**
 * UX Helpers — прогресс, loop detection, channel summary
 */

/**
 * Прогресс-бар обучения
 * Показывает модуль и текущий шаг
 * @param {string} state — текущий state пользователя
 * @param {object} user — объект пользователя
 * @returns {string|null} HTML-строка прогресса или null
 */
export function formatTrainingProgress(state, user) {
  // Определяем модуль и порядок шагов
  const modules = {
    Module_1_Strategy: { name: "Стратегия", steps: ["Module_1_Strategy"] },
    Module_2_Online: {
      name: "Онлайн",
      steps: ["Module_2_Online", "Module_2_Reward_PromoKit"],
    },
    Module_3_Offline: { name: "Офлайн", steps: ["Module_3_Offline"] },
    Training_Pro_Main: {
      name: "PRO",
      steps: [
        "Training_Pro_Main",
        "Training_Pro_P1_1",
        "Training_Pro_P1_2",
        "Training_Pro_P1_3",
        "Training_Pro_P1_4",
        "Training_Pro_P1_5",
        "Training_Pro_P2_1",
        "Training_Pro_P2_2",
        "Training_Pro_P2_3",
        "Training_Pro_P2_4",
        "Training_Bot_Success",
      ],
    },
  };

  // Находим какой модуль содержит текущий state
  for (const [modKey, modInfo] of Object.entries(modules)) {
    const idx = modInfo.steps.indexOf(state);
    if (idx === -1) continue;

    const stepNum = idx + 1;
    const totalSteps = modInfo.steps.length;
    const filled = "█".repeat(stepNum);
    const empty = "░".repeat(totalSteps - stepNum);

    return `\n📚 <b>${modInfo.name}</b> • Шаг ${stepNum}/${totalSteps}\n${filled}${empty}\n`;
  }

  return null;
}

/**
 * Detect если пользователь повторяет одно и то же действие
 * @param {object} user — объект пользователя
 * @param {string} currentInput — текущий ввод
 * @returns {boolean}
 */
export function detectLoop(user, currentInput) {
  if (!user?.session?.dialog_history) return false;
  const history = user.session.dialog_history;
  if (history.length < 3) return false;

  const last3 = history.slice(-3);
  return last3.every(
    (msg) =>
      msg.role === "user" &&
      msg.content?.trim().toLowerCase() === currentInput.trim().toLowerCase(),
  );
}

/**
 * Получить подсказку при loop (повторном действии)
 * @param {string} state — текущий state
 * @returns {string|null}
 */
export function getLoopHint(state) {
  const hints = {
    WAIT_VK_GROUP_ID:
      "💡 Подсказка: зайди в сообщество VK → «Управление» → «Работа с API» → ID указан там (только цифры)",
    WAIT_EMAIL_INPUT: "💡 Подсказка: введи email в формате name@example.com",
    WAIT_BOT_TOKEN:
      "💡 Подсказка: токен выглядит как 123456789:ABCdefGHIjklMNOpqrsTUVwxyz (из @BotFather)",
    WAIT_REG_ID:
      "💡 Подсказка: это твой ID в SetHubble (цифры из личного кабинета)",
  };
  return hints[state] || null;
}

/**
 * Сформировать сводку настроенных каналов
 * @param {object} user — объект пользователя
 * @param {string} justConfigured — ключ канала который только что настроен
 * @returns {string}
 */
export function buildChannelSummary(user, justConfigured = null) {
  const channels = user.session?.channels || {};
  const configured = [];
  const names = {
    telegram: "📱 Telegram",
    vk: "💬 VK",
    web: "🌐 Web-чат",
    email: "📧 Email",
  };

  for (const [key, val] of Object.entries(channels)) {
    if (val?.configured) {
      configured.push(names[key] || key);
    }
  }

  if (configured.length === 0) return "";

  let summary = `\n<b>📊 Твои каналы:</b> ${configured.join(" • ")}`;

  if (justConfigured && names[justConfigured]) {
    summary += `\n✅ <b>${names[justConfigured]} подключён!</b>`;
  }

  // Мотивация при 3+ каналах
  if (configured.length >= 3) {
    summary += `\n\n🎉 <b>3+ канала!</b> По статистике это даёт в 3 раза больше лидов!`;
  }

  return summary;
}

/**
 * Получить текст ошибки + подсказку для секретного слова
 * @param {string} state — текущий state (WAIT_SECRET_1/2/3)
 * @param {number} attempts — количество неудачных попыток
 * @returns {string} HTML-строка сообщения
 */
export function getSecretWordErrorResponse(state, attempts) {
  const baseMsg =
    "❌ <b>Неверное слово.</b>\n\nЗагляни в конец статьи еще раз, найди правильное слово и пришли его мне.";

  if (attempts < SECRET_MAX_ATTEMPTS_BEFORE_HINT) {
    return baseMsg;
  }

  const hints = SECRET_HINTS[state];
  if (!hints) return baseMsg;

  if (attempts < SECRET_MAX_ATTEMPTS_BEFORE_SKIP) {
    return `${baseMsg}\n\n${hints.vague}`;
  }

  return `${baseMsg}\n\n${hints.specific}\n\n🔄 <i>Если не можешь найти слово — нажми кнопку «Пропустить модуль» ниже. Ты сможешь вернуться к статье позже.</i>`;
}

/**
 * Сформировать строку баланса NeuroCoins для отображения в текстах
 * @param {object} user — объект пользователя
 * @returns {string} HTML-строка с балансом и прогрессом
 */
export function getNeuroCoinsStatus(user) {
  const xp = user.session?.xp || 0;
  const progress = Math.min((xp / 100) * 100, 100);
  const needed = Math.max(0, 100 - xp);

  if (xp >= 100) {
    return `\n🪙 <b>Баланс: ${xp} NeuroCoins</b> — Золотой Билет доступен! 🎟️\n`;
  }

  return (
    `\n🪙 <b>Баланс: ${xp}/100 NeuroCoins</b>\n` +
    `${getProgressBar(progress)}\n` +
    `Нужно ещё ${needed} 🪙 для скидки 50% на PRO\n`
  );
}

export default {
  formatTrainingProgress,
  detectLoop,
  getLoopHint,
  buildChannelSummary,
  getSecretWordErrorResponse,
  getNeuroCoinsStatus,
};
