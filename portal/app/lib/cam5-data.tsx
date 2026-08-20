"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { API_CONFIGURED, cam5Api, type ApiAlarm, type ApiReading, type ApiUnit, type ApiWorkOrder } from "./api";
import {
  toPortalSensors, useAlarms, useAssetTree, useDiagnostics, useLatestReadings,
  useSystemMode, useWorkOrders, STALE_AFTER_S, type PortalSensor, type QueryResult,
} from "./use-cam5";
import { usePersistentState } from "../use-persistent-state";
import { defaultChannelConfiguration, initialAlarms, sensors as fixtureSensors } from "./fixtures";
import type { SensorState, Severity, SystemMode, WorkOrder, WorkPriority, WorkStatus } from "./types";

const ASSET_ID = process.env.NEXT_PUBLIC_CAM5_ASSET_ID ?? "MCC-01";

type Cam5Data = {
  assetId: string;
  unitId: string;
  setUnitId: (unitId: string) => void;
  units: ApiUnit[];
  sensors: PortalSensor[];
  readings: ApiReading[];
  alarms: ApiAlarm[];
  portalAlarms: PortalAlarm[];
  portalWorkOrders: WorkOrder[];
  createWorkOrder: (payload: { alarmId?: string; title: string; source?: string; priority?: string; assigneeId?: string }) => Promise<WorkOrder>;
  updateWorkOrder: (id: string, status: WorkStatus) => Promise<void>;
  acknowledgedIds: string[];
  closedIds: string[];
  acknowledgeAlarm: (id: string, note?: string) => Promise<void>;
  closeAlarm: (id: string, note: string) => Promise<void>;
  reopenAlarm: (id: string) => Promise<void>;
  workOrders: ApiWorkOrder[];
  diagnostics: QueryResult<any>;
  mode: SystemMode;
  modeDetail: string;
  demo: boolean;
  loading: boolean;
  refetchAll: () => void;
};

const Cam5DataContext = createContext<Cam5Data | null>(null);

/** Forma legada de una alarma, la que ya consumen AlarmsView y Overview. */
export type PortalAlarm = {
  id: string; severity: Severity; title: string; detail: string;
  since: string; value: string; acknowledged: boolean;
  status: "open" | "acknowledged" | "closed";
};

function relative(iso: string) {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "Hace instantes";
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.round(seconds / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const WO_STATUS: Record<string, WorkStatus> = { pending: "Pendiente", in_progress: "En curso", completed: "Completada" };
const WO_PRIORITY: Record<string, WorkPriority> = { critical: "Crítica", high: "Alta", normal: "Normal" };

function toPortalWorkOrders(orders: ApiWorkOrder[]): WorkOrder[] {
  return orders.map((order) => ({
    id: order.id,
    title: order.title,
    source: order.source ?? (order.alarm_id ? `Evento ${order.alarm_id}` : "Plan preventivo"),
    sourceAlarmId: order.alarm_id ?? undefined,
    due: order.due_at ? new Date(order.due_at).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" }) : "Sin programar",
    priority: WO_PRIORITY[order.priority] ?? "Normal",
    assignee: order.assignee_name ?? "Sin asignar",
    status: WO_STATUS[order.status] ?? "Pendiente",
  }));
}

function toPortalAlarms(alarms: ApiAlarm[]): PortalAlarm[] {
  return alarms.map((alarm) => ({
    id: alarm.id,
    severity: alarm.severity as Severity,
    title: alarm.title,
    detail: alarm.detail ?? `${alarm.channel_code ?? ""} ${alarm.channel_label ?? ""}`.trim(),
    since: relative(alarm.opened_at),
    value: alarm.opened_value === null ? "—" : `${Number(Number(alarm.opened_value).toFixed(2))} ${alarm.uom ?? ""}`.trim(),
    acknowledged: alarm.status !== "open",
    status: alarm.status,
  }));
}

/**
 * Fuente de datos del portal. Un solo sondeo alimenta todas las vistas, en vez
 * de que cada una abra el suyo. Si no hay backend configurado, cae a los datos
 * simulados para que la interfaz siga siendo demostrable.
 */
export function Cam5DataProvider({ children }: { children: React.ReactNode }) {
  const [unitId, setUnitId] = useState("CAM5-01");

  const tree = useAssetTree(ASSET_ID);
  const readings = useLatestReadings(ASSET_ID);
  const alarms = useAlarms({ assetId: ASSET_ID });
  const workOrders = useWorkOrders();
  const diagnostics = useDiagnostics();
  const system = useSystemMode(readings);

  // Capa de demostración: sólo se usa cuando no hay API disponible.
  const [configuration] = usePersistentState("cam5.front.channel-config", defaultChannelConfiguration());
  const demoSensors = useMemo<PortalSensor[]>(() => fixtureSensors.map((sensor) => {
    const configured = configuration.find((item) => item.id === sensor.id);
    const warning = Number(configured?.warning ?? sensor.threshold.split(" ")[0]);
    const critical = Number(configured?.critical ?? warning + 10);
    const reading = Number(sensor.value);
    const state: SensorState = reading >= critical ? "critical" : reading >= warning ? "warning" : "normal";
    const enabled = configured?.enabled ?? true;
    const activeThreshold = state === "critical" ? critical : warning;
    return {
      ...sensor, enabled, warning, critical, state,
      threshold: `${activeThreshold} ${sensor.unit}`,
      quality: enabled ? sensor.quality : "Deshabilitado",
      metric: "demo", unitId: "CAM5-01", sourceTimestamp: null,
      rawQuality: enabled ? "good" : "disabled",
    };
  }), [configuration]);

  const liveSensors = useMemo(
    () => toPortalSensors(readings.data ?? [], unitId),
    [readings.data, unitId]
  );

  const useDemo = !API_CONFIGURED || (readings.data === null && !readings.loading);
  const units = tree.data?.units ?? [];

  const demoAlarms: PortalAlarm[] = useMemo(() => initialAlarms.map((alarm) => ({
    ...alarm,
    status: alarm.acknowledged ? "acknowledged" : "open",
  })), []);

  const livePortalAlarms = useMemo(() => toPortalAlarms(alarms.data ?? []), [alarms.data]);
  const portalAlarms = useDemo ? demoAlarms : livePortalAlarms;

  const value: Cam5Data = {
    assetId: ASSET_ID,
    unitId,
    setUnitId,
    units,
    sensors: useDemo ? demoSensors : liveSensors,
    readings: readings.data ?? [],
    alarms: alarms.data ?? [],
    portalAlarms,
    portalWorkOrders: useDemo ? [] : toPortalWorkOrders(workOrders.data ?? []),
    createWorkOrder: async (payload) => {
      const created = await cam5Api.createWorkOrder({ assetId: ASSET_ID, ...payload });
      workOrders.refetch();
      return toPortalWorkOrders([created])[0];
    },
    updateWorkOrder: async (id, status) => {
      const api = status === "Completada" ? "completed" : status === "En curso" ? "in_progress" : "pending";
      await cam5Api.updateWorkOrder(id, { status: api });
      workOrders.refetch();
      alarms.refetch();
    },
    // En vivo, reconocido y cerrado los decide el servidor; en demostración
    // siguen viviendo en el estado local del portal.
    acknowledgedIds: useDemo ? [] : livePortalAlarms.filter((a) => a.status !== "open").map((a) => a.id),
    closedIds: useDemo ? [] : livePortalAlarms.filter((a) => a.status === "closed").map((a) => a.id),
    acknowledgeAlarm: async (id, note) => { await cam5Api.acknowledgeAlarm(id, note); alarms.refetch(); },
    closeAlarm: async (id, note) => { await cam5Api.closeAlarm(id, note); alarms.refetch(); workOrders.refetch(); },
    reopenAlarm: async () => { throw new Error("La reapertura de alarmas aún no está expuesta por la API"); },
    workOrders: workOrders.data ?? [],
    diagnostics,
    mode: system.mode,
    modeDetail: system.detail,
    demo: useDemo,
    loading: readings.loading,
    refetchAll: () => {
      readings.refetch(); alarms.refetch(); workOrders.refetch();
      diagnostics.refetch(); tree.refetch();
    },
  };

  return <Cam5DataContext.Provider value={value}>{children}</Cam5DataContext.Provider>;
}

export function useCam5Data(): Cam5Data {
  const value = useContext(Cam5DataContext);
  if (!value) throw new Error("useCam5Data debe usarse dentro de <Cam5DataProvider>");
  return value;
}

/** Mantiene la firma que ya usan las 13 vistas: sólo cambia de dónde vienen los datos. */
export function useSensorData(): PortalSensor[] {
  return useCam5Data().sensors;
}
