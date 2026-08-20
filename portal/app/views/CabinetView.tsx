"use client";

import { useState } from "react";
import { IconActivity as Activity, IconDroplet as Droplets, IconTemperature as Thermometer, IconTrendingUp as TrendingUp, IconWifi as Wifi } from "@tabler/icons-react";
import { CabinetDiagram } from "../components/CabinetDiagram";
import { StatusPill } from "../components/StatusPill";
import { sensors } from "../lib/fixtures";
import { useSensorData } from "../lib/use-sensor-data";

import { TableEmptyState } from "../components/TableEmptyState";

export function CabinetView({ onOpenTrend }: { onOpenTrend: (id: string) => void }) {
  const sensors = useSensorData();
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const [selectedId, setSelectedId] = useState("PD1");
  const selected = sensors.find((sensor) => sensor.id === selectedId && sensor.enabled) ?? sensors.find((sensor) => sensor.enabled) ?? sensors[0];
  if (!selected) return <TableEmptyState title="Sin canales disponibles" detail="Aún no llegan lecturas desde el gateway para esta unidad." />;
  const SelectedIcon = selected.type === "Temperatura" ? Thermometer : selected.type === "Humedad" ? Droplets : Activity;
  const selectedStateLabel = !selected.enabled ? "No configurado" : selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal";

  return (
    <section className="cabinet-view-grid">
      <article className="panel cabinet-full-panel">
        <div className="panel-header"><div><span className="eyebrow">Mapa de condición de la cabina</span><h2>MCC-01 · Alimentador Norte</h2><p>{activeSensors.length} canales activos · {24 - activeSensors.length} disponibles</p></div><StatusPill state="critical">{activeSensors.filter((sensor) => sensor.state === "critical").length} crítico · {activeSensors.filter((sensor) => sensor.state === "warning").length} advertencias</StatusPill></div>
        <CabinetDiagram selectedId={selectedId} onSelect={setSelectedId} />
        <div className="diagram-legend"><span><i className="dot-normal" />Normal</span><span><i className="dot-warning" />Advertencia</span><span><i className="dot-critical" />Crítico</span><span><i className="dot-disabled" />No configurado</span><small>Selecciona una tarjeta para revisar el canal.</small></div>
      </article>
      <article className="panel sensor-panel">
        <div className={`selected-sensor-card selected-${selected.state}`}>
          <div className="selected-sensor-head"><span className="selected-sensor-icon"><SelectedIcon size={21} /></span><div><small>Canal seleccionado</small><strong>{selected.id} · {selected.type}</strong></div><StatusPill state={selected.state}>{selectedStateLabel}</StatusPill></div>
          <div className="selected-sensor-value">{selected.value}<span>{selected.unit}</span></div>
          <p>{selected.label} · {selected.zone}</p>
          <dl><div><dt>Tendencia</dt><dd>{selected.trend}</dd></div><div><dt>Umbral</dt><dd>{selected.threshold}</dd></div><div><dt>Registro asumido</dt><dd>{selected.register}</dd></div><div><dt>Calidad</dt><dd>{selected.quality}</dd></div></dl>
          <button type="button" onClick={() => onOpenTrend(selected.id)}>Abrir tendencia del canal <TrendingUp size={16} /></button>
        </div>
        <div className="panel-header compact sensor-list-header"><div><span className="eyebrow">Canales configurados</span><h2>Matriz de sensores</h2></div><span className="data-fresh"><Wifi size={14} /> Hace 2 s</span></div>
        <div className="sensor-list">
          {sensors.map((sensor) => (
            <button type="button" className={`sensor-row ${!sensor.enabled ? "disabled" : ""} ${selectedId === sensor.id ? "selected" : ""}`} key={sensor.id} onClick={() => setSelectedId(sensor.id)} disabled={!sensor.enabled}>
              <span className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</span>
              <div><strong>{sensor.label}</strong><small>{sensor.zone}</small></div>
              <div className="sensor-reading"><strong>{sensor.value}<small>{sensor.unit}</small></strong><span>{sensor.trend}</span></div>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}
