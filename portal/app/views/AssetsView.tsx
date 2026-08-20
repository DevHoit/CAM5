"use client";

import { useState } from "react";
import { IconActivity as Activity, IconAlertTriangle as AlertTriangle, IconBuilding as Building2, IconCircleCheck as CheckCircle2, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconCircuitCell as CircuitBoard, IconDatabase as Database, IconBuildingFactory2 as Factory, IconHierarchy3 as Hierarchy, IconMapPin as MapPin, IconPlus as Plus, IconSearch as Search, IconSettings as Settings, IconShieldCheck as ShieldCheck } from "@tabler/icons-react";
import { usePersistentState } from "../use-persistent-state";
import { StatusPill } from "../components/StatusPill";
import { TableEmptyState } from "../components/TableEmptyState";
import { useFeedback } from "../lib/contexts";
import { defaultAssetConfig, sensors } from "../lib/fixtures";
import type { View } from "../lib/types";
import { useSensorData } from "../lib/use-sensor-data";

export function AssetsView({ onNavigate }: { onNavigate: (view: View) => void }) {
  type AssetState = "normal" | "warning" | "critical";
  type AssetRecord = { id: string; name: string; type: string; site: string; area: string; state: AssetState; configured: number; capacity: number; gateway: string; voltage: string; owner: string; updated: string };
  const notify = useFeedback();
  const sensors = useSensorData();
  const [assetConfig, setAssetConfig] = usePersistentState("cam5.front.asset-config", defaultAssetConfig);
  const [tab, setTab] = useState<"hierarchy" | "directory">("hierarchy");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AssetState>("all");
  const [selectedId, setSelectedId] = useState("MCC-01");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "Centro de control", site: "Subestación Norte", area: "Sala eléctrica A" });
  const [assets, setAssets] = usePersistentState<AssetRecord[]>("cam5.front.assets", [
    { id: "MCC-01", name: "Alimentador Norte", type: "Centro de control de motores", site: "Subestación Norte", area: "Sala eléctrica A", state: "critical", configured: 8, capacity: 24, gateway: "CAM5-GW-01", voltage: "13.8 kV", owner: "Paula Rojas", updated: "Hace 2 s" },
    { id: "MCC-02", name: "Banco de condensadores", type: "Centro de control de motores", site: "Subestación Norte", area: "Sala eléctrica A", state: "normal", configured: 6, capacity: 12, gateway: "CAM5-GW-01", voltage: "13.8 kV", owner: "Felipe Soto", updated: "Hace 5 s" },
    { id: "TR-01", name: "Transformador principal", type: "Transformador de potencia", site: "Subestación Norte", area: "Patio de transformación", state: "warning", configured: 12, capacity: 16, gateway: "CAM5-GW-01", voltage: "110 / 13.8 kV", owner: "Emerson Allende", updated: "Hace 4 s" },
  ]);
  const activeSensorCount = sensors.filter((sensor) => sensor.enabled).length;
  const storedSelected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const selected = storedSelected.id === "MCC-01" ? { ...storedSelected, configured: activeSensorCount } : storedSelected;
  const filtered = assets.filter((asset) => (statusFilter === "all" || asset.state === statusFilter) && `${asset.id} ${asset.name} ${asset.type} ${asset.site} ${asset.area}`.toLowerCase().includes(query.toLowerCase()));
  const locations = ["Subestación Norte"];
  const totalConfigured = assets.reduce((sum, asset) => sum + (asset.id === "MCC-01" ? activeSensorCount : asset.configured), 0);
  const totalCapacity = assets.reduce((sum, asset) => sum + asset.capacity, 0);
  const selectedConfigured = selected.id === "MCC-01" ? activeSensorCount : selected.configured;
  const coverage = selected.capacity ? Math.round((selectedConfigured / selected.capacity) * 100) : 0;
  const selectedSensors = selected.id === "MCC-01" ? sensors.filter((sensor) => sensor.enabled) : [];
  const stateLabel = (state: AssetState) => state === "critical" ? "Crítico" : state === "warning" ? "Advertencia" : "Normal";
  const createAsset = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    if (assets.some((asset) => asset.id === form.code.trim().toUpperCase())) { notify(`El código ${form.code.trim().toUpperCase()} ya está registrado.`, "warning"); return; }
    const next = { id: form.code.trim().toUpperCase(), name: form.name.trim(), type: form.type, site: "Subestación Norte", area: form.area, state: "normal" as AssetState, configured: 0, capacity: 0, gateway: "CAM5-GW-01", voltage: "Sin definir", owner: "Sin asignar", updated: "Nunca" };
    setAssets((current) => [next, ...current]); setSelectedId(next.id); setTab("hierarchy"); setShowCreate(false); setForm({ code: "", name: "", type: "Centro de control", site: "Subestación Norte", area: "Sala eléctrica A" }); notify(`Activo ${next.id} registrado en el inventario.`);
  };
  const updateSelected = (field: "name" | "area" | "owner" | "voltage", value: string) => { setAssets((current) => current.map((asset) => asset.id === selected.id ? { ...asset, [field]: value } : asset)); if (selected.id === "MCC-01" && field === "name") setAssetConfig({ ...assetConfig, description: value }); if (selected.id === "MCC-01" && field === "voltage") setAssetConfig({ ...assetConfig, voltage: value.replace(/\s*kV$/i, "") }); };
  const openAsset = (id: string) => {
    if (id === selectedId && tab === "hierarchy" && !editing) {
      onNavigate(id === "MCC-01" ? (selected.state === "normal" ? "cabinet" : "alarms") : "settings");
      return;
    }
    setSelectedId(id); setTab("hierarchy"); setEditing(false);
  };

  return (
    <>
      <section className="module-summary-grid asset-inventory-summary">
        <article><span className="module-summary-icon blue"><Factory size={19} /></span><div><small>Activos registrados</small><strong>{assets.length}</strong><span>1 ubicación operativa</span></div></article>
        <article><span className="module-summary-icon amber"><AlertTriangle size={19} /></span><div><small>Atención requerida</small><strong>{assets.filter((asset) => asset.state !== "normal").length}</strong><span>1 crítico · 1 advertencia</span></div></article>
        <article><span className="module-summary-icon green"><Activity size={19} /></span><div><small>Canales configurados</small><strong>{totalConfigured}</strong><span>de {totalCapacity} disponibles</span></div></article>
      </section>

      <article className="panel module-panel asset-inventory-module">
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de activos"><button className={tab === "hierarchy" ? "active" : ""} onClick={() => setTab("hierarchy")}><Hierarchy size={16} /> Jerarquía</button><button className={tab === "directory" ? "active" : ""} onClick={() => setTab("directory")}><Database size={16} /> Directorio</button></div><button className="primary-button" onClick={() => setShowCreate((current) => !current)}><Plus size={16} /> {showCreate ? "Cancelar" : "Nuevo activo"}</button></div>

        {showCreate && <form className="asset-create-form" onSubmit={createAsset}><label><span>Código</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Ej.: MCC-03" /></label><label><span>Nombre</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Descripción operacional" /></label><label><span>Tipo</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Centro de control</option><option>Transformador de potencia</option><option>Celda de media tensión</option><option>UPS industrial</option></select></label><label><span>Área dentro de Subestación Norte</span><input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} placeholder="Ej.: Sala eléctrica A" /></label><button type="submit"><Plus size={15} /> Registrar</button></form>}

        {tab === "hierarchy" && <div className="asset-management-layout"><aside className="asset-tree"><div className="asset-tree-head"><span className="asset-tree-icon"><Factory size={20} /></span><div><span className="eyebrow">Instalación única</span><strong>Subestación Norte</strong></div></div><div className="asset-tree-content">{locations.map((location) => <section key={location}><div className="tree-location"><span><Building2 size={17} /></span><div><strong>{location}</strong><small>{assets.filter((asset) => asset.site === location).length} activos</small></div></div><div className="tree-assets">{assets.filter((asset) => asset.site === location).map((asset) => <button key={asset.id} className={selected.id === asset.id ? "selected" : ""} onClick={() => openAsset(asset.id)}><span className={`tree-state state-${asset.state}`} /><span><strong>{asset.id}</strong><small>{asset.name}</small></span><ChevronRight size={15} /></button>)}</div></section>)}</div><div className="asset-tree-footer"><MapPin size={15} /><span>1 ubicación · 1 gateway · {assets.length} activos</span></div></aside><section className="asset-detail"><div className="asset-detail-header"><span className={`asset-detail-icon state-${selected.state}`}><CircuitBoard size={23} /></span><div><span className="eyebrow">Activo seleccionado · {selected.id}</span><h2>{selected.name}</h2><p><MapPin size={14} /> {selected.site} · {selected.area}</p></div><StatusPill state={selected.state}>{stateLabel(selected.state)}</StatusPill></div><div className="asset-detail-actions"><span>Ficha actualizada {selected.updated}</span><button className="secondary-button" onClick={() => setEditing((current) => !current)}>{editing ? <><CheckCircle2 size={15} /> Finalizar edición</> : <><Settings size={15} /> Editar ficha</>}</button></div>{editing ? <div className="asset-edit-grid"><label><span>Nombre operacional</span><input value={selected.name} onChange={(event) => updateSelected("name", event.target.value)} /></label><label><span>Área</span><input value={selected.area} onChange={(event) => updateSelected("area", event.target.value)} /></label><label><span>Gateway único</span><input value={selected.gateway} readOnly /></label><label><span>Responsable</span><select value={selected.owner} onChange={(event) => updateSelected("owner", event.target.value)}><option>Sin asignar</option><option>Emerson Allende</option><option>Paula Rojas</option><option>Felipe Soto</option></select></label><label><span>Tensión nominal</span><input value={selected.voltage} onChange={(event) => updateSelected("voltage", event.target.value)} /></label></div> : <dl className="asset-facts"><div><dt>Tipo</dt><dd>{selected.type}</dd></div><div><dt>Tensión nominal</dt><dd>{selected.voltage}</dd></div><div><dt>Gateway único</dt><dd>{selected.gateway}</dd></div><div><dt>Responsable</dt><dd>{selected.owner}</dd></div></dl>}<div className="asset-detail-grid"><section className="asset-coverage-card"><div><span className="eyebrow">Cobertura de instrumentación</span><strong>{coverage}%</strong></div><p>{selected.capacity ? `${selected.configured} canales configurados de ${selected.capacity} disponibles.` : "Activo nuevo sin capacidad de instrumentación definida."}</p><span className="asset-coverage-bar"><i style={{ width: `${coverage}%` }} /></span><dl><div><dt>Temperatura</dt><dd>{selected.id === "MCC-01" ? "5 canales" : "Configuración base"}</dd></div><div><dt>Descarga parcial</dt><dd>{selected.id === "MCC-01" ? "2 canales" : "No configurada"}</dd></div><div><dt>Ambiental</dt><dd>{selected.id === "MCC-01" ? "1 canal" : "No configurada"}</dd></div></dl></section><section className={`asset-condition-card condition-${selected.state}`}><span className="eyebrow">Condición actual</span><div><AlertTriangle size={20} /><strong>{stateLabel(selected.state)}</strong></div><p>{selected.state === "critical" ? "Descarga parcial acelerada en el compartimiento de cables. Requiere diagnóstico priorizado." : selected.state === "warning" ? "Existen variables sobre nivel preventivo. Mantener seguimiento de tendencia." : "No se observan condiciones fuera de los límites definidos."}</p><button onClick={() => openAsset(selected.id)}>{selected.state === "normal" ? "Revisar cobertura" : "Revisar hallazgos"} <ChevronRight size={15} /></button></section></div><div className="asset-channel-preview"><div className="report-library-head"><div><span className="eyebrow">Instrumentación</span><h2>Canales asociados</h2></div><span>{selectedSensors.length || selected.configured} canales</span></div>{selectedSensors.length ? <div className="asset-channel-grid">{selectedSensors.map((sensor) => <span key={sensor.id}><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b><span><strong>{sensor.label}</strong><small>{sensor.value} {sensor.unit} · {sensor.quality}</small></span></span>)}</div> : <div className="asset-empty-state"><Activity size={22} /><div><strong>Instrumentación sin detalle demostrativo</strong><p>La ficha está creada, pero sus canales se definirán desde Configuración.</p></div></div>}</div></section></div>}

        {tab === "directory" && <div className="asset-directory"><div className="asset-directory-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código, nombre, tipo o ubicación…" /></label><label className="status-filter"><span>Condición</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todas</option><option value="normal">Normal</option><option value="warning">Advertencia</option><option value="critical">Crítico</option></select><ChevronDown size={13} /></label></div><div className="module-table-wrap"><div className="asset-directory-table"><div className="module-table-head"><span>Activo</span><span>Tipo</span><span>Ubicación</span><span>Cobertura</span><span>Gateway</span><span>Condición</span><span>Acción</span></div>{filtered.map((asset) => <div className="module-table-row" key={asset.id}><span className="asset-directory-name"><b><CircuitBoard size={17} /></b><span><strong>{asset.id}</strong><small>{asset.name}</small></span></span><span>{asset.type}</span><span>{asset.site}<small>{asset.area}</small></span><span>{asset.configured} / {asset.capacity || "—"} canales</span><span className="mono-cell">{asset.gateway}</span><span><StatusPill state={asset.state}>{stateLabel(asset.state)}</StatusPill></span><span><button className="ghost-button" onClick={() => openAsset(asset.id)}>Abrir ficha</button></span></div>)}</div></div></div>}
        {tab === "directory" && filtered.length === 0 && <TableEmptyState title="No hay activos con estos filtros" detail="Prueba con otra condición o modifica el texto de búsqueda." />}
        <div className="module-footer"><span><ShieldCheck size={14} /> Inventario con trazabilidad de cambios.</span><small>Cambios conservados localmente · listo para conectar al inventario central.</small></div>
      </article>
    </>
  );
}
