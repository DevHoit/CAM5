import { q, one, pool } from "./db.ts";
import { ApiError } from "./errors.ts";
import { loadCatalog, seriesKey, type SeriesInfo } from "./catalog.ts";
import { evaluate, type Sample } from "./alarms.ts";

type Rejected = { seq?: number; ref?: string; code: string; message: string };

type Flat = {
  seq: number | null;
  series: SeriesInfo;
  ts: Date;
  value: number | null;
  quality: string;
};

const QUALITIES = new Set(["good", "stale", "bad", "disabled"]);

/** Aplana los dos formatos del contrato (disperso y serie comprimida) a filas. */
async function flatten(body: any, rejected: Rejected[]): Promise<Flat[]> {
  const catalog = await loadCatalog();
  const out: Flat[] = [];

  const resolve = (unitId: string, channel: string, metric: string, ref: string) => {
    const info = catalog.get(seriesKey(unitId, channel, metric));
    if (!info) {
      rejected.push({ ref, code: "UNKNOWN_CHANNEL", message: `${unitId}.${channel}.${metric} no está registrado` });
      return null;
    }
    return info;
  };

  for (const r of body.readings ?? []) {
    const info = resolve(r.unitId, r.channel, r.metric, `${r.unitId}.${r.channel}.${r.metric}`);
    if (!info) continue;
    const ts = new Date(r.ts);
    if (Number.isNaN(ts.getTime())) {
      rejected.push({ seq: r.seq, code: "BAD_TIMESTAMP", message: `ts inválido: ${r.ts}` });
      continue;
    }
    if (!QUALITIES.has(r.quality)) {
      rejected.push({ seq: r.seq, code: "BAD_QUALITY", message: `quality inválida: ${r.quality}` });
      continue;
    }
    out.push({
      seq: r.seq ?? null,
      series: info,
      ts,
      value: r.value === null || r.value === undefined ? null : Number(r.value),
      quality: r.quality,
    });
  }

  for (const s of body.series ?? []) {
    const info = resolve(s.unitId, s.channel, s.metric, `${s.unitId}.${s.channel}.${s.metric}`);
    if (!info) continue;
    const t0 = Date.parse(s.t0);
    const dt = Number(s.dtMs ?? 1000);
    if (!Number.isFinite(t0) || !Number.isFinite(dt) || dt <= 0) {
      rejected.push({ ref: `${s.unitId}.${s.channel}`, code: "BAD_SERIES", message: "t0 o dtMs inválidos" });
      continue;
    }
    const values: any[] = s.values ?? [];
    const qualities = Array.isArray(s.quality) ? s.quality : null;
    for (let i = 0; i < values.length; i++) {
      const quality = qualities ? qualities[i] : (s.quality ?? "good");
      if (!QUALITIES.has(quality)) {
        rejected.push({ ref: `${s.unitId}.${s.channel}[${i}]`, code: "BAD_QUALITY", message: `quality inválida: ${quality}` });
        continue;
      }
      const value = values[i];
      if (value === null && quality === "good") {
        rejected.push({ ref: `${s.unitId}.${s.channel}[${i}]`, code: "NULL_GOOD", message: "una muestra ausente no puede tener quality good" });
        continue;
      }
      out.push({
        seq: s.seqStart != null ? Number(s.seqStart) + i : null,
        series: info,
        ts: new Date(t0 + i * dt),
        value: value === null || value === undefined ? null : Number(value),
        quality,
      });
    }
  }

  return out;
}

export async function ingestTelemetry(gateway: any, body: any) {
  if (!body?.batchId) throw new ApiError(422, "VALIDATION_ERROR", "Falta batchId", { batchId: "requerido" });

  // Idempotencia: reenviar el mismo lote tras un corte no debe duplicar datos.
  const claimed = await one(
    `INSERT INTO ingest_batch (batch_id, gateway_id, kind, sent_at, lag_ms)
     VALUES ($1,$2,'telemetry',$3, CASE WHEN $3::timestamptz IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (now() - $3::timestamptz)) * 1000 END)
     ON CONFLICT (batch_id) DO NOTHING
     RETURNING batch_id`,
    [body.batchId, gateway.id, body.sentAt ?? null]
  );
  if (!claimed) {
    const previous = await one<{ accepted: number }>(
      `SELECT accepted FROM ingest_batch WHERE batch_id = $1`, [body.batchId]);
    return { accepted: previous?.accepted ?? 0, rejected: [], duplicate: true };
  }

  const rejected: Rejected[] = [];
  const rows = await flatten(body, rejected);

  let accepted = 0;
  if (rows.length > 0) {
    // Asegura las particiones mensuales que toca este lote (incluye los meses
    // antiguos que llegan cuando el gateway reinyecta tras un corte largo).
    const months = new Set(rows.map((r) => r.ts.toISOString().slice(0, 7)));
    for (const month of months) {
      await q(`SELECT ensure_reading_partition($1::timestamptz)`, [`${month}-01T00:00:00Z`]);
    }

    const ids = rows.map((r) => r.series.channelMetricId);
    const ts = rows.map((r) => r.ts.toISOString());
    const values = rows.map((r) => r.value);
    const qualities = rows.map((r) => r.quality);
    const seqs = rows.map((r) => r.seq);

    const inserted = await q<{ n: string }>(
      `WITH ins AS (
         INSERT INTO reading (channel_metric_id, ts, value, quality, seq)
         SELECT * FROM unnest($1::bigint[], $2::timestamptz[], $3::double precision[], $4::text[], $5::bigint[])
         ON CONFLICT (channel_metric_id, ts) DO NOTHING
         RETURNING 1)
       SELECT count(*)::text AS n FROM ins`,
      [ids, ts, values, qualities, seqs]
    );
    accepted = Number(inserted[0]?.n ?? 0);

    // Último valor por serie. La guarda por ts evita que una reinyección de
    // datos antiguos pise la lectura actual del dashboard.
    await q(
      `INSERT INTO reading_latest (channel_metric_id, ts, value, quality, seq)
       SELECT DISTINCT ON (cmid) cmid, t, v, qual, s
         FROM unnest($1::bigint[], $2::timestamptz[], $3::double precision[], $4::text[], $5::bigint[])
              AS x(cmid, t, v, qual, s)
        ORDER BY cmid, t DESC
       ON CONFLICT (channel_metric_id) DO UPDATE
         SET ts = EXCLUDED.ts, value = EXCLUDED.value, quality = EXCLUDED.quality,
             seq = EXCLUDED.seq, received_at = now()
       WHERE EXCLUDED.ts > reading_latest.ts`,
      [ids, ts, values, qualities, seqs]
    );
  }

  const samples: Sample[] = rows.map((r) => ({ series: r.series, ts: r.ts, value: r.value, quality: r.quality }));
  const openedAlarms = await evaluate(samples);

  const maxSeq = rows.reduce((max, r) => (r.seq != null && r.seq > max ? r.seq : max), 0);
  await q(
    `UPDATE gateway SET last_seen_at = now(), last_seq = GREATEST(COALESCE(last_seq,0), $2) WHERE id = $1`,
    [gateway.id, maxSeq]
  );
  await q(`UPDATE ingest_batch SET accepted = $2, rejected = $3 WHERE batch_id = $1`,
    [body.batchId, accepted, rejected.length]);

  return { accepted, rejected, duplicate: false, openedAlarms };
}

export async function ingestStatus(gateway: any, body: any) {
  const g = body.gateway ?? {};
  await q(
    `UPDATE gateway SET last_seen_at = now(), clock_sync = $2, spool_depth = $3,
                        firmware = $4, last_seq = GREATEST(COALESCE(last_seq,0), COALESCE($5,0))
      WHERE id = $1`,
    [gateway.id, g.clockSync ?? null, g.spoolDepth ?? null, g.firmware ?? null, g.lastSeq ?? null]
  );

  for (const u of body.units ?? []) {
    const exists = await one(`SELECT id FROM unit WHERE id = $1`, [u.unitId]);
    if (!exists) continue;
    await q(
      `UPDATE unit SET online = $2, last_seen_at = now(), poll_latency_ms = $3 WHERE id = $1`,
      [u.unitId, !!u.online, u.pollLatencyMs ?? null]
    );
    await q(
      `INSERT INTO unit_health (unit_id, ts, online, poll_cycle_ms, poll_latency_ms,
              reads_ok_24h, reads_failed_24h, modbus_exceptions_24h,
              channels_configured, channels_good, readers_online)
       VALUES ($1, now(), $2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (unit_id) DO UPDATE SET
         ts = now(), online = EXCLUDED.online, poll_cycle_ms = EXCLUDED.poll_cycle_ms,
         poll_latency_ms = EXCLUDED.poll_latency_ms, reads_ok_24h = EXCLUDED.reads_ok_24h,
         reads_failed_24h = EXCLUDED.reads_failed_24h,
         modbus_exceptions_24h = EXCLUDED.modbus_exceptions_24h,
         channels_configured = EXCLUDED.channels_configured,
         channels_good = EXCLUDED.channels_good, readers_online = EXCLUDED.readers_online`,
      [u.unitId, !!u.online, u.pollCycleMs ?? null, u.pollLatencyMs ?? null,
       u.readsOk24h ?? null, u.readsFailed24h ?? null, u.modbusExceptions24h ?? null,
       u.channelsConfigured ?? null, u.channelsGood ?? null, u.readersOnline ?? null]
    );
  }
  return { accepted: (body.units ?? []).length, rejected: [] };
}

export async function ingestEvents(gateway: any, body: any) {
  if (!body?.batchId) throw new ApiError(422, "VALIDATION_ERROR", "Falta batchId", { batchId: "requerido" });
  const claimed = await one(
    `INSERT INTO ingest_batch (batch_id, gateway_id, kind, sent_at)
     VALUES ($1,$2,'events',$3) ON CONFLICT (batch_id) DO NOTHING RETURNING batch_id`,
    [body.batchId, gateway.id, body.sentAt ?? null]
  );
  if (!claimed) return { accepted: 0, rejected: [], duplicate: true };

  let accepted = 0;
  for (const e of body.events ?? []) {
    await q(
      `INSERT INTO gateway_event (gateway_id, unit_id, seq, ts, type, severity, channel_code, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [gateway.id, e.unitId ?? null, e.seq ?? null, e.ts, e.type,
       e.severity ?? "info", e.channel ?? null, e.detail ?? null]
    );
    accepted++;
  }
  await q(`UPDATE ingest_batch SET accepted = $2 WHERE batch_id = $1`, [body.batchId, accepted]);
  return { accepted, rejected: [], duplicate: false };
}
