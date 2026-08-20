/**
 * Agregación incremental. Las tendencias largas del portal leen estas tablas,
 * nunca la serie cruda. Reanudable y correcta ante reinyección.
 *
 *   node src/rollup.ts            (una pasada)
 *   node src/rollup.ts --loop 60  (residente, cada 60 s)
 *
 * El agregado por minuto es OPCIONAL (`CAM5_ROLLUP_1M`). Sólo aporta cuando el
 * muestreo es sub-minuto: si el gateway envía cada 1–5 minutos, ese agregado
 * guarda tantas filas como la tabla cruda y más pesadas (162 vs 128 bytes),
 * de modo que duplica el almacenamiento sin acelerar ninguna consulta.
 *
 * El watermark es sobre `received_at`, no sobre `ts`. Cuando el gateway
 * recupera el enlace y reinyecta un corte de horas, esas lecturas traen
 * timestamps antiguos: un watermark por `ts` las habría dejado fuera de los
 * agregados de forma permanente, y las tendencias largas mostrarían un hueco
 * que la serie cruda sí tiene.
 */
import { q, one, pool } from "./db.ts";

const WORST = `CASE quality WHEN 'bad' THEN 3 WHEN 'stale' THEN 2 WHEN 'disabled' THEN 1 ELSE 0 END`;

async function watermark(grain: string): Promise<Date> {
  const row = await one<{ last_received_at: Date }>(
    `SELECT last_received_at FROM rollup_state WHERE grain = $1`, [grain]);
  if (row) return new Date(row.last_received_at);
  const first = await one<{ ts: Date | null }>(`SELECT min(received_at) AS ts FROM reading`);
  return first?.ts ? new Date(new Date(first.ts).getTime() - 1000) : new Date(0);
}

async function setWatermark(grain: string, at: Date) {
  await q(
    `INSERT INTO rollup_state (grain, last_received_at) VALUES ($1, $2)
     ON CONFLICT (grain) DO UPDATE SET last_received_at = EXCLUDED.last_received_at`,
    [grain, at]
  );
}

/**
 * Recalcula sólo los buckets de minuto tocados por lecturas nuevas —vengan en
 * tiempo real o reinyectadas— y devuelve cuántos escribió.
 */
async function rollMinutes(from: Date, to: Date) {
  const rows = await q<{ n: string }>(
    `WITH touched AS (
       SELECT DISTINCT channel_metric_id, date_trunc('minute', ts) AS bucket
         FROM reading
        WHERE received_at > $1 AND received_at <= $2
          AND ts < date_trunc('minute', now())   -- el minuto en curso aún puede recibir datos
     ),
     src AS (
       SELECT r.channel_metric_id,
              date_trunc('minute', r.ts) AS bucket,
              count(*)::int AS samples,
              avg(r.value) FILTER (WHERE r.quality = 'good') AS avg_value,
              min(r.value) FILTER (WHERE r.quality = 'good') AS min_value,
              max(r.value) FILTER (WHERE r.quality = 'good') AS max_value,
              (array_agg(r.value ORDER BY r.ts DESC))[1] AS last_value,
              (array_agg(r.quality ORDER BY ${WORST} DESC))[1] AS worst_quality
         FROM reading r
         JOIN touched t
           ON t.channel_metric_id = r.channel_metric_id
          AND r.ts >= t.bucket AND r.ts < t.bucket + interval '1 minute'
        GROUP BY 1, 2),
     ins AS (
       INSERT INTO reading_rollup_1m
         (channel_metric_id, bucket, samples, avg_value, min_value, max_value, last_value, worst_quality)
       SELECT * FROM src
       ON CONFLICT (channel_metric_id, bucket) DO UPDATE SET
         samples = EXCLUDED.samples, avg_value = EXCLUDED.avg_value,
         min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
         last_value = EXCLUDED.last_value, worst_quality = EXCLUDED.worst_quality
       RETURNING channel_metric_id, bucket)
     SELECT count(*)::text AS n FROM ins`,
    [from, to]
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Misma lógica para la hora: recalcula las horas cuyos datos cambiaron. Se
 * alimenta del agregado por minuto cuando existe, y de la tabla cruda cuando no.
 */
async function rollHours(from: Date, to: Date) {
  const source = ROLLUP_1M
    ? `SELECT m.channel_metric_id, date_trunc('hour', m.bucket) AS bucket,
              sum(m.samples)::int AS samples,
              avg(m.avg_value) AS avg_value, min(m.min_value) AS min_value, max(m.max_value) AS max_value,
              (array_agg(m.last_value ORDER BY m.bucket DESC))[1] AS last_value,
              (array_agg(m.worst_quality ORDER BY
                 CASE m.worst_quality WHEN 'bad' THEN 3 WHEN 'stale' THEN 2 WHEN 'disabled' THEN 1 ELSE 0 END DESC))[1] AS worst_quality
         FROM reading_rollup_1m m
         JOIN touched t
           ON t.channel_metric_id = m.channel_metric_id
          AND m.bucket >= t.bucket AND m.bucket < t.bucket + interval '1 hour'
        GROUP BY 1, 2`
    : `SELECT r.channel_metric_id, date_trunc('hour', r.ts) AS bucket,
              count(*)::int AS samples,
              avg(r.value) FILTER (WHERE r.quality = 'good') AS avg_value,
              min(r.value) FILTER (WHERE r.quality = 'good') AS min_value,
              max(r.value) FILTER (WHERE r.quality = 'good') AS max_value,
              (array_agg(r.value ORDER BY r.ts DESC))[1] AS last_value,
              (array_agg(r.quality ORDER BY ${WORST} DESC))[1] AS worst_quality
         FROM reading r
         JOIN touched t
           ON t.channel_metric_id = r.channel_metric_id
          AND r.ts >= t.bucket AND r.ts < t.bucket + interval '1 hour'
        GROUP BY 1, 2`;

  const rows = await q<{ n: string }>(
    `WITH touched AS (
       SELECT DISTINCT r.channel_metric_id, date_trunc('hour', r.ts) AS bucket
         FROM reading r
        WHERE r.received_at > $1 AND r.received_at <= $2
          AND r.ts < date_trunc('hour', now())
     ),
     src AS (${source}),
     ins AS (
       INSERT INTO reading_rollup_1h
         (channel_metric_id, bucket, samples, avg_value, min_value, max_value, last_value, worst_quality)
       SELECT * FROM src
       ON CONFLICT (channel_metric_id, bucket) DO UPDATE SET
         samples = EXCLUDED.samples, avg_value = EXCLUDED.avg_value,
         min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
         last_value = EXCLUDED.last_value, worst_quality = EXCLUDED.worst_quality
       RETURNING 1)
     SELECT count(*)::text AS n FROM ins`,
    [from, to]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Retención: la serie cruda se poda por partición completa, no fila a fila. */
async function dropOldPartitions(keepDays: number) {
  const parts = await q<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'reading' AND c.relkind = 'r'`);
  const cutoff = new Date(Date.now() - keepDays * 86_400_000);
  const cutoffKey = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;
  let dropped = 0;
  for (const p of parts) {
    const key = p.relname.replace("reading_", "");
    if (/^\d{6}$/.test(key) && key < cutoffKey) {
      await q(`DROP TABLE IF EXISTS ${p.relname}`);
      dropped++;
    }
  }
  return dropped;
}

// Con muestreo de 1 minuto o más espaciado, desactívalo: el agregado por hora
// se calcula igual desde la tabla cruda.
const ROLLUP_1M = process.env.CAM5_ROLLUP_1M !== "false";

async function pass() {
  const now = new Date();
  let minutes = 0;
  if (ROLLUP_1M) {
    const fromMinutes = await watermark("1m");
    minutes = await rollMinutes(fromMinutes, now);
    await setWatermark("1m", now);
  }
  const fromHours = await watermark("1h");
  const hours = await rollHours(fromHours, now);
  await setWatermark("1h", now);
  const keepDays = Number(process.env.CAM5_RAW_RETENTION_DAYS ?? 90);
  const dropped = keepDays > 0 ? await dropOldPartitions(keepDays) : 0;
  console.log(`rollup 1m=${ROLLUP_1M ? minutes : "off"} 1h=${hours} particiones_eliminadas=${dropped}`);
}

const loopIndex = process.argv.indexOf("--loop");
const loopSeconds = loopIndex >= 0 ? Number(process.argv[loopIndex + 1]) : 0;

if (loopSeconds > 0) {
  for (;;) {
    await pass().catch((error) => console.error(error));
    await new Promise((r) => setTimeout(r, loopSeconds * 1000));
  }
} else {
  await pass();
  await pool.end();
}
