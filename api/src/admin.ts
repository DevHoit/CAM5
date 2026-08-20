/**
 * Gestión: usuarios, notificaciones, claves de integración, reportes,
 * histórico paginado y mapa Modbus. Completa lo que el portal aún resolvía
 * con `localStorage`.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { q, one } from "./db.ts";
import { ApiError } from "./errors.ts";
import { audit } from "./read.ts";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export const REPORT_DIR = process.env.CAM5_REPORT_DIR ?? "/tmp/cam5-reports";

// ---------------------------------------------------------------- usuarios

export const listUsers = () =>
  q(`SELECT id, email, full_name, role, status, created_at, last_login
       FROM app_user ORDER BY full_name`);

export async function createUser(payload: any, actor: any) {
  const email = String(payload?.email ?? "").trim().toLowerCase();
  const fullName = String(payload?.fullName ?? "").trim();
  const role = String(payload?.role ?? "viewer");
  const fieldErrors: Record<string, string> = {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = "Correo inválido";
  if (fullName.length < 3) fieldErrors.fullName = "Nombre demasiado corto";
  if (!["admin", "engineer", "operator", "viewer"].includes(role)) fieldErrors.role = "Rol desconocido";
  if (Object.keys(fieldErrors).length) {
    throw new ApiError(422, "VALIDATION_ERROR", "La configuración contiene campos inválidos", fieldErrors);
  }
  const exists = await one(`SELECT id FROM app_user WHERE email = $1`, [email]);
  if (exists) throw new ApiError(409, "DUPLICATE_EMAIL", "Ya existe un usuario con ese correo", { email: "Ya registrado" });

  const id = `u-${randomBytes(6).toString("hex")}`;
  const created = await one(
    `INSERT INTO app_user (id, email, full_name, role) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, email, fullName, role]);
  await audit(actor, "Usuario creado", id, null, created);
  return created;
}

export async function updateUser(id: string, payload: any, actor: any) {
  const before = await one(`SELECT * FROM app_user WHERE id = $1`, [id]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Usuario no existe");
  // Un administrador no puede quitarse a sí mismo el acceso ni dejar el sistema sin administradores.
  if (before.id === actor.id && (payload?.status === "suspended" || (payload?.role && payload.role !== "admin"))) {
    throw new ApiError(409, "SELF_LOCKOUT", "No puedes suspenderte ni quitarte el rol de administrador a ti mismo");
  }
  if (before.role === "admin" && payload?.role && payload.role !== "admin") {
    const admins = await one<{ n: string }>(
      `SELECT count(*)::text AS n FROM app_user WHERE role = 'admin' AND status = 'active'`);
    if (Number(admins?.n ?? 0) <= 1) {
      throw new ApiError(409, "LAST_ADMIN", "El sistema debe conservar al menos un administrador activo");
    }
  }
  const after = await one(
    `UPDATE app_user SET full_name = COALESCE($2, full_name), role = COALESCE($3, role),
                         status = COALESCE($4, status)
      WHERE id = $1 RETURNING *`,
    [id, payload?.fullName ?? null, payload?.role ?? null, payload?.status ?? null]);
  await audit(actor, "Usuario actualizado", id, before, after);
  return after;
}

// ------------------------------------------------------------ notificaciones

export const listNotificationChannels = () =>
  q(`SELECT c.*,
            (SELECT count(*) FROM notification_log l WHERE l.channel_id = c.id) AS attempts,
            (SELECT count(*) FROM notification_log l WHERE l.channel_id = c.id AND l.status = 'delivered') AS delivered,
            (SELECT count(*) FROM notification_log l WHERE l.channel_id = c.id AND l.status = 'failed') AS failed
       FROM notification_channel c ORDER BY c.id`);

export async function createNotificationChannel(payload: any, actor: any) {
  const kind = String(payload?.kind ?? "email");
  const target = String(payload?.target ?? "").trim();
  const fieldErrors: Record<string, string> = {};
  if (!["email", "sms", "webhook"].includes(kind)) fieldErrors.kind = "Canal desconocido";
  if (!target) fieldErrors.target = "Requerido";
  if (kind === "email" && target && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) fieldErrors.target = "Correo inválido";
  if (kind === "webhook" && target && !/^https:\/\//.test(target)) fieldErrors.target = "El webhook debe usar HTTPS";
  if (Object.keys(fieldErrors).length) {
    throw new ApiError(422, "VALIDATION_ERROR", "La configuración contiene campos inválidos", fieldErrors);
  }
  const created = await one(
    `INSERT INTO notification_channel (kind, target, min_severity) VALUES ($1,$2,$3) RETURNING *`,
    [kind, target, payload?.minSeverity ?? "warning"]);
  await audit(actor, "Canal de notificación creado", `${kind}:${target}`, null, created);
  return created;
}

export async function updateNotificationChannel(id: string, payload: any, actor: any) {
  const before = await one(`SELECT * FROM notification_channel WHERE id = $1`, [id]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Canal no existe");
  const after = await one(
    `UPDATE notification_channel SET enabled = COALESCE($2, enabled),
            min_severity = COALESCE($3, min_severity), target = COALESCE($4, target)
      WHERE id = $1 RETURNING *`,
    [id, payload?.enabled ?? null, payload?.minSeverity ?? null, payload?.target ?? null]);
  await audit(actor, "Canal de notificación actualizado", String(id), before, after);
  return after;
}

export const notificationLog = (limit = 50) =>
  q(`SELECT l.*, c.kind, c.target FROM notification_log l
       LEFT JOIN notification_channel c ON c.id = l.channel_id
      ORDER BY l.attempted_at DESC LIMIT $1`, [limit]);

// ------------------------------------------------------------- claves de API

export const listApiKeys = () =>
  q(`SELECT id, name, key_prefix, scope, active, created_at, last_used_at
       FROM api_key ORDER BY created_at DESC`);

export async function createApiKey(payload: any, actor: any) {
  const name = String(payload?.name ?? "").trim();
  if (!name) throw new ApiError(422, "VALIDATION_ERROR", "La configuración contiene campos inválidos", { name: "Requerido" });
  // La clave en claro se devuelve UNA sola vez; en la base sólo queda el hash.
  const raw = `cam5_live_${randomBytes(24).toString("hex")}`;
  const created = await one(
    `INSERT INTO api_key (name, key_hash, key_prefix, scope) VALUES ($1,$2,$3,$4)
     RETURNING id, name, key_prefix, scope, active, created_at, last_used_at`,
    [name, sha256(raw), raw.slice(0, 14), payload?.scope ?? "read"]);
  await audit(actor, "Clave de API creada", name, null, { scope: payload?.scope ?? "read" });
  return { ...created, key: raw };
}

export async function setApiKeyActive(id: string, active: boolean, actor: any) {
  const before = await one(`SELECT id, name, active FROM api_key WHERE id = $1`, [id]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Clave no existe");
  const after = await one(
    `UPDATE api_key SET active = $2 WHERE id = $1
     RETURNING id, name, key_prefix, scope, active, created_at, last_used_at`, [id, active]);
  await audit(actor, active ? "Clave de API reactivada" : "Clave de API revocada", before.name, before, after);
  return after;
}

// ----------------------------------------------------------------- reportes

export const listReports = (assetId?: string) =>
  q(`SELECT r.*, u.full_name AS requested_by_name FROM report r
       LEFT JOIN app_user u ON u.id = r.requested_by
      WHERE ($1::text IS NULL OR r.asset_id = $1)
      ORDER BY r.created_at DESC LIMIT 50`, [assetId ?? null]);

/**
 * Genera el reporte fuera del ciclo de la petición: la API responde `pending`
 * de inmediato y el portal sondea hasta `ready`. Un informe de 30 días puede
 * tardar más que cualquier timeout HTTP razonable.
 */
export async function requestReport(payload: any, actor: any) {
  const assetId = String(payload?.assetId ?? "");
  const from = new Date(payload?.from);
  const to = new Date(payload?.to);
  const fieldErrors: Record<string, string> = {};
  if (!assetId) fieldErrors.assetId = "Requerido";
  if (Number.isNaN(from.getTime())) fieldErrors.from = "Fecha inválida";
  if (Number.isNaN(to.getTime())) fieldErrors.to = "Fecha inválida";
  if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from >= to) {
    fieldErrors.from = "El inicio debe ser anterior al término";
  }
  if (Object.keys(fieldErrors).length) {
    throw new ApiError(422, "VALIDATION_ERROR", "La configuración contiene campos inválidos", fieldErrors);
  }

  const id = `RP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex")}`;
  const created = await one(
    `INSERT INTO report (id, asset_id, kind, period_from, period_to, status, requested_by)
     VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING *`,
    [id, assetId, payload?.kind ?? "condition", from, to, actor?.id ?? null]);

  setImmediate(() => generateReport(id, assetId, from, to).catch(async (error) => {
    await q(`UPDATE report SET status = 'failed', error = $2 WHERE id = $1`,
      [id, String(error?.message ?? error).slice(0, 500)]);
  }));

  await audit(actor, "Reporte solicitado", id, null, created);
  return created;
}

async function generateReport(id: string, assetId: string, from: Date, to: Date) {
  const rows = await q(
    `SELECT u.id AS unidad, c.code AS canal, c.label AS etiqueta, c.zone AS zona,
            cm.metric AS metrica, cm.uom AS unidad_medida,
            r.bucket AS instante, r.avg_value AS promedio, r.min_value AS minimo,
            r.max_value AS maximo, r.samples AS muestras, r.worst_quality AS calidad
       FROM reading_rollup_1h r
       JOIN channel_metric cm ON cm.id = r.channel_metric_id
       JOIN channel c ON c.id = cm.channel_id
       JOIN unit u ON u.id = c.unit_id
      WHERE u.asset_id = $1 AND r.bucket >= $2 AND r.bucket < $3
      ORDER BY u.id, c.code, cm.metric, r.bucket`,
    [assetId, from, to]);

  const header = ["unidad", "canal", "etiqueta", "zona", "metrica", "unidad_medida",
    "instante", "promedio", "minimo", "maximo", "muestras", "calidad"];
  const escape = (value: any) => {
    // Fechas en ISO 8601 UTC, no en el formato por defecto de JS.
    const text = value === null || value === undefined ? ""
      : value instanceof Date ? value.toISOString()
      : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header.join(","), ...rows.map((row) => header.map((key) => escape((row as any)[key])).join(","))].join("\n");

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, `${id}.csv`), "﻿" + csv, "utf8");
  await q(
    `UPDATE report SET status = 'ready', ready_at = now(), download_url = $2 WHERE id = $1`,
    [id, `/api/v1/reports/${id}/download`]);
}

// -------------------------------------------------------- histórico paginado

/** Paginación por cursor opaco, según la convención de BACKEND_INTEGRATION.md. */
export async function measurements(assetId: string, params: {
  unitId?: string; channel?: string; metric?: string; cursor?: string; limit?: number;
}) {
  const limit = Math.min(500, Math.max(1, Number(params.limit ?? 50)));
  let before: Date | null = null;
  if (params.cursor) {
    try {
      before = new Date(Buffer.from(params.cursor, "base64url").toString("utf8"));
      if (Number.isNaN(before.getTime())) before = null;
    } catch { before = null; }
  }

  const rows = await q(
    `SELECT r.ts, r.value, r.quality, r.seq,
            u.id AS unit_id, c.code AS channel, c.label, c.zone, cm.metric, cm.uom,
            cm.warn_threshold AS warn, cm.crit_threshold AS crit
       FROM reading r
       JOIN channel_metric cm ON cm.id = r.channel_metric_id
       JOIN channel c ON c.id = cm.channel_id
       JOIN unit u ON u.id = c.unit_id
      WHERE u.asset_id = $1
        AND ($2::text IS NULL OR u.id = $2)
        AND ($3::text IS NULL OR c.code = $3)
        AND ($4::text IS NULL OR cm.metric = $4)
        AND ($5::timestamptz IS NULL OR r.ts < $5)
      ORDER BY r.ts DESC
      LIMIT $6`,
    [assetId, params.unitId ?? null, params.channel ?? null, params.metric ?? null, before, limit + 1]
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length
    ? Buffer.from(new Date((page[page.length - 1] as any).ts).toISOString()).toString("base64url")
    : null;
  return { items: page, nextCursor };
}

// ------------------------------------------------------------- mapa Modbus

export const modbusMap = (assetId: string) =>
  q(`SELECT c.id, c.unit_id, c.code, c.kind, c.label, c.enabled,
            c.register, c.data_type, c.scale, c.byte_order, c.map_confirmed,
            u.unit_address
       FROM channel c JOIN unit u ON u.id = c.unit_id
      WHERE u.asset_id = $1 ORDER BY c.unit_id, c.register NULLS LAST, c.code`, [assetId]);

export async function saveModbusMap(assetId: string, entries: any[], actor: any) {
  if (!Array.isArray(entries)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Se esperaba una lista de canales", { entries: "Requerido" });
  }
  // Una referencia Modbus no puede repetirse dentro del mismo Unit ID.
  const seen = new Map<string, string>();
  const fieldErrors: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.register === null || entry.register === undefined) continue;
    const register = Number(entry.register);
    if (!Number.isInteger(register) || register < 0 || register > 65535 + 40000) {
      fieldErrors[`register:${entry.id}`] = "Registro fuera de rango";
      continue;
    }
    const key = `${entry.unitId ?? entry.unit_id}|${register}`;
    if (seen.has(key)) {
      fieldErrors[`register:${entry.id}`] = `Duplicado con ${seen.get(key)} en el mismo Unit ID`;
    } else {
      seen.set(key, entry.code ?? String(entry.id));
    }
  }
  if (Object.keys(fieldErrors).length) {
    throw new ApiError(422, "VALIDATION_ERROR", "La configuración contiene campos inválidos", fieldErrors);
  }

  const before = await modbusMap(assetId);
  for (const entry of entries) {
    await q(
      `UPDATE channel SET register = $2, data_type = COALESCE($3, data_type),
              scale = COALESCE($4, scale), byte_order = COALESCE($5, byte_order),
              map_confirmed = COALESCE($6, map_confirmed)
        WHERE id = $1`,
      [entry.id, entry.register ?? null, entry.dataType ?? null, entry.scale ?? null,
       entry.byteOrder ?? null, entry.mapConfirmed ?? null]);
  }
  // Sube la versión de configuración para que el gateway vuelva a descargar su perfil.
  await q(`UPDATE gateway SET config_version = config_version + 1
            WHERE id IN (SELECT DISTINCT gateway_id FROM unit WHERE asset_id = $1)`, [assetId]);
  await audit(actor, "Mapa Modbus actualizado", assetId, before, entries);
  return modbusMap(assetId);
}

export async function updateAsset(assetId: string, payload: any, actor: any) {
  const before = await one(`SELECT * FROM asset WHERE id = $1`, [assetId]);
  if (!before) throw new ApiError(404, "NOT_FOUND", "Activo no existe");
  const after = await one(
    `UPDATE asset SET name = COALESCE($2, name), description = COALESCE($3, description),
            voltage_kv = COALESCE($4, voltage_kv), location = COALESCE($5, location),
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [assetId, payload?.name ?? null, payload?.description ?? null,
     payload?.voltageKv ?? null, payload?.location ?? null]);
  await audit(actor, "Activo actualizado", assetId, before, after);
  return after;
}

export { randomUUID };
