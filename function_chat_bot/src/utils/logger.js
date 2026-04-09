/**
 * Структурированный логгер для Yandex Cloud Functions
 * Позволяет удобно искать ошибки в логах
 */

export const log = {
  info: (msg, meta = {}) =>
    console.log(JSON.stringify({ level: "INFO", msg, ...meta })),

  error: (msg, err = {}, meta = {}) =>
    console.error(
      JSON.stringify({
        level: "ERROR",
        msg,
        error: err.message || err,
        stack: err.stack,
        ...meta,
      }),
    ),

  warn: (msg, meta = {}) =>
    console.warn(JSON.stringify({ level: "WARN", msg, ...meta })),

  debug: (msg, meta = {}) =>
    console.log(JSON.stringify({ level: "DEBUG", msg, ...meta })),
};
