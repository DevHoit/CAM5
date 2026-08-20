"use client";

import { useState } from "react";
import { IconActivity as Activity, IconCircleCheck as CheckCircle2, IconChevronRight as ChevronRight, IconCircuitCell as CircuitBoard, IconCopy as Copy, IconDatabase as Database, IconKey as Key, IconDeviceDesktopAnalytics as MonitorDot, IconPlugConnected as PlugConnected, IconPlus as Plus, IconRadio as Radio, IconRefresh as Refresh, IconServer as Server, IconShieldCheck as ShieldCheck, IconTimeline as Timeline, IconTool as Tool, IconWebhook as Webhook, IconBolt as Zap } from "@tabler/icons-react";
import { usePersistentState } from "../use-persistent-state";
import { useActiveRole, useConfirm, useFeedback } from "../lib/contexts";
import { sensors } from "../lib/fixtures";
import { useSensorData } from "../lib/use-sensor-data";

export function IntegrationsView() {
  const notify = useFeedback();
  const confirm = useConfirm();
  const role = useActiveRole();
  const sensors = useSensorData();
  const activeChannelCount = sensors.filter((sensor) => sensor.enabled).length;
  const [tab, setTab] = useState<"connections" | "flow" | "api">("connections");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showApiForm, setShowApiForm] = useState(false);
  const [apiForm, setApiForm] = useState({ name: "", scope: "Solo lectura" });
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [connections, setConnections] = usePersistentState("cam5.front.integrations", [
    { id: "controller", name: "Controlador CAM5-CTRL-01", role: "Adquisición de campo", protocol: "Modbus TCP", endpoint: "192.168.10.42:502 · Unit ID 1", enabled: true, locked: true, status: "Operativa", freshness: "Hace 2 s" },
    { id: "gateway", name: "Gateway CAM5-GW-01", role: "Puente OT / plataforma", protocol: "Ethernet · HTTPS/MQTT", endpoint: "LAN 192.168.10.40", enabled: true, locked: true, status: "Operativa", freshness: "Hace 2 s" },
    { id: "historian", name: "Historiador OT", role: "Integración futura", protocol: "OPC UA", endpoint: "No configurado", enabled: false, locked: false, status: "Fuera del MVP", freshness: "Sin sincronizar" },
    { id: "cmms", name: "CMMS de mantenimiento", role: "Integración futura", protocol: "REST / Webhook", endpoint: "No configurado", enabled: false, locked: false, status: "Fuera del MVP", freshness: "Sin sincronizar" },
  ]);
  const [apiKeys, setApiKeys] = usePersistentState("cam5.front.api-keys", [
    { id: 1, name: "Integración de pruebas", token: "cam5_test_••••••••7K2P", scope: "Solo lectura", created: "11 ago 2026", lastUse: "Nunca", active: false },
  ]);
  const activeConnections = connections.filter((connection) => connection.enabled).length;
  const testConnection = (id: string) => {
    setTestingId(id);
    setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "Probando…" } : connection));
    window.setTimeout(() => {
      setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "Operativa", freshness: "Ahora" } : connection));
      setTestingId(null);
      notify("Conexión comprobada correctamente.");
    }, 900);
  };
  const toggleConnection = (id: string) => setConnections((current) => current.map((connection) => connection.id === id && !connection.locked ? { ...connection, enabled: !connection.enabled, status: connection.enabled ? "Desactivada" : "Operativa", freshness: connection.enabled ? "Sin sincronizar" : "Ahora" } : connection));
  const createApiKey = (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiForm.name.trim()) return;
    const rawKey = `cam5_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    setApiKeys((current) => [{ id: Date.now(), name: apiForm.name.trim(), token: `${rawKey.slice(0, 10)}••••••••${rawKey.slice(-4).toUpperCase()}`, scope: apiForm.scope, created: "Ahora", lastUse: "Nunca", active: true }, ...current]);
    setNewApiKey(rawKey); setApiForm({ name: "", scope: "Solo lectura" }); setShowApiForm(false); notify("Clave creada. Cópiala antes de abandonar esta sección.", "info");
  };
  const revokeApiKey = (id: number) => { const key = apiKeys.find((item) => item.id === id); const apply = () => { setApiKeys((current) => current.map((item) => item.id === id ? { ...item, active: !item.active } : item)); notify(`Clave ${key?.active ? "revocada" : "reactivada"}.`, key?.active ? "warning" : "success"); }; if (key?.active) confirm({ title: `Revocar “${key.name}”`, detail: "Los servicios que utilicen esta credencial dejarán de acceder al sistema inmediatamente.", confirmLabel: "Revocar clave", tone: "danger", onConfirm: apply }); else apply(); };
  const copyApiKey = async () => { if (!newApiKey) return; await navigator.clipboard?.writeText(newApiKey); setCopied(true); notify("Clave copiada al portapapeles.", "info"); window.setTimeout(() => setCopied(false), 1800); };
  const syncLog = [
    { time: "11:52:08", system: "CAM5-CTRL-01", action: "Lectura Modbus completada", detail: `${activeChannelCount} canales · 42 ms`, state: "Correcta" },
    { time: "11:52:07", system: "CAM5-GW-01", action: "Paquete de telemetría enviado", detail: "Subestación Norte", state: "Correcta" },
    { time: "11:52:06", system: "CAM5 CORE", action: "Reglas de condición evaluadas", detail: `${activeChannelCount} señales`, state: "Correcta" },
    { time: "11:48:04", system: "Motor de eventos", action: "Evento crítico registrado", detail: "AL-260811-031", state: "Correcta" },
  ];

  return (
    <>
      <section className="module-summary-grid integration-summary-grid">
        <article><span className="module-summary-icon green"><PlugConnected size={19} /></span><div><small>Enlaces OT operativos</small><strong>{activeConnections}</strong><span>Controlador + gateway</span></div></article>
        <article><span className="module-summary-icon blue"><Refresh size={19} /></span><div><small>Sincronización</small><strong>99.98%</strong><span>Últimas 24 horas</span></div></article>
        <article><span className="module-summary-icon amber"><Webhook size={19} /></span><div><small>Integraciones futuras</small><strong>2</strong><span>Historiador + CMMS</span></div></article>
      </section>

      <article className={`panel module-panel integration-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de integraciones"><button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><PlugConnected size={16} /> Conexiones</button><button className={tab === "flow" ? "active" : ""} onClick={() => setTab("flow")}><Timeline size={16} /> Flujo de datos</button><button className={tab === "api" ? "active" : ""} onClick={() => setTab("api")}><Key size={16} /> Acceso API</button></div><span className="autosave-state"><ShieldCheck size={14} /> Configuración local protegida</span></div>

        {tab === "connections" && <div className="integration-content"><div className="settings-section-head"><span className="settings-icon"><PlugConnected size={20} /></span><div><h2>Arquitectura de la instalación</h2><p>Dos enlaces requeridos y fijos para la primera implementación monositio.</p></div></div><div className="integration-card-grid">{connections.map((connection) => <article className={`integration-card ${connection.enabled ? "enabled" : "disabled"}`} key={connection.id}><div className="integration-card-head"><span className="integration-card-icon">{connection.id === "controller" ? <Radio size={21} /> : connection.id === "gateway" ? <Server size={21} /> : connection.id === "historian" ? <Database size={21} /> : <Tool size={21} />}</span>{connection.locked ? <span className="core-link-label"><ShieldCheck size={13} /> Requerida</span> : <button className={`switch-control ${connection.enabled ? "on" : ""}`} onClick={() => toggleConnection(connection.id)} aria-label={`${connection.enabled ? "Desactivar" : "Activar"} ${connection.name}`}><i /></button>}</div><span className="eyebrow">{connection.role}</span><h3>{connection.name}</h3><dl><div><dt>Protocolo</dt><dd>{connection.protocol}</dd></div><div><dt>Destino</dt><dd title={connection.endpoint}>{connection.endpoint}</dd></div><div><dt>Última actividad</dt><dd>{connection.freshness}</dd></div></dl><div className="integration-card-footer"><span className={connection.enabled && connection.status === "Operativa" ? "quality-ok" : connection.status === "Probando…" ? "integration-testing" : "muted-state"}>{connection.status === "Operativa" && <CheckCircle2 size={14} />}{connection.status}</span><button onClick={() => testConnection(connection.id)} disabled={!connection.enabled || testingId === connection.id}>{testingId === connection.id ? "Probando…" : "Probar conexión"}</button></div></article>)}</div><div className="configuration-note"><ShieldCheck size={17} /><p><strong>Alcance inicial fijo.</strong> Subestación Norte utiliza un controlador CAM5-CTRL-01 y un gateway CAM5-GW-01. Historiador y CMMS quedan preparados visualmente para una fase posterior.</p></div></div>}

        {tab === "flow" && <div className="integration-content flow-content"><div className="settings-section-head"><span className="settings-icon"><Timeline size={20} /></span><div><h2>Ruta monositio de los datos</h2><p>Una cadena fija y fácil de diagnosticar desde el sensor hasta el portal.</p></div></div><div className="data-flow"><article><span><Activity size={21} /></span><small>Origen</small><strong>8 canales CAM5</strong><p>Temperatura, UHF y humedad</p></article><i><ChevronRight size={19} /></i><article><span><CircuitBoard size={21} /></span><small>Controlador</small><strong>CAM5-CTRL-01</strong><p>Modbus TCP · Unit ID 1</p></article><i><ChevronRight size={19} /></i><article><span><Server size={21} /></span><small>Gateway</small><strong>CAM5-GW-01</strong><p>Ethernet · HTTPS/MQTT</p></article><i><ChevronRight size={19} /></i><article className="flow-core"><span><Zap size={21} /></span><small>Procesamiento</small><strong>CAM5 CORE</strong><p>Reglas, eventos e histórico</p></article><i><ChevronRight size={19} /></i><article><span><MonitorDot size={21} /></span><small>Aplicación</small><strong>Portal CAM5</strong><p>Dashboard, alertas y reportes</p></article></div><div className="flow-grid"><section><div className="report-library-head"><div><span className="eyebrow">Mapeo Modbus</span><h2>Señales publicadas</h2></div><span>8 activas</span></div><div className="module-table-wrap"><div className="integration-mapping-table"><div className="module-table-head"><span>Canal</span><span>Registro</span><span>Variable publicada</span><span>Publicación</span><span>Calidad</span></div>{sensors.map((sensor) => <div className="module-table-row" key={sensor.id}><span><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b></span><span className="mono-cell">{sensor.register}</span><span className="mono-cell">cam5.mcc01.{sensor.id.toLowerCase()}</span><span>{sensor.id === "PD1" ? "CORE + eventos" : "CAM5 CORE"}</span><span className="quality-ok"><CheckCircle2 size={14} /> Válida</span></div>)}</div></div></section><aside className="sync-activity"><div className="report-library-head"><div><span className="eyebrow">Actividad</span><h2>Últimas sincronizaciones</h2></div></div><div>{syncLog.map((entry) => <article key={`${entry.time}-${entry.system}`}><span className={entry.state === "Correcta" ? "normal" : "warning"}><Refresh size={15} /></span><div><strong>{entry.action}</strong><small>{entry.system} · {entry.detail}</small></div><time>{entry.time}</time></article>)}</div></aside></div></div>}

        {tab === "api" && <div className="integration-content api-content"><div className="api-section-head"><div className="settings-section-head"><span className="settings-icon"><Key size={20} /></span><div><h2>Credenciales de integración</h2><p>Claves para servicios que consumen o publican información en CAM5.</p></div></div><button className="primary-button" onClick={() => setShowApiForm((current) => !current)}><Plus size={16} /> {showApiForm ? "Cancelar" : "Nueva clave"}</button></div>{showApiForm && <form className="api-key-form" onSubmit={createApiKey}><label><span>Nombre de la integración</span><input required value={apiForm.name} onChange={(event) => setApiForm({ ...apiForm, name: event.target.value })} placeholder="Ej.: Panel de confiabilidad" /></label><label><span>Alcance</span><select value={apiForm.scope} onChange={(event) => setApiForm({ ...apiForm, scope: event.target.value })}><option>Solo lectura</option><option>Telemetría · lectura</option><option>Eventos · escritura</option></select></label><button type="submit"><Key size={15} /> Crear clave</button></form>}{newApiKey && <div className="api-key-reveal"><ShieldCheck size={19} /><div><strong>Copia la nueva clave ahora</strong><code>{newApiKey}</code><small>Por seguridad, no volverá a mostrarse completa.</small></div><button onClick={copyApiKey}>{copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}{copied ? "Copiada" : "Copiar"}</button></div>}<div className="api-layout"><section className="api-key-list"><div className="report-library-head"><div><span className="eyebrow">Credenciales</span><h2>Claves registradas</h2></div><span>{apiKeys.filter((key) => key.active).length} activas</span></div>{apiKeys.map((key) => <article key={key.id}><span className={`api-key-icon ${key.active ? "active" : ""}`}><Key size={18} /></span><div><strong>{key.name}</strong><code>{key.token}</code><small>{key.scope} · Creada {key.created} · Uso: {key.lastUse}</small></div><button className="ghost-button" onClick={() => revokeApiKey(key.id)}>{key.active ? "Revocar" : "Reactivar"}</button></article>)}</section><aside className="api-endpoints"><span className="eyebrow">Endpoints disponibles</span><h3>API CAM5 v1</h3><p>Rutas propuestas para la futura integración con servicios autorizados.</p><dl><div><dt>GET</dt><dd>/api/v1/assets/mcc-01/readings</dd></div><div><dt>GET</dt><dd>/api/v1/assets/mcc-01/events</dd></div><div><dt>POST</dt><dd>/api/v1/work-orders</dd></div><div><dt>POST</dt><dd>/api/v1/webhooks/events</dd></div></dl><div className="configuration-note"><Webhook size={16} /><p>Los endpoints son parte del diseño del frontend; todavía no exponen información real.</p></div></aside></div></div>}
      </article>
    </>
  );
}
