/**
 * Cliente HTTP de CAM5 CORE. Es el ÚNICO lugar donde se construyen URLs:
 * ningún componente debe llamar a `fetch` directamente.
 */
export type ApiQuality = "good" | "stale" | "bad" | "disabled";
export type ApiSeverity = "normal" | "warning" | "critical";
export type ApiRole = "admin" | "engineer" | "operator" | "viewer";

export type SessionUser = { id: string; email: string; fullName: string; role: ApiRole };

export type ApiUnit = {
  id: string; asset_id: string; gateway_id: string; parent_unit_id: string | null;
  kind: "cam5" | "irm"; name: string; model: string | null; firmware: string | null;
  transport: string | null; endpoint: string | null; unit_address: number | null;
  online: boolean; last_seen_at: string | null; poll_latency_ms: number | null;
  readers_online?: number | null; channels_good?: number | null; channels_configured?: number | null;
  modbus_exceptions_24h?: number | null;
};

export type ApiAsset = {
  id: string; site_id: string; name: string; description: string | null;
  voltage_kv: string | null; location: string | null;
};

export type ApiChannelMetric = {
  id: number; metric: string; uom: string; isPrimary: boolean;
  deadband: string | null; warn: string | null; crit: string | null;
  hysteresis: string; delayS: number;
};

export type ApiChannel = {
  id: number; unit_id: string; code: string; kind: string; label: string; zone: string | null;
  enabled: boolean; register: number | null; data_type: string | null; scale: string | null;
  byte_order: string | null; map_confirmed: boolean;
  position_x: string | null; position_y: string | null;
  metrics: ApiChannelMetric[];
};

export type ApiReading = {
  unit_id: string; channel: string; kind: string; label: string; zone: string | null;
  enabled: boolean; metric: string; uom: string; is_primary: boolean;
  warn: string | null; crit: string | null;
  value: number | null; source_timestamp: string | null; received_at: string | null;
  seq: string | null; quality: ApiQuality; severity: ApiSeverity;
  trend_1h?: number | null;
};

export type ApiAlarm = {
  id: string; asset_id: string; unit_id: string | null; channel_metric_id: number | null;
  rule: string; severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "closed";
  title: string; detail: string | null;
  opened_at: string; opened_value: number | null; opened_threshold: number | null;
  acknowledged_at: string | null; acknowledged_by: string | null;
  closed_at: string | null; closed_by: string | null; close_note: string | null;
  channel_code: string | null; channel_label: string | null; metric: string | null; uom: string | null;
  active_work_orders: string;
};

export type ApiWorkOrder = {
  id: string; asset_id: string; alarm_id: string | null; title: string; source: string | null;
  priority: "normal" | "high" | "critical"; status: "pending" | "in_progress" | "completed";
  assignee_id: string | null; assignee_name: string | null;
  due_at: string | null; created_at: string; completed_at: string | null;
  reused?: boolean;
};

export type ApiTrend = {
  unitId: string; channel: string; metric: string; uom: string;
  grain: "raw" | "1m" | "1h";
  points: { ts: string; value: number | null; min?: number; max?: number; quality: string; samples?: number }[];
};

export type ApiDiagnostics = {
  gateways: {
    id: string; name: string; last_seen_at: string | null; last_seq: string | null;
    clock_sync: string | null; spool_depth: number | null; firmware: string | null;
    seconds_since_contact: string | null;
  }[];
  units: ApiUnit[];
  ingest24h: { batches: string; readings: string; avg_lag_ms: string; max_lag_ms: string };
};

export type ApiUser = {
  id: string; email: string; full_name: string;
  role: ApiRole; status: "active" | "suspended";
  created_at: string; last_login: string | null;
};

export type ApiNotificationChannel = {
  id: number; kind: "email" | "sms" | "webhook"; target: string;
  min_severity: string; enabled: boolean;
  attempts: string; delivered: string; failed: string;
};

export type ApiNotificationLog = {
  id: number; channel_id: number | null; alarm_id: string | null;
  attempted_at: string; delivered_at: string | null;
  status: "attempted" | "delivered" | "failed"; error: string | null;
  kind: string | null; target: string | null;
};

export type ApiKey = {
  id: number; name: string; key_prefix: string; scope: string;
  active: boolean; created_at: string; last_used_at: string | null;
  key?: string; // sólo en la respuesta de creación
};

export type ApiReport = {
  id: string; asset_id: string; kind: string;
  period_from: string; period_to: string;
  status: "pending" | "ready" | "failed";
  download_url: string | null; error: string | null;
  requested_by: string | null; requested_by_name: string | null;
  created_at: string; ready_at: string | null;
};

export type ApiMeasurement = {
  ts: string; value: number | null; quality: ApiQuality; seq: string | null;
  unit_id: string; channel: string; label: string; zone: string | null;
  metric: string; uom: string; warn: string | null; crit: string | null;
};

export type ApiModbusEntry = {
  id: number; unit_id: string; code: string; kind: string; label: string;
  enabled: boolean; register: number | null; data_type: string | null;
  scale: string | null; byte_order: string | null; map_confirmed: boolean;
  unit_address: number | null;
};

export type ApiAuditEntry = {
  id: number; ts: string; actor: string; action: string; target: string | null;
  old_value: unknown; new_value: unknown; origin: string; trace_id: string | null;
};

export type ApiError = {
  code: string; message: string; fieldErrors: Record<string, string>; traceId: string;
};

export class Cam5ApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string>;
  traceId: string;
  constructor(status: number, body: Partial<ApiError>) {
    super(body.message ?? `CAM5 API ${status}`);
    this.status = status;
    this.code = body.code ?? "UNKNOWN";
    this.fieldErrors = body.fieldErrors ?? {};
    this.traceId = body.traceId ?? "";
  }
}

const API_BASE = process.env.NEXT_PUBLIC_CAM5_API_URL ?? "/api/v1";

/** true cuando no hay backend configurado y el portal corre en modo demostración. */
export const API_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CAM5_API_URL);

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 12_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
      credentials: "include",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Cam5ApiError(response.status, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const qs = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export const cam5Api = {
  health: () => request<{ status: "ok" | "degraded"; timestamp: string; dbLatencyMs: number }>("/health"),
  session: () => request<{ user: SessionUser }>("/session"),

  asset: (assetId: string) => request<{ asset: ApiAsset; units: ApiUnit[] }>(`/assets/${assetId}`),
  channels: (assetId: string) => request<ApiChannel[]>(`/assets/${assetId}/channels`),

  latestReadings: (assetId: string, staleAfterS = 60) =>
    request<ApiReading[]>(`/assets/${assetId}/readings/latest?${qs({ staleAfterS })}`),

  trend: (assetId: string, unitId: string, channel: string, metric: string, from: string, to: string) =>
    request<ApiTrend>(`/assets/${assetId}/trends?${qs({ unitId, channel, metric, from, to })}`),

  alarms: (params: { status?: string; assetId?: string } = {}) =>
    request<ApiAlarm[]>(`/alarms?${qs(params)}`),
  acknowledgeAlarm: (alarmId: string, note?: string) =>
    request<ApiAlarm>(`/alarms/${alarmId}/acknowledge`, { method: "POST", body: JSON.stringify({ note }) }),
  closeAlarm: (alarmId: string, note: string) =>
    request<ApiAlarm>(`/alarms/${alarmId}/close`, { method: "POST", body: JSON.stringify({ note }) }),

  workOrders: () => request<ApiWorkOrder[]>("/work-orders"),
  createWorkOrder: (payload: {
    assetId: string; alarmId?: string; title: string; source?: string;
    priority?: string; assigneeId?: string; dueAt?: string;
  }) => request<ApiWorkOrder>("/work-orders", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkOrder: (id: string, payload: Partial<{ status: string; priority: string; assigneeId: string; dueAt: string }>) =>
    request<ApiWorkOrder>(`/work-orders/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  diagnostics: () => request<ApiDiagnostics>("/diagnostics"),
  audit: (limit = 100) => request<any[]>(`/audit?${qs({ limit })}`),
  gatewayEvents: (limit = 100) => request<any[]>(`/gateway-events?${qs({ limit })}`),

  updateChannel: (channelId: number, payload: Partial<{
    enabled: boolean; label: string; zone: string; register: number;
    dataType: string; scale: number; byteOrder: string;
  }>) => request<ApiChannel>(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // ---- gestión ----
  users: () => request<ApiUser[]>("/users"),
  createUser: (payload: { email: string; fullName: string; role: string }) =>
    request<ApiUser>("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Partial<{ fullName: string; role: string; status: string }>) =>
    request<ApiUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  notificationChannels: () => request<ApiNotificationChannel[]>("/notification-channels"),
  createNotificationChannel: (payload: { kind: string; target: string; minSeverity?: string }) =>
    request<ApiNotificationChannel>("/notification-channels", { method: "POST", body: JSON.stringify(payload) }),
  updateNotificationChannel: (id: number, payload: Partial<{ enabled: boolean; minSeverity: string; target: string }>) =>
    request<ApiNotificationChannel>(`/notification-channels/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  notificationLog: (limit = 50) => request<ApiNotificationLog[]>(`/notification-log?${qs({ limit })}`),

  apiKeys: () => request<ApiKey[]>("/api-keys"),
  createApiKey: (payload: { name: string; scope?: string }) =>
    request<ApiKey>("/api-keys", { method: "POST", body: JSON.stringify(payload) }),
  setApiKeyActive: (id: number, active: boolean) =>
    request<ApiKey>(`/api-keys/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),

  reports: (assetId?: string) => request<ApiReport[]>(`/reports?${qs({ assetId })}`),
  requestReport: (payload: { assetId: string; kind?: string; from: string; to: string }) =>
    request<ApiReport>("/reports", { method: "POST", body: JSON.stringify(payload) }),
  reportDownloadUrl: (id: string) => `${API_BASE}/reports/${id}/download`,

  measurements: (assetId: string, params: { unitId?: string; channel?: string; metric?: string; cursor?: string; limit?: number }) =>
    request<{ items: ApiMeasurement[]; nextCursor: string | null }>(`/assets/${assetId}/measurements?${qs(params)}`),

  modbusMap: (assetId: string) => request<ApiModbusEntry[]>(`/assets/${assetId}/modbus-map`),
  saveModbusMap: (assetId: string, entries: unknown[]) =>
    request<ApiModbusEntry[]>(`/assets/${assetId}/modbus-map`, { method: "PUT", body: JSON.stringify({ entries }) }),

  updateAsset: (assetId: string, payload: Partial<{ name: string; description: string; voltageKv: number; location: string }>) =>
    request<ApiAsset>(`/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  auditLog: (limit = 100) => request<ApiAuditEntry[]>(`/audit?${qs({ limit })}`),

  updateChannelMetric: (id: number, payload: Partial<{
    warn: number | null; crit: number | null; hysteresis: number; delayS: number; deadband: number;
  }>) => request<ApiChannelMetric>(`/channel-metrics/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
};
