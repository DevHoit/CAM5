/**
 * Siembra la capacidad completa del CAM-5: una unidad principal más 9 lectores
 * IRM, cada uno con 12 canales de temperatura, 4 de descarga parcial,
 * 8 de humedad, 6 relés y la señal de salud.
 */
import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db.ts";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

// Período de muestreo del gateway. De él salen el latido y los retardos de
// alarma: un retardo menor que el período nunca se cumpliría con una sola
// muestra, y uno mucho mayor retrasa la alarma sin motivo.
const SAMPLE_S = Number(process.env.CAM5_SAMPLE_INTERVAL_S ?? 5);
const HEARTBEAT_S = Number(process.env.CAM5_SEED_HEARTBEAT_S ?? Math.max(10, SAMPLE_S));
// Dos muestras consecutivas sobre umbral antes de abrir la alarma.
const DELAY_FAST = Math.max(60, SAMPLE_S * 2);
const DELAY_SLOW = Math.max(300, SAMPLE_S * 4);

const SITE = { id: "subestacion-norte", name: "Subestación Norte" };
const ASSET = { id: "MCC-01", name: "MCC-01", description: "Alimentador Norte", voltage: 13.8, location: "Subestación Norte" };
const GATEWAY_ID = "CAM5-GW-01";

const TEMP_ZONES = ["Barras principales", "Barras principales", "Barras principales",
  "Interruptor", "Interruptor", "Interruptor", "Compartimiento de cables",
  "Compartimiento de cables", "Compartimiento de cables", "Entrada", "Entrada", "Entrada"];

type MetricSpec = {
  metric: string; uom: string; primary?: boolean; deadband?: number; heartbeat?: number;
  warn?: number | null; crit?: number | null; hysteresis?: number; delayS?: number;
};

const PD_METRICS: MetricSpec[] = [
  { metric: "q_peak",      uom: "QUHF",  primary: true, deadband: 1,    warn: 40,  crit: 60, hysteresis: 3, delayS: DELAY_FAST },
  { metric: "sd_max",      uom: "QUHF",  deadband: 1 },
  { metric: "pd_max",      uom: "QUHF",  deadband: 1 },
  { metric: "noise_floor", uom: "QUHF",  deadband: 1, heartbeat: HEARTBEAT_S },
  { metric: "snr",         uom: "dB",    deadband: 0.5, heartbeat: HEARTBEAT_S },
  { metric: "trend_alpha", uom: "QUHF",  deadband: 1, heartbeat: HEARTBEAT_S },
  { metric: "trend_beta",  uom: "QUHF",  deadband: 1, heartbeat: HEARTBEAT_S },
  { metric: "trend_phi",   uom: "ratio", deadband: 0.05, warn: 1.5, crit: 2.5, hysteresis: 0.2, delayS: DELAY_SLOW },
];

const SYSTEM_METRICS: MetricSpec[] = [
  { metric: "comm_ok",               uom: "bool",  primary: true, heartbeat: HEARTBEAT_S },
  { metric: "poll_latency_ms",       uom: "ms",    deadband: 5,  heartbeat: HEARTBEAT_S },
  { metric: "retries_24h",           uom: "count", deadband: 1,  heartbeat: HEARTBEAT_S },
  { metric: "modbus_exceptions_24h", uom: "count", deadband: 1,  heartbeat: HEARTBEAT_S },
  { metric: "readers_online",        uom: "count", deadband: 1,  heartbeat: HEARTBEAT_S },
];

function channelsFor(unitId: string) {
  const list: { code: string; kind: string; label: string; zone: string | null; metrics: MetricSpec[] }[] = [];

  for (let i = 1; i <= 12; i++) {
    const code = `T${String(i).padStart(2, "0")}`;
    list.push({
      code, kind: "temperature", label: `Sensor SAW ${code}`, zone: TEMP_ZONES[i - 1],
      metrics: [{ metric: "temperature", uom: "degC", primary: true, deadband: 0.2, heartbeat: HEARTBEAT_S, warn: 65, crit: 75, hysteresis: 1.5, delayS: DELAY_FAST }],
    });
  }
  for (let i = 1; i <= 4; i++) {
    const code = `PD${i}`;
    list.push({
      code, kind: "partial_discharge", label: `Canal UHF ${String(i).padStart(2, "0")}`,
      zone: i <= 2 ? "Compartimiento de cables" : "Barras principales",
      metrics: PD_METRICS,
    });
  }
  for (let i = 1; i <= 8; i++) {
    const code = `H${String(i).padStart(2, "0")}`;
    list.push({
      code, kind: "humidity", label: `Ambiente ${code}`, zone: "Compartimiento de cables",
      metrics: [
        { metric: "relative_humidity",   uom: "percentRH", primary: true, deadband: 0.5, heartbeat: HEARTBEAT_S, warn: 75, crit: 85, hysteresis: 2, delayS: DELAY_SLOW },
        { metric: "ambient_temperature", uom: "degC",      deadband: 0.2, heartbeat: HEARTBEAT_S },
      ],
    });
  }
  for (let i = 1; i <= 6; i++) {
    list.push({
      code: `RLY${i}`, kind: "relay", label: `Relé de alarma ${i}`, zone: "Salidas",
      metrics: [{ metric: "relay_state", uom: "bool", primary: true, heartbeat: HEARTBEAT_S }],
    });
  }
  list.push({ code: "SYS", kind: "system", label: `Salud ${unitId}`, zone: null, metrics: SYSTEM_METRICS });
  return list;
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  await client.query(
    `INSERT INTO site (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [SITE.id, SITE.name]);
  await client.query(
    `INSERT INTO asset (id, site_id, name, description, voltage_kv, location)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
    [ASSET.id, SITE.id, ASSET.name, ASSET.description, ASSET.voltage, ASSET.location]);

  const apiKey = process.env.CAM5_SEED_GATEWAY_KEY ?? `cam5_gw_${randomBytes(24).toString("hex")}`;
  const hmacSecret = process.env.CAM5_SEED_GATEWAY_SECRET ?? randomBytes(32).toString("hex");
  await client.query(
    `INSERT INTO gateway (id, site_id, name, api_key_hash, hmac_secret)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, hmac_secret = EXCLUDED.hmac_secret`,
    [GATEWAY_ID, SITE.id, "Gateway Subestación Norte", sha256(apiKey), hmacSecret]);

  // El administrador inicial se define por entorno: no conviene fijar un correo
  // real en el código de un repositorio.
  const adminEmail = process.env.CAM5_ADMIN_EMAIL ?? "admin@example.com";
  const adminName = process.env.CAM5_ADMIN_NAME ?? "Administrador";
  const users = [
    ["u-admin", adminEmail, adminName, "admin"],
    ["u-paula", "paula.rojas@example.cl", "Paula Rojas", "engineer"],
    ["u-felipe", "felipe.soto@example.cl", "Felipe Soto", "operator"],
  ];
  for (const [id, email, name, role] of users) {
    await client.query(
      `INSERT INTO app_user (id, email, full_name, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`, [id, email, name, role]);
  }

  // Cuántos lectores IRM cuelgan del CAM-5. Un piloto de una sola unidad usa 0.
  const readerCount = Number(process.env.CAM5_SEED_READERS ?? 9);
  const unitIds = ["CAM5-01",
    ...Array.from({ length: readerCount }, (_, i) => `CAM5-01/IRM-${String(i + 1).padStart(2, "0")}`)];
  let channelCount = 0;
  let metricCount = 0;

  for (const unitId of unitIds) {
    const isMain = unitId === "CAM5-01";
    await client.query(
      `INSERT INTO unit (id, asset_id, gateway_id, parent_unit_id, kind, name, model, transport, endpoint, unit_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [unitId, ASSET.id, GATEWAY_ID, isMain ? null : "CAM5-01",
       isMain ? "cam5" : "irm", unitId,
       isMain ? "CAM5B-TPH-AMEU" : "IntelliSAW IRM",
       "modbus-tcp", isMain ? "192.168.10.42:502" : "192.168.10.42:502",
       isMain ? 1 : unitIds.indexOf(unitId) + 1]);

    for (const channel of channelsFor(unitId)) {
      const inserted = await client.query(
        `INSERT INTO channel (unit_id, code, kind, label, zone)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (unit_id, code) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [unitId, channel.code, channel.kind, channel.label, channel.zone]);
      const channelId = inserted.rows[0].id;
      channelCount++;
      for (const m of channel.metrics) {
        await client.query(
          `INSERT INTO channel_metric (channel_id, metric, uom, is_primary, deadband, heartbeat_s,
                                       warn_threshold, crit_threshold, hysteresis, delay_s)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (channel_id, metric) DO NOTHING`,
          [channelId, m.metric, m.uom, m.primary ?? false, m.deadband ?? null, m.heartbeat ?? HEARTBEAT_S,
           m.warn ?? null, m.crit ?? null, m.hysteresis ?? 0, m.delayS ?? 0]);
        metricCount++;
      }
    }
  }

  await client.query(
    `INSERT INTO notification_channel (kind, target, min_severity)
     VALUES ('email','operaciones@example.cl','warning') ON CONFLICT DO NOTHING`);

  await client.query("COMMIT");
  console.log(`unidades: ${unitIds.length}`);
  console.log(`canales:  ${channelCount}`);
  console.log(`series:   ${metricCount}  (${metricCount / unitIds.length} por unidad)`);
  console.log(`muestreo: cada ${SAMPLE_S} s · latido ${HEARTBEAT_S} s · retardo de alarma ${DELAY_FAST}/${DELAY_SLOW} s`);
  console.log(`\nCredenciales del gateway (guárdalas, la clave no se vuelve a mostrar):`);
  console.log(`  CAM5_GATEWAY_KEY=${apiKey}`);
  console.log(`  CAM5_GATEWAY_SECRET=${hmacSecret}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
