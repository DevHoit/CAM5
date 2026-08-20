import { q } from "./db.ts";

export type SeriesKey = string; // `${unitId}|${channelCode}|${metric}`

export type SeriesInfo = {
  channelMetricId: number;
  channelId: number;
  unitId: string;
  assetId: string;
  channelCode: string;
  channelKind: string;
  label: string;
  zone: string | null;
  metric: string;
  uom: string;
  enabled: boolean;
  warn: number | null;
  crit: number | null;
  hysteresis: number;
  delayS: number;
};

let cache = new Map<SeriesKey, SeriesInfo>();
let loadedAt = 0;
const TTL_MS = 30_000;

export function seriesKey(unitId: string, channelCode: string, metric: string): SeriesKey {
  return `${unitId}|${channelCode}|${metric}`;
}

export async function loadCatalog(force = false) {
  if (!force && Date.now() - loadedAt < TTL_MS && cache.size > 0) return cache;
  const rows = await q(`
    SELECT cm.id            AS channel_metric_id,
           c.id             AS channel_id,
           c.unit_id, u.asset_id,
           c.code           AS channel_code,
           c.kind           AS channel_kind,
           c.label, c.zone, c.enabled,
           cm.metric, cm.uom,
           cm.warn_threshold, cm.crit_threshold, cm.hysteresis, cm.delay_s
      FROM channel_metric cm
      JOIN channel c ON c.id = cm.channel_id
      JOIN unit u    ON u.id = c.unit_id
  `);
  const next = new Map<SeriesKey, SeriesInfo>();
  for (const row of rows) {
    next.set(seriesKey(row.unit_id, row.channel_code, row.metric), {
      channelMetricId: Number(row.channel_metric_id),
      channelId: Number(row.channel_id),
      unitId: row.unit_id,
      assetId: row.asset_id,
      channelCode: row.channel_code,
      channelKind: row.channel_kind,
      label: row.label,
      zone: row.zone,
      metric: row.metric,
      uom: row.uom,
      enabled: row.enabled,
      warn: row.warn_threshold === null ? null : Number(row.warn_threshold),
      crit: row.crit_threshold === null ? null : Number(row.crit_threshold),
      hysteresis: Number(row.hysteresis ?? 0),
      delayS: Number(row.delay_s ?? 0),
    });
  }
  cache = next;
  loadedAt = Date.now();
  return cache;
}

export function invalidateCatalog() {
  loadedAt = 0;
}
