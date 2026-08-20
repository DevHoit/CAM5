"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  API_CONFIGURED, Cam5ApiError, cam5Api,
  type ApiAlarm, type ApiChannel, type ApiDiagnostics, type ApiReading,
  type ApiTrend, type ApiUnit, type ApiWorkOrder, type SessionUser,
} from "./api";
import type { SensorState, SystemMode } from "./types";

// ---------------------------------------------------------------------------
// Estado de conexión compartido
// ---------------------------------------------------------------------------

type ConnectionSnapshot = { lastSuccessAt: number | null; lastErrorAt: number | null; lastError: Error | null };

const connection: ConnectionSnapshot = { lastSuccessAt: null, lastErrorAt: null, lastError: null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function markSuccess() { connection.lastSuccessAt = Date.now(); connection.lastError = null; notify(); }
function markError(error: Error) { connection.lastErrorAt = Date.now(); connection.lastError = error; notify(); }

// ---------------------------------------------------------------------------
// Consulta con sondeo
// ---------------------------------------------------------------------------

export type QueryResult<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  updatedAt: number | null;
  refetch: () => void;
};

export function useCam5Query<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: { pollMs?: number; enabled?: boolean } = {}
): QueryResult<T> {
  const { pollMs = 0, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled && API_CONFIGURED);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!enabled || !API_CONFIGURED) { setLoading(false); return; }
    let cancelled = false;

    const run = async () => {
      try {
        const result = await fetcherRef.current();
        if (cancelled || !alive.current) return;
        setData(result);
        setError(null);
        setUpdatedAt(Date.now());
        markSuccess();
      } catch (caught) {
        if (cancelled || !alive.current) return;
        const err = caught instanceof Error ? caught : new Error(String(caught));
        setError(err);
        markError(err);
        // Conservamos el último dato bueno: el portal muestra el valor
        // conocido y marca la telemetría como atrasada, no la borra.
      } finally {
        if (!cancelled && alive.current) setLoading(false);
      }
    };

    run();
    if (pollMs <= 0) return () => { cancelled = true; };
    const timer = setInterval(run, pollMs);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, enabled, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, updatedAt, refetch };
}

// ---------------------------------------------------------------------------
// Contexto del portal: activo y unidad seleccionados
// ---------------------------------------------------------------------------

export type Cam5Scope = {
  assetId: string;
  unitId: string;
  setUnitId: (unitId: string) => void;
  units: ApiUnit[];
  demo: boolean;
};

export const Cam5ScopeContext = createContext<Cam5Scope>({
  assetId: "MCC-01", unitId: "CAM5-01", setUnitId: () => undefined, units: [], demo: !API_CONFIGURED,
});
export const useCam5Scope = () => useContext(Cam5ScopeContext);

// ---------------------------------------------------------------------------
// Consultas concretas
// ---------------------------------------------------------------------------

/**
 * Cuánto puede envejecer una lectura antes de mostrarse como atrasada. DEBE ser
 * mayor que el período de muestreo del gateway: con lecturas cada 5 minutos y un
 * umbral de 60 s, todo el tablero aparecería permanentemente atrasado.
 */
export const STALE_AFTER_S = Number(process.env.NEXT_PUBLIC_CAM5_STALE_AFTER_S ?? 60);

/**
 * Ritmo de sondeo del portal. Pedir cada 5 s cuando el dato cambia cada 5 min
 * son 59 peticiones desperdiciadas de cada 60. Se ajusta al período real,
 * acotado entre 5 y 60 segundos.
 */
const POLL_FAST = Math.min(60_000, Math.max(5_000, STALE_AFTER_S * 1000 / 5));
const POLL_SLOW = Math.max(30_000, POLL_FAST * 2);

export const useSession = () =>
  useCam5Query<{ user: SessionUser }>(() => cam5Api.session(), []);

export const useAssetTree = (assetId: string) =>
  useCam5Query(() => cam5Api.asset(assetId), [assetId], { pollMs: POLL_SLOW });

export const useChannels = (assetId: string) =>
  useCam5Query<ApiChannel[]>(() => cam5Api.channels(assetId), [assetId], { pollMs: POLL_SLOW });

export const useLatestReadings = (assetId: string, staleAfterS = STALE_AFTER_S) =>
  useCam5Query<ApiReading[]>(() => cam5Api.latestReadings(assetId, staleAfterS), [assetId, staleAfterS], { pollMs: POLL_FAST });

export const useAlarms = (params: { status?: string; assetId?: string } = {}) =>
  useCam5Query<ApiAlarm[]>(() => cam5Api.alarms(params), [params.status, params.assetId], { pollMs: POLL_FAST });

export const useWorkOrders = () =>
  useCam5Query<ApiWorkOrder[]>(() => cam5Api.workOrders(), [], { pollMs: POLL_SLOW });

export const useDiagnostics = () =>
  useCam5Query<ApiDiagnostics>(() => cam5Api.diagnostics(), [], { pollMs: POLL_FAST });

export function useTrend(assetId: string, unitId: string, channel: string, metric: string, period: string) {
  const hours = period.startsWith("24") ? 24 : period.startsWith("7") ? 24 * 7 : 24 * 30;
  // El rango se ancla al minuto para que el sondeo no genere una URL nueva cada segundo.
  const to = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const from = new Date(to.getTime() - hours * 3_600_000);
  return useCam5Query<ApiTrend>(
    () => cam5Api.trend(assetId, unitId, channel, metric, from.toISOString(), to.toISOString()),
    [assetId, unitId, channel, metric, hours, to.getTime()],
    { pollMs: POLL_SLOW, enabled: Boolean(unitId && channel) }
  );
}

// ---------------------------------------------------------------------------
// Modo del sistema: operativa / actualizando / atrasada / sin conexión
// ---------------------------------------------------------------------------

export function useSystemMode(readings: QueryResult<ApiReading[]>, staleAfterS = STALE_AFTER_S): {
  mode: SystemMode; detail: string; demo: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const tick = () => force((n) => n + 1);
    listeners.add(tick);
    const timer = setInterval(tick, 5_000);
    return () => { listeners.delete(tick); clearInterval(timer); };
  }, []);

  if (!API_CONFIGURED) {
    return { mode: "normal", detail: "Modo demostración · sin backend configurado", demo: true };
  }
  if (readings.loading && !readings.data) {
    return { mode: "loading", detail: "Esperando respuesta", demo: false };
  }
  if (readings.error) {
    const seconds = connection.lastSuccessAt ? Math.round((Date.now() - connection.lastSuccessAt) / 1000) : null;
    return {
      mode: "offline",
      detail: seconds === null ? "Sin contacto con CAM5 CORE" : `Sin datos hace ${formatAge(seconds)}`,
      demo: false,
    };
  }

  // La frescura se mide sobre el dato, no sobre la respuesta HTTP: el servidor
  // puede responder perfectamente mientras el gateway lleva minutos callado.
  const newest = (readings.data ?? [])
    .map((r) => (r.source_timestamp ? Date.parse(r.source_timestamp) : 0))
    .reduce((max, ts) => Math.max(max, ts), 0);
  if (newest === 0) return { mode: "offline", detail: "Sin telemetría registrada", demo: false };

  const ageS = Math.round((Date.now() - newest) / 1000);
  if (ageS > staleAfterS * 10) return { mode: "offline", detail: `Sin datos hace ${formatAge(ageS)}`, demo: false };
  if (ageS > staleAfterS) return { mode: "stale", detail: `Último dato hace ${formatAge(ageS)}`, demo: false };
  return { mode: "normal", detail: `Actualizado hace ${formatAge(ageS)}`, demo: false };
}

export function formatAge(seconds: number) {
  if (seconds < 60) return `${Math.max(0, seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

// ---------------------------------------------------------------------------
// Adaptador: API → la forma que ya consumen las vistas
// ---------------------------------------------------------------------------

export type PortalSensor = {
  id: string; label: string; zone: string; value: string; unit: string; type: string;
  state: SensorState; trend: string; threshold: string; register: string; quality: string;
  enabled: boolean; warning: number; critical: number;
  metric: string; unitId: string; sourceTimestamp: string | null; rawQuality: string;
};

const KIND_LABEL: Record<string, string> = {
  temperature: "Temperatura",
  partial_discharge: "Descarga parcial",
  humidity: "Humedad",
  relay: "Relé de alarma",
  system: "Salud de unidad",
};

const UOM_LABEL: Record<string, string> = {
  degC: "°C", percentRH: "%RH", QUHF: "QUHF", dB: "dB", ratio: "×",
  bool: "", ms: "ms", count: "",
};

const QUALITY_LABEL: Record<string, string> = {
  good: "Válida", stale: "Atrasada", bad: "Inválida", disabled: "Deshabilitado",
};

function trendLabel(delta: number | null | undefined, uom: string) {
  if (delta === null || delta === undefined) return "Sin referencia";
  if (Math.abs(delta) < 0.05) return "Estable";
  const sign = delta > 0 ? "+" : "";
  const unit = UOM_LABEL[uom] ?? uom;
  return `${sign}${delta.toFixed(Math.abs(delta) < 10 ? 1 : 0)} ${unit}/h`.replace("  ", " ");
}

/** Convierte las lecturas de la API a la forma legada que las vistas ya consumen. */
export function toPortalSensors(readings: ApiReading[], unitId: string): PortalSensor[] {
  return readings
    .filter((r) => r.unit_id === unitId && r.is_primary)
    .map((r) => {
      const warning = r.warn === null ? Number.NaN : Number(r.warn);
      const critical = r.crit === null ? Number.NaN : Number(r.crit);
      const unit = UOM_LABEL[r.uom] ?? r.uom;
      const activeThreshold = r.severity === "critical" ? critical : warning;
      return {
        id: r.channel,
        label: r.label,
        zone: r.zone ?? "Sin zona",
        value: r.value === null ? "—" : String(Number(r.value.toFixed(2))),
        unit,
        type: KIND_LABEL[r.kind] ?? r.kind,
        state: r.severity as SensorState,
        trend: trendLabel(r.trend_1h, r.uom),
        threshold: Number.isFinite(activeThreshold) ? `${activeThreshold} ${unit}`.trim() : "Sin umbral",
        register: "—",
        quality: QUALITY_LABEL[r.quality] ?? r.quality,
        enabled: r.enabled && r.quality !== "disabled",
        warning: Number.isFinite(warning) ? warning : 0,
        critical: Number.isFinite(critical) ? critical : 0,
        metric: r.metric,
        unitId: r.unit_id,
        sourceTimestamp: r.source_timestamp,
        rawQuality: r.quality,
      };
    });
}

export { connection as cam5Connection, Cam5ApiError };

// ---------------------------------------------------------------------------
// Gestión: usuarios, notificaciones, claves, reportes, histórico, Modbus
// ---------------------------------------------------------------------------

export const useUsers = () =>
  useCam5Query(() => cam5Api.users(), [], { pollMs: POLL_SLOW });

export const useNotificationChannels = () =>
  useCam5Query(() => cam5Api.notificationChannels(), [], { pollMs: POLL_SLOW });

export const useNotificationLog = (limit = 50) =>
  useCam5Query(() => cam5Api.notificationLog(limit), [limit], { pollMs: POLL_SLOW });

export const useApiKeys = () =>
  useCam5Query(() => cam5Api.apiKeys(), [], { pollMs: POLL_SLOW });

/**
 * Los reportes se generan de forma asíncrona; mientras haya alguno en `pending`
 * el sondeo se acelera para que el estado cambie a la vista sin recargar.
 */
export function useReports(assetId: string) {
  const [fast, setFast] = useState(false);
  const query = useCam5Query(() => cam5Api.reports(assetId), [assetId], { pollMs: fast ? 3_000 : POLL_SLOW });
  useEffect(() => {
    setFast((query.data ?? []).some((report: any) => report.status === "pending"));
  }, [query.data]);
  return query;
}

export const useAuditLog = (limit = 100) =>
  useCam5Query(() => cam5Api.auditLog(limit), [limit], { pollMs: POLL_SLOW });

export const useModbusMap = (assetId: string) =>
  useCam5Query(() => cam5Api.modbusMap(assetId), [assetId], { pollMs: 0 });

/** Histórico con cursor: acumula páginas en memoria y expone «cargar más». */
export function useMeasurements(assetId: string, filters: { unitId?: string; channel?: string; metric?: string }) {
  const [pages, setPages] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${assetId}|${filters.unitId ?? ""}|${filters.channel ?? ""}|${filters.metric ?? ""}`;

  const first = useCam5Query(
    () => cam5Api.measurements(assetId, { ...filters, limit: 50 }),
    [key],
    { pollMs: 0 }
  );

  useEffect(() => {
    if (first.data) { setPages(first.data.items); setCursor(first.data.nextCursor); }
  }, [first.data]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await cam5Api.measurements(assetId, { ...filters, cursor, limit: 50 });
      setPages((current) => [...current, ...next.items]);
      setCursor(next.nextCursor);
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, cursor, loadingMore, key]);

  return { items: pages, hasMore: Boolean(cursor), loadMore, loadingMore, loading: first.loading, error: first.error };
}
