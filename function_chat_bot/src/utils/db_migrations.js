/**
 * DB Migrations — v6.0 (Омниканальная схема)
 *
 * Миграции запускаются автоматически при инициализации YDB.
 * В v6.0 схема создаётся с нуля (fresh DB), миграции не нужны.
 * Для будущих изменений схемы — добавляйте версии сюда.
 */

import { log } from "./logger.js";

const MIGRATIONS = [
  // v6.1: Пример будущей миграции
  // {
  //   version: "6.1",
  //   description: "Add new column for phone number",
  //   up: async (driver) => {
  //     await driver.tableClient.withSession(async (session) => {
  //       await session.executeQuery(
  //         `ALTER TABLE users ADD COLUMN phone Utf8;`
  //       );
  //     });
  //   },
  // },
];

export async function runMigrations(driver) {
  log.info(`[MIGRATION] Checking ${MIGRATIONS.length} pending migrations...`);

  const applied = [];
  for (const migration of MIGRATIONS) {
    try {
      log.info(`[MIGRATION] Applying v${migration.version}: ${migration.description}`);
      await migration.up(driver);
      applied.push(migration.version);
      log.info(`[MIGRATION] ✅ Applied v${migration.version}`);
    } catch (e) {
      log.error(`[MIGRATION] ❌ Failed v${migration.version}`, e);
      throw e; // Критическая ошибка — останавливаем инициализацию
    }
  }

  if (applied.length > 0) {
    log.info(`[MIGRATION] Successfully applied ${applied.length} migrations: ${applied.join(", ")}`);
  } else {
    log.info(`[MIGRATION] No pending migrations — schema is up to date`);
  }

  return applied;
}

export default { runMigrations };
