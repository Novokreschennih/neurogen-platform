/**
 * AI Engine для NeuroGen Bot
 * Консультант по материалам SetHubble — отвечает только по пройденному материалу
 */

// === КАРТА ЗНАНИЙ: что ИИ знает на каждом шаге воронки ===

// === AI ENGINE v3.0: Поддержка Polza.ai и кастомных настроек ===
const AI_PROVIDERS = {
  polza: "https://polza.ai/api/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

// Дефолтный системный промпт для v3.0
const DEFAULT_AI_PROMPT = `Ты — NeuroGen, ИИ-консультант платформы SetHubble.
Твоя цель: помогать лидам и продавать преимущества системы.
Тон: дружелюбный эксперт, кратко (1-2 предложения), используй эмодзи.
Всегда заканчивай призывом к действию (CTA).`;
const KNOWLEDGE_MAP = {
  // До регистрации — только общее
  START: [
    "общее описание SetHubble",
    "как работает реферальная система",
    "основные понятия",
  ],
  Start_Choice: ["общее описание", "выбор роли (Агент/Онлайн/Офлайн)"],
  Agent_1_Pain: ["общее описание", "путь Агента", "как зарабатывать с нуля"],
  Business_Online_Pain: [
    "общее описание",
    "онлайн-бизнес",
    "блогеры и инфобиз",
  ],
  Business_Offline_Pain: ["общее описание", "офлайн-бизнес", "O2O-генератор"],

  // После регистрации — про SetHubble и регистрацию
  Pre_Training_Logic: [
    "общее описание",
    "регистрация в SetHubble",
    "настройка аккаунта",
    "кошелек",
  ],

  // Теоретический курс (5 модулей)
  Theory_Mod1: ["общее описание", "архитектура платформы", "теория модуля 1"],
  Theory_Mod2: [
    "общее описание",
    "возможности партнеров",
    "теория модулей 1-2",
  ],
  Theory_Mod3: ["общее описание", "онлайн-бизнес", "теория модулей 1-3"],
  Theory_Mod4: [
    "общее описание",
    "офлайн-бизнес",
    "O2O-генератор",
    "теория модулей 1-4",
  ],
  Theory_Mod5: [
    "общее описание",
    "маркетинг-план",
    "бинар",
    "компрессия",
    "весь теор. курс",
  ],

  // Бесплатное обучение — модули по порядку
  Training_Main: ["общее описание", "регистрация", "введение в обучение"],
  Module_1_Strategy: [
    "общее описание",
    "регистрация",
    "модуль 1: стратегия заработка",
  ],
  Module_2_Online: [
    "общее описание",
    "регистрация",
    "модуль 1",
    "модуль 2: онлайн-бизнес",
  ],
  Module_3_Offline: [
    "общее описание",
    "регистрация",
    "модуль 1",
    "модуль 2",
    "модуль 3: офлайн-бизнес",
    "O2O-генератор",
  ],
  Lesson_Final_Comparison: [
    "общее описание",
    "все 3 модуля",
    "сравнение FREE и PRO тарифов",
    "O2O-генератор",
  ],

  // Оффер и покупка
  Offer_Tripwire: [
    "всё бесплатное",
    "PRO-статус и его преимущества",
    "тарифы и условия",
  ],
  FAQ_PRO: [
    "всё бесплатное",
    "PRO-статус",
    "тарифы",
    "ответы на вопросы по покупке",
  ],

  // После покупки PRO — всё доступно
  Delivery_1: ["все материалы", "PRO-контент", "инструкции по использованию"],
  Training_Pro_Main: ["все материалы", "PRO-обучение", "продвинутые стратегии"],
  Training_Pro_1: ["все материалы", "PRO-обучение", "модуль 1: дизайн"],
  Training_Pro_2: [
    "все материалы",
    "PRO-обучение",
    "модули 1-2: дизайн и сайты",
  ],
  Training_Pro_3: [
    "все материалы",
    "PRO-обучение",
    "модули 1-3: дизайн, сайты, боты",
  ],
  Training_Pro_4: ["все материалы", "PRO-обучение", "модули 1-4: полный курс"],

  // Тарифы масштабирования
  Rocket_Limits: ["все материалы", "PRO-обучение", "тариф Rocket"],
  Shuttle_Offer: ["все материалы", "PRO-обучение", "тарифы Rocket и Shuttle"],

  // Поддержка
  SUPPORT_ASK: [
    "общее описание",
    "сравнение FREE и PRO тарифов",
    "маркетинг-план",
    "PRO-статус и его преимущества",
  ],
};

// === ФАКТИЧЕСКАЯ БАЗА ЗНАНИЙ (СУХАЯ ВЫЖИМКА) ===
// ИИ будет читать эти факты перед ответом, чтобы не выдумывать лишнего.
const KNOWLEDGE_CONTENT = {
  "общее описание":
    "SetHubble — гибридная IT-платформа и крипто-платежный шлюз с многоуровневой партнерской программой. Это не affiliate-маркетинг (здесь строится своя сеть навсегда) и не классический MLM (нет привязки к одному бренду).",
  "выгоды системы":
    "Система дает готовый IT-бизнес. Пользователь получает ИИ-бота (который продает за него 24/7), доступ к нейросетям NeuroGen (создание лендингов, видео, скриптов) и возможность получать пассивный доход в USDT со всех уровней своей сети. Это избавление от рутины и найма.",
  "как работает реферальная система":
    "Вы делитесь ссылкой на бота или платформу. Люди закрепляются за вами навсегда (до 10 уровней в глубину на платных тарифах). Вы получаете процент (до 50%) с их покупок, оплат сервисов или продаж их бизнесов.",
  "основные понятия":
    "Лид — потенциальный клиент. Агент — партнер, строящий сеть. PRO-статус — расширенный пакет с 50% комиссией и ИИ-инструментами. NeuroCoins — внутренняя валюта Академии для скидок.",
  "путь Агента":
    "Агенты зарабатывают без создания своих продуктов. Можно подключить любой офлайн или онлайн бизнес к платформе. Их клиенты станут вашей 2-й и 3-й линией. Это чистый пассивный доход.",
  "выбор роли (Агент/Онлайн/Офлайн)":
    "Каждому направлению свой инструмент: агентам — сеть, онлайну — монетизация отказов, офлайну — умные промокоды вместо дорогой рекламы.",
  "как зарабатывать с нуля":
    "Достаточно пройти Академию, получить своего бесплатного ИИ-бота и разместить ссылку на него в соцсетях. Бот сам проведет презентацию и закроет сделку.",
  "регистрация в SetHubble":
    "Регистрация нужна для создания личного кошелька, куда будут падать USDT, и фиксации вашего места в структуре пригласителя.",
  "настройка аккаунта":
    "Главное — получить цифровой ID и 'хвост' (sh_ref_tail), чтобы бот понимал, кому начислять деньги за приведенных людей.",
  "онлайн-бизнес":
    "Для инфобизнеса и донатов. Прием USDT, BTC, ETH, TON от $1. Бесплатное размещение до 5 продуктов. ~10% ваших покупателей становятся вашими агентами.",
  "офлайн-бизнес":
    "Многоуровневые промокоды для салонов, СТО, фитнеса. Скидка клиенту + вознаграждение агенту. Касса — отдельно (в рублях), крипта — отдельно (в USDT).",
  "O2O-генератор":
    "Это механика 'Троянский конь' для B2B-встреч. Партнер берет готовую PDF-презентацию SetHubble, вставляет туда свой личный QR-код из Promo-Kit, распечатывает и оставляет на столе у владельца бизнеса (ЛПР). ЛПР сканирует код, переходит в бота партнера, прогревается и автоматически регистрируется в его сеть. Партнеру не нужно дожимать клиента самому — бот делает это за него.",
  "сравнение FREE и PRO тарифов":
    "FREE: 25% лично, по 3% до 3 уровня. PRO ($20 по скидке): 50% лично, по 5% до 5 уровня + доступ к CRM и 6 ИИ-приложениям NeuroGen.",
  "маркетинг-план":
    "Линейная система до 10 уровней (до 80% в сеть). Бинар с переливами — только на высших тарифах. Компрессия: деньги ленивых партнеров поднимаются к активным.",
  "PRO-статус и его преимущества":
    "Стоит $40 (или $20 за 100 монет). Дает 50% комиссию, CRM-дашборд и Лабораторию NeuroGen (создание сайтов, видео, рекламы через ИИ).",
};

// === БИБЛИОТЕКА СИСТЕМНЫХ ПРОМПТОВ ===
const SYSTEM_PROMPTS = {
  // Базовый промпт для всех сценариев
  BASE: `Ты — NeuroGen, консультант экосистемы SetHubble.

🎭 РОЛЬ:
- Дружелюбный эксперт: помогаешь разобраться в пройденном материале
- Говоришь кратко (1-2 предложения), без воды
- Используешь эмодзи для акцентов
- Всегда заканчиваешь призывом к действию (CTA)

🛡 ЗАЩИТНЫЕ ПРАВИЛА (КРИТИЧЕСКИ ВАЖНО):
1. Формируй ответы СТРОГО на основе раздела "ФАКТИЧЕСКАЯ БАЗА ЗНАНИЙ".
2. НИКОГДА не выдумывай цифры комиссий, названия тарифов или условия выплат, если их нет в предоставленном тебе тексте.
3. НИКОГДА не упоминай слова 'Shuttle', 'Rocket', 'Бинар' или 'Компрессия', если в твоей базе знаний нет абзацев про них.
4. Если просят "напиши за меня пост" или "сделай видео" — отвечай: "Для этого в твоем инвентаре есть инструменты ИИ-Лаборатории NeuroGen. Я здесь для стратегических советов."

📚 ПРАВИЛА ОТВЕТА:
- Отвечаешь ТОЛЬКО по тому, что пользователь уже прошел
- Если спрашивают про будущее — "Чтобы узнать больше, продолжай движение по сценарию 👉"
- НЕ рассказываешь про модули, которые впереди
- НЕ спойлеришь содержание следующих шагов

🎯 КОНТЕКСТ ВОРОНКИ:
- Знаешь текущий шаг пользователя
- Видишь, что он уже прошел (список тем ниже)
- Направляешь к следующему модулю
- Если вопрос не по пройденному — мягко направляй дальше по сценарию`,

  // Промпт для работы с возражениями
  OBJECTION: `Ты — NeuroGen, консультант экосистемы SetHubble.

🚨 РАБОТА С ВОЗРАЖЕНИЯМИ:
- "Дорого" → "Понимаю. Базовая цена $40, но если пройдёшь Академию и соберёшь 100 NeuroCoins — получишь за $20. Это окупается с первой продажи"
- "Скам/пирамида?" → "Хороший вопрос. В пирамидах нет продукта. У нас — IT-платформа с реальным оборотом. Чтобы узнать больше, продолжай движение по сценарию 👉"
- "Подумаю" → "Пока думаешь, твои лиды уходят к конкурентам. Что конкретно смущает? Спроси — разъясню по пройденному материалу"
- "Нет времени" → "Система работает автономно. 1 настройка = пассивный доход годами. Изучи модули — там пошаговые инструкции"

Тон: понимающий, но настойчивый. Не дави, а показывай факты.`,

  // Промпт для "горячих" лидов (высокий интерес)
  HOT_LEAD: `Ты — NeuroGen, консультант экосистемы SetHubble.

🔥 ПОЛЬЗОВАТЕЛЬ ГОТОВ К ПОКУПКЕ:
- Отвечай быстро, по делу
- Давай четкие инструкции к оплате
- Убирай последние сомнения
- Напоминай про бонусы (материалы PRO-обучения)

Тон: энергичный, побуждающий к немедленному действию.`,

  // Промпт для "холодных" лидов (низкая активность)
  COLD_LEAD: `Ты — NeuroGen, консультант экосистемы SetHubble.

❄️ ПОЛЬЗОВАТЕЛЬ ОСТЫЛ:
- Не дави, а напоминай о ценности
- Напоминай про упущенную выгоду
- Предлагай легкий следующий шаг
- Используй триггеры FOMO

Тон: заботливый, но с чувством срочности.`,

  // Промпт для поддержки (технические вопросы)
  SUPPORT: `Ты — NeuroGen, консультант экосистемы SetHubble.

🛠 ТЕХНИЧЕСКАЯ ПОДДЕРЖКА:
- Отвечай точно на вопросы по регистрации, оплате, настройке
- Давай пошаговые инструкции
- Если вопрос сложный — перенаправляй в @sethubble_support
- Если спрашивают про будущее — "Чтобы узнать больше, продолжай движение по сценарию 👉"

Тон: спокойный, инструктирующий.`,
};

// === ЭМОЦИОНАЛЬНЫЙ АНАЛИЗ ===
const EMOTION_PATTERNS = {
  // Положительные эмоции
  positive: {
    keywords: [
      "круто",
      "отлично",
      "супер",
      "класс",
      "интересно",
      "хочу",
      "готов",
      "да",
      "восхищаюсь",
      "впечатляет",
      "огонь",
      "топ",
      "мощно",
      "гениально",
      "спасибо",
    ],
    emojis: ["🔥", "🚀", "💎", "⚡️", "🎯"],
    response_tone: "enthusiastic",
  },
  // Отрицательные эмоции
  negative: {
    keywords: [
      "нет",
      "не хочу",
      "отстань",
      "бесит",
      "разочарован",
      "плохо",
      "ужасно",
      "скан",
      "дорого",
      "обман",
      "кидалово",
      "пирамида",
      "спам",
      "хватит",
    ],
    emojis: ["🛑", "⚠️", "🤔", "💭"],
    response_tone: "empathetic",
  },
  // Сомнения
  doubt: {
    keywords: [
      "сомневаюсь",
      "не уверен",
      "подумаю",
      "позже",
      "надо подумать",
      "не знаю",
      "сложно",
      "страшно",
      "риск",
      "а вдруг",
      "что если",
    ],
    emojis: ["🤔", "💭", "⚖️", "🎲"],
    response_tone: "reassuring",
  },
  // Вопрос/интерес
  question: {
    keywords: [
      "как",
      "что",
      "где",
      "когда",
      "почему",
      "зачем",
      "сколько",
      "какой",
      "расскажи",
      "объясни",
      "покажи",
      "вопрос",
    ],
    emojis: ["❓", "🔍", "📊", "💡"],
    response_tone: "informative",
  },
  // Готовность к покупке
  buying: {
    keywords: [
      "купить",
      "оплатить",
      "как оплатить",
      "цена",
      "стоимость",
      "тариф",
      "pro",
      "активировать",
      "перейти",
      "хочу pro",
      "готов купить",
    ],
    emojis: ["💎", "🛒", "💳", "✅"],
    response_tone: "closing",
  },
};

/**
 * Анализирует эмоциональную окраску сообщения пользователя
 * @param {string} text - Текст сообщения
 * @returns {object} { emotion, confidence, keywords }
 */
export function analyzeEmotion(text) {
  const lowerText = text.toLowerCase();
  let bestMatch = { emotion: "neutral", confidence: 0, keywords: [] };

  for (const [emotion, config] of Object.entries(EMOTION_PATTERNS)) {
    const foundKeywords = config.keywords.filter((kw) =>
      lowerText.includes(kw),
    );
    const confidence = foundKeywords.length / config.keywords.length;

    if (confidence > bestMatch.confidence) {
      bestMatch = {
        emotion,
        confidence,
        keywords: foundKeywords,
        emojis: config.emojis,
        response_tone: config.response_tone,
      };
    }
  }

  // Если найдено хотя бы 2 ключевых слова — считаем эмоцию значимой
  if (bestMatch.keywords.length >= 2) {
    bestMatch.confidence = Math.min(bestMatch.confidence + 0.3, 1);
  }

  return bestMatch;
}

/**
 * Определяет доступные знания для пользователя на основе его шага
 * @param {string} userState - Текущий шаг воронки
 * @returns {string[]} Список доступных тем
 */
export function getAvailableKnowledge(userState) {
  // Если пользователь на PRO-уровне — доступно всё
  if (
    userState?.startsWith("Delivery_") ||
    userState?.startsWith("Training_Pro_") ||
    userState === "Rocket_Limits" ||
    userState === "Shuttle_Offer"
  ) {
    return [
      "все материалы SetHubble",
      "PRO-обучение",
      "продвинутые стратегии",
      "тарифы Rocket и Shuttle",
    ];
  }

  // Иначе возвращаем знания по карте
  return KNOWLEDGE_MAP[userState] || KNOWLEDGE_MAP.START;
}

/**
 * Определяет тип промпта на основе контекста
 * @param {string} userState - Текущий шаг воронки
 * @param {object} emotionAnalysis - Результат анализа эмоций
 * @param {object} user - Данные пользователя
 * @returns {string} Ключ системного промпта
 */
function selectSystemPrompt(userState, emotionAnalysis, user) {
  // Приоритет: возражения > покупка > сомнения > интерес > база
  if (
    emotionAnalysis.emotion === "negative" &&
    emotionAnalysis.confidence > 0.5
  ) {
    return "OBJECTION";
  }

  if (
    emotionAnalysis.emotion === "buying" ||
    emotionAnalysis.keywords.some((k) =>
      ["купить", "оплатить", "pro", "активировать"].includes(k),
    )
  ) {
    return "HOT_LEAD";
  }

  if (emotionAnalysis.emotion === "doubt" && emotionAnalysis.confidence > 0.3) {
    return "OBJECTION";
  }

  // Если пользователь на шаге обучения ИЛИ в разделе поддержки — включаем промпт саппорта
  if (
    userState === "SUPPORT_ASK" ||
    userState?.startsWith("Module_") ||
    userState?.startsWith("Training_")
  ) {
    return "SUPPORT";
  }

  // Если пользователь неактивен давно — холодный лид
  const lastSeen = user.last_seen || 0;
  const hoursSinceLastSeen = (Date.now() - lastSeen) / (1000 * 60 * 60);
  if (hoursSinceLastSeen > 24) {
    return "COLD_LEAD";
  }

  return "BASE";
}

/**
 * Формирует контекст воронки и фактическую базу знаний для промпта
 * @param {string} userState - Текущий шаг
 * @param {string} partnerId - Реферальный хвост
 * @param {boolean} hasPro - Есть ли PRO-статус
 * @returns {string} Описание контекста
 */
function buildFunnelContext(userState, partnerId, hasPro) {
  const funnelSteps = {
    START: "🎯 Начало пути: пользователь только зашел",
    Start_Choice: "🎭 Выбор роли: определяет сценарий",
    Agent_1_Pain: "🚀 Путь Агента: хочет зарабатывать с нуля",
    Business_Online_Pain: "💻 Онлайн-бизнес: блогер/инфобиз",
    Business_Offline_Pain: "🏢 Офлайн-бизнес: магазин/кафе/услуги",
    Pre_Training_Logic: "📝 Регистрация: еще не в системе",
    Theory_Mod1: "📚 Теория 1: Изучает архитектуру",
    Theory_Mod2: "📚 Теория 2: Изучает возможности партнеров",
    Theory_Mod3: "📚 Теория 3: Изучает онлайн-бизнес",
    Theory_Mod4: "📚 Теория 4: Изучает офлайн-бизнес",
    Theory_Mod5: "📚 Теория 5: Изучает бинар и компрессию",
    Training_Main: "🎓 Обучение: проходит бесплатные модули",
    Module_1_Strategy: "📖 Модуль 1: изучает стратегию",
    Module_2_Online: "💻 Модуль 2: настраивает онлайн",
    Module_3_Offline: "🏬 Модуль 3: осваивает офлайн",
    Lesson_Final_Comparison: "⚖️ Сравнение: выбирает между FREE и PRO",
    Offer_Tripwire: "💎 Оффер PRO: горячая точка продажи",
    FAQ_PRO: "❓ Вопросы: сомневается перед покупкой",
    Delivery_1: "📦 Доставка: получил PRO",
    Training_Pro_Main: "🎓 PRO-обучение: углубленное",
    Rocket_Limits: "🚀 Тариф Rocket: масштабирование",
    Shuttle_Offer: "🛰 Тариф Shuttle: максимальный пакет",
    SUPPORT_ASK: "🛠 Пользователь задает вопрос в техподдержку",
  };

  const stepDescription =
    funnelSteps[userState] || "❓ Неизвестный шаг воронки";
  const role = partnerId?.includes("agent")
    ? "Агент"
    : partnerId?.includes("online")
      ? "Онлайн"
      : partnerId?.includes("offline")
        ? "Офлайн"
        : "Не определена";
  const availableTopics = getAvailableKnowledge(userState);

  // === ИСПРАВЛЕНИЕ: БАЗОВЫЕ СМЫСЛЫ ВСЕГДА В ПАМЯТИ ===
  let actualKnowledgeBase = `
- [Основа]: Мы продаем IT-систему, которая генерирует пассивный доход за счет оцифровки рекомендаций.
- [Выгода клиента]: Автоматизация (ИИ-боты работают за тебя) + 6 нейросетей NeuroGen для бизнеса + доход в USDT.`;

  availableTopics.forEach((topic) => {
    if (KNOWLEDGE_CONTENT[topic]) {
      actualKnowledgeBase += `\n- [${topic}]: ${KNOWLEDGE_CONTENT[topic]}`;
    } else {
      // Фолбэк, если ИИ знает про алиасы (общее описание SetHubble и т.д.)
      if (topic === "общее описание SetHubble")
        actualKnowledgeBase += `\n- [${topic}]: ${KNOWLEDGE_CONTENT["общее описание"]}`;
      if (topic === "как работает реферальная система")
        actualKnowledgeBase += `\n- [${topic}]: ${KNOWLEDGE_CONTENT["как работает реферальная система"]}`;
      if (topic === "основные понятия")
        actualKnowledgeBase += `\n- [${topic}]: ${KNOWLEDGE_CONTENT["основные понятия"]}`;
    }
  });

  return `📊 КОНТЕКСТ ВОРОНКИ:
• Текущий шаг: ${userState || "START"}
• Описание: ${stepDescription}
• Роль: ${role}
• PRO-статус: ${hasPro ? "✅ Активен" : "❌ Не активен"}

📚 ФАКТИЧЕСКАЯ БАЗА ЗНАНИЙ (Опирайся СТРОГО на эти факты):${actualKnowledgeBase}`;
}

/**
 * Формирует историю диалога для контекста
 * @param {Array} dialogHistory - Массив сообщений [{role, content, timestamp}]
 * @param {number} maxMessages - Максимум сообщений для включения
 * @returns {string} Форматированная история
 */
function buildDialogHistory(dialogHistory, maxMessages = 5) {
  if (!dialogHistory || dialogHistory.length === 0) {
    return "📜 История диалога: это первое сообщение";
  }

  const recentMessages = dialogHistory.slice(-maxMessages);
  const formatted = recentMessages
    .map((msg, i) => {
      const time = new Date(msg.timestamp).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const roleIcon = msg.role === "user" ? "👤" : "🤖";
      const preview =
        msg.content.substring(0, 80) + (msg.content.length > 80 ? "..." : "");
      return `${roleIcon} [${time}] ${preview}`;
    })
    .join("\n");

  return `📜 ИСТОРИЯ ДИАЛОГА (последние ${recentMessages.length} сообщений):\n${formatted}`;
}

/**
 * Добавляет эмодзи и форматирование к ответу ИИ
 * @param {string} text - Сырой ответ от ИИ
 * @param {object} emotionAnalysis - Результат анализа эмоций
 * @param {boolean} hasPro - PRO-статус пользователя
 * @returns {string} Форматированный ответ
 */
function formatAIResponse(text, emotionAnalysis, hasPro) {
  // Добавляем эмодзи в начало на основе эмоции
  const emoji = emotionAnalysis.emojis?.[0] || "🤖";

  // Разбиваем на предложения и добавляем структуру
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

  // Форматируем: первое предложение с эмодзи, остальные с отступом
  let formatted = `${emoji} ${sentences[0] || text}`;

  if (sentences.length > 1) {
    formatted += "\n\n" + sentences.slice(1).join(" ");
  }

  // Добавляем CTA, если нет в ответе
  const hasCTA = /👇|🚀|💎|нажми|выбери|перейди|активируй|продолжай/i.test(
    text,
  );
  if (!hasCTA && !hasPro) {
    formatted +=
      "\n\n👉 <i>Продолжай движение по сценарию — впереди много интересного!</i>";
  } else if (!hasCTA && hasPro) {
    formatted += "\n\n👉 <i>Применяй знания на практике — система готова!</i>";
  }

  return formatted;
}

/**
 * Основная функция генерации ответа ИИ
 * @param {string} userText - Текст сообщения пользователя
 * @param {object} user - Данные пользователя из БД
 * @param {string} userState - Текущий шаг воронки
 * @param {Array} dialogHistory - История диалога
 * @param {object} botConfig - Настройки бота (ai_provider, ai_model, custom_api_key, custom_prompt)
 * @returns {Promise<string|null>} Ответ ИИ или null при ошибке
 */
export async function generateAIResponse(
  userText,
  user,
  userState,
  dialogHistory = [],
  botConfig = {},
) {
  // v3.0: Определяем провайдера (По умолчанию polza)
  const provider = botConfig.ai_provider || "polza";
  const baseURL = AI_PROVIDERS[provider];

  if (!baseURL) {
    console.error(`[AI ENGINE] Unknown provider: ${provider}`);
    // Fallback на старый функционал если провайдер не найден
  }

  // v3.0: Ключ — личный партнёра ИЛИ глобальный из .env
  const apiKey =
    botConfig.custom_api_key ||
    process.env.POLZA_API_KEY ||
    process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("[AI ENGINE] No API key available");
    return null;
  }

  // v3.0: Модель (дефолт — gpt-4o-mini для экономии)
  const model = botConfig.ai_model || "openai/gpt-4o-mini";

  // v3.0: Промпт — кастомный партнёра ИЛИ дефолтный
  const customSystemPrompt = botConfig.custom_prompt || DEFAULT_AI_PROMPT;

  // 1. Анализируем эмоцию
  const emotionAnalysis = analyzeEmotion(userText);

  // 2. Выбираем системный промпт: приоритет отдаем личным настройкам партнера!
  let baseSystemPrompt = botConfig.custom_prompt;

  // Если у партнера нет своего промпта — используем системный с анализом эмоций
  if (!baseSystemPrompt) {
    const promptKey = selectSystemPrompt(userState, emotionAnalysis, user);
    baseSystemPrompt = SYSTEM_PROMPTS[promptKey] || SYSTEM_PROMPTS.BASE;
  }

  // 3. Формируем контекст воронки
  const funnelContext = buildFunnelContext(
    userState,
    user.partner_id,
    user.bought_tripwire,
  );

  // 4. Формируем историю диалога
  const historyContext = buildDialogHistory(dialogHistory, 5);

  // 5. Данные пользователя
  const xp = user.session?.xp || 0;
  const hasPro = user.bought_tripwire;
  const userName = user.first_name || "Пользователь";

  // 6. Финальный системный промпт
  const systemPrompt = `${baseSystemPrompt}

${funnelContext}

ДАННЫЕ ПОЛЬЗОВАТЕЛЯ:
• Имя: ${userName}
• Баланс: ${xp} NeuroCoins
• PRO-статус: ${hasPro ? "✅ Активен" : "❌ Не активен"}

${historyContext}

ПРАВИЛА ОТВЕТА:
1. Тон: дружелюбный эксперт, кратко (1-2 предложения)
2. Форматирование: HTML (используй <b>, <i>, эмодзи)
3. Всегда заканчивай призывом к действию (CTA)
4. ⚠️ ГЛАВНОЕ ПРАВИЛО: На общие вопросы (что мне это даст, зачем это нужно) — отвечай сочно, опираясь на раздел "Основа" и "Выгода клиента".
5. ⚠️ ЖЕСТКОЕ ПРАВИЛО: Если спрашивают точные механики или цифры (названия тарифов, как настроить сервер), которых нет в твоей Базе Знаний, скажи: "Детально мы разберем это в следующих уроках. Продолжай обучение по кнопкам ниже 👉"
6. НЕ спойлерь точное содержание следующих модулей.
7. Если у пользователя баланс < 100 NeuroCoins — напомни, что за прохождение уроков дают скидку на PRO-статус.`;

  // 7. Формируем сообщения для API
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userText },
  ];

  try {
    // Таймаут 8 секунд
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    // v3.0: Используем baseURL и model из botConfig
    const endpoint = baseURL
      ? `${baseURL}/chat/completions`
      : "https://openrouter.ai/api/v1/chat/completions";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sethubble.com",
        "X-Title": "NeuroGen AI Engine v3",
      },
      body: JSON.stringify({
        model: model,
        messages,
        max_tokens: 200,
        temperature: 0.75,
        top_p: 0.9,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[OPENROUTER API ERROR]", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const rawResponse = data.choices?.[0]?.message?.content;

    if (!rawResponse) {
      console.warn("[AI ENGINE] Empty response from API");
      return null;
    }

    // 8. Форматируем ответ
    const formattedResponse = formatAIResponse(
      rawResponse,
      emotionAnalysis,
      hasPro,
    );

    return formattedResponse;
  } catch (error) {
    console.error("[AI ENGINE] Generation error:", error.message);
    return null;
  }
}

/**
 * Добавляет сообщение в историю диалога
 * @param {Array} currentHistory - Текущая история
 * @param {string} role - "user" или "assistant"
 * @param {string} content - Текст сообщения
 * @param {number} maxHistory - Максимальная длина истории
 * @returns {Array} Обновленная история
 */
export function addToDialogHistory(
  currentHistory,
  role,
  content,
  maxHistory = 10,
) {
  const newMessage = {
    role,
    content,
    timestamp: Date.now(),
  };

  const updated = [...currentHistory, newMessage];
  return updated.slice(-maxHistory);
}

/**
 * Очищает старую историю диалога
 * @param {Array} history - История для очистки
 * @param {number} maxAgeHours - Максимальный возраст в часах
 * @returns {Array} Отфильтрованная история
 */
export function cleanupDialogHistory(history, maxAgeHours = 24) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  return history.filter((msg) => msg.timestamp > cutoff);
}

export default {
  generateAIResponse,
  analyzeEmotion,
  getAvailableKnowledge,
  addToDialogHistory,
  cleanupDialogHistory,
  SYSTEM_PROMPTS,
  EMOTION_PATTERNS,
};
