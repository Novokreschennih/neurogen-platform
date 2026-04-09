// _data/tagDictionary.js

// Используем современный синтаксис `export default`

const tagsData = [
	{ slug: "sethubble-guide", name: "SetHubble Гайды" },
	{ slug: "sethubble-strategy", name: "SetHubble Стратегии" },
	{ slug: "sethubble-partnership", name: "SetHubble Партнерство" },
	{ slug: "sethubble-practicum", name: "SetHubble Практикум" },
	{ slug: "sethubble-ecosystem", name: "SetHubble Экосистема" },
	{ slug: "sethubble-philosophy", name: "SetHubble Философия" },
	{ slug: "affiliate-marketing", name: "Партнерский маркетинг" },
	{ slug: "referral-system", name: "Реферальная система" },
	{ slug: "cryptocurrencies", name: "Криптовалюты" },
	{ slug: "automation", name: "Автоматизация" },
	{ slug: "growth-strategies", name: "Стратегии роста" },
	{ slug: "zero-investment-earning", name: "Заработок без вложений" },
	{ slug: "monetization", name: "Монетизация" },
	{ slug: "traffic", name: "Трафик" },
	{ slug: "digital-trap", name: "Цифровой Капкан" },
	{ slug: "auto-recruiter", name: "Авто-Рекрутер" },
	{ slug: "income-calculator", name: "Калькулятор дохода" },
	{ slug: "binary-system", name: "Бинарная система" },
	{ slug: "linear-system", name: "Линейная система" },
	{ slug: "crypto-payments", name: "Крипто-платежи" },
	{ slug: "for-authors", name: "Для авторов" },
	{ slug: "for-partners", name: "Для партнеров" },
	{ slug: "for-beginners", name: "Для начинающих" },
	{ slug: "for-bloggers", name: "Для блогеров" },
	{ slug: "case-study", name: "Кейс" },
	{ slug: "news", name: "Новость" },
	{ slug: "announcement", name: "Анонс" },
	{ slug: "comparison", name: "Сравнение" },
];

// Преобразуем массив в удобный объект-словарь: { "slug": "РусскоеИмя" }
const tagMap = {};
for (const tag of tagsData) {
	tagMap[tag.slug] = tag.name;
}

// Eleventy автоматически сделает этот объект доступным во всех шаблонах
// под именем `tags` (по имени файла).
export default tagMap;
