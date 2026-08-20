/**
 * Gateway simulado. Emite exactamente el payload de CAM5_GATEWAY_SPEC.md para
 * que el backend y el portal puedan desarrollarse sin el equipo físico ni el
 * mapa Modbus. Implementa deadband, latido, firma HMAC, idempotencia y
 * almacenamiento con reinyección tras un corte.
 *
 *   node tools/fake-gateway.ts --minutes 2
 *   node tools/fake-gateway.ts --backfill-hours 6      (reinyección de un corte)
 *   node tools/fake-gateway.ts --offline-after 20 --offline-for 30
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "true");
}
const num = (key: string, fallback: number) => Number(args.get(key) ?? fallback);

const BASE = process.env.CAM5_CORE_URL ?? "http://127.0.0.1:8787/api/v1";
const KEY = process.env.CAM5_GATEWAY_KEY ?? "cam5_gw_devkey123";
const SECRET = process.env.CAM5_GATEWAY_SECRET ?? "devsecret456";
const GATEWAY_ID = process.env.CAM5_GATEWAY_ID ?? "CAM5-GW-01";
const SITE_ID = process.env.CAM5_SITE_ID ?? "subestacion-norte";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const ulid = () => randomBytes(16).toString("hex").toUpperCase();

function signedHeaders(method: string, path: string, raw: string, extra: Record<string, string> = {}) {
  const timestamp = new Date().toISOString();
  const stringToSign = `${method}\n/api/v1${path}\n${timestamp}\n${sha256(raw)}`;
  return {
    "Authorization": `Bearer ${KEY}`,
    "X-CAM5-Gateway-Id": GATEWAY_ID,
    "X-CAM5-Timestamp": timestamp,
    "X-CAM5-Signature": "v1=" + createHmac("sha256", SECRET).update(stringToSign).digest("hex"),
    "X-CAM5-Schema-Version": "1.0",
    ...extra,
  };
}

async function send(path: string, body: any) {
  const raw = JSON.stringify(body);
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: signedHeaders("POST", path, raw, {
      "Content-Type": "application/json",
      "Idempotency-Key": body.batchId,
    }),
    body: raw,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

// ------------------------------------------------------------ modelo físico
type Sim = {
  unitId: string; channel: string; metric: string; uom: string;
  value: number; drift: number; noise: number; min: number; max: number;
  deadband: number; heartbeatS: number;
  lastSent: number | null; lastSentAt: number;
};

const configResponse = await fetch(`${BASE}/gateway/config`, {
  headers: signedHeaders("GET", "/gateway/config", ""),
});
const config: any = await configResponse.json().catch(() => null);

const channels: any[] = config?.channels ?? [];
if (channels.length === 0) {
  console.error("No se pudo leer /gateway/config. ¿El servidor está arriba y la clave es correcta?");
  process.exit(1);
}

function seedFor(kind: string, metric: string) {
  switch (metric) {
    case "temperature":          return { value: 48 + Math.random() * 12, drift: 0.04, noise: 0.15, min: 15, max: 95 };
    case "ambient_temperature":  return { value: 22 + Math.random() * 4,  drift: 0.01, noise: 0.1,  min: 5,  max: 45 };
    case "relative_humidity":    return { value: 55 + Math.random() * 20, drift: 0.05, noise: 0.3,  min: 10, max: 99 };
    case "q_peak":               return { value: 12 + Math.random() * 20, drift: 0.15, noise: 1.2,  min: 0,  max: 120 };
    case "sd_max":               return { value: 8  + Math.random() * 15, drift: 0.12, noise: 1.0,  min: 0,  max: 120 };
    case "pd_max":               return { value: 6  + Math.random() * 12, drift: 0.12, noise: 1.0,  min: 0,  max: 120 };
    case "noise_floor":          return { value: 4  + Math.random() * 3,  drift: 0.02, noise: 0.4,  min: 0,  max: 40 };
    case "snr":                  return { value: 14 + Math.random() * 6,  drift: 0.03, noise: 0.5,  min: 0,  max: 40 };
    case "trend_alpha":          return { value: 10 + Math.random() * 10, drift: 0.08, noise: 0.6,  min: 0,  max: 120 };
    case "trend_beta":           return { value: 10 + Math.random() * 6,  drift: 0.02, noise: 0.2,  min: 0,  max: 120 };
    case "trend_phi":            return { value: 0.9 + Math.random() * 0.4, drift: 0.004, noise: 0.02, min: 0, max: 6 };
    case "relay_state":          return { value: 0, drift: 0, noise: 0, min: 0, max: 1 };
    case "comm_ok":              return { value: 1, drift: 0, noise: 0, min: 0, max: 1 };
    case "poll_latency_ms":      return { value: 40 + Math.random() * 10, drift: 0.1, noise: 3, min: 5, max: 900 };
    default:                     return { value: 0, drift: 0, noise: 0.2, min: 0, max: 100 };
  }
}

const sims: Sim[] = channels
  .filter((c) => c.enabled)
  .map((c) => {
    const seed = seedFor(c.kind, c.metric);
    return {
      unitId: c.unit_id, channel: c.code, metric: c.metric, uom: c.uom,
      ...seed,
      deadband: c.deadband === null || c.deadband === undefined ? 0 : Number(c.deadband),
      heartbeatS: Number(c.heartbeat_s ?? 30),
      lastSent: null, lastSentAt: 0,
    };
  });

console.log(`series simuladas: ${sims.length}`);

// Una serie se lleva a condición crítica para que el motor de alarmas del
// servidor tenga algo real que detectar durante la demostración.
const escalating = sims.find((s) => s.channel === "PD1" && s.metric === "q_peak" && s.unitId === "CAM5-01");
const heating = sims.find((s) => s.channel === "T01" && s.metric === "temperature" && s.unitId === "CAM5-01");

function step(sim: Sim, tick: number) {
  let next = sim.value + (Math.random() - 0.5) * 2 * sim.noise + (Math.random() - 0.45) * sim.drift;
  if (sim === escalating) next = sim.value + 0.9 + Math.random() * 0.6;
  if (sim === heating) next = sim.value + 0.35 + Math.random() * 0.2;
  if (sim.metric === "relay_state" || sim.metric === "comm_ok") next = sim.value;
  sim.value = Math.min(sim.max, Math.max(sim.min, next));
  return Number(sim.value.toFixed(3));
}

let seq = Number(args.get("seq-start") ?? 1);

/** Report-by-exception: sólo emite si supera el deadband o vence el latido. */
function collect(at: number) {
  const readings: any[] = [];
  for (const sim of sims) {
    const value = step(sim, at);
    const movedEnough = sim.lastSent === null || Math.abs(value - sim.lastSent) >= sim.deadband;
    const heartbeatDue = at - sim.lastSentAt >= sim.heartbeatS * 1000;
    if (!movedEnough && !heartbeatDue) continue;
    sim.lastSent = value;
    sim.lastSentAt = at;
    readings.push({
      seq: seq++, unitId: sim.unitId, channel: sim.channel, metric: sim.metric,
      value, uom: sim.uom, quality: "good", ts: new Date(at).toISOString(),
    });
  }
  return readings;
}

function batch(readings: any[]) {
  return {
    schemaVersion: "1.0", batchId: ulid(), siteId: SITE_ID, gatewayId: GATEWAY_ID,
    sentAt: new Date().toISOString(), configVersion: config.profileVersion, readings,
  };
}

async function statusBeat(spoolDepth = 0) {
  return send("/ingest/status", {
    schemaVersion: "1.0", batchId: ulid(), gatewayId: GATEWAY_ID, siteId: SITE_ID,
    sentAt: new Date().toISOString(),
    gateway: {
      firmware: "cam5-gw-sim 1.0.0", uptimeSec: Math.floor(process.uptime()),
      clockSync: "ntp", clockOffsetMs: 3, spoolDepth, lastSeq: seq,
      configVersion: config.profileVersion,
    },
    units: [...new Set(sims.map((s) => s.unitId))].map((unitId) => ({
      unitId, transport: "modbus-tcp", endpoint: "192.168.10.42:502", unitAddress: 1,
      online: true, pollCycleMs: 1840, pollLatencyMs: 38 + Math.floor(Math.random() * 12),
      readsOk24h: 43198, readsFailed24h: 2, modbusExceptions24h: 0,
      channelsConfigured: sims.filter((s) => s.unitId === unitId).length,
      channelsGood: sims.filter((s) => s.unitId === unitId).length,
      readersOnline: unitId === "CAM5-01" ? 9 : 0,
    })),
  });
}

// ------------------------------------------------------------ modo backfill
const backfillHours = num("backfill-hours", 0);
if (backfillHours > 0) {
  // Reproduce lo que hace el gateway al recuperar internet: reinyecta el spool
  // con los timestamps ORIGINALES, no con la hora de envío.
  const intervalMs = num("backfill-interval-ms", 60_000);
  const start = Date.now() - backfillHours * 3_600_000;
  let sent = 0, accepted = 0;
  for (let at = start; at <= Date.now(); at += intervalMs) {
    const readings = collect(at);
    if (readings.length === 0) continue;
    for (let i = 0; i < readings.length; i += 2000) {
      const { status, json } = await send("/ingest/telemetry", batch(readings.slice(i, i + 2000)));
      if (status !== 202) { console.error("fallo", status, json); process.exit(1); }
      accepted += json.accepted; sent++;
    }
  }
  await statusBeat(0);
  console.log(`backfill listo: ${sent} lotes, ${accepted} lecturas insertadas`);
  process.exit(0);
}

// ------------------------------------------------------------ modo continuo
const minutes = num("minutes", 1);
const tickMs = num("tick-ms", 1000);
const offlineAfter = num("offline-after", -1);
const offlineFor = num("offline-for", 0);

const spool: any[] = [];
let ticks = 0, accepted = 0, duplicates = 0;
const deadline = Date.now() + minutes * 60_000;

console.log(`enviando a ${BASE} durante ${minutes} min…`);
while (Date.now() < deadline) {
  const at = Date.now();
  const readings = collect(at);
  const offline = offlineAfter >= 0 && ticks >= offlineAfter && ticks < offlineAfter + offlineFor;

  if (readings.length > 0) spool.push(batch(readings));

  if (!offline) {
    while (spool.length > 0) {
      const payload = spool[0];
      const { status, json } = await send("/ingest/telemetry", payload);
      if (status === 202) {
        spool.shift();
        accepted += json.accepted;
        if (json.duplicate) duplicates++;
      } else if (status >= 500 || status === 429) {
        break; // se queda en el spool y se reintenta
      } else {
        console.error("cuarentena", status, JSON.stringify(json).slice(0, 300));
        spool.shift();
      }
    }
  } else if (ticks === offlineAfter) {
    console.log(`  ── enlace caído, acumulando en spool ──`);
  }

  if (ticks % 30 === 0) await statusBeat(spool.length);
  if (offline && ticks === offlineAfter + offlineFor - 1) {
    console.log(`  ── enlace restablecido, ${spool.length} lotes en cola ──`);
  }
  ticks++;
  await new Promise((r) => setTimeout(r, tickMs));
}

while (spool.length > 0) {
  const { status, json } = await send("/ingest/telemetry", spool[0]);
  if (status === 202) { spool.shift(); accepted += json.accepted; } else break;
}
await statusBeat(spool.length);
console.log(`ticks=${ticks} lecturas aceptadas=${accepted} lotes duplicados=${duplicates} pendientes=${spool.length}`);
