/**
 * DB Migrations — автоматические мигра схемы YDB
 *
 * Запускается при старте функции. Проверяет и добавляет недостающие колонки.
 * Безопасно: можно запускать многократно.
 */

import { log } from "./logger.js";
import pkg from "ydb-sdk";
const { TypedValues, AlterTableDescription } = pkg;

const MIGRATIONS = [
  {
    name: "v4.3.1_add_pin_code",
    table: "users",
    column: "pin_code",
    type: TypedValues.utf8(""),
  },
  {
    name: "v4.3.2_add_session_version",
    table: "users",
    column: "session_version",
    type: TypedValues.uint64("0"),
  },
  {
    name: "v5.0_add_vk_group_id",
    table: "bots",
    column: "vk_group_id",
    type: TypedValues.utf8(""),
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
      // Проверяем существует ли колонка через describeTable
      await tableClient.withSession(async (session) => {
        const result = await session.describeTable(migration.table);
        const columns = result.columns || [];
        const exists = columns.some((col) => col.name === migration.column);
        if (!exists) {
          throw new Error(`Column ${migration.column} not found`);
        }
      });
      // Колонка есть — миграция уже применена
      log.debug(`[MIGRATION] Skip (already applied): ${migration.name}`);
    } catch (e) {
      // Колонки нет — применяем миграцию через alterTable (DDL API)
      log.info(`[MIGRATION] Applying: ${migration.name}`);
      try {
        await tableClient.withSession(async (session) => {
          const desc = new AlterTableDescription();
          desc.withAddColumn({
            name: migration.column,
            type: migration.type.type,
          });
          await session.alterTable(migration.table, desc);
        });
        applied.push(migration.name);
        log.info(`[MIGRATION] Applied: ${migration.name}`);
      } catch (alterError) {
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
