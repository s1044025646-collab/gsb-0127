import { resolve } from "node:path";
import { openDatabase } from "../src/db/database.js";

const path = resolve(process.argv[2] ?? "data/cli.db");
const name = process.argv[3] ?? "cli";
const db = openDatabase({ path });
const info = db
  .prepare("INSERT INTO documents(name, created_at) VALUES (?,?)")
  .run(name, new Date().toISOString());
  console.log("created document id", Number(info.lastInsertRowid));
db.close();
