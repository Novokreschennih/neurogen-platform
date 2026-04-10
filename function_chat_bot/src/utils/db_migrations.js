/**
 * DB Migrations — заглушка (v5.0)
 *
 * Миграции не нужны — YDB создаётся с нуля по ydb_schema.sql.
 * Все колонки уже в схеме: pin_code, session_version, vk_group_id.
 */

import { log } from "./logger.js";

export async function runMigrations(driver) {
  log.info("[MIGRATION] Skipping — fresh DB with full schema");
  return [];
}

export default { runMigrations };
