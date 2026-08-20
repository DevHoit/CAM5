/**
 * Verifica las invariantes de DELIVERY_CHECKLIST.md y DATA_CONTRACTS.md.
 * Requiere el servidor arriba y la base sembrada:
 *   npm run migrate && npm run seed && npm start
 *   npm test
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";

const BASE = process.env.CAM5_CORE_URL ?? "http://127.0.0.1:8787/api/v1";
const KEY = process.env.CAM5_GATEWAY_KEY ?? "cam5_gw_devkey123";
const SECRET = process.env.CAM5_GATEWAY_SECRET ?? "devsecret456";
const USER = { "X-CAM5-User": process.env.CAM5_TEST_USER ?? "admin@example.com", "Content-Type": "application/json" };

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const id = () => randomBytes(16).toString("hex").toUpperCase();

function gwHeaders(method: string, path: string, raw: string, key = KEY, secret = SECRET) {
  const t = new Date().toISOString();
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
    "X-CAM5-Gateway-Id": "CAM5-GW-01",
    "X-CAM5-Timestamp": t,
    "X-CAM5-Signature": "v1=" + createHmac("sha256", secret)
      .update(`${method}\n/api/v1${path}\n${t}\n${sha256(raw)}`).digest("hex"),
  };
}

async function ingest(body: any, opts: { key?: string; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const response = await fetch(`${BASE}/ingest/telemetry`, {
    method: "POST",
    headers: { ...gwHeaders("POST", "/ingest/telemetry", raw, opts.key, opts.secret), "Idempotency-Key": body.batchId },
    body: raw,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function reading(over: any = {}) {
  return {
    seq: Math.floor(Math.random() * 1e9), unitId: "CAM5-01", channel: "T09",
    metric: "temperature", value: 44.5, uom: "degC", quality: "good",
    ts: new Date().toISOString(), ...over,
  };
}
const batchOf = (readings: any[]) => ({
  schemaVersion: "1.0", batchId: id(), siteId: "subestacion-norte",
  gatewayId: "CAM5-GW-01", sentAt: new Date().toISOString(), readings,
});

before(async () => {
  const response = await fetch(`${BASE}/health`);
  assert.equal(response.status, 200, "el servidor debe estar arriba");
});

test("rechaza credencial desconocida", async () => {
  const { status } = await ingest(batchOf([reading()]), { key: "no-existe" });
  assert.equal(status, 401);
});

test("rechaza firma HMAC inválida", async () => {
  const { status } = await ingest(batchOf([reading()]), { secret: "secreto-equivocado" });
  assert.equal(status, 401);
});

test("reenviar el mismo lote no duplica datos", async () => {
  const batch = batchOf([reading(), reading({ channel: "T10" })]);
  const first = await ingest(batch);
  const second = await ingest(batch);
  assert.equal(first.status, 202);
  assert.equal(first.body.duplicate, false);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.accepted, first.body.accepted);
});

test("un canal desconocido se rechaza sin tumbar el lote", async () => {
  const { status, body } = await ingest(batchOf([
    reading(),
    reading({ channel: "NO-EXISTE" }),
  ]));
  assert.equal(status, 202);
  assert.equal(body.accepted, 1);
  assert.equal(body.rejected.length, 1);
  assert.equal(body.rejected[0].code, "UNKNOWN_CHANNEL");
});

test("una quality inválida se rechaza", async () => {
  const { body } = await ingest(batchOf([reading({ quality: "cero" })]));
  assert.equal(body.rejected[0].code, "BAD_QUALITY");
});

test("una muestra ausente no puede declararse good", async () => {
  const raw = {
    schemaVersion: "1.0", batchId: id(), siteId: "subestacion-norte", gatewayId: "CAM5-GW-01",
    sentAt: new Date().toISOString(),
    series: [{
      unitId: "CAM5-01", channel: "T11", metric: "temperature", uom: "degC",
      seqStart: 1, t0: new Date().toISOString(), dtMs: 1000,
      values: [40.1, null, 40.3], quality: ["good", "good", "good"],
    }],
  };
  const { body } = await ingest(raw);
  assert.equal(body.accepted, 2);
  assert.equal(body.rejected[0].code, "NULL_GOOD");
});

test("acepta el formato de serie comprimida", async () => {
  const t0 = new Date(Date.now() - 5000).toISOString();
  const { status, body } = await ingest({
    schemaVersion: "1.0", batchId: id(), siteId: "subestacion-norte", gatewayId: "CAM5-GW-01",
    sentAt: new Date().toISOString(),
    series: [{
      unitId: "CAM5-01", channel: "T12", metric: "temperature", uom: "degC",
      seqStart: 500000, t0, dtMs: 1000, values: [41, 41.2, 41.4, 41.5], quality: "good",
    }],
  });
  assert.equal(status, 202);
  assert.equal(body.accepted, 4);
});

test("la reinyección con timestamps antiguos no pisa la lectura actual", async () => {
  const now = new Date();
  await ingest(batchOf([reading({ channel: "T08", value: 55.5, ts: now.toISOString() })]));
  const old = new Date(now.getTime() - 3_600_000).toISOString();
  await ingest(batchOf([reading({ channel: "T08", value: 20.0, ts: old })]));

  const latest = await (await fetch(`${BASE}/assets/MCC-01/readings/latest`, { headers: USER })).json();
  const row = latest.find((r: any) => r.unit_id === "CAM5-01" && r.channel === "T08" && r.metric === "temperature");
  assert.equal(Number(row.value), 55.5, "reading_latest debe conservar el dato más reciente");
});

test("el portal distingue atrasado de sin conexión", async () => {
  const fresh = await (await fetch(`${BASE}/assets/MCC-01/readings/latest?staleAfterS=3600`, { headers: USER })).json();
  const stale = await (await fetch(`${BASE}/assets/MCC-01/readings/latest?staleAfterS=0`, { headers: USER })).json();
  const pick = (rows: any[]) => rows.find((r) => r.channel === "T09" && r.metric === "temperature");
  assert.equal(pick(fresh).quality, "good");
  assert.equal(pick(stale).quality, "stale");
});

test("el umbral preventivo debe ser menor que el crítico", async () => {
  const channels = await (await fetch(`${BASE}/assets/MCC-01/channels`, { headers: USER })).json();
  const t02 = channels.find((c: any) => c.unit_id === "CAM5-01" && c.code === "T02");
  const metric = t02.metrics.find((m: any) => m.metric === "temperature");
  const response = await fetch(`${BASE}/channel-metrics/${metric.id}`, {
    method: "PATCH", headers: USER, body: JSON.stringify({ warn: 90, crit: 80 }),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.ok(body.fieldErrors.warn);
  assert.ok(body.traceId);
});

test("cerrar una alarma exige nota", async () => {
  const alarms = await (await fetch(`${BASE}/alarms`, { headers: USER })).json();
  const open = alarms.find((a: any) => a.status !== "closed");
  if (!open) return; // sin alarmas abiertas en este entorno
  const response = await fetch(`${BASE}/alarms/${open.id}/close`, {
    method: "POST", headers: USER, body: JSON.stringify({}),
  });
  assert.equal(response.status, 422);
});

test("una alarma no genera órdenes de trabajo duplicadas", async () => {
  const alarms = await (await fetch(`${BASE}/alarms`, { headers: USER })).json();
  const target = alarms[0];
  if (!target) return;
  const payload = JSON.stringify({ assetId: "MCC-01", alarmId: target.id, title: "Prueba", priority: "high" });
  const a = await (await fetch(`${BASE}/work-orders`, { method: "POST", headers: USER, body: payload })).json();
  const b = await (await fetch(`${BASE}/work-orders`, { method: "POST", headers: USER, body: payload })).json();
  assert.equal(a.id, b.id);
});

test("el rol se aplica en el servidor, no sólo en la interfaz", async () => {
  const alarms = await (await fetch(`${BASE}/alarms`, { headers: USER })).json();
  const target = alarms.find((a: any) => a.status !== "closed");
  if (!target) return;
  const response = await fetch(`${BASE}/alarms/${target.id}/close`, {
    method: "POST",
    headers: { "X-CAM5-User": "felipe.soto@example.cl", "Content-Type": "application/json" },
    body: JSON.stringify({ note: "intento desde rol operador" }),
  });
  assert.equal(response.status, 403);
});

test("las tendencias eligen granularidad según el rango", async () => {
  const url = (from: string, to: string) =>
    `${BASE}/assets/MCC-01/trends?unitId=CAM5-01&channel=T01&metric=temperature&from=${from}&to=${to}`;
  const now = Date.now();
  const short = await (await fetch(url(new Date(now - 2 * 3600e3).toISOString(), new Date(now).toISOString()), { headers: USER })).json();
  const long = await (await fetch(url(new Date(now - 30 * 86400e3).toISOString(), new Date(now).toISOString()), { headers: USER })).json();
  assert.equal(short.grain, "raw");
  assert.equal(long.grain, "1h");
});

test("la reinyección tardía sí entra en los agregados", async () => {
  // Regresión: con un watermark sobre `ts` en lugar de `received_at`, las
  // lecturas que el gateway reinyecta tras un corte quedaban fuera de los
  // agregados para siempre y las tendencias largas mostraban un hueco.
  const { execFileSync } = await import("node:child_process");
  const { Client } = await import("pg");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // 1. Agregación al día.
    execFileSync("node", ["src/rollup.ts"], { stdio: "pipe" });

    // 2. Llega un dato con timestamp de hace 3 días (el corte que se reinyecta).
    const late = new Date(Date.now() - 3 * 86_400_000);
    late.setUTCSeconds(0, 0);
    await ingest({
      schemaVersion: "1.0", batchId: id(), siteId: "subestacion-norte", gatewayId: "CAM5-GW-01",
      sentAt: new Date().toISOString(),
      readings: [reading({ channel: "T07", value: 33.3, ts: late.toISOString() })],
    });

    // 3. Otra pasada de agregación.
    execFileSync("node", ["src/rollup.ts"], { stdio: "pipe" });

    const { rows } = await client.query(
      `SELECT r.samples, r.avg_value FROM reading_rollup_1m r
         JOIN channel_metric cm ON cm.id = r.channel_metric_id
         JOIN channel c ON c.id = cm.channel_id
        WHERE c.unit_id = 'CAM5-01' AND c.code = 'T07' AND cm.metric = 'temperature'
          AND r.bucket = $1`,
      [late.toISOString()]
    );
    assert.equal(rows.length, 1, "el bucket reinyectado debe existir en el agregado");
    assert.equal(Number(rows[0].avg_value), 33.3);
  } finally {
    await client.end();
  }
});

test("un usuario no puede dejar el sistema sin administradores ni auto-bloquearse", async () => {
  const me = await (await fetch(`${BASE}/session`, { headers: USER })).json();
  const response = await fetch(`${BASE}/users/${me.user.id}`, {
    method: "PATCH", headers: USER, body: JSON.stringify({ status: "suspended" }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SELF_LOCKOUT");
});

test("un webhook de notificación debe usar HTTPS", async () => {
  const response = await fetch(`${BASE}/notification-channels`, {
    method: "POST", headers: USER,
    body: JSON.stringify({ kind: "webhook", target: "http://inseguro.example.cl/hook" }),
  });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).fieldErrors.target);
});

test("la clave de API sólo se muestra al crearla", async () => {
  const created = await (await fetch(`${BASE}/api-keys`, {
    method: "POST", headers: USER, body: JSON.stringify({ name: `Prueba ${Date.now()}`, scope: "read" }),
  })).json();
  assert.ok(created.key?.startsWith("cam5_live_"), "la creación devuelve la clave completa");

  const listed = await (await fetch(`${BASE}/api-keys`, { headers: USER })).json();
  const same = listed.find((key: any) => key.id === created.id);
  assert.equal(same.key, undefined, "el listado nunca vuelve a exponer la clave");
  assert.ok(same.key_prefix.length > 0);
});

test("un registro Modbus no puede repetirse dentro del mismo Unit ID", async () => {
  const map = await (await fetch(`${BASE}/assets/MCC-01/modbus-map`, { headers: USER })).json();
  const two = map.filter((entry: any) => entry.unit_id === "CAM5-01").slice(0, 2);
  const response = await fetch(`${BASE}/assets/MCC-01/modbus-map`, {
    method: "PUT", headers: USER,
    body: JSON.stringify({ entries: two.map((entry: any) => ({ id: entry.id, unit_id: entry.unit_id, code: entry.code, register: 49999 })) }),
  });
  assert.equal(response.status, 422);
  assert.ok(Object.keys((await response.json()).fieldErrors).length > 0);
});

test("el reporte se genera de forma asíncrona y queda descargable", async () => {
  const to = new Date();
  const from = new Date(to.getTime() - 3 * 3600e3);
  const created = await (await fetch(`${BASE}/reports`, {
    method: "POST", headers: USER,
    body: JSON.stringify({ assetId: "MCC-01", kind: "condition", from: from.toISOString(), to: to.toISOString() }),
  })).json();
  assert.equal(created.status, "pending", "la API responde de inmediato, sin bloquear");

  let status = "pending";
  for (let attempt = 0; attempt < 30 && status === "pending"; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    const list = await (await fetch(`${BASE}/reports?assetId=MCC-01`, { headers: USER })).json();
    status = list.find((report: any) => report.id === created.id)?.status ?? "pending";
  }
  assert.equal(status, "ready");

  const download = await fetch(`${BASE}/reports/${created.id}/download`, { headers: USER });
  assert.equal(download.status, 200);
  const csv = await download.text();
  assert.match(csv.split("\n")[0], /unidad,canal/);
  assert.match(csv.split("\n")[1] ?? "", /\d{4}-\d{2}-\d{2}T/, "las fechas del CSV van en ISO 8601");
});

test("el histórico pagina por cursor sin repetir filas", async () => {
  const url = (cursor?: string) =>
    `${BASE}/assets/MCC-01/measurements?unitId=CAM5-01&channel=T01&metric=temperature&limit=10${cursor ? `&cursor=${cursor}` : ""}`;
  const first = await (await fetch(url(), { headers: USER })).json();
  assert.equal(first.items.length, 10);
  assert.ok(first.nextCursor);

  const second = await (await fetch(url(first.nextCursor), { headers: USER })).json();
  const overlap = second.items.filter((row: any) => first.items.some((prev: any) => prev.ts === row.ts));
  assert.equal(overlap.length, 0, "las páginas no deben solaparse");
  assert.ok(Date.parse(second.items[0].ts) < Date.parse(first.items.at(-1).ts));
});

test("acepta lotes comprimidos con gzip", async () => {
  // El gateway envía `Content-Encoding: gzip`. El servidor descomprime antes de
  // parsear, así que la firma HMAC se calcula sobre el JSON sin comprimir.
  const { gzipSync } = await import("node:zlib");
  const readings = Array.from({ length: 300 }, (_, index) => reading({
    channel: "T12",
    value: 40 + index * 0.01,
    ts: new Date(Date.now() - index * 1000).toISOString(),
    seq: 900000 + index,
  }));
  const body = batchOf(readings);
  const raw = JSON.stringify(body);
  const compressed = gzipSync(Buffer.from(raw));
  assert.ok(compressed.length < raw.length / 5, "el lote debe comprimir bien");

  const response = await fetch(`${BASE}/ingest/telemetry`, {
    method: "POST",
    headers: {
      ...gwHeaders("POST", "/ingest/telemetry", raw),
      "Content-Encoding": "gzip",
      "Idempotency-Key": body.batchId,
    },
    body: compressed,
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).accepted, 300);
});
