"use client";

import { useSensorData } from "../lib/use-sensor-data";

export function SensorMarker({ id, selectedId, onSelect }: { id: string; selectedId?: string; onSelect?: (id: string) => void }) {
  const sensors = useSensorData();
  const sensor = sensors.find((item) => item.id === id);
  // Con datos en vivo la primera pintura ocurre antes de que llegue la
  // telemetría, y un canal del diagrama puede no existir en la unidad activa.
  if (!sensor) {
    return (
      <span className="sensor-marker marker-disabled" aria-label={`${id}, sin lectura`}>
        <span className="sensor-marker-top"><span className="sensor-marker-id">{id}</span><span className="sensor-marker-state"><i />Sin lectura</span></span>
        <strong className="sensor-marker-value">—</strong>
        <span className="sensor-marker-label">Canal no disponible</span>
      </span>
    );
  }
  const stateLabel = !sensor.enabled ? "No configurado" : sensor.state === "critical" ? "Crítico" : sensor.state === "warning" ? "Advertencia" : "Normal";
  return (
    <button
      type="button"
      className={`sensor-marker ${sensor.enabled ? `marker-${sensor.state}` : "marker-disabled"} ${selectedId === id ? "selected" : ""}`}
      aria-label={`${sensor.id}, ${sensor.label}, ${sensor.value} ${sensor.unit}, ${sensor.state}`}
      aria-pressed={selectedId === id}
      disabled={!sensor.enabled}
      onClick={() => onSelect?.(id)}
    >
      <span className="sensor-marker-top"><span className="sensor-marker-id">{sensor.id}</span><span className="sensor-marker-state"><i />{stateLabel}</span></span>
      <strong className="sensor-marker-value">{sensor.value}<small>{sensor.unit}</small></strong>
      <span className="sensor-marker-label">{sensor.label}</span>
    </button>
  );
}
