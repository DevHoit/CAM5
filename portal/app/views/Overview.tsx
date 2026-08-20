"use client";

import { IconActivity as Activity, IconAlertTriangle as AlertTriangle, IconBellRinging as BellRing, IconChevronRight as ChevronRight, IconDroplet as Droplets, IconRadio as Radio, IconServer as Server, IconShieldCheck as ShieldCheck, IconTemperature as Thermometer, IconWifi as Wifi } from "@tabler/icons-react";
import { usePersistentState } from "../use-persistent-state";
import { MetricCard } from "../components/MetricCard";
import { StatusPill } from "../components/StatusPill";
import { chartData, defaultAssetConfig, sensors } from "../lib/fixtures";
import { useCam5Data } from "../lib/cam5-data";
import type { View } from "../lib/types";
import { useSensorData } from "../lib/use-sensor-data";

export function Overview({ onNavigate, onAcknowledge, acknowledged }: { onNavigate: (view: View) => void; onAcknowledge: (id: string) => void; acknowledged: string[] }) {
  const sensors = useSensorData();
  const [assetConfig] = usePersistentState("cam5.front.asset-config", defaultAssetConfig);
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const temperature = activeSensors.filter((sensor) => sensor.type === "Temperatura").sort((a, b) => Number(b.value) - Number(a.value))[0];
  const partialDischarge = activeSensors.find((sensor) => sensor.id === "PD1");
  const humidity = activeSensors.find((sensor) => sensor.id === "H01");
  const conditionCounts = {
    critical: activeSensors.filter((sensor) => sensor.state === "critical").length,
    warning: activeSensors.filter((sensor) => sensor.state === "warning").length,
    normal: activeSensors.filter((sensor) => sensor.state === "normal").length,
  };
  const cam5 = useCam5Data();
  const activeAlarms = cam5.portalAlarms.filter((alarm) => alarm.status === "open" && !acknowledged.includes(alarm.id));
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="Temperatura máxima" value={temperature?.value ?? "—"} unit={temperature?.unit} note={temperature ? `${temperature.id} · ${temperature.trend}` : "Sin canales activos"} tone={temperature?.state === "critical" ? "red" : temperature?.state === "warning" ? "amber" : "green"} icon={Thermometer} />
        <MetricCard label="Descarga parcial" value={partialDischarge?.value ?? "—"} unit={partialDischarge?.unit} note={partialDischarge ? `${partialDischarge.id} · ${partialDischarge.trend}` : "Canal deshabilitado"} tone={partialDischarge?.state === "critical" ? "red" : partialDischarge?.state === "warning" ? "amber" : "green"} icon={Activity} />
        <MetricCard label="Humedad relativa" value={humidity?.value ?? "—"} unit={humidity?.unit} note={humidity ? `${humidity.id} · ${humidity.trend}` : "Canal deshabilitado"} tone={humidity?.state === "critical" ? "red" : humidity?.state === "warning" ? "amber" : "blue"} icon={Droplets} />
        <MetricCard label="Disponibilidad" value={`${activeSensors.length}/${sensors.length}`} note={`${sensors.length - activeSensors.length} canales deshabilitados`} tone="green" icon={Server} />
      </section>

      <section className="overview-grid">
        <article className="panel asset-summary-panel">
          <div className="panel-header asset-summary-header">
            <div><span className="eyebrow">Activo prioritario</span><h2>{assetConfig.name} · {assetConfig.description}</h2><p>Cabina de {assetConfig.voltage} kV · evaluación actualizada hace 2 s</p></div>
            <StatusPill state="critical">Atención prioritaria</StatusPill>
          </div>

          <div className="asset-summary-body">
            <section className="primary-finding" aria-label="Hallazgo de mayor prioridad">
              <div className="finding-heading">
                <span className="finding-icon"><AlertTriangle size={20} /></span>
                <div><span>Evento de mayor prioridad</span><h3>Descarga parcial en aceleración</h3><p>PD1 · Compartimiento de cables · activo hace 12 min</p></div>
                <strong>72<small>idx</small></strong>
              </div>
              <div className="finding-evidence">
                <div><span>Aceleración</span><strong>Φ 2.8×</strong></div>
                <div><span>Umbral configurado</span><strong>60 idx</strong></div>
                <div><span>Prioridad sugerida</span><strong>Inspección en terreno</strong></div>
              </div>
              <div className="finding-action"><ShieldCheck size={17} /><p><strong>Acción recomendada:</strong> revisar terminaciones y cableado del compartimiento antes del próximo ciclo de carga.</p></div>
            </section>

            <aside className="condition-summary" aria-label="Resumen de canales">
              <div className="condition-summary-title"><div><span className="eyebrow">Estado actual</span><h3>{activeSensors.length} canales supervisados</h3></div><span className="online-mini"><i />Datos sincronizados</span></div>
              <div className="condition-counts">
                <div className="count-critical"><strong>{conditionCounts.critical}</strong><span>Crítico</span></div>
                <div className="count-warning"><strong>{conditionCounts.warning}</strong><span>Advertencia</span></div>
                <div className="count-normal"><strong>{conditionCounts.normal}</strong><span>Normal</span></div>
              </div>
              <div className="secondary-findings">
                <div><span className="sensor-code sensor-warning">T01</span><p><strong>68.4 °C</strong><small>Barra L1 · sobre umbral</small></p><b>+1.8 °C/h</b></div>
                <div><span className="sensor-code sensor-warning">H01</span><p><strong>78 %RH</strong><small>Humedad de cabina elevada</small></p><b>+4 % / 24h</b></div>
              </div>
            </aside>
          </div>

          <div className="asset-summary-footer"><span><Wifi size={15} /> CAM5-GW-01 · 42 ms</span><button onClick={() => onNavigate("cabinet")}>Revisar condición del activo <ChevronRight size={16} /></button></div>
        </article>

        <article className="panel alarms-panel">
          <div className="panel-header compact">
            <div><span className="eyebrow">Triage</span><h2>Alarmas activas</h2></div>
            <button className="icon-button" aria-label="Abrir centro de alertas" onClick={() => onNavigate("alarms")}><BellRing size={18} /></button>
          </div>
          <div className="alarm-list">
            {activeAlarms.slice(0, 3).map((alarm) => (
              <div className={`alarm-item alarm-${alarm.severity}`} key={alarm.id}>
                <div className="alarm-indicator"><AlertTriangle size={17} /></div>
                <div className="alarm-copy"><strong>{alarm.title}</strong><span>{alarm.detail}</span><small>{alarm.since}</small></div>
                <div className="alarm-side"><b>{alarm.value}</b><button onClick={() => onAcknowledge(alarm.id)}>Reconocer</button></div>
              </div>
            ))}
          </div>
          <button className="text-action" onClick={() => onNavigate("alarms")}>Ver todas las alertas <span>→</span></button>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel trend-preview">
          <div className="panel-header compact"><div><span className="eyebrow">Últimas 24 horas</span><h2>Tendencia combinada</h2></div><StatusPill state="critical">PD acelerando</StatusPill></div>
          <div className="mini-chart" aria-label="Gráfico de temperatura y descarga parcial">
            {chartData.map(([temp, pd], index) => <span key={index}><i style={{ height: `${temp}%` }} /><b style={{ height: `${pd}%` }} /></span>)}
          </div>
          <div className="chart-legend"><span><i className="legend-temp" />Temperatura T01</span><span><i className="legend-pd" />Índice PD1</span><button onClick={() => onNavigate("trends")}>Analizar tendencia</button></div>
        </article>
        <article className="panel connection-panel">
          <div className="panel-header compact"><div><span className="eyebrow">Comunicaciones</span><h2>Salud del gateway</h2></div><Radio size={20} className="brand-icon" /></div>
          <div className="connection-score"><strong>99.96%</strong><span>Disponibilidad 30 días</span></div>
          <dl className="connection-stats"><div><dt>Último dato</dt><dd>Hace 2 s</dd></div><div><dt>Protocolo</dt><dd>Modbus TCP</dd></div><div><dt>Latencia</dt><dd>42 ms</dd></div></dl>
          <div className="freshness"><span style={{ width: "96%" }} /></div>
        </article>
      </section>
    </>
  );
}
