import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

mkdirSync(dirname(config.databasePath), { recursive: true });

const sqlite = new Database(config.databasePath, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export { schema };

migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
