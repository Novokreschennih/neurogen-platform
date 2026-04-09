# QWEN.md — Контекст проекта: Блог SetHubble

## Обзор проекта

**blog-sh** — это статический блог-сайт для платформы **SetHubble** (sethubble.ru), построенный на базе **Eleventy (11ty) v3** — генератора статических сайтов. Проект основан на шаблоне [eleventy-base-blog v9](https://github.com/11ty/eleventy-base-blog) и кастомизирован для русскоязычной аудитории.

**Основное назначение:**
- Публикация блогов, новостей и образовательного контента (Academy)
- Генерация статического сайта с оптимизацией производительности (Lighthouse 400/400/400/400)
- Поддержка черновиков (drafts) с защитой от публикации в production
- Автоматическая оптимизация изображений через `@11ty/eleventy-img`

## Технологии и стек

| Категория | Технология |
|---|---|
| **Генератор сайтов** | Eleventy (11ty) v3.1.2 |
| **Шаблонизаторы** | Nunjucks (`.njk`), Markdown (`.md`), HTML |
| **CSS** | Чистый CSS (без фреймворков), кастомные стили |
| **JavaScript** | Vanilla JS (минимальный, для интерактивности) |
| **Изображения** | @11ty/eleventy-img (AVIF/WebP, авто-оптимизация) |
| **Подсветка кода** | PrismJS (через @11ty/eleventy-plugin-syntaxhighlight) |
| **Поиск** | Fuse.js (клиентский поиск) |
| **RSS** | Atom-фиды для блога и новостей |
| **Валидация** | Zod (schema validation для данных) |
| **Минификация** | html-minifier-terser (production) |
| **Node.js** | >= 18 (рекомендуется 20, указана в `.nvmrc`) |

## Структура проекта

```
├── eleventy.config.js          # Главная конфигурация Eleventy
├── package.json                # Зависимости и скрипты
├── netlify.toml                # Конфигурация Netlify
├── vercel.json                 # Конфигурация Vercel
├── update-covers.js            # Скрипт авто-расстановки обложек
├── .nvmrc                      # Версия Node.js (20)
├── src/
│   ├── _config/
│   │   └── filters.js          # Кастомные фильтры (даты, reading time, related posts и т.д.)
│   ├── _data/
│   │   ├── metadata.js         # Метаданные сайта (title, URL, author)
│   │   ├── authors.js          # Список авторов
│   │   ├── tagDictionary.js    # Словарь тегов для локализации
│   │   ├── eleventyDataSchema.js # Валидация данных через Zod
│   │   └── buildDate.js        # Дата сборки
│   ├── _includes/
│   │   ├── layouts/            # Шаблоны: base, home, post, news, academy
│   │   ├── partials/           # Переиспользуемые компоненты
│   │   └── postslist.njk       # Список постов
│   ├── css/                    # CSS файлы (index, fonts, error-page, landing, simulator)
│   ├── fonts/                  # Шрифты
│   ├── js/                     # Клиентский JS (включая sw.js — service worker)
│   ├── public/                 # Статические файлы (копируются в корень _site)
│   ├── _redirects              # Правила редиректов для Netlify
│   └── content/
│       ├── blog/               # Статьи блога (.md файлы с датами в названиях)
│       ├── news/               # Новости
│       ├── academy/            # Обучающие материалы
│       ├── feed/               # Фиды
│       ├── index.njk           # Главная страница блога
│       ├── archive.njk         # Архив всех статей
│       ├── search.njk          # Страница поиска
│       ├── tags.njk            # Страница тегов
│       ├── tag-pages.njk       # Генерация страниц по тегам
│       ├── authors.njk         # Страница авторов
│       ├── calculator.njk      # Калькулятор дохода
│       ├── news.njk            # Страница новостей
│       ├── sitemap.xml.njk     # Sitemap
│       ├── content.11tydata.js # Глобальные данные контента
│       └── 404.md              # Страница ошибки 404
├── _site/                      # Сгенерированный output (продакшен)
└── .github/workflows/
    └── deploy.yml              # CI/CD: деплой в Yandex Cloud S3
```

## Команды

### Требования
- Node.js >= 18 (рекомендуется версия 20, указана в `.nvmrc`)
- npm

### Разработка

```bash
# Установка зависимостей
npm install

# Запуск dev-сервера с live-reload
npm start
# или: npx @11ty/eleventy --serve --quiet

# Debug-режим (показывает все внутренние процессы)
npm run debug
# или: cross-env DEBUG=Eleventy* npx @11ty/eleventy
```

### Сборка

```bash
# Продакшен-сборка в _site/
npm run build
# или: npx @11ty/eleventy

# Сборка для GitHub Pages (с path prefix)
npm run build-ghpages

# Benchmark (анализ производительности сборки)
npm run benchmark
```

### Переменные окружения

```bash
# Для production-сборки (черновики исключаются)
ELEVENTY_ENV=production npm run build
# или
NODE_ENV=production npm run build
```

### Деплой

Проект настроен на **автоматический деплой** при push в ветку `main` через GitHub Actions:

- **Хостинг:** Yandex Cloud Object Storage (S3-совместимый)
- **Бакет:** `sethubble.ru`
- **Endpoint:** `https://storage.yandexcloud.net`
- **Секреты:** `YC_KEY_ID` и `YC_SECRET_KEY` (хранятся в GitHub Secrets)

Также присутствуют конфигурации для **Netlify** (`netlify.toml`) и **Vercel** (`vercel.json`).

## Особенности конфигурации

### Черновики (Drafts)

В `eleventy.config.js` реализована полная защита черновиков:

- Пометьте статью как `draft: true` в front matter
- Черновики видны локально (`--serve`), но **не публикуются** в production
- Контролируется через переменные окружения: `ELEVENTY_ENV=production` или `NODE_ENV=production`
- Используется глобальный `eleventyComputed` для установки `permalink: false` и `eleventyExcludeFromCollections: true`

### Коллекции

- **`posts`** — статьи из `src/content/blog/**/*.md`
- **`news`** — новости из `src/content/news/**/*.md`

Обе коллекции фильтруют черновики в production-режиме.

### Кастомные фильтры (filters.js)

| Фильтр | Назначение |
|---|---|
| `readableDate` | Форматирование даты на русском языке |
| `htmlDateString` | Дата в формате ISO для HTML `datetime` |
| `readingTime` | Время чтения статьи (200 слов/мин) |
| `getRelatedPosts` | Связанные статьи по тегам |
| `getHeadings` | Извлечение заголовков H2-H4 для оглавления |
| `strip_html` / `striptags` | Удаление HTML-тегов |
| `filterTagList` | Фильтрация системных тегов |
| `sortAlphabetically` | Сортировка строк по алфавиту |

### Шорткод изображений

Настраивается через `image` в Nunjucks:
- Автоматическая генерация форматов WebP/JPEG
- Responsive widths: 400, 800, 1200, auto
- Lightbox-обёртка для просмотра в полном размере
- Graceful fallback, если изображение не найдено

### Скрипт update-covers.js

Автоматически расставляет обложки (`image:` в front matter) по тегам статей. Маппинг тегов к SVG определён внутри скрипта.

### Минификация HTML

Включается только в production:
- Удаление комментариев
- Сжатие whitespace
- Минификация CSS и JS

## SEO и фиды

- **Sitemap:** `/sitemap.xml` (авто-генерация)
- **RSS блог:** `/feed/feed.xml` (Atom, последние 10 статей)
- **RSS новости:** `/feed/news.xml` (Atom, последние 10 новостей)
- **Метаданные:** язык `ru`, заголовок "Блог о SetHubble"

## Production-оптимизации

- Минификация HTML (удаление комментариев, collapse whitespace, minify CSS/JS)
- Оптимизация изображений (AVIF/WebP, lazy loading, async decoding)
- Нулевой JavaScript на выходе (статический сайт)
- Per-page CSS bundles через `eleventy-plugin-bundle`

## Контент-конвенции

### Front matter для статей

```yaml
---
title: "Заголовок статьи"
description: "Краткое описание (для SEO и превью)"
date: 2025-10-10
tags:
  - affiliate-marketing
  - for-beginners
image: "/img/affiliate-marketing.svg"
draft: false  # true для черновика
---
```

### Теги контента

Основные категории тегов:
- `sethubble-guide`, `sethubble-strategy` — о платформе
- `affiliate-marketing`, `referral-system` — партнёрский маркетинг
- `crypto-payments`, `cryptocurrencies` — крипто
- `for-business`, `for-bloggers` — целевые аудитории
- `case-study`, `for-beginners`, `monetization` и др.

## Шаблоны (Layouts)

| Шаблон | Описание |
|--------|----------|
| `layouts/base.njk` | Базовая HTML-структура (head, header, footer) |
| `layouts/home.njk` | Главная страница (наследует base.njk) |
| `layouts/post.njk` | Страница поста блога |
| `layouts/news.njk` | Страница новости |
| `layouts/academy.njk` | Страница образовательного контента |

## URLs и маршруты

- Главная блога: `/blog/`
- Архив: `/archive/`
- Новости: `/news/`
- Теги: `/tags/` + авто-генерация страниц `/tags/<tag>/`
- Поиск: `/search/`
- 404: `/404.html`
- Редиректы (Vercel): `/start/` → `https://sethubble.com/ru/p_qdr`

## Стилевые соглашения

- `.editorconfig`: отступы 2 пробела, LF, UTF-8, trailing whitespace удаляется
- CSS: копируется из `src/css/` в `_site/css/` без обработки
- JavaScript: копируется из `src/js/` в `_site/js/`

## Примечания для разработки

1. **Все URL-адреса** отвязаны от физической структуры файлов (контролируются через `permalink` и шаблоны)
2. **Изображения** могут храниться рядом с MD-файлами или в `/img/`
3. **CSS** копируется через `addPassthroughCopy` — изменения в `src/css/` сразу доступны
4. **Service Worker** (`src/js/sw.js`) копируется в корень `_site/`
5. **Минификация** включена только в production-режиме
6. При добавлении новых тегов обновите `tagDictionary` в `_data/` и список кнопок фильтра в `index.njk`

## Полезные ссылки

- [Документация Eleventy](https://www.11ty.dev/docs/)
- [Eleventy Data Cascade](https://www.11ty.dev/docs/data-cascade/)
- [Eleventy Navigation Plugin](https://www.11ty.dev/docs/plugins/navigation/)
- [Eleventy Image Plugin](https://www.11ty.dev/docs/plugins/image/)
- [Оригинальный шаблон eleventy-base-blog](https://github.com/11ty/eleventy-base-blog)
