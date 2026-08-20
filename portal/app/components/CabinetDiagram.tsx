"use client";

import { IconCircuitCell as CircuitBoard, IconWifi as Wifi } from "@tabler/icons-react";
import { SensorMarker } from "./SensorMarker";
import { StatusPill } from "./StatusPill";

export function CabinetDiagram({ selectedId, onSelect }: { selectedId?: string; onSelect?: (id: string) => void }) {
  return (
    <div className="condition-map" aria-label="Mapa de condición de la cabina MCC-01">
      <div className="condition-map-header"><span className="map-asset-icon"><CircuitBoard size={20} /></span><div><strong>MCC-01</strong><small>13.8 kV · Alimentador Norte</small></div><b>CAM5-01</b></div>

      <div className="condition-map-zones">
        <section className="equipment-zone">
          <header className="zone-header"><span className="zone-index">01</span><div><h3>Barras principales</h3><p>Temperatura por fase y actividad UHF</p></div><span className="zone-status warning"><i />1 advertencia</span></header>
          <div className="bus-map">
            <div className="phase-rows">
              <div className="phase-row"><span className="phase-tag phase-l1">L1</span><span className="phase-line" /><SensorMarker id="T01" selectedId={selectedId} onSelect={onSelect} /></div>
              <div className="phase-row"><span className="phase-tag">L2</span><span className="phase-line" /><SensorMarker id="T02" selectedId={selectedId} onSelect={onSelect} /></div>
              <div className="phase-row"><span className="phase-tag">L3</span><span className="phase-line" /><SensorMarker id="T03" selectedId={selectedId} onSelect={onSelect} /></div>
            </div>
            <div className="aux-channel"><span>Monitoreo UHF</span><SensorMarker id="PD2" selectedId={selectedId} onSelect={onSelect} /></div>
          </div>
        </section>

        <section className="equipment-zone">
          <header className="zone-header"><span className="zone-index">02</span><div><h3>Interruptor de potencia</h3><p>Temperatura de contactos superior e inferior</p></div><span className="zone-status normal"><i />Condición normal</span></header>
          <div className="breaker-map">
            <SensorMarker id="T04" selectedId={selectedId} onSelect={onSelect} />
            <span className="device-connector" />
            <div className="breaker-device"><strong>52</strong><span>Interruptor CA</span></div>
            <span className="device-connector" />
            <SensorMarker id="T05" selectedId={selectedId} onSelect={onSelect} />
          </div>
        </section>

        <section className="equipment-zone zone-critical">
          <header className="zone-header"><span className="zone-index">03</span><div><h3>Compartimiento de cables</h3><p>Descarga parcial y humedad ambiental</p></div><span className="zone-status critical"><i />1 crítico · 1 advertencia</span></header>
          <div className="cable-map">
            <SensorMarker id="H01" selectedId={selectedId} onSelect={onSelect} />
            <div className="cable-device"><div><span><b>L1</b><i /></span><span><b>L2</b><i /></span><span><b>L3</b><i /></span></div><small>Salida de cables</small></div>
            <SensorMarker id="PD1" selectedId={selectedId} onSelect={onSelect} />
          </div>
        </section>
      </div>

      <div className="condition-map-footer"><span><Wifi size={15} /><span><strong>CAM5-CTRL-01</strong><small>Modbus TCP · vía CAM5-GW-01 · último dato hace 2 s</small></span></span><StatusPill state="online">En línea</StatusPill></div>
    </div>
  );
}
