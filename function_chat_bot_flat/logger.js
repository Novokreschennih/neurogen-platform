/**
 * Структурированный логгер для Yandex Cloud Functions (v5.0)
 *
 * Формат: JSON с level, msg, trace_id, timestamp
 * Совместим с Yandex Cloud Logging
 */

import crypto from "crypto";

// Генерация trace_id для каждого запроса
function genTraceId() {
  return crypto.randomBytes(8).toString("hex");
}

// Текущий trace_id (устанавливается в начале каждого запроса)
let currentTraceId = null;

export function setTraceId(id) {
  currentTraceId = id;
}

export function getTraceId() {
  return currentTraceId || "no-trace";
}

export const log = {
  info: (msg, meta = {}) =>
    console.log(
      JSON.stringify({
        level: "INFO",
        msg,
        trace_id: currentTraceId,
        timestamp: new Date().toISOString(),
        ...meta,
      }),
    ),

  error: (msg, err = {}, meta = {}) =>
    console.error(
      JSON.stringify({
        level: "ERROR",
        msg,
        trace_id: currentTraceId,
        timestamp: new Date().toISOString(),
        error: err?.message || String(err),
        stack: err?.stack?.split("\n").slice(0, 3).join(" "),
        ...meta,
      }),
    ),

  warn: (msg, meta = {}) =>
    console.warn(
      JSON.stringify({
        level: "WARN",
        msg,
        trace_id: currentTraceId,
        timestamp: new Date().toISOString(),
        ...meta,
      }),
    ),

  debug: (msg, meta = {}) =>
    console.log(
      JSON.stringify({
        level: "DEBUG",
        msg,
        trace_id: currentTraceId,
        timestamp: new Date().toISOString(),
        ...meta,
      }),
    ),
};

export default { log, setTraceId, getTraceId };
