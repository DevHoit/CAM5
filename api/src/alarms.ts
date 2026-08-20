import { q, one } from "./db.ts";
import type { SeriesInfo } from "./catalog.ts";

export type Sample = { series: SeriesInfo; ts: Date; value: number | null; quality: string };

type Level = "normal" | "warning" | "critical";

/**
 * Nivel de una lectura considerando histéresis: para BAJAR de nivel el valor
 * debe caer por debajo del umbral menos la histéresis. Evita el parpadeo de
 * alarmas cuando la señal oscila justo sobre el umbral.
 */
function levelFor(value: number, series: SeriesInfo, previous: Level): Level {
  const h = series.hysteresis ?? 0;
  const crit = series.crit;
  const warn = series.warn;
  if (crit !== null && value >= crit) return "critical";
  if (crit !== null && previous === "critical" && value >= crit - h) return "critical";
  if (warn !== null && value >= warn) return "warning";
  if (warn !== null && (previous === "warning" || previous === "critical") && value >= warn - h) return "warning";
  return "normal";
}

async function nextId(prefix: string, table: string, at: Date): Promise<string> {
  const day = at.toISOString().slice(2, 10).replace(/-/g, "");
  const like = `${prefix}-${day}-%`;
  const row = await one<{ n: string }>(
    `SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::int), 0) + 1 AS n
       FROM ${table} WHERE id LIKE $1`,
    [like]
  );
  return `${prefix}-${day}-${String(row?.n ?? 1).padStart(3, "0")}`;
}

/**
 * Evalúa umbrales en el servidor. Es lo que permite que una alarma exista
 * aunque nadie tenga el portal abierto.
 */
export async function evaluate(samples: Sample[]): Promise<string[]> {
  const opened: string[] = [];
  // Solo evaluamos lecturas válidas. Una lectura stale/bad no debe abrir ni
  // cerrar alarmas: la condición del activo es desconocida, no normal.
  const usable = samples.filter((s) => s.quality === "good" && s.value !== null && s.series.enabled);
  if (usable.length === 0) return opened;

  // Nos quedamos con la muestra más reciente por serie dentro del lote.
  const latest = new Map<number, Sample>();
  for (const sample of usable) {
    const current = latest.get(sample.series.channelMetricId);
    if (!current || sample.ts > current.ts) latest.set(sample.series.channelMetricId, sample);
  }

  for (const sample of latest.values()) {
    const series = sample.series;
    if (series.warn === null && series.crit === null) continue;

    const state = await one<{ level: Level; since: Date; confirmed: boolean }>(
      `SELECT level, since, confirmed FROM alarm_candidate WHERE channel_metric_id = $1`,
      [series.channelMetricId]
    );
    const previous: Level = state?.level ?? "normal";
    const level = levelFor(sample.value as number, series, previous);

    if (level !== previous) {
      await q(
        `INSERT INTO alarm_candidate (channel_metric_id, level, since, last_value, confirmed)
         VALUES ($1,$2,$3,$4,false)
         ON CONFLICT (channel_metric_id)
         DO UPDATE SET level = $2, since = $3, last_value = $4, confirmed = false`,
        [series.channelMetricId, level, sample.ts, sample.value]
      );
    } else {
      await q(`UPDATE alarm_candidate SET last_value = $2 WHERE channel_metric_id = $1`,
        [series.channelMetricId, sample.value]);
    }

    const since = level !== previous ? sample.ts : (state?.since ?? sample.ts);
    const heldMs = sample.ts.getTime() - new Date(since).getTime();
    const confirmed = level === previous ? (state?.confirmed ?? false) : false;

    if (level === "normal") {
      // Retorno a la normalidad: se registra, pero NO se cierra la alarma.
      // El cierre es una decisión humana y exige nota (DATA_CONTRACTS.md).
      if (previous !== "normal" && confirmed) {
        const active = await one<{ id: string }>(
          `SELECT id FROM alarm WHERE channel_metric_id = $1 AND status <> 'closed'`,
          [series.channelMetricId]
        );
        if (active) {
          await q(
            `INSERT INTO alarm_note (alarm_id, author, note) VALUES ($1,'Sistema',$2)`,
            [active.id, `Condición normalizada: ${sample.value} ${series.uom}`]
          );
        }
        await q(`UPDATE alarm_candidate SET confirmed = false WHERE channel_metric_id = $1`,
          [series.channelMetricId]);
      }
      continue;
    }

    if (heldMs < series.delayS * 1000) continue; // aún dentro del retardo configurado

    const threshold = level === "critical" ? series.crit : series.warn;
    const active = await one<{ id: string; severity: string; status: string }>(
      `SELECT id, severity, status FROM alarm
        WHERE channel_metric_id = $1 AND rule = 'threshold' AND status <> 'closed'`,
      [series.channelMetricId]
    );

    if (!active) {
      const id = await nextId("AL", "alarm", sample.ts);
      await q(
        `INSERT INTO alarm (id, asset_id, unit_id, channel_metric_id, rule, severity, status,
                            title, detail, opened_at, opened_value, opened_threshold)
         VALUES ($1,$2,$3,$4,'threshold',$5,'open',$6,$7,$8,$9,$10)`,
        [
          id, series.assetId, series.unitId, series.channelMetricId, level,
          titleFor(series, level),
          `${series.channelCode} · ${series.label}${series.zone ? " · " + series.zone : ""}`,
          sample.ts, sample.value, threshold,
        ]
      );
      opened.push(id);
    } else if (level === "critical" && active.severity !== "critical") {
      // Escalamiento preventivo → crítico sobre la misma alarma, con trazabilidad.
      await q(`UPDATE alarm SET severity = 'critical', updated_at = now() WHERE id = $1`, [active.id]);
      await q(`INSERT INTO alarm_note (alarm_id, author, note) VALUES ($1,'Sistema',$2)`,
        [active.id, `Escalada a crítica: ${sample.value} ${series.uom} (umbral ${threshold})`]);
      opened.push(active.id);
    }

    await q(`UPDATE alarm_candidate SET confirmed = true WHERE channel_metric_id = $1`,
      [series.channelMetricId]);
  }

  return opened;
}

function titleFor(series: SeriesInfo, level: Level) {
  const word = level === "critical" ? "crítico" : "preventivo";
  switch (series.channelKind) {
    case "temperature": return `Temperatura sobre umbral ${word}`;
    case "partial_discharge": return series.metric === "trend_phi"
      ? "Aceleración de descarga parcial"
      : `Descarga parcial sobre umbral ${word}`;
    case "humidity": return `Humedad sobre umbral ${word}`;
    default: return `Señal sobre umbral ${word}`;
  }
}

export { nextId };
