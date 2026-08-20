import { q, one } from "./db.ts";
import { ApiError } from "./errors.ts";
import { nextId } from "./alarms.ts";

/** Árbol Sitio → Activo → Unidad CAM-5 → Lector IRM. */
export async function assetTree(assetId: string) {
  const asset = await one(`SELECT * FROM asset WHERE id = $1`, [assetId]);
  if (!asset) throw new ApiError(404, "NOT_FOUND", `Activo ${assetId} no existe`);
  const units = await q(
    `SELECT u.*, h.online AS health_online, h.readers_online, h.poll_latency_ms AS health_latency,
            h.modbus_exceptions_24h, h.channels_good, h.channels_configured
       FROM unit u LEFT JOIN unit_health h ON h.unit_id = u.id
      WHERE u.asset_id = $1
      ORDER BY u.parent_unit_id NULLS FIRST, u.id`,
    [assetId]
  );
  return { asset, units };
}

export async function channels(assetId: string) {
  return q(
    `SELECT c.id, c.unit_id, c.code, c.kind, c.label, c.zone, c.enabled,
            c.register, c.data_type, c.scale, c.byte_order, c.map_confirmed,
            c.position_x, c.position_y,
            json_agg(json_build_object(
              'id', cm.id, 'metric', cm.metric, 'uom', cm.uom, 'isPrimary', cm.is_primary,
              'deadband', cm.deadband, 'warn', cm.warn_threshold, 'crit', cm.crit_threshold,
              'hysteresis', cm.hysteresis, 'delayS', cm.delay_s
            ) ORDER BY cm.is_primary DESC, cm.metric) AS metrics
       FROM channel c
       JOIN unit u ON u.id = c.unit_id
       JOIN channel_metric cm ON cm.channel_id = c.id
      WHERE u.asset_id = $1
      GROUP BY c.id
      ORDER BY c.unit_id, c.code`,
    [assetId]
  );
}

/**
 * Lecturas actuales. `staleAfterS` marca como atrasada una serie cuyo último
 * dato supera el tiempo de frescura, que es distinto de estar sin conexión.
 */
export async function latestReadings(assetId: string, staleAfterS = 60) {
  return q(
    `SELECT u.id AS unit_id, c.code AS channel, c.kind, c.label, c.zone, c.enabled,
            cm.metric, cm.uom, cm.is_primary,
            cm.warn_threshold AS warn, cm.crit_threshold AS crit,
            rl.value, rl.ts AS source_timestamp, rl.received_at, rl.seq,
            CASE
              WHEN rl.ts IS NULL THEN 'bad'
              WHEN NOT c.enabled THEN 'disabled'
              WHEN EXTRACT(EPOCH FROM (now() - rl.ts)) > $2 THEN 'stale'
              ELSE rl.quality
            END AS quality,
            CASE
              WHEN rl.value IS NULL OR NOT c.enabled THEN 'normal'
              WHEN cm.crit_threshold IS NOT NULL AND rl.value >= cm.crit_threshold THEN 'critical'
              WHEN cm.warn_threshold IS NOT NULL AND rl.value >= cm.warn_threshold THEN 'warning'
              ELSE 'normal'
            END AS severity,
            -- Variación respecto a hace una hora, calculada sobre el agregado.
            -- Alimenta la columna "tendencia" del portal sin una consulta por canal.
            (rl.value - ref.avg_value) AS trend_1h
       FROM channel c
       JOIN unit u ON u.id = c.unit_id
       JOIN channel_metric cm ON cm.channel_id = c.id
       LEFT JOIN reading_latest rl ON rl.channel_metric_id = cm.id
       LEFT JOIN LATERAL (
         SELECT avg_value FROM reading_rollup_1m
          WHERE channel_metric_id = cm.id
            AND bucket <= now() - interval '1 hour'
          ORDER BY bucket DESC LIMIT 1
       ) ref ON true
      WHERE u.asset_id = $1
      ORDER BY u.id, c.code, cm.is_primary DESC, cm.metric`,
    [assetId, staleAfterS]
  );
}

/**
 * Tendencias. Elige automáticamente crudo / 1 min / 1 h según el rango pedido,
 * para que 30 días no dispare un escaneo de la tabla cruda.
 */
export async function trend(unitId: string, channel: string, metric: string, from: string, to: string) {
  const cm = await one<{ id: number; uom: string }>(
    `SELECT cm.id, cm.uom FROM channel_metric cm
       JOIN channel c ON c.id = cm.channel_id
      WHERE c.unit_id = $1 AND c.code = $2 AND cm.metric = $3`,
    [unitId, channel, metric]
  );
  if (!cm) throw new ApiError(404, "NOT_FOUND", `Serie ${unitId}.${channel}.${metric} no existe`);

  const spanH = (Date.parse(to) - Date.parse(from)) / 3_600_000;
  if (!Number.isFinite(spanH) || spanH <= 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "Rango inválido", { from: "from debe ser anterior a to" });
  }

  // Si el agregado por minuto está desactivado (muestreo de 1 min o más
  // espaciado), la tabla cruda cubre el rango medio sin costo apreciable:
  // 7 días a 5 minutos son ~2.000 filas por serie.
  const has1m = process.env.CAM5_ROLLUP_1M !== "false";
  const grain = spanH <= 6 ? "raw" : spanH <= 168 ? (has1m ? "1m" : "raw") : "1h";
  const table = grain === "1m" ? "reading_rollup_1m" : "reading_rollup_1h";

  const points = grain === "raw"
    ? await q(
        `SELECT ts, value, quality FROM reading
          WHERE channel_metric_id = $1 AND ts >= $2 AND ts < $3
          ORDER BY ts`, [cm.id, from, to])
    : await q(
        `SELECT bucket AS ts, avg_value AS value, min_value AS min, max_value AS max,
                worst_quality AS quality, samples
           FROM ${table}
          WHERE channel_metric_id = $1 AND bucket >= $2 AND bucket < $3
          ORDER BY bucket`, [cm.id, from, to]);

  return { unitId, channel, metric, uom: cm.uom, grain, points };
}

export async function listAlarms(filter: { status?: string; assetId?: string } = {}) {
  return q(
    `SELECT a.*, c.code AS channel_code, c.label AS channel_label, cm.metric, cm.uom,
            (SELECT count(*) FROM work_order w
              WHERE w.alarm_id = a.id AND w.status <> 'completed') AS active_work_orders
       FROM alarm a
       LEFT JOIN channel_metric cm ON cm.id = a.channel_metric_id
       LEFT JOIN channel c ON c.id = cm.channel_id
      WHERE ($1::text IS NULL OR a.status = $1)
        AND ($2::text IS NULL OR a.asset_id = $2)
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        a.opened_at DESC`,
    [filter.status ?? null, filter.assetId ?? null]
  );
}

export async function acknowledgeAlarm(id: string, user: any, note?: string) {
  const alarm = await one<{ status: string }>(`SELECT status FROM alarm WHERE id = $1`, [id]);
  if (!alarm) throw new ApiError(404, "NOT_FOUND", `Alarma ${id} no existe`);
  if (alarm.status === "closed") throw new ApiError(409, "INVALID_TRANSITION", "La alarma ya está cerrada");
  const updated = await one(
    `UPDATE alarm SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2,
                      updated_at = now()
      WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, user.id]
  );
  if (note) await q(`INSERT INTO alarm_note (alarm_id, author, note) VALUES ($1,$2,$3)`, [id, user.full_name, note]);
  await audit(user, "Alarma reconocida", id, null, { status: "acknowledged" });
  return updated ?? await one(`SELECT * FROM alarm WHERE id = $1`, [id]);
}

/** Cerrar exige nota y genera auditoría (DELIVERY_CHECKLIST.md). */
export async function closeAlarm(id: string, user: any, note: string) {
  if (!note || !note.trim()) {
    throw new ApiError(422, "VALIDATION_ERROR", "El cierre requiere una nota", { note: "requerido" });
  }
  const alarm = await one<{ status: string }>(`SELECT status FROM alarm WHERE id = $1`, [id]);
  if (!alarm) throw new ApiError(404, "NOT_FOUND", `Alarma ${id} no existe`);
  if (alarm.status === "closed") throw new ApiError(409, "INVALID_TRANSITION", "La alarma ya está cerrada");

  const updated = await one(
    `UPDATE alarm SET status = 'closed', closed_at = now(), closed_by = $2, close_note = $3,
                      acknowledged_at = COALESCE(acknowledged_at, now()),
                      acknowledged_by = COALESCE(acknowledged_by, $2), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, user.id, note.trim()]
  );
  await q(`INSERT INTO alarm_note (alarm_id, author, note) VALUES ($1,$2,$3)`, [id, user.full_name, note.trim()]);
  await q(`UPDATE alarm_candidate SET confirmed = false
            WHERE channel_metric_id = (SELECT channel_metric_id FROM alarm WHERE id = $1)`, [id]);
  await audit(user, "Alarma cerrada", id, null, { status: "closed", note: note.trim() });
  return updated;
}

export async function createWorkOrder(payload: any, user: any) {
  if (payload.alarmId) {
    const existing = await one<{ id: string }>(
      `SELECT id FROM work_order WHERE alarm_id = $1 AND status <> 'completed'`, [payload.alarmId]);
    if (existing) {
      // Idempotente por diseño: una alarma no genera órdenes duplicadas.
      return { ...(await one(`SELECT * FROM work_order WHERE id = $1`, [existing.id])), reused: true };
    }
  }
  const id = await nextId("OT", "work_order", new Date());
  const created = await one(
    `INSERT INTO work_order (id, asset_id, alarm_id, title, source, priority, status, assignee_id, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
    [id, payload.assetId, payload.alarmId ?? null, payload.title, payload.source ?? null,
     payload.priority ?? "normal", payload.assigneeId ?? null, payload.dueAt ?? null]
  );
  await audit(user, "Orden de trabajo creada", id, null, created);
  return created;
}

export async function audit(user: any, action: string, target: string, oldValue: any, newValue: any, origin = "portal") {
  await q(
    `INSERT INTO audit_log (actor, action, target, old_value, new_value, origin)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [user?.full_name ?? "Sistema", action, target,
     oldValue ? JSON.stringify(oldValue) : null,
     newValue ? JSON.stringify(newValue) : null, origin]
  );
}
