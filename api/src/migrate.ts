/**
 * Aplica el esquema. `db/cam5-schema.sql` es la única fuente de verdad y es
 * idempotente, así que re-ejecutarlo sobre una base con datos sólo agrega lo
 * que falte.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.ts";

const dbDir = process.env.CAM5_DB_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db");

const files = (await readdir(dbDir)).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) throw new Error(`No hay archivos .sql en ${dbDir}`);

for (const file of files) {
  const sql = await readFile(path.join(dbDir, file), "utf8");
  await pool.query(sql);
  console.log("aplicado", file);
}
await pool.query(`SELECT ensure_reading_partition(now())`);
await pool.query(`SELECT ensure_reading_partition(now() + interval '1 month')`);
await pool.end();
console.log("esquema al día");
