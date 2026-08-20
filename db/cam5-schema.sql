-- =============================================================================
-- CAM5 CORE — esquema completo de base de datos
-- PostgreSQL 16+ · sin extensiones · Versión 1.0 · 19 de agosto de 2026
-- =============================================================================
--
-- Crea el rol, la base, las 24 tablas, sus relaciones, índices, restricciones
-- y vistas de consulta. Idempotente: se puede re-ejecutar sin romper nada.
--
-- Uso:
--   createdb cam5
--   psql -d cam5 -v ON_ERROR_STOP=1 -f cam5-schema.sql
--
-- Para crear el rol de aplicación (requiere superusuario, una sola vez):
--   CREATE ROLE cam5 LOGIN PASSWORD 'cambia-esto';
--   CREATE DATABASE cam5 OWNER cam5;
--
-- Notas de diseño:
--   * `reading` está PARTICIONADA POR MES. La poda de histórico se hace con
--     DROP TABLE de la partición, no con DELETE: es instantáneo y no genera
--     bloat. La función ensure_reading_partition() crea la partición que falte.
--   * No se usa TimescaleDB a propósito, para poder correr sobre cualquier
--     Postgres gestionado. Convertir `reading` en hipertabla más adelante es
--     una migración aditiva que no toca el resto del esquema.
--   * Todas las marcas de tiempo son `timestamptz` y se guardan en UTC.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CATÁLOGO: dónde está el activo y qué se está midiendo
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'America/Santiago',
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE site IS 'Instalación física. Una subestación, una planta.';

CREATE TABLE IF NOT EXISTS asset (
  id          text PRIMARY KEY,
  site_id     text NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  description text,
  voltage_kv  numeric(6,2),
  location    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE asset IS 'Activo eléctrico monitoreado: cabina, celda, barra, interruptor.';

CREATE TABLE IF NOT EXISTS gateway (
  id                text PRIMARY KEY,
  site_id           text NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
  name              text NOT NULL,
  api_key_hash      text NOT NULL,
  api_key_hash_next text,
  hmac_secret       text NOT NULL,
  config_version    integer NOT NULL DEFAULT 1,
  enabled           boolean NOT NULL DEFAULT true,
  last_seen_at      timestamptz,
  last_seq          bigint,
  clock_sync        text,
  spool_depth       integer,
  firmware          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE gateway IS 'Equipo de campo que lee el CAM-5 por Modbus y envía a CORE.';
COMMENT ON COLUMN gateway.api_key_hash IS 'SHA-256 de la clave. La clave en claro nunca se guarda.';
COMMENT ON COLUMN gateway.api_key_hash_next IS 'Segunda clave válida durante la rotación, para no cortar el servicio.';
COMMENT ON COLUMN gateway.hmac_secret IS 'Secreto compartido para firmar los envíos. Se guarda en claro porque el servidor debe recalcular la firma: protégelo a nivel de base y de disco.';
COMMENT ON COLUMN gateway.config_version IS 'Sube con cada cambio de configuración. El gateway la compara y vuelve a descargar su perfil.';
COMMENT ON COLUMN gateway.spool_depth IS 'Lotes pendientes de envío en el gateway. Delata un enlace degradado antes de que se pierdan datos.';
CREATE INDEX IF NOT EXISTS gateway_api_key_idx ON gateway(api_key_hash);

CREATE TABLE IF NOT EXISTS unit (
  id              text PRIMARY KEY,
  asset_id        text NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  gateway_id      text NOT NULL REFERENCES gateway(id) ON DELETE RESTRICT,
  parent_unit_id  text REFERENCES unit(id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('cam5','irm')),
  name            text NOT NULL,
  model           text,
  firmware        text,
  transport       text CHECK (transport IN ('modbus-tcp','modbus-rtu')),
  endpoint        text,
  unit_address    integer,
  online          boolean NOT NULL DEFAULT false,
  last_seen_at    timestamptz,
  poll_latency_ms integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE unit IS 'Unidad de monitoreo: el CAM-5 principal o uno de sus hasta 9 lectores IRM.';
COMMENT ON COLUMN unit.parent_unit_id IS 'Auto-referencia: los lectores IRM cuelgan del CAM-5 que los interroga por RS485. Permite crecer de 1 a 10 unidades sin migrar el esquema.';
CREATE INDEX IF NOT EXISTS unit_asset_idx  ON unit(asset_id);
CREATE INDEX IF NOT EXISTS unit_parent_idx ON unit(parent_unit_id);

CREATE TABLE IF NOT EXISTS channel (
  id            bigserial PRIMARY KEY,
  unit_id       text NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  code          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('temperature','partial_discharge','humidity','relay','system')),
  label         text NOT NULL,
  zone          text,
  enabled       boolean NOT NULL DEFAULT true,
  register      integer,
  data_type     text CHECK (data_type IN ('Int16','UInt16','Int32','UInt32','Float32')),
  scale         numeric,
  byte_order    text CHECK (byte_order IN ('AB','BA','ABCD','CDAB','BADC','DCBA')),
  map_confirmed boolean NOT NULL DEFAULT false,
  position_x    numeric,
  position_y    numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, code)
);
COMMENT ON TABLE channel IS 'Punto físico instrumentado: T01–T12 temperatura, PD1–PD4 descarga parcial, H01–H08 humedad, RLY1–RLY6 relés, SYS salud.';
COMMENT ON COLUMN channel.map_confirmed IS 'FALSE mientras la dirección Modbus sea un supuesto. Distingue lo verificado contra el equipo de lo asumido en el diseño.';
COMMENT ON COLUMN channel.position_x IS 'Coordenada en el mapa de condición del portal, para no fijar posiciones en el código.';
-- Una referencia Modbus no puede repetirse dentro del mismo Unit ID.
CREATE UNIQUE INDEX IF NOT EXISTS channel_register_unique
  ON channel(unit_id, register) WHERE register IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_metric (
  id             bigserial PRIMARY KEY,
  channel_id     bigint NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  metric         text NOT NULL,
  uom            text NOT NULL,
  is_primary     boolean NOT NULL DEFAULT false,
  deadband       numeric,
  heartbeat_s    integer NOT NULL DEFAULT 30,
  warn_threshold numeric,
  crit_threshold numeric,
  hysteresis     numeric NOT NULL DEFAULT 0,
  delay_s        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, metric),
  CONSTRAINT threshold_order CHECK (
    warn_threshold IS NULL OR crit_threshold IS NULL OR warn_threshold < crit_threshold
  )
);
COMMENT ON TABLE channel_metric IS 'Serie medible. Existe porque un canal de descarga parcial produce ocho series distintas (q_peak, sd_max, pd_max, noise_floor, snr, trend_alpha, trend_beta, trend_phi), no una.';
COMMENT ON COLUMN channel_metric.deadband IS 'Cambio mínimo para que el gateway reenvíe. Sin esto, 710 series a 1 Hz son 61 millones de muestras diarias.';
COMMENT ON COLUMN channel_metric.heartbeat_s IS 'Aunque no cambie, se emite cada N segundos para que la tendencia no tenga huecos.';
COMMENT ON COLUMN channel_metric.hysteresis IS 'Para bajar de nivel el valor debe caer bajo el umbral menos la histéresis. Evita el parpadeo de alarmas.';
COMMENT ON COLUMN channel_metric.delay_s IS 'La condición debe sostenerse este tiempo antes de abrir la alarma.';
CREATE INDEX IF NOT EXISTS channel_metric_channel_idx ON channel_metric(channel_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TELEMETRÍA: lo que llega del gateway
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingest_batch (
  batch_id    text PRIMARY KEY,
  gateway_id  text NOT NULL REFERENCES gateway(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('telemetry','status','events')),
  received_at timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  accepted    integer NOT NULL DEFAULT 0,
  rejected    integer NOT NULL DEFAULT 0,
  lag_ms      bigint
);
COMMENT ON TABLE ingest_batch IS 'Idempotencia de la ingesta: la clave del lote impide que un reenvío tras un corte duplique datos.';
COMMENT ON COLUMN ingest_batch.lag_ms IS 'received_at menos sent_at. Mide cuánto tardó en reinyectarse un lote acumulado.';
CREATE INDEX IF NOT EXISTS ingest_batch_recv_idx ON ingest_batch(gateway_id, received_at DESC);

CREATE TABLE IF NOT EXISTS reading (
  channel_metric_id bigint      NOT NULL,
  ts                timestamptz NOT NULL,
  value             double precision,
  quality           text        NOT NULL CHECK (quality IN ('good','stale','bad','disabled')),
  seq               bigint,
  received_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_metric_id, ts)
) PARTITION BY RANGE (ts);
COMMENT ON TABLE reading IS 'Serie cruda, particionada por mes. Sin clave foránea a propósito: en tablas particionadas de alto volumen el costo de validación por fila no compensa.';
COMMENT ON COLUMN reading.ts IS 'Instante de la lectura EN ORIGEN, no el del envío.';
COMMENT ON COLUMN reading.received_at IS 'Instante en que CORE la recibió. La diferencia con ts revela una reinyección.';
COMMENT ON COLUMN reading.quality IS 'good | stale | bad | disabled. Un fallo NUNCA se convierte en 0: se conserva el último valor y se degrada la calidad.';
COMMENT ON COLUMN reading.seq IS 'Contador monótono del gateway. Permite detectar huecos sin ambigüedad.';
CREATE INDEX IF NOT EXISTS reading_received_idx ON reading (received_at);

CREATE OR REPLACE FUNCTION ensure_reading_partition(at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  start_ts date := date_trunc('month', at AT TIME ZONE 'UTC')::date;
  end_ts   date := (date_trunc('month', at AT TIME ZONE 'UTC') + interval '1 month')::date;
  part     text := format('reading_%s', to_char(start_ts, 'YYYYMM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF reading FOR VALUES FROM (%L) TO (%L)',
      part, start_ts, end_ts);
  END IF;
END $$;
COMMENT ON FUNCTION ensure_reading_partition IS 'Crea la partición mensual que contenga el instante dado. La ingesta la invoca antes de insertar, incluidos los meses antiguos que llegan al reinyectar.';

CREATE TABLE IF NOT EXISTS reading_latest (
  channel_metric_id bigint PRIMARY KEY REFERENCES channel_metric(id) ON DELETE CASCADE,
  ts                timestamptz NOT NULL,
  value             double precision,
  quality           text NOT NULL,
  seq               bigint,
  received_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE reading_latest IS 'Último valor por serie. Evita escanear la tabla particionada para pintar el dashboard. Sólo avanza hacia adelante en el tiempo: reinyectar datos antiguos no pisa la lectura actual.';

CREATE TABLE IF NOT EXISTS reading_rollup_1m (
  channel_metric_id bigint NOT NULL REFERENCES channel_metric(id) ON DELETE CASCADE,
  bucket        timestamptz NOT NULL,
  samples       integer NOT NULL,
  avg_value     double precision,
  min_value     double precision,
  max_value     double precision,
  last_value    double precision,
  worst_quality text NOT NULL,
  PRIMARY KEY (channel_metric_id, bucket)
);
COMMENT ON TABLE reading_rollup_1m IS 'Agregado por minuto. Las tendencias de más de 6 horas leen de aquí.';

CREATE TABLE IF NOT EXISTS reading_rollup_1h (
  LIKE reading_rollup_1m INCLUDING ALL
);
COMMENT ON TABLE reading_rollup_1h IS 'Agregado por hora. Las tendencias de más de 7 días y los reportes leen de aquí.';

CREATE TABLE IF NOT EXISTS rollup_state (
  grain            text PRIMARY KEY,
  last_received_at timestamptz NOT NULL
);
COMMENT ON TABLE rollup_state IS 'Marca de avance de la agregación.';
COMMENT ON COLUMN rollup_state.last_received_at IS 'El watermark es sobre received_at, NO sobre ts. Con un watermark por ts, los datos que el gateway reinyecta tras un corte quedarían fuera de los agregados de forma permanente.';

CREATE TABLE IF NOT EXISTS gateway_event (
  id           bigserial PRIMARY KEY,
  gateway_id   text NOT NULL REFERENCES gateway(id) ON DELETE CASCADE,
  unit_id      text REFERENCES unit(id) ON DELETE SET NULL,
  seq          bigint,
  ts           timestamptz NOT NULL,
  type         text NOT NULL,
  severity     text NOT NULL DEFAULT 'info',
  channel_code text,
  detail       jsonb,
  received_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE gateway_event IS 'Eventos de infraestructura: cambio de relé, excepción Modbus, arranque, canal perdido. NO son alarmas de proceso.';
CREATE INDEX IF NOT EXISTS gateway_event_ts_idx ON gateway_event(gateway_id, ts DESC);

CREATE TABLE IF NOT EXISTS unit_health (
  unit_id               text PRIMARY KEY REFERENCES unit(id) ON DELETE CASCADE,
  ts                    timestamptz NOT NULL,
  online                boolean NOT NULL,
  poll_cycle_ms         integer,
  poll_latency_ms       integer,
  reads_ok_24h          bigint,
  reads_failed_24h      bigint,
  modbus_exceptions_24h bigint,
  channels_configured   integer,
  channels_good         integer,
  readers_online        integer
);
COMMENT ON TABLE unit_health IS 'Última salud reportada por cada unidad en el latido de estado. Alimenta la vista Diagnóstico OT.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ALARMAS: el servidor es la única fuente de verdad del estado
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alarm (
  id                text PRIMARY KEY,
  asset_id          text NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  unit_id           text REFERENCES unit(id) ON DELETE SET NULL,
  channel_metric_id bigint REFERENCES channel_metric(id) ON DELETE SET NULL,
  rule              text NOT NULL DEFAULT 'threshold',
  severity          text NOT NULL CHECK (severity IN ('info','warning','critical')),
  status            text NOT NULL CHECK (status IN ('open','acknowledged','closed')),
  title             text NOT NULL,
  detail            text,
  opened_at         timestamptz NOT NULL,
  opened_value      double precision,
  opened_threshold  double precision,
  acknowledged_at   timestamptz,
  acknowledged_by   text,
  closed_at         timestamptz,
  closed_by         text,
  close_note        text,
  reopen_count      integer NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE alarm IS 'Ciclo de vida open → acknowledged → closed, con closed → open permitido y auditado. Se evalúa en el servidor: una alarma existe aunque nadie tenga el portal abierto.';
COMMENT ON COLUMN alarm.id IS 'Formato AL-AAMMDD-NNN. Estable, legible y no reutilizable.';
COMMENT ON COLUMN alarm.close_note IS 'Obligatoria al cerrar. El retorno a la normalidad NO cierra la alarma: eso es una decisión humana.';
CREATE INDEX IF NOT EXISTS alarm_status_idx ON alarm(status, opened_at DESC);
CREATE INDEX IF NOT EXISTS alarm_asset_idx  ON alarm(asset_id, opened_at DESC);
-- Una serie no puede tener dos alarmas abiertas de la misma regla a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS alarm_active_unique
  ON alarm(channel_metric_id, rule) WHERE status <> 'closed';

CREATE TABLE IF NOT EXISTS alarm_note (
  id       bigserial PRIMARY KEY,
  alarm_id text NOT NULL REFERENCES alarm(id) ON DELETE CASCADE,
  ts       timestamptz NOT NULL DEFAULT now(),
  author   text NOT NULL,
  note     text NOT NULL
);
COMMENT ON TABLE alarm_note IS 'Bitácora del evento: notas del operador y anotaciones automáticas del sistema.';
CREATE INDEX IF NOT EXISTS alarm_note_alarm_idx ON alarm_note(alarm_id, ts);

CREATE TABLE IF NOT EXISTS alarm_candidate (
  channel_metric_id bigint PRIMARY KEY REFERENCES channel_metric(id) ON DELETE CASCADE,
  level             text NOT NULL CHECK (level IN ('normal','warning','critical')),
  since             timestamptz NOT NULL,
  last_value        double precision,
  confirmed         boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE alarm_candidate IS 'Estado interno del evaluador: cuánto lleva una serie sobre umbral. Sin persistirlo, el retardo y la histéresis se perderían en cada reinicio del servicio.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GESTIÓN OPERATIVA
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_user (
  id         text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  full_name  text NOT NULL,
  role       text NOT NULL CHECK (role IN ('admin','engineer','operator','viewer')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz
);
COMMENT ON TABLE app_user IS 'El rol se aplica en el servidor, no sólo en la interfaz.';

CREATE TABLE IF NOT EXISTS work_order (
  id           text PRIMARY KEY,
  asset_id     text NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  alarm_id     text REFERENCES alarm(id) ON DELETE SET NULL,
  title        text NOT NULL,
  source       text,
  priority     text NOT NULL CHECK (priority IN ('normal','high','critical')),
  status       text NOT NULL CHECK (status IN ('pending','in_progress','completed')),
  assignee_id  text REFERENCES app_user(id) ON DELETE SET NULL,
  due_at       timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
COMMENT ON TABLE work_order IS 'Orden de trabajo. Formato OT-AAMMDD-NNN.';
-- Una alarma puede tener como máximo una orden activa vinculada.
CREATE UNIQUE INDEX IF NOT EXISTS work_order_alarm_active
  ON work_order(alarm_id) WHERE alarm_id IS NOT NULL AND status <> 'completed';

CREATE TABLE IF NOT EXISTS audit_log (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  actor     text NOT NULL,
  action    text NOT NULL,
  target    text,
  old_value jsonb,
  new_value jsonb,
  origin    text NOT NULL DEFAULT 'portal',
  trace_id  text
);
COMMENT ON TABLE audit_log IS 'Quién cambió qué, cuándo, desde dónde, y con qué valor anterior y nuevo.';
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS api_key (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text NOT NULL,
  scope        text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
COMMENT ON TABLE api_key IS 'Credenciales para servicios externos. Sólo se guarda el hash; la clave completa se muestra una única vez al crearla.';

CREATE TABLE IF NOT EXISTS report (
  id           text PRIMARY KEY,
  asset_id     text NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  period_from  timestamptz NOT NULL,
  period_to    timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending','ready','failed')),
  download_url text,
  error        text,
  requested_by text REFERENCES app_user(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ready_at     timestamptz
);
COMMENT ON TABLE report IS 'Generación asíncrona: la API responde pending de inmediato y el portal sondea hasta ready. Un informe de 30 días no cabe en ningún timeout HTTP razonable.';

CREATE TABLE IF NOT EXISTS notification_channel (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('email','sms','webhook')),
  target       text NOT NULL,
  min_severity text NOT NULL DEFAULT 'warning',
  enabled      boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE notification_channel IS 'Destino de las notificaciones y severidad mínima que las dispara.';

CREATE TABLE IF NOT EXISTS notification_log (
  id           bigserial PRIMARY KEY,
  channel_id   bigint REFERENCES notification_channel(id) ON DELETE SET NULL,
  alarm_id     text REFERENCES alarm(id) ON DELETE SET NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  status       text NOT NULL CHECK (status IN ('attempted','delivered','failed')),
  error        text
);
COMMENT ON TABLE notification_log IS 'Registra intento, entrega y error por separado: un canal que "no falló" no es lo mismo que uno que entregó.';
CREATE INDEX IF NOT EXISTS notification_log_idx ON notification_log(attempted_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VISTAS DE CONSULTA
-- ─────────────────────────────────────────────────────────────────────────────

-- Catálogo aplanado: una fila por serie medible, con toda su jerarquía.
CREATE OR REPLACE VIEW v_series AS
SELECT cm.id            AS channel_metric_id,
       s.id             AS site_id,
       a.id             AS asset_id,
       u.id             AS unit_id,
       u.kind           AS unit_kind,
       u.parent_unit_id,
       c.id             AS channel_id,
       c.code           AS channel_code,
       c.kind           AS channel_kind,
       c.label, c.zone, c.enabled,
       c.register, c.data_type, c.scale, c.byte_order, c.map_confirmed,
       cm.metric, cm.uom, cm.is_primary,
       cm.warn_threshold, cm.crit_threshold, cm.hysteresis, cm.delay_s, cm.deadband
  FROM channel_metric cm
  JOIN channel c ON c.id = cm.channel_id
  JOIN unit    u ON u.id = c.unit_id
  JOIN asset   a ON a.id = u.asset_id
  JOIN site    s ON s.id = a.site_id;
COMMENT ON VIEW v_series IS 'Una fila por serie medible con su jerarquía completa. Punto de entrada para consultas ad hoc.';

-- Condición actual, ya resuelta: valor, calidad y severidad por serie.
CREATE OR REPLACE VIEW v_condition_now AS
SELECT v.*,
       rl.value, rl.ts AS source_timestamp, rl.received_at, rl.seq,
       CASE
         WHEN rl.ts IS NULL              THEN 'bad'
         WHEN NOT v.enabled              THEN 'disabled'
         WHEN rl.ts < now() - interval '1 minute' THEN 'stale'
         ELSE rl.quality
       END AS effective_quality,
       CASE
         WHEN rl.value IS NULL OR NOT v.enabled THEN 'normal'
         WHEN v.crit_threshold IS NOT NULL AND rl.value >= v.crit_threshold THEN 'critical'
         WHEN v.warn_threshold IS NOT NULL AND rl.value >= v.warn_threshold THEN 'warning'
         ELSE 'normal'
       END AS severity
  FROM v_series v
  LEFT JOIN reading_latest rl ON rl.channel_metric_id = v.channel_metric_id;
COMMENT ON VIEW v_condition_now IS 'Condición actual por serie. Distingue atrasado (stale por antigüedad del dato) de inválido.';

-- Alarmas vigentes con su orden de trabajo asociada.
CREATE OR REPLACE VIEW v_alarm_active AS
SELECT al.*,
       c.code AS channel_code, c.label AS channel_label,
       cm.metric, cm.uom,
       w.id AS work_order_id, w.status AS work_order_status
  FROM alarm al
  LEFT JOIN channel_metric cm ON cm.id = al.channel_metric_id
  LEFT JOIN channel c         ON c.id = cm.channel_id
  LEFT JOIN work_order w      ON w.alarm_id = al.id AND w.status <> 'completed'
 WHERE al.status <> 'closed';
COMMENT ON VIEW v_alarm_active IS 'Alarmas abiertas o reconocidas, con la orden de trabajo activa si existe.';

COMMIT;

-- Particiones del mes en curso y del siguiente, para que la ingesta nunca falle
-- por falta de partición justo al cambiar de mes.
SELECT ensure_reading_partition(now());
SELECT ensure_reading_partition(now() + interval '1 month');

-- Permisos para el rol de aplicación (ajusta el nombre si usas otro).
-- GRANT USAGE ON SCHEMA public TO cam5;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cam5;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cam5;
