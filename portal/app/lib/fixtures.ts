import type { SensorState, Severity, WorkOrder } from "./types";

export const sensors = [
  { id: "T01", label: "Barra fase L1", zone: "Barras principales", value: "68.4", unit: "°C", type: "Temperatura", state: "warning" as SensorState, trend: "+1.8 °C/h", threshold: "65 °C", register: "HR 40001", quality: "Válida" },
  { id: "T02", label: "Barra fase L2", zone: "Barras principales", value: "54.1", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "+0.2 °C/h", threshold: "65 °C", register: "HR 40002", quality: "Válida" },
  { id: "T03", label: "Barra fase L3", zone: "Barras principales", value: "52.8", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "+0.1 °C/h", threshold: "65 °C", register: "HR 40003", quality: "Válida" },
  { id: "T04", label: "Contacto superior", zone: "Interruptor", value: "47.2", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "Estable", threshold: "70 °C", register: "HR 40004", quality: "Válida" },
  { id: "T05", label: "Contacto inferior", zone: "Interruptor", value: "49.5", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "+0.3 °C/h", threshold: "70 °C", register: "HR 40005", quality: "Válida" },
  { id: "PD1", label: "Canal UHF 01", zone: "Compartimiento de cables", value: "72", unit: "idx", type: "Descarga parcial", state: "critical" as SensorState, trend: "Acelerando · Φ 2.8×", threshold: "60 idx", register: "HR 40121", quality: "Válida" },
  { id: "PD2", label: "Canal UHF 02", zone: "Barras principales", value: "18", unit: "idx", type: "Descarga parcial", state: "normal" as SensorState, trend: "Estable", threshold: "60 idx", register: "HR 40122", quality: "Válida" },
  { id: "H01", label: "Ambiente de cabina", zone: "Compartimiento de cables", value: "78", unit: "%RH", type: "Humedad", state: "warning" as SensorState, trend: "+4 % / 24h", threshold: "75 %RH", register: "HR 40201", quality: "Válida" },
];

export const defaultAssetConfig = { name: "MCC-01", description: "Alimentador Norte", voltage: "13.8", location: "Subestación Norte", timezone: "America/Santiago" };

export function defaultChannelConfiguration() {
  return sensors.map((sensor) => ({
    ...sensor,
    enabled: true,
    warning: sensor.id === "PD1" || sensor.id === "PD2" ? "40" : sensor.id === "H01" ? "75" : sensor.threshold.split(" ")[0],
    critical: sensor.id.startsWith("PD") ? "60" : sensor.id === "H01" ? "85" : String(Number(sensor.threshold.split(" ")[0]) + 10),
  }));
}

export const initialAlarms = [
  { id: "AL-260811-031", severity: "critical" as Severity, title: "Aceleración de descarga parcial", detail: "PD1 · Compartimiento de cables", since: "Hace 12 min", value: "Φ 2.8×", acknowledged: false },
  { id: "AL-260811-028", severity: "warning" as Severity, title: "Diferencial térmico elevado", detail: "T01 Barra L1 vs. L2/L3", since: "Hace 34 min", value: "+15.6 °C", acknowledged: false },
  { id: "AL-260811-019", severity: "warning" as Severity, title: "Humedad sobre umbral", detail: "H01 Ambiente cabina", since: "Hace 2 h", value: "78 %RH", acknowledged: false },
  { id: "AL-260810-104", severity: "info" as Severity, title: "Sincronización recuperada", detail: "Gateway CAM5-GW-01", since: "Ayer 18:42", value: "Resuelta", acknowledged: true },
];

export const initialWorkOrders: WorkOrder[] = [
  { id: "OT-260811-018", title: "Diagnóstico de descarga parcial", source: "PD1 · Evento AL-260811-031", sourceAlarmId: "AL-260811-031", due: "Hoy · 16:00", priority: "Crítica", assignee: "Emerson Allende", status: "En curso" },
  { id: "OT-260811-017", title: "Inspección termográfica dirigida", source: "T01 · Evento AL-260811-028", sourceAlarmId: "AL-260811-028", due: "21 ago 2026", priority: "Alta", assignee: "Paula Rojas", status: "Pendiente" },
  { id: "OT-260810-014", title: "Control de humedad en cabina", source: "H01 · Evento AL-260811-019", sourceAlarmId: "AL-260811-019", due: "22 ago 2026", priority: "Alta", assignee: "Felipe Soto", status: "Pendiente" },
  { id: "OT-260731-009", title: "Verificación mensual de gateway", source: "Plan preventivo PM-04", due: "31 jul 2026", priority: "Normal", assignee: "Felipe Soto", status: "Completada" },
];

export const chartData = [
  [42, 16], [44, 18], [43, 17], [46, 19], [48, 21], [47, 22], [50, 24], [51, 27],
  [53, 31], [52, 30], [55, 36], [57, 39], [58, 42], [60, 46], [62, 51], [61, 50],
  [63, 55], [65, 59], [64, 61], [66, 66], [67, 70], [68, 72], [67, 71], [68, 74],
];

export const auditEntries = [
  { time: "Hoy 11:48", user: "Emerson Allende", action: "Umbral crítico actualizado", target: "PD1 · 65 → 60 idx", origin: "Portal web" },
  { time: "Hoy 09:22", user: "Paula Rojas", action: "Alarma reconocida", target: "AL-260811-028 · T01", origin: "Portal web" },
  { time: "Ayer 18:43", user: "Sistema", action: "Gateway reconectado", target: "CAM5-GW-01", origin: "Servicio OT" },
  { time: "Ayer 16:15", user: "Emerson Allende", action: "Registro Modbus modificado", target: "H01 · HR 40201", origin: "Portal web" },
  { time: "10 ago 14:06", user: "Felipe Soto", action: "Informe exportado", target: "MCC-01 · 30 días", origin: "Portal web" },
];

export const closedAlarms = [
  ...initialAlarms,
  { id: "AL-260809-087", severity: "warning" as Severity, title: "Latencia de gateway elevada", detail: "CAM5-GW-01 · Comunicaciones", since: "9 ago 13:22", value: "218 ms", acknowledged: true },
  { id: "AL-260807-044", severity: "info" as Severity, title: "Reinicio programado", detail: "CAM5-GW-01 · Firmware", since: "7 ago 02:00", value: "Completado", acknowledged: true },
];
