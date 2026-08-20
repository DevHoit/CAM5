"use client";

import { useState } from "react";
import { IconBellRinging as BellRing, IconCircleCheck as CheckCircle2, IconChevronDown as ChevronDown, IconClock as Clock3, IconDatabase as Database, IconShieldCheck as ShieldCheck, IconTimeline as Timeline } from "@tabler/icons-react";
import { StatusPill } from "../components/StatusPill";
import { auditEntries, closedAlarms, sensors } from "../lib/fixtures";
import type { HistoryTab } from "../lib/types";
import { useCam5Data, useSensorData } from "../lib/cam5-data";
import { useAuditLog, useMeasurements } from "../lib/use-cam5";

import { TableEmptyState } from "../components/TableEmptyState";

export function HistoryView() {
  const sensors = useSensorData();
  const [tab, setTab] = useState<HistoryTab>("measurements");
  const [range, setRange] = useState("24 h");
  const [channel, setChannel] = useState("all");
  const cam5 = useCam5Data();
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const visibleSensors = channel === "all" ? activeSensors : activeSensors.filter((sensor) => sensor.id === channel);

  // El histórico de mediciones se pagina por cursor: 30 días de una unidad son
  // cientos de miles de filas y no caben en una sola respuesta.
  const selectedSensor = activeSensors.find((sensor) => sensor.id === channel);
  const history = useMeasurements(cam5.assetId, {
    unitId: cam5.unitId,
    channel: channel === "all" ? undefined : channel,
    metric: selectedSensor?.metric,
  });
  const audit = useAuditLog(100);

  const estimatedRecords = cam5.demo
    ? activeSensors.length * (range === "24 h" ? 43200 : range === "7 días" ? 302400 : range === "30 días" ? 1296000 : 3888000)
    : history.items.length;
  const auditRows = cam5.demo
    ? auditEntries
    : (audit.data ?? []).map((entry) => ({
        time: new Date(entry.ts).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        user: entry.actor,
        action: entry.action,
        target: entry.target ?? "—",
        origin: entry.origin === "portal" ? "Portal web" : entry.origin,
      }));
  const alarmRows = cam5.demo
    ? closedAlarms
    : cam5.portalAlarms;

  return (
    <>
      <section className="module-summary-grid">
        <article><span className="module-summary-icon blue"><Database size={19} /></span><div><small>{cam5.demo ? "Registros del periodo" : "Registros cargados"}</small><strong>{estimatedRecords.toLocaleString("es-CL")}</strong><span>{cam5.demo ? `${activeSensors.length} canales · ${range}` : history.hasMore ? "Hay más disponibles" : "Todo el histórico visible"}</span></div></article>
        <article><span className="module-summary-icon green"><ShieldCheck size={19} /></span><div><small>Integridad de datos</small><strong>{cam5.demo ? "99.98%" : history.items.length ? `${((history.items.filter((row) => row.quality === "good").length / history.items.length) * 100).toFixed(2)}%` : "—"}</strong><span>{cam5.demo ? "69 muestras estimadas" : `${history.items.filter((row) => row.quality !== "good").length} muestras no válidas`}</span></div></article>
        <article><span className="module-summary-icon amber"><BellRing size={19} /></span><div><small>Eventos registrados</small><strong>{alarmRows.length}</strong><span>{alarmRows.filter((a) => a.severity === "critical").length} críticos · {alarmRows.filter((a) => a.severity === "warning").length} advertencias</span></div></article>
      </section>

      <article className="panel module-panel">
        <div className="module-toolbar">
          <div className="module-tabs" role="tablist" aria-label="Tipo de histórico">
            <button className={tab === "measurements" ? "active" : ""} onClick={() => setTab("measurements")}><Timeline size={16} /> Mediciones</button>
            <button className={tab === "alarms" ? "active" : ""} onClick={() => setTab("alarms")}><BellRing size={16} /> Alarmas</button>
            <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><ShieldCheck size={16} /> Auditoría</button>
          </div>
          <div className="history-filters">
            {tab === "measurements" && <label><span>Canal</span><select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">Todos los canales</option>{activeSensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select><ChevronDown size={13} /></label>}
            <label><span>Periodo</span><select value={range} onChange={(event) => setRange(event.target.value)}><option>24 h</option><option>7 días</option><option>30 días</option><option>90 días</option></select><ChevronDown size={13} /></label>
          </div>
        </div>

        {tab === "measurements" && (cam5.demo
          ? <div className="module-table-wrap"><div className="history-table measurement-history"><div className="module-table-head"><span>Canal</span><span>Última lectura</span><span>Promedio</span><span>Mínimo</span><span>Máximo</span><span>Calidad</span></div>{visibleSensors.map((sensor) => {
              const value = Number(sensor.value);
              const spread = sensor.type === "Descarga parcial" ? 8 : sensor.type === "Humedad" ? 5 : 4;
              return <div className="module-table-row" key={sensor.id}><span className="history-channel"><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b><span><strong>{sensor.label}</strong><small>{sensor.zone}</small></span></span><span className="mono-cell">{sensor.value} {sensor.unit}</span><span className="mono-cell">{(value - spread * .35).toFixed(1)} {sensor.unit}</span><span className="mono-cell">{(value - spread).toFixed(1)} {sensor.unit}</span><span className="mono-cell">{(value + (sensor.state === "normal" ? 1.2 : 2.4)).toFixed(1)} {sensor.unit}</span><span className="quality-ok"><CheckCircle2 size={14} /> Válida</span></div>;
            })}</div></div>
          : <><div className="module-table-wrap"><div className="history-table measurement-history"><div className="module-table-head"><span>Canal</span><span>Instante</span><span>Valor</span><span>Umbral prev.</span><span>Umbral crítico</span><span>Calidad</span></div>{history.items.length === 0 ? <TableEmptyState title="Sin mediciones" detail="No hay registros para el canal y periodo seleccionados." /> : history.items.map((row, index) => <div className="module-table-row" key={`${row.unit_id}-${row.channel}-${row.metric}-${row.ts}-${index}`}><span className="history-channel"><b className="sensor-code">{row.channel}</b><span><strong>{row.label}</strong><small>{row.metric}</small></span></span><span className="mono-cell">{new Date(row.ts).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span className="mono-cell">{row.value === null ? "—" : Number(row.value.toFixed(3))} {row.uom}</span><span className="mono-cell">{row.warn ?? "—"}</span><span className="mono-cell">{row.crit ?? "—"}</span><span className={row.quality === "good" ? "quality-ok" : "unack-state"}>{row.quality === "good" ? <><CheckCircle2 size={14} /> Válida</> : <><Clock3 size={14} /> {row.quality === "stale" ? "Atrasada" : row.quality === "bad" ? "Inválida" : "Deshabilitada"}</>}</span></div>)}</div></div>
            {history.hasMore && <div className="module-footer"><button className="secondary-button" onClick={history.loadMore} disabled={history.loadingMore}>{history.loadingMore ? "Cargando…" : "Cargar 50 registros más"}</button></div>}</>)}

        {tab === "alarms" && <div className="module-table-wrap"><div className="history-table alarm-history"><div className="module-table-head"><span>Fecha</span><span>Severidad</span><span>Evento</span><span>Valor</span><span>Estado</span></div>{alarmRows.map((alarm, index) => <div className="module-table-row" key={alarm.id}><span>{index < 3 ? alarm.since : alarm.since}</span><span><StatusPill state={alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Info"}</StatusPill></span><span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.detail} · {alarm.id}</small></span><span className="mono-cell">{alarm.value}</span><span className={alarm.acknowledged ? "quality-ok" : "unack-state"}>{alarm.acknowledged ? <><CheckCircle2 size={14} /> Cerrada</> : <><Clock3 size={14} /> Abierta</>}</span></div>)}</div></div>}

        {tab === "audit" && <div className="module-table-wrap"><div className="history-table audit-history"><div className="module-table-head"><span>Fecha</span><span>Usuario</span><span>Acción</span><span>Detalle</span><span>Origen</span></div>{auditRows.map((entry) => <div className="module-table-row" key={`${entry.time}-${entry.action}`}><span>{entry.time}</span><span><strong>{entry.user}</strong></span><span>{entry.action}</span><span className="mono-cell">{entry.target}</span><span>{entry.origin}</span></div>)}</div></div>}

        <div className="module-footer"><span><Database size={14} /> Retención configurada: 24 meses</span><small>{cam5.demo ? "Fuente actual: simulador local · fuente futura: historiador CAM5." : `Fuente: CAM5 CORE · unidad ${cam5.unitId}`}</small></div>
      </article>
    </>
  );
}
