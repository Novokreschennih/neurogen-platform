# Омниканальная склейка профилей — Диагностика и план исправлений

**Дата:** 2026-04-24
**Проект:** NeuroGen Platform (function_chat_bot + website)

---

## Проблема

Пользователь, прошедший через Web-чат, Telegram и VK, создаёт **несколько строк в базе** вместо одной объединённой.

**Пример:**
- Строка 1: `vk_id=343397967`, `email=`, `web_id=` (пусто)
- Строка 2: `web_id=web_abc123`, `vk_id=` (пусто), `email=`

---

## Анализ текущей архитектуры

### Формат ссылок (Frontend)

| Канал | Формат ссылки |
|-------|---------------|
| Telegram | `https://t.me/bot?start=p_qdr__web_abc123__emailB64` |
| VK | `https://vk.me/group?ref=p_qdr__web_abc123__emailB64` |
| Web | `/ai/?ref=p_qdr&session_id=web_abc123&email=user@mail.ru` |

**Разделитель:** `__` (безопасен для Telegram/VK, не конфликтует с partner_id)

### Парсер (validator.js)

Функция `validateStartPayload()` разбивает payload по `__`:
- `parts[0]` → `partner_id`
- `parts[1]` (начинается с `web_`) → `web_id`
- `parts[2]` (не `noemail`) → `email` (base64 decode)

### Логика склейки в каналах

```
┌─────────────────────────────────────────────────────────────┐
│                      Telegram (telegram_setup.js)          │
├─────────────────────────────────────────────────────────────┤
│  1. Ищет по tg_id → если найден, обновляет                 │
│  2. Если НЕ найден:                                         │
│     a) Парсит start payload (__)                            │
│     b) Ищет по web_id                                      │
│     c) Ищет по email                                       │
│  3. Нашел → привязывает tg_id к существующей строке        │
│     Не нашел → создаёт новую строку                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      VK (vk_handler.js)                     │
├─────────────────────────────────────────────────────────────┤
│  1. Парсит ref из callback payload                          │
│  2. Ищет по web_id → затем по email                         │
│  3. Нашел → привязывает vk_id                              │
│     Не нашел → создаёт новую строку                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Web-чат (web_chat.js)                   │
├─────────────────────────────────────────────────────────────┤
│  1. Ищет по session_id (web_id)                            │
│  2. Если не найден, но есть email → ищет по email          │
│  3. Нашел → привязывает web_id                             │
│     Не нашел → создаёт новую строку                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Выявленные проблемы

### 1. Race Condition в Telegram
**Симптом:** Две строки с одинаковым `tg_id`

**Причина:** Telegram может отправить несколько запросов одновременно (callback + message). Оба запроса видят "пользователь не найден" и создают новые строки.

**Статус:** YDB deduplication (`isUpdateProcessed` / `markUpdateProcessed`) работает, но в памяти `processedUpdates` может не спасти если запросы попадают на разные инстанции.

### 2. Telegram не сохраняет `email` в новой строке
**Симптом:** Строка TG создаётся с пустым `email`, даже если payload содержал email.

**Проверка:** В `telegram_setup.js` строка 431:
```javascript
email: emailFromJoin || "",
```
 — правильно, `emailFromJoin` может быть null если парсинг не сработал.

### 3. VK всегда сбрасывает state в "START"
**Симптом:** Пользователь прошёл Theory_Mod1 в Web, пришёл в VK — state сброшен.

**Код в vk_handler.js:**
```javascript
if (!vkUser.state || vkUser.state === "START") {
  vkUser.state = "START";
}
```
 — **Это правильно!** Условие `if (!vkUser.state)` срабатывает только если state пустой. Но если state уже `Theory_Mod1`, он НЕ перезаписывается.

**Однако:** если `vkUser.state` ранее был пустым (new user merged), потом станет START. Это корректно для новых пользователей.

### 4. Telegram всегда сбрасывает state в "START"
**Код в telegram_setup.js:**
```javascript
if (!ctx.dbUser.state || ctx.dbUser.state === "START") {
  ctx.dbUser.state = "START";
}
```
 — **Та же логика**, что и в VK. Если state уже существует (например, `Training_Main`), он не перезаписывается.

### 5. Возможная проблема с порядком склейки
**Сценарий:**
1. Пользователь открыл Web-чат → создалась строка с `web_id`, `email`
2. Пользователь кликнул Telegram → payload содержит `web_id` и `email`
3. Telegram находит по `web_id` → привязывает `tg_id`
4. Пользователь кликнул VK → payload содержит `web_id` и `email`
5. VK находит по `web_id` → привязывает `vk_id`

**Должно работать правильно**, если `web_id` передаётся корректно.

---

## Что проверить после деплоя

### 1. База данных
```sql
-- Проверить все строки пользователя
SELECT id, tg_id, vk_id, web_id, email, state, created_at, last_seen
FROM users
WHERE email = 'test@mail.ru' OR web_id = 'web_abc123'
ORDER BY created_at;
```

**Ожидаемый результат:** одна строка с заполненными `tg_id`, `vk_id`, `web_id`, `email`

### 2. Логи YDB
```bash
yc serverless function logs --function-name sethubble-bot --tail 100 | grep -E "\[WEB\]|\[TG\]|\[VK\]|Merged"
```

**Искать строки:**
- `[WEB] Merged new web_id` — web склеился
- `[TG] Merged Telegram ID into existing user` — TG прикрепился
- `[VK] Merged with tags and state preserved` — VK прикрепился

---

## План действий

### Шаг 1: Убедиться, что фронтенд передаёт все параметры

**join.njk / base.njk:**
```javascript
btnTelegram.addEventListener("click", () => {
  const email = emailInput.value.trim() || storedEmail;
  const encEmail = email ? encodeEmailForUrl(email) : "noemail";
  const startPayload = `${partnerId}__${currentSessionId}__${encEmail}`;
  window.open(`https://t.me/${refBot}?start=${startPayload}`, "_blank");
});
```

**ai.njk (Web-чат):**
```javascript
// При загрузке читаем email из URL
function captureReferral() {
  const params = new URLSearchParams(window.location.search);
  const urlEmail = params.get("email");
  if (urlEmail) {
    userEmail = urlEmail;
    localStorage.setItem("neurogen_user_email", urlEmail);
  }
}

// Отправляем email в каждом запросе
body: JSON.stringify({
  sessionId: currentSessionId,
  email: userEmail,  // <-- обязательно
  ...
})
```

### Шаг 2: Проверить validator.js

```javascript
export function validateStartPayload(raw) {
  // Должен поддерживать:
  // - p_qdr__web_xxx__emailB64 (основной формат)
  // - p-qdr (старый формат с дефисом)
  // - p_qdr|email (старый формат с pipe)
}
```

### Шаг 3: Очистить тестовые данные

```sql
-- Удалить тестовых пользователей
DELETE FROM users WHERE email LIKE '%@test%' OR web_id LIKE 'web_%';
```

### Шаг 4: Деплой и тестирование

1. Зайти на сайт `/join/`
2. Ввести email, открыть Web-чат
3. Нажать кнопку Telegram, написать `/start`
4. Нажать кнопку VK, написать "Старт"
5. Проверить базу — все ID должны быть в одной строке

---

## Риски

| Риск | Вероятность | Последствие |
|------|-------------|-------------|
| Race condition создаёт дубли | Средняя | Две строки вместо одной |
| Telegram не парсит `__` payload | Низкая | Создаётся новая строка без склейки |
| YDB недоступен | Низкая | Функция падает, но не создаёт дублей |
| Пользователь открывает TG из органики (без payload) | Высокая | Создаётся изолиованная строка |

---

## Вывод

Текущая архитектура **правильная** — склейка работает по `web_id` → `email`. 

Проблема с дублированием строк скорее всего вызвана:
1. **Органическими запусками** (пользователь нажал /start без payload)
2. **Race condition** при одновременных запросах

После деплоя провести тестирование по плану выше и проверить логи.