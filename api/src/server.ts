import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { pool, q, one } from "./db.ts";
import { ApiError, errorBody } from "./errors.ts";
import { authenticateGateway, currentUser, requireRole } from "./auth.ts";
import { ingestTelemetry, ingestStatus, ingestEvents } from "./ingest.ts";
import * as read from "./read.ts";
import * as admin from "./admin.ts";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { invalidateCatalog } from "./catalog.ts";
import { createGunzip, createInflate } from "node:zlib";
import { Transform } from "node:stream";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 16 * 1024 * 1024, // los lotes de reinyección tras un corte son grandes
});

// El gateway comprime los lotes (`Content-Encoding: gzip`). Se descomprime antes
// de parsear, para que la firma HMAC se calcule sobre el JSON sin comprimir, tal
// como lo define CAM5_GATEWAY_SPEC.md §3.2.
app.addHook("preParsing", async (request, _reply, payload) => {
  const encoding = String(request.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding !== "gzip" && encoding !== "deflate") return payload;

  // Fastify compara los bytes recibidos contra Content-Length, que describe el
  // cuerpo COMPRIMIDO. Contamos los bytes tal como llegan y los exponemos en
  // `receivedEncodedLength`; sin eso, descomprimir dispara
  // «Request body size did not match Content-Length».
  let encodedLength = 0;
  const counter = new Transform({
    transform(chunk, _enc, callback) {
      encodedLength += chunk.length;
      callback(null, chunk);
    },
  });

  const decompressed = payload.pipe(counter).pipe(encoding === "gzip" ? createGunzip() : createInflate());
  Object.defineProperty(decompressed, "receivedEncodedLength", { get: () => encodedLength });
  return decompressed;
});

// Guardamos el cuerpo crudo: la firma HMAC se calcula sobre los bytes exactos.
app.addContentTypeParser("application/json", { parseAs: "string" }, (req: any, body: string, done) => {
  req.rawBody = body;
  try { done(null, body.length ? JSON.parse(body) : {}); }
  catch { done(new ApiError(400, "MALFORMED_JSON", "El cuerpo no es JSON válido"), undefined); }
});

// CORS. El portal puede servirse desde otro origen (dev en :3000, o el portal
// en Workers y la API en el servidor). Lista blanca explícita, nunca "*" con
// credenciales: el navegador rechaza esa combinación.
const ALLOWED_ORIGINS = (process.env.CAM5_CORS_ORIGINS ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*"))) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Access-Control-Allow-Headers",
      "Content-Type, Authorization, Idempotency-Key, X-CAM5-User, X-CAM5-Gateway-Id, X-CAM5-Timestamp, X-CAM5-Signature, X-CAM5-Schema-Version, X-CAM5-Config-Version");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    reply.header("Access-Control-Max-Age", "600");
  }
  if (request.method === "OPTIONS") return reply.status(204).send();
});

app.setErrorHandler((error: any, request, reply) => {
  const traceId = randomUUID();
  if (error instanceof ApiError) {
    request.log.warn({ traceId, code: error.code }, error.message);
    return reply.status(error.status).send(errorBody(error, traceId));
  }
  request.log.error({ traceId, err: error }, "error no controlado");
  return reply.status(500).send(errorBody(new ApiError(500, "INTERNAL", "Error interno"), traceId));
});

const V1 = "/api/v1";

// Período de muestreo del gateway, en segundos. De él se derivan el umbral de
// frescura y el latido, para que no queden desalineados.
const SAMPLE_INTERVAL_S = Number(process.env.CAM5_SAMPLE_INTERVAL_S ?? 5);

// Cuánto puede envejecer una lectura antes de considerarla atrasada. DEBE ser
// mayor que el período de muestreo: con muestras cada 5 minutos y un umbral de
// 60 s, TODAS las lecturas se verían atrasadas siempre. Por defecto, 2,5 ciclos.
const DEFAULT_STALE_AFTER_S = Number(
  process.env.CAM5_STALE_AFTER_S ?? Math.max(60, Math.round(SAMPLE_INTERVAL_S * 2.5))
);

// ---------------------------------------------------------------- salud
app.get(`${V1}/health`, async () => {
  const started = Date.now();
  await q("SELECT 1");
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    dbLatencyMs: Date.now() - started,
    sampleIntervalS: SAMPLE_INTERVAL_S,
    staleAfterS: DEFAULT_STALE_AFTER_S,
    rollup1m: process.env.CAM5_ROLLUP_1M !== "false",
  };
});

// ---------------------------------------------------------------- ingesta
async function gatewayFrom(request: any) {
  return authenticateGateway(
    request.headers,
    request.rawBody ?? "",
    request.method,
    request.url.split("?")[0]
  );
}

app.post(`${V1}/ingest/telemetry`, async (request: any, reply) => {
  const gateway = await gatewayFrom(request);
  const result = await ingestTelemetry(gateway, request.body);
  const fresh = await one<{ config_version: number }>(
    `SELECT config_version FROM gateway WHERE id = $1`, [gateway.id]);
  return reply.status(202).send({
    accepted: result.accepted,
    rejected: result.rejected,
    duplicate: result.duplicate,
    configVersion: fresh?.config_version ?? gateway.config_version,
    serverTime: new Date().toISOString(),
  });
});

app.post(`${V1}/ingest/status`, async (request: any, reply) => {
  const gateway = await gatewayFrom(request);
  const result = await ingestStatus(gateway, request.body);
  return reply.status(202).send({ ...result, serverTime: new Date().toISOString() });
});

app.post(`${V1}/ingest/events`, async (request: any, reply) => {
  const gateway = await gatewayFrom(request);
  const result = await ingestEvents(gateway, request.body);
  return reply.status(202).send({ ...result, serverTime: new Date().toISOString() });
});

// Configuración que el gateway descarga. Así el portal empuja cambios de umbral
// o de habilitación sin abrir un puerto entrante en el gateway.
app.get(`${V1}/gateway/config`, async (request: any) => {
  const gateway = await gatewayFrom(request);
  const units = await q(
    `SELECT u.id, u.transport, u.endpoint, u.unit_address
       FROM unit u WHERE u.gateway_id = $1 ORDER BY u.id`, [gateway.id]);
  const channels = await q(
    `SELECT c.unit_id, c.code, c.kind, c.enabled, c.register, c.data_type, c.scale, c.byte_order,
            cm.metric, cm.uom, cm.deadband, cm.heartbeat_s
       FROM channel c
       JOIN unit u ON u.id = c.unit_id
       JOIN channel_metric cm ON cm.channel_id = c.id
      WHERE u.gateway_id = $1 ORDER BY c.unit_id, c.code, cm.metric`, [gateway.id]);
  const version = await one<{ config_version: number }>(
    `SELECT config_version FROM gateway WHERE id = $1`, [gateway.id]);
  return {
    profileVersion: version?.config_version ?? 1,
    units,
    channels,
    transmit: {
      // El modo de muestreo se configura desde el servidor: en un piloto de una
      // unidad con lecturas cada 1–5 minutos, `periodic` es más simple que
      // report-by-exception y produce una serie regular.
      mode: process.env.CAM5_SAMPLE_MODE ?? "report-by-exception",
      sampleIntervalSec: SAMPLE_INTERVAL_S,
      heartbeatSec: Number(process.env.CAM5_HEARTBEAT_S ?? SAMPLE_INTERVAL_S),
      batchMaxReadings: Number(process.env.CAM5_BATCH_MAX_READINGS ?? 500),
      batchMaxIntervalMs: Number(process.env.CAM5_BATCH_MAX_INTERVAL_MS ?? 5000),
      staleMaxSeconds: Number(process.env.CAM5_STALE_MAX_S ?? SAMPLE_INTERVAL_S * 3),
    },
  };
});

// ---------------------------------------------------------------- portal
app.get(`${V1}/session`, async (request: any) => {
  const user = await currentUser(request.headers);
  return { user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } };
});

app.get(`${V1}/assets/:assetId`, async (request: any) => {
  await currentUser(request.headers);
  return read.assetTree(request.params.assetId);
});

app.get(`${V1}/assets/:assetId/channels`, async (request: any) => {
  await currentUser(request.headers);
  return read.channels(request.params.assetId);
});



app.get(`${V1}/assets/:assetId/readings/latest`, async (request: any) => {
  await currentUser(request.headers);
  const staleAfter = Number(request.query.staleAfterS ?? DEFAULT_STALE_AFTER_S);
  return read.latestReadings(request.params.assetId, staleAfter);
});

app.get(`${V1}/assets/:assetId/trends`, async (request: any) => {
  await currentUser(request.headers);
  const { unitId, channel, metric, from, to } = request.query;
  if (!unitId || !channel || !from || !to) {
    throw new ApiError(422, "VALIDATION_ERROR", "Parámetros incompletos", {
      unitId: "requerido", channel: "requerido", from: "requerido", to: "requerido",
    });
  }
  return read.trend(unitId, channel, metric ?? "temperature", from, to);
});

app.get(`${V1}/alarms`, async (request: any) => {
  await currentUser(request.headers);
  return read.listAlarms({ status: request.query.status, assetId: request.query.assetId });
});

app.post(`${V1}/alarms/:alarmId/acknowledge`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer", "operator"]);
  return read.acknowledgeAlarm(request.params.alarmId, user, request.body?.note);
});

app.post(`${V1}/alarms/:alarmId/close`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  return read.closeAlarm(request.params.alarmId, user, request.body?.note);
});

app.get(`${V1}/work-orders`, async (request: any) => {
  await currentUser(request.headers);
  return q(`SELECT w.*, u.full_name AS assignee_name FROM work_order w
              LEFT JOIN app_user u ON u.id = w.assignee_id
             ORDER BY w.created_at DESC`);
});

app.post(`${V1}/work-orders`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer", "operator"]);
  return read.createWorkOrder(request.body, user);
});

app.patch(`${V1}/work-orders/:id`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer", "operator"]);
  const before = await one(`SELECT * FROM work_order WHERE id = $1`, [request.params.id]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Orden no existe");
  const after = await one(
    `UPDATE work_order SET status = COALESCE($2, status), priority = COALESCE($3, priority),
                           assignee_id = COALESCE($4, assignee_id), due_at = COALESCE($5, due_at),
                           completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END
      WHERE id = $1 RETURNING *`,
    [request.params.id, request.body?.status ?? null, request.body?.priority ?? null,
     request.body?.assigneeId ?? null, request.body?.dueAt ?? null]
  );
  await read.audit(user, "Orden de trabajo actualizada", request.params.id, before, after);
  return after;
});

app.get(`${V1}/audit`, async (request: any) => {
  await currentUser(request.headers);
  return q(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT $1`, [Number(request.query.limit ?? 100)]);
});

app.get(`${V1}/gateway-events`, async (request: any) => {
  await currentUser(request.headers);
  return q(`SELECT * FROM gateway_event ORDER BY ts DESC LIMIT $1`, [Number(request.query.limit ?? 100)]);
});

// Diagnóstico OT: alimenta la vista de puesta en marcha con datos reales.
app.get(`${V1}/diagnostics`, async (request: any) => {
  await currentUser(request.headers);
  const gateways = await q(
    `SELECT id, name, last_seen_at, last_seq, clock_sync, spool_depth, firmware,
            EXTRACT(EPOCH FROM (now() - last_seen_at)) AS seconds_since_contact
       FROM gateway`);
  const units = await q(
    `SELECT u.id, u.name, u.kind, u.endpoint, u.online, u.poll_latency_ms,
            u.transport, u.unit_address, u.last_seen_at,
            h.poll_cycle_ms, h.reads_ok_24h, h.reads_failed_24h, h.modbus_exceptions_24h,
            h.channels_good, h.channels_configured, h.readers_online
       FROM unit u LEFT JOIN unit_health h ON h.unit_id = u.id ORDER BY u.id`);
  const ingest = await one(
    `SELECT count(*) AS batches, COALESCE(sum(accepted),0) AS readings,
            COALESCE(round(avg(lag_ms)),0) AS avg_lag_ms, COALESCE(max(lag_ms),0) AS max_lag_ms
       FROM ingest_batch WHERE received_at > now() - interval '24 hours'`);
  return { gateways, units, ingest24h: ingest };
});

// Cambios de configuración desde el portal: suben config_version para que el
// gateway detecte que debe volver a descargar su perfil.
app.patch(`${V1}/channels/:channelId`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  const before = await one(`SELECT * FROM channel WHERE id = $1`, [request.params.channelId]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Canal no existe");
  const after = await one(
    `UPDATE channel SET enabled = COALESCE($2, enabled), label = COALESCE($3, label),
                        zone = COALESCE($4, zone), register = COALESCE($5, register),
                        data_type = COALESCE($6, data_type), scale = COALESCE($7, scale),
                        byte_order = COALESCE($8, byte_order)
      WHERE id = $1 RETURNING *`,
    [request.params.channelId, request.body?.enabled ?? null, request.body?.label ?? null,
     request.body?.zone ?? null, request.body?.register ?? null, request.body?.dataType ?? null,
     request.body?.scale ?? null, request.body?.byteOrder ?? null]
  );
  await q(`UPDATE gateway SET config_version = config_version + 1
            WHERE id = (SELECT gateway_id FROM unit WHERE id = $1)`, [before.unit_id]);
  await read.audit(user, "Canal actualizado", `${before.unit_id}.${before.code}`, before, after);
  invalidateCatalog();
  return after;
});

app.patch(`${V1}/channel-metrics/:id`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  const before = await one(`SELECT * FROM channel_metric WHERE id = $1`, [request.params.id]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Métrica no existe");
  const warn = request.body?.warn ?? before.warn_threshold;
  const crit = request.body?.crit ?? before.crit_threshold;
  if (warn !== null && crit !== null && Number(warn) >= Number(crit)) {
    throw new ApiError(422, "VALIDATION_ERROR", "La configuración contiene campos inválidos",
      { warn: "El umbral preventivo debe ser menor que el crítico" });
  }
  const after = await one(
    `UPDATE channel_metric SET warn_threshold = $2, crit_threshold = $3,
            hysteresis = COALESCE($4, hysteresis), delay_s = COALESCE($5, delay_s),
            deadband = COALESCE($6, deadband)
      WHERE id = $1 RETURNING *`,
    [request.params.id, warn, crit, request.body?.hysteresis ?? null,
     request.body?.delayS ?? null, request.body?.deadband ?? null]
  );
  await q(`UPDATE gateway SET config_version = config_version + 1
            WHERE id = (SELECT u.gateway_id FROM channel c JOIN unit u ON u.id = c.unit_id
                         WHERE c.id = $1)`, [before.channel_id]);
  await read.audit(user, "Umbral actualizado", `metric:${request.params.id}`, before, after);
  invalidateCatalog();
  return after;
});

// ---------------------------------------------------------------- gestión

app.get(`${V1}/users`, async (request: any) => {
  await currentUser(request.headers);
  return admin.listUsers();
});

app.post(`${V1}/users`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin"]);
  return admin.createUser(request.body, user);
});

app.patch(`${V1}/users/:id`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin"]);
  return admin.updateUser(request.params.id, request.body, user);
});

app.get(`${V1}/notification-channels`, async (request: any) => {
  await currentUser(request.headers);
  return admin.listNotificationChannels();
});

app.post(`${V1}/notification-channels`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  return admin.createNotificationChannel(request.body, user);
});

app.patch(`${V1}/notification-channels/:id`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  return admin.updateNotificationChannel(request.params.id, request.body, user);
});

app.get(`${V1}/notification-log`, async (request: any) => {
  await currentUser(request.headers);
  return admin.notificationLog(Number(request.query.limit ?? 50));
});

app.get(`${V1}/api-keys`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  return admin.listApiKeys();
});

app.post(`${V1}/api-keys`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin"]);
  return admin.createApiKey(request.body, user);
});

app.patch(`${V1}/api-keys/:id`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin"]);
  return admin.setApiKeyActive(request.params.id, Boolean(request.body?.active), user);
});

app.get(`${V1}/reports`, async (request: any) => {
  await currentUser(request.headers);
  return admin.listReports(request.query.assetId);
});

app.post(`${V1}/reports`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer", "operator"]);
  return admin.requestReport(request.body, user);
});

app.get(`${V1}/reports/:id/download`, async (request: any, reply: any) => {
  await currentUser(request.headers);
  const report = await one<{ status: string }>(`SELECT status FROM report WHERE id = $1`, [request.params.id]);
  if (!report) throw new ApiError(404, "NOT_FOUND", "Reporte no existe");
  if (report.status !== "ready") throw new ApiError(409, "NOT_READY", "El reporte aún no está disponible");
  const file = path.join(admin.REPORT_DIR, `${request.params.id}.csv`);
  await stat(file).catch(() => { throw new ApiError(410, "FILE_GONE", "El archivo del reporte ya no está disponible"); });
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${request.params.id}.csv"`);
  return reply.send(createReadStream(file));
});

app.get(`${V1}/assets/:assetId/measurements`, async (request: any) => {
  await currentUser(request.headers);
  return admin.measurements(request.params.assetId, request.query);
});

app.get(`${V1}/assets/:assetId/modbus-map`, async (request: any) => {
  await currentUser(request.headers);
  return admin.modbusMap(request.params.assetId);
});

app.put(`${V1}/assets/:assetId/modbus-map`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  const result = await admin.saveModbusMap(request.params.assetId, request.body?.entries ?? request.body, user);
  invalidateCatalog();
  return result;
});

app.patch(`${V1}/assets/:assetId`, async (request: any) => {
  const user = await currentUser(request.headers);
  requireRole(user, ["admin", "engineer"]);
  return admin.updateAsset(request.params.assetId, request.body, user);
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

if (process.env.CAM5_NO_LISTEN !== "true") {
  app.listen({ port, host }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
}

export { app };
