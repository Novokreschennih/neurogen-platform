/**
 * VK Photo Upload and Cache Utility
 *
 * Загружает изображения из постоянного хранилища (Yandex Object Storage)
 * во ВКонтакте через VK API с 3-шаговым процессом загрузки.
 * Кэширует attachment-строки, чтобы не загружать одни и те же картинки повторно.
 *
 * VK Photo Upload Flow:
 *   1. photos.getMessagesUploadServer → получаем upload_url
 *   2. Скачиваем изображение из постоянного URL (Yandex Object Storage)
 *   3. POST (multipart) изображения на upload_url
 *   4. photos.saveMessagesPhoto → получаем owner_id + id → attachment
 *
 * @module vk_photo_cache
 */

import { log } from "./logger.js";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Максимальное количество закэшированных фото (50 = все статические step_meta) */
const CACHE_MAX = 50;

/** Время жизни кэша в мс (24 часа) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── In-Memory Cache ────────────────────────────────────────────────────────

/**
 * @type {Map<string, { attachment: string, timestamp: number }>}
 * Ключ: URL изображения (например, https://storage.yandexcloud.net/sethubble-assets/main_intro.jpg)
 * Значение: VK attachment строка (например, photo-123456_7890)
 */
const photoCache = new Map();

// ─── Multipart Form Builder (без внешних зависимостей) ─────────────────────

/**
 * Создаёт тело multipart/form-data запроса вручную
 * @param {Buffer} imageBuffer - содержимое изображения
 * @param {string} boundary - уникальный разделитель
 * @param {string} filename - имя файла
 * @returns {Buffer} готовое тело запроса
 */
function buildMultipartBody(imageBuffer, boundary, filename = "image.jpg") {
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="photo"; filename="${filename}"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, imageBuffer, footer]);
}

/**
 * Извлекает границы binary-данных из текстового ответа VK API
 * @param {string} text - ответ VK API (может содержать JSON с binary data)
 * @returns {object} распарсенный объект
 */
function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Core Upload Logic ──────────────────────────────────────────────────────

/**
 * Загружает изображение в VK и возвращает attachment строку
 *
 * @param {string} photoUrl - URL изображения (из Yandex Object Storage)
 * @param {string} groupToken - токен группы VK (process.env.VK_GROUP_TOKEN)
 * @returns {Promise<string|null>} attachment строка (photo{owner_id}_{id}) или null при ошибке
 */
async function uploadPhotoToVk(photoUrl, groupToken) {
  // ─── Шаг 1: Получаем upload_url ───────────────────────────────────────
  const uploadServerUrl = `https://api.vk.com/method/photos.getMessagesUploadServer`;
  const params = new URLSearchParams({
    access_token: groupToken,
    v: "5.199",
  });

  let uploadUrl;
  try {
    const resp = await fetch(uploadServerUrl, { method: "POST", body: params });
    const data = await resp.json();
    if (data.error) {
      log.error(`[VK PHOTO UPLOAD] getMessagesUploadServer error:`, data.error);
      return null;
    }
    uploadUrl = data.response?.upload_url;
    if (!uploadUrl) {
      log.error(`[VK PHOTO UPLOAD] No upload_url in response`);
      return null;
    }
  } catch (e) {
    log.error(`[VK PHOTO UPLOAD] Failed to get upload server:`, e.message);
    return null;
  }

  // ─── Шаг 2: Скачиваем изображение из постоянного хранилища ────────────
  let imageBuffer;
  try {
    const imgResp = await fetch(photoUrl);
    if (!imgResp.ok) {
      log.error(`[VK PHOTO UPLOAD] Failed to fetch image: ${imgResp.status}`);
      return null;
    }
    const arrayBuffer = await imgResp.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
  } catch (e) {
    log.error(`[VK PHOTO UPLOAD] Failed to download image:`, e.message);
    return null;
  }

  // ─── Шаг 3: Загружаем изображение на upload_url (multipart) ──────────
  const boundary = `----VkUploadBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const multipartBody = buildMultipartBody(imageBuffer, boundary);

  let uploadResponse;
  try {
    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    const responseText = await uploadResp.text();
    uploadResponse = safeParseJson(responseText);
    if (!uploadResponse) {
      log.error(`[VK PHOTO UPLOAD] Failed to parse upload response`);
      return null;
    }
  } catch (e) {
    log.error(`[VK PHOTO UPLOAD] Failed to upload to VK:`, e.message);
    return null;
  }

  const { server, photo, hash } = uploadResponse;
  if (!server || !photo || !hash) {
    log.error(`[VK PHOTO UPLOAD] Incomplete upload response:`, { hasServer: !!server, hasPhoto: !!photo, hasHash: !!hash });
    return null;
  }

  // ─── Шаг 4: Сохраняем фото в сообщениях VK ───────────────────────────
  try {
    const saveUrl = `https://api.vk.com/method/photos.saveMessagesPhoto`;
    const saveParams = new URLSearchParams({
      access_token: groupToken,
      v: "5.199",
      server: String(server),
      photo: photo,
      hash: hash,
    });
    const saveResp = await fetch(saveUrl, { method: "POST", body: saveParams });
    const saveData = await saveResp.json();

    if (saveData.error) {
      log.error(`[VK PHOTO UPLOAD] saveMessagesPhoto error:`, saveData.error);
      return null;
    }

    const savedPhoto = saveData.response?.[0];
    if (!savedPhoto || !savedPhoto.owner_id || !savedPhoto.id) {
      log.error(`[VK PHOTO UPLOAD] No saved photo data`);
      return null;
    }

    const attachment = `photo${savedPhoto.owner_id}_${savedPhoto.id}`;
    log.info(`[VK PHOTO UPLOAD] Successfully uploaded: ${attachment}`, {
      url: photoUrl.substring(0, 80),
    });
    return attachment;
  } catch (e) {
    log.error(`[VK PHOTO UPLOAD] Failed to save photo:`, e.message);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Возвращает VK attachment для указанного URL изображения.
 * Использует кэш: при повторном запросе возвращает закэшированный attachment.
 *
 * @param {string} photoUrl - URL изображения
 * @param {string} groupToken - токен группы VK
 * @returns {Promise<string|null>} attachment строка или null (при ошибке → fallback на ссылку)
 */
export async function getVkPhotoAttachment(photoUrl, groupToken) {
  if (!photoUrl || !groupToken) return null;

  // Проверяем кэш
  const cached = photoCache.get(photoUrl);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    log.info(`[VK PHOTO CACHE] HIT: ${cached.attachment}`);
    return cached.attachment;
  }

  // Если кэш устарел или отсутствует — загружаем
  log.info(`[VK PHOTO CACHE] MISS: uploading ${photoUrl.substring(0, 80)}...`);
  const attachment = await uploadPhotoToVk(photoUrl, groupToken);

  if (attachment) {
    // Управляем размером кэша: если превышен, удаляем самую старую запись
    if (photoCache.size >= CACHE_MAX) {
      const oldestKey = photoCache.keys().next().value;
      if (oldestKey) photoCache.delete(oldestKey);
    }
    photoCache.set(photoUrl, { attachment, timestamp: Date.now() });
    log.info(`[VK PHOTO CACHE] Cached: ${attachment} (cache size: ${photoCache.size})`);
  } else {
    log.warn(`[VK PHOTO CACHE] Upload failed, will use fallback link for: ${photoUrl.substring(0, 80)}`);
  }

  return attachment;
}

/**
 * Очищает кэш фото (для тестирования)
 */
export function clearVkPhotoCache() {
  photoCache.clear();
  log.info(`[VK PHOTO CACHE] Cache cleared`);
}

/**
 * Возвращает статистику кэша
 */
export function getVkPhotoCacheStats() {
  return {
    size: photoCache.size,
    maxSize: CACHE_MAX,
    ttlMs: CACHE_TTL_MS,
  };
}
