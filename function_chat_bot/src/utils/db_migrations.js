/**
 * DB Migrations — автоматические мигра схемы YDB
 *
 * Запускается при старте функции. Проверяет и добавляет недостающие колонки.
 * Безопасно: можно запускать многократно.
 */

import { log } from "./logger.js";
import pkg from "ydb-sdk";
const { TxControl } = pkg;

const MIGRATIONS = [
  {
    name: "v4.3.1_add_pin_code",
    check: "SELECT pin_code FROM users LIMIT 1;",
    alter: "ALTER TABLE users ADD COLUMN pin_code Utf8;",
  },
  {
    name: "v4.3.2_add_session_version",
    check: "SELECT session_version FROM users LIMIT 1;",
    alter: "ALTER TABLE users ADD COLUMN session_version Uint64;",
  },
  {
    name: "v5.0_add_vk_group_id",
    check: "SELECT vk_group_id FROM bots LIMIT 1;",
    alter: "ALTER TABLE bots ADD COLUMN vk_group_id Utf8;",
  },
];

/**
 * Запустить все ожидающие миграции
 * @param {object} driver — YDB Driver
 */
export async function runMigrations(driver) {
  const tableClient = driver.tableClient;
  const applied = [];

  for (const migration of MIGRATIONS) {
    try {
      // Проверяем существует ли колонка
      await tableClient.withSession(async (session) => {
        await session.executeQuery(migration.check);
      });
      // Колонка есть — миграция уже применена
      log.debug(`[MIGRATION] Skip (already applied): ${migration.name}`);
    } catch (e) {
      // Колонки нет — применяем миграцию
      log.info(`[MIGRATION] Applying: ${migration.name}`);
      try {
        // DDL (ALTER TABLE) должен выполняться БЕЗ транзакции
        // В ydb-sdk v5.x TxControl.noTx() отключает транзакцию для DDL
        await tableClient.withSession(async (session) => {
          await session.executeQuery(migration.alter, undefined, {
            txControl: TxControl.noTx(),
          });
        });
        applied.push(migration.name);
        log.info(`[MIGRATION] Applied: ${migration.name}`);
      } catch (alterError) {
        // Если ALTER TABLE падает с "column already exists" — считаем успехом
        const msg = alterError.message || String(alterError);
        if (
          msg.includes("already exists") ||
          msg.includes("ALREADY_EXISTS") ||
          msg.includes("ColumnAlreadyExists")
        ) {
          log.info(`[MIGRATION] Column already exists: ${migration.name}`);
          applied.push(migration.name);
        } else {
          log.error(`[MIGRATION] Failed: ${migration.name}`, alterError);
          throw alterError;
        }
      }
    }
  }

  if (applied.length > 0) {
    log.info(
      `[MIGRATION] All migrations complete. Applied: ${applied.length}`,
      {
        migrations: applied,
      },
    );
  } else {
    log.info(`[MIGRATION] No pending migrations`);
  }

  return applied;
}

export default { runMigrations, MIGRATIONS };
