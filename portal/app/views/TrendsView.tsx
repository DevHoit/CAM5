"use client";

import { IconActivity as Activity, IconChevronDown as ChevronDown, IconCircuitCell as CircuitBoard, IconDroplet as Droplets, IconGauge as Gauge, IconShieldCheck as ShieldCheck, IconTemperature as Thermometer, IconTrendingUp as TrendingUp } from "@tabler/icons-react";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { useCam5Data, useSensorData } from "../lib/cam5-data";
import { useTrend, formatAge } from "../lib/use-cam5";

import { TableEmptyState } from "../components/TableEmptyState";

export function TrendsView({ period, setPeriod, selectedId, onSelectChannel, onBackToMap }: { period: string; setPeriod: (period: string) => void; selectedId: string; onSelectChannel: (id: string) => void; onBackToMap: () => void }) {
  const sensors = useSensorData();
  const cam5 = useCam5Data();
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const selected = activeSensors.find((sensor) => sensor.id === selectedId) ?? activeSensors[0] ?? sensors[0];
  const currentValue = Number(selected?.value ?? 0);
  const thresholdValue = Number.parseFloat(selected?.threshold ?? "0");

  // Serie real del backend. En modo demostración se conserva el perfil sintético
  // para que la vista siga siendo presentable sin backend.
  const trend = useTrend(cam5.assetId, selected?.unitId ?? "", selected?.id ?? "", selected?.metric ?? "", period);
  if (!selected) return <TableEmptyState title="Sin canales disponibles" detail="Aún no llegan lecturas desde el gateway para esta unidad." />;
  const amplitude = selected.type === "Descarga parcial" ? (selected.state === "critical" ? 48 : 8) : selected.type === "Humedad" ? 14 : selected.state === "warning" ? 17 : 5;
  const profile = [-1, -.96, -.98, -.9, -.84, -.87, -.78, -.73, -.68, -.7, -.62, -.56, -.5, -.45, -.38, -.4, -.3, -.25, -.27, -.18, -.12, -.08, -.05, 0];
  const demoSeries = profile.map((point) => Math.max(0, Number((currentValue + point * amplitude).toFixed(1))));

  // Remuestreo a 24 columnas: el gráfico tiene un ancho fijo y una tendencia de
  // 30 días trae miles de puntos.
  const livePoints = (trend.data?.points ?? []).filter((p) => p.value !== null);
  const series = cam5.demo || livePoints.length === 0
    ? demoSeries
    : Array.from({ length: 24 }, (_, column) => {
        const start = Math.floor(column * livePoints.length / 24);
        const end = Math.max(start + 1, Math.floor((column + 1) * livePoints.length / 24));
        const slice = livePoints.slice(start, end);
        const avg = slice.reduce((sum, p) => sum + Number(p.value), 0) / slice.length;
        return Number(avg.toFixed(2));
      });
  const axisLabels = cam5.demo || livePoints.length === 0
    ? ["00:00", "06:00", "12:00", "18:00", "23:00"]
    : [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const point = livePoints[Math.min(livePoints.length - 1, Math.floor(fraction * (livePoints.length - 1)))];
        const at = new Date(point.ts);
        return period === "24 h"
          ? at.toISOString().slice(11, 16)
          : `${at.getUTCDate()}/${at.getUTCMonth() + 1}`;
      });
  const grainLabel = cam5.demo ? "Resolución 1 hora"
    : trend.data?.grain === "raw" ? "Resolución nativa"
    : trend.data?.grain === "1m" ? "Resolución 1 minuto" : "Resolución 1 hora";
  const chartMax = Math.ceil(Math.max(currentValue, thresholdValue, ...series) * 1.15 / 10) * 10;
  const variation = series.length > 0 ? currentValue - series[0] : 0;
  const stateLabel = selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal";
  const stateTone = selected.state === "critical" ? "red" : selected.state === "warning" ? "amber" : "green";
  const SelectedIcon = selected.type === "Temperatura" ? Thermometer : selected.type === "Humedad" ? Droplets : Activity;
  const insight = selected.state === "critical"
    ? `${selected.id} mantiene crecimiento sostenido y supera el umbral configurado. Se recomienda inspección prioritaria de ${selected.zone.toLowerCase()}.`
    : selected.state === "warning"
      ? `${selected.id} se encuentra sobre el umbral operativo y presenta una tendencia ascendente. Conviene verificar el activo durante el próximo ciclo de carga.`
      : `${selected.id} permanece dentro del rango esperado y sin cambios relevantes durante el periodo seleccionado.`;

  return (
    <>
      <section className="toolbar-row">
        <div className="trend-toolbar-controls">
          <label className="channel-select"><Activity size={16} /><span><small>Canal</small><select value={selected.id} onChange={(event) => onSelectChannel(event.target.value)} aria-label="Seleccionar canal de tendencia">{activeSensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select></span><ChevronDown size={14} /></label>
          <div className="segmented" aria-label="Rango temporal">{["24 h", "7 días", "30 días"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div>
        </div>
      </section>
      <section className="metrics-grid compact-metrics">
        <MetricCard label="Lectura actual" value={selected.value} unit={selected.unit} note={`${selected.id} · ${selected.label}`} tone={stateTone} icon={SelectedIcon} />
        <MetricCard label="Umbral configurado" value={String(thresholdValue)} unit={selected.unit} note={currentValue > thresholdValue ? "Umbral superado" : "Dentro del rango"} tone={currentValue > thresholdValue ? "amber" : "green"} icon={Gauge} />
        <MetricCard label="Variación del periodo" value={`+${variation.toFixed(selected.type === "Descarga parcial" ? 0 : 1)}`} unit={selected.unit} note={selected.trend} tone="blue" icon={TrendingUp} />
        <MetricCard
          label="Calidad del dato"
          value={selected.rawQuality === "good" ? "100" : selected.rawQuality === "stale" ? "50" : "0"}
          unit="%"
          note={cam5.demo
            ? `${selected.quality} · actualizado hace 2 s`
            : `${selected.quality} · ${selected.sourceTimestamp ? `hace ${formatAge(Math.round((Date.now() - Date.parse(selected.sourceTimestamp)) / 1000))}` : "sin lectura"}`}
          tone={selected.rawQuality === "good" ? "green" : selected.rawQuality === "stale" ? "amber" : "red"}
          icon={ShieldCheck} />
      </section>
      <article className="panel chart-panel">
        <div className="panel-header"><div><span className="eyebrow">{selected.id} · {grainLabel} · {period}{!cam5.demo && trend.data ? ` · ${livePoints.length} puntos` : ""}</span><h2>{selected.label}</h2><p>{selected.zone} · {selected.type}</p></div><StatusPill state={selected.state}>{stateLabel}</StatusPill></div>
        <div className="chart-scale"><span>{chartMax}</span><span>{Math.round(chartMax * .75)}</span><span>{Math.round(chartMax * .5)}</span><span>{Math.round(chartMax * .25)}</span><span>0</span></div>
        <div className={`large-chart channel-chart chart-${selected.state}`}>
          <div className="threshold-line" style={{ bottom: `${Math.min(100, thresholdValue / chartMax * 100)}%` }}><span>Umbral {selected.threshold}</span></div>
          {series.map((value, index) => <span key={index} title={`${String(index).padStart(2, "0")}:00 · ${value} ${selected.unit}`}><i style={{ height: `${Math.max(3, value / chartMax * 100)}%` }} /></span>)}
        </div>
        <div className="chart-axis">{axisLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
        <div className="chart-legend centered"><span><i className={`legend-channel legend-${selected.state}`} />{selected.id} · {selected.unit}</span><span><i className="legend-threshold" />Umbral {selected.threshold}</span></div>
      </article>
      <article className={`panel insight-panel insight-${selected.state}`}><span className="insight-icon"><TrendingUp size={20} /></span><div><strong>Interpretación del canal</strong><p>{insight}</p></div><button onClick={onBackToMap}><CircuitBoard size={15} /> Volver al mapa</button></article>
    </>
  );
}
