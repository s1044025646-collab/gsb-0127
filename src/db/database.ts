import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export type Clock = () => Date;

export interface DbOptions {
  path: string;
  now?: Clock;
}

/**
 * Open (creating if needed) and migrate the database. Migrations are
 * idempotent: IF NOT EXISTS guards make re-running safe on every start.
 */
export function openDatabase(opts: DbOptions): DatabaseSync {
  mkdirSync(dirname(opts.path), { recursive: true });
  const db = new DatabaseSync(opts.path);
  migrate(db, opts.now ?? (() => new Date()));
  return db;
}

export function migrate(db: DatabaseSync, now: Clock): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);
  const stamp = db.prepare("SELECT version FROM schema_meta WHERE version = ?");
  const existing = stamp.get(SCHEMA_VERSION);
  if (!existing) {
    db.prepare("INSERT INTO schema_meta(version, applied_at) VALUES (?,?)").run(
      SCHEMA_VERSION,
      now().toISOString(),
    );
  }
}

export function iso(now: Clock): string {
  return now().toISOString();
}
