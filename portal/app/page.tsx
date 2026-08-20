"use client";

import { useEffect, useRef, useState } from "react";
import { IconActivity as Activity, IconAlertTriangle as AlertTriangle, IconBellRinging as BellRing, IconBuilding as Building2, IconCircleCheck as CheckCircle2, IconChevronRight as ChevronRight, IconClock as Clock3, IconDownload as Download, IconMenu2 as Menu, IconPlugConnected as PlugConnected, IconRefresh as Refresh, IconServer as Server, IconShieldCheck as ShieldCheck, IconX as X, IconBolt as Zap } from "@tabler/icons-react";
import { usePersistentState } from "./use-persistent-state";
import { ConfirmContext, FeedbackContext, RoleContext } from "./lib/contexts";
import { defaultAssetConfig, initialWorkOrders, sensors } from "./lib/fixtures";
import { navGroups, viewTitles } from "./lib/navigation";
import type { ConfirmRequest, NoticeTone, SystemMode, UserRole, View, WorkOrder } from "./lib/types";
import { Cam5DataProvider, useCam5Data, useSensorData, type PortalAlarm } from "./lib/cam5-data";
import { AlarmsView } from "./views/AlarmsView";
import { AssetsView } from "./views/AssetsView";
import { CabinetView } from "./views/CabinetView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { HistoryView } from "./views/HistoryView";
import { IntegrationsView } from "./views/IntegrationsView";
import { MaintenanceView } from "./views/MaintenanceView";
import { NotificationsView } from "./views/NotificationsView";
import { Overview } from "./views/Overview";
import { ReportsView } from "./views/ReportsView";
import { SettingsView } from "./views/SettingsView";
import { TrendsView } from "./views/TrendsView";
import { UsersView } from "./views/UsersView";

function PortalShell() {
  const sensors = useSensorData();
  const cam5 = useCam5Data();
  const [assetConfig] = usePersistentState("cam5.front.asset-config", defaultAssetConfig);
  const activeSensorRouteKey = sensors.filter((sensor) => sensor.enabled).map((sensor) => sensor.id).join(",");
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState("24 h");
  const [trendSensorId, setTrendSensorId] = useState("T01");
  const [demoAcknowledged, setDemoAcknowledged] = usePersistentState<string[]>("cam5.front.acknowledged", []);
  const [demoWorkOrders, setDemoWorkOrders] = usePersistentState<WorkOrder[]>("cam5.front.work-orders", initialWorkOrders);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const [demoClosedAlarmIds, setDemoClosedAlarmIds] = usePersistentState<string[]>("cam5.front.closed-alarms", []);
  const [alarmAssignees, setAlarmAssignees] = usePersistentState<Record<string, string>>("cam5.front.alarm-assignees", { "AL-260811-031": "Emerson Allende", "AL-260811-028": "Paula Rojas", "AL-260811-019": "Felipe Soto" });
  const [alarmNotes, setAlarmNotes] = usePersistentState<Record<string, string[]>>("cam5.front.alarm-notes", {});
  // El modo ya no se simula: lo deriva useSystemMode de la antigüedad del dato
  // y del estado del enlace. En modo demostración se mantiene el selector manual.
  const [demoMode, setDemoMode] = usePersistentState<SystemMode>("cam5.front.system-mode", "normal");
  const systemMode: SystemMode = cam5.demo ? demoMode : cam5.mode;
  const [activeRole, setActiveRole] = usePersistentState<UserRole>("cam5.front.active-role", "Administrador");
  const [notice, setNotice] = useState<{ id: number; message: string; tone: NoticeTone } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const noticeTimer = useRef<number | null>(null);

  // Con backend, reconocido/cerrado y las órdenes vienen del servidor.
  const acknowledged = cam5.demo ? demoAcknowledged : cam5.acknowledgedIds;
  const closedAlarmIds = cam5.demo ? demoClosedAlarmIds : cam5.closedIds;
  const workOrders = cam5.demo ? demoWorkOrders : cam5.portalWorkOrders;
  const setClosedAlarmIds = cam5.demo ? setDemoClosedAlarmIds : ((() => undefined) as typeof setDemoClosedAlarmIds);
  const setWorkOrders = cam5.demo ? setDemoWorkOrders : ((() => undefined) as typeof setDemoWorkOrders);

  // En vivo el contador sale del backend; en demostración, del estado local.
  const openAlarmCount = cam5.demo
    ? Math.max(0, 3 - acknowledged.length)
    : cam5.alarms.filter((alarm) => alarm.status !== "closed").length;

  const notify = (message: string, tone: NoticeTone = "success") => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  };

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    const applyRoute = () => {
      const params = new URLSearchParams(window.location.search);
      const nextView = params.get("view");
      if (nextView && Object.prototype.hasOwnProperty.call(viewTitles, nextView)) setView(nextView as View);
      const channel = params.get("channel");
      if (channel && sensors.some((sensor) => sensor.id === channel && sensor.enabled)) setTrendSensorId(channel);
    };
    if (!new URLSearchParams(window.location.search).has("view")) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "overview");
      window.history.replaceState({}, "", url);
    }
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, [activeSensorRouteKey]);

  const navigate = (next: View, parameters?: Record<string, string>) => {
    setView(next);
    if (next !== "maintenance") setFocusOrderId(null);
    setMenuOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("channel");
    url.searchParams.delete("record");
    Object.entries(parameters ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    window.history.pushState({}, "", url);
  };
  const openChannelTrend = (id: string) => { setTrendSensorId(id); navigate("trends", { channel: id }); };
  const selectTrendChannel = (id: string) => {
    setTrendSensorId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "trends");
    url.searchParams.set("channel", id);
    window.history.replaceState({}, "", url);
  };
  const acknowledge = (id: string) => {
    if (cam5.demo) {
      setDemoAcknowledged((current) => current.includes(id) ? current : [...current, id]);
      notify(`Evento ${id} reconocido.`);
      return;
    }
    cam5.acknowledgeAlarm(id)
      .then(() => notify(`Evento ${id} reconocido.`))
      .catch((error) => notify(error.message ?? "No se pudo reconocer el evento.", "warning"));
  };
  const openWorkOrderFromAlarm = (alarm: PortalAlarm, assignee: string) => {
    const existing = workOrders.find((order) => order.sourceAlarmId === alarm.id);
    if (existing) { setFocusOrderId(existing.id); navigate("maintenance"); notify(`Orden ${existing.id} abierta.`, "info"); return; }

    const signal = alarm.detail.split(" · ")[0];
    const title = `Atender ${alarm.title.toLowerCase()}`;
    const priority = alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Alta" : "Normal";

    if (!cam5.demo) {
      // El servidor es idempotente: si la alarma ya tiene una orden activa,
      // devuelve la existente en vez de crear una segunda.
      cam5.createWorkOrder({
        alarmId: alarm.id,
        title,
        source: `${signal} · Evento ${alarm.id}`,
        priority: alarm.severity === "critical" ? "critical" : alarm.severity === "warning" ? "high" : "normal",
      })
        .then((order) => { setFocusOrderId(order.id); navigate("maintenance"); notify(`Orden ${order.id} vinculada al evento.`); })
        .catch((error) => notify(error.message ?? "No se pudo crear la orden.", "warning"));
      return;
    }

    const id = `OT-${Date.now().toString().slice(-9)}`;
    const order: WorkOrder = {
      id, title, source: `${signal} · Evento ${alarm.id}`, sourceAlarmId: alarm.id,
      due: alarm.severity === "critical" ? "Hoy · Prioritario" : alarm.severity === "warning" ? "Próximas 24 h" : "Sin programar",
      priority: priority as WorkOrder["priority"],
      assignee: assignee === "Sin asignar" ? "Paula Rojas" : assignee,
      status: "Pendiente",
    };
    setDemoWorkOrders((current) => [order, ...current]); setFocusOrderId(id); navigate("maintenance"); notify(`Orden ${id} creada y vinculada al evento.`);
  };
  const exportCsv = () => {
    const rows = ["canal,tipo,ubicacion,valor,unidad,estado", ...sensors.filter((sensor) => sensor.enabled).map((sensor) => [sensor.id, sensor.type, sensor.zone, sensor.value, sensor.unit, sensor.state].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cam5-telemetria.csv"; anchor.click(); URL.revokeObjectURL(url);
    notify("Telemetría exportada correctamente.", "info");
  };

  return (
    <FeedbackContext.Provider value={notify}>
    <ConfirmContext.Provider value={(request) => { setConfirmNote(""); setConfirmRequest(request); }}>
    <RoleContext.Provider value={activeRole}>
    <div className="app-shell">
      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand-block">
          <span className="brand-mark"><Zap size={22} strokeWidth={2.3} /></span>
          <div className="brand-copy"><span className="brand-name"><strong>CAM5</strong><b>CORE</b></span><small>Critical asset intelligence</small></div>
          <button className="sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-heading"><span>{group.index}</span><p>{group.label}</p><i /></div>
              <div className="nav-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const badgeCount = item.badge ? openAlarmCount : null;
                  return (
                    <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}>
                      <span className="nav-item-icon"><Icon size={19} strokeWidth={1.8} /></span>
                      <span className="nav-item-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                      {badgeCount !== null && badgeCount > 0 ? <b>{badgeCount}</b> : <ChevronRight className="nav-chevron" size={16} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-status">
          <div className="gateway-badge"><span className="gateway-icon"><Server size={17} /></span><span><strong>Cadena OT operativa</strong><small>CAM5-CTRL-01 → CAM5-GW-01</small></span><i /></div>
          <button className="user-card" onClick={() => navigate("users")} aria-label="Abrir usuarios y roles"><span className="user-avatar">EA</span><span className="user-copy"><strong>Emerson Allende</strong><small>Administrador OT</small></span><ChevronRight size={16} /></button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left"><button className="menu-button" aria-label="Abrir navegación" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="mobile-brand"><Zap size={18} fill="currentColor" /></span><div className="site-selector"><Building2 size={17} /><div><span>{assetConfig.location}</span><strong className="site-active-asset">{assetConfig.name} · {assetConfig.description}</strong></div><span className="single-site-label">Piloto monositio</span></div></div>
          <div className="topbar-right"><label className="simulation-mode role-preview"><span>Vista por rol</span><select value={activeRole} onChange={(event) => setActiveRole(event.target.value as UserRole)} aria-label="Simular permisos de usuario"><option>Administrador</option><option>Ingeniero</option><option>Operador</option><option>Solo lectura</option></select></label>{cam5.demo
              ? <label className="simulation-mode"><span>Simulación</span><select value={demoMode} onChange={(event) => setDemoMode(event.target.value as SystemMode)} aria-label="Simular estado de telemetría"><option value="normal">Operativa</option><option value="loading">Actualizando</option><option value="stale">Datos atrasados</option><option value="offline">Sin conexión</option></select></label>
              : cam5.units.length > 1 && <label className="simulation-mode"><span>Unidad</span><select value={cam5.unitId} onChange={(event) => cam5.setUnitId(event.target.value)} aria-label="Seleccionar unidad CAM-5">{cam5.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.id}{unit.kind === "irm" ? " · lector" : ""}</option>)}</select></label>}<div className={`live-state live-${systemMode}`}><span /><div><strong>{systemMode === "offline" ? "Telemetría interrumpida" : systemMode === "stale" ? "Telemetría atrasada" : systemMode === "loading" ? "Actualizando telemetría" : "Telemetría activa"}</strong><small>{cam5.demo ? (systemMode === "offline" ? "Sin datos hace 18 min" : systemMode === "stale" ? "Último dato hace 6 min" : systemMode === "loading" ? "Esperando respuesta" : "Actualizado hace 2 s") : cam5.modeDetail}</small></div></div></div>
        </header>

        <div className="content-scroll">
          <div className="page-content">
            {systemMode !== "normal" && <section className={`operational-banner banner-${systemMode}`} role="alert"><span>{systemMode === "offline" ? <PlugConnected size={19} /> : systemMode === "loading" ? <Refresh className="spin" size={19} /> : <Clock3 size={19} />}</span><div><strong>{systemMode === "offline" ? "Gateway sin comunicación" : systemMode === "loading" ? "Sincronizando datos" : "Las lecturas están atrasadas"}</strong><p>{systemMode === "offline" ? "El portal conserva el último valor conocido. Las acciones operativas siguen disponibles, pero no hay telemetría nueva." : systemMode === "loading" ? "Solicitando la última configuración, lecturas y eventos disponibles." : "Los datos visibles superan el tiempo de frescura configurado. Revisa el enlace antes de tomar una decisión."}</p></div>{systemMode !== "loading" && <button onClick={() => { if (cam5.demo) { setDemoMode("normal"); notify("Conexión simulada restablecida."); } else { cam5.refetchAll(); notify("Reintentando conexión con CAM5 CORE…", "info"); } }}><Refresh size={15} /> Reintentar</button>}</section>}
            <section className="page-heading"><div><span className="eyebrow"><Activity size={13} /> Gestión de activos críticos</span><h1>{viewTitles[view].title}</h1><p>{viewTitles[view].description}</p></div><div className="heading-actions">{view !== "assets" && view !== "settings" && view !== "integrations" && view !== "users" && view !== "notifications" && view !== "reports" && view !== "maintenance" && view !== "diagnostics" && <button className="secondary-button" onClick={exportCsv}><Download size={16} /><span>Exportar</span></button>}<button className="primary-button" onClick={() => navigate("alarms")}><BellRing size={16} />{openAlarmCount} alertas abiertas</button></div></section>
            {view === "overview" && <Overview onNavigate={navigate} onAcknowledge={acknowledge} acknowledged={acknowledged} />}
            {view === "cabinet" && <CabinetView onOpenTrend={openChannelTrend} />}
            {view === "diagnostics" && <DiagnosticsView />}
            {view === "trends" && <TrendsView period={period} setPeriod={setPeriod} selectedId={trendSensorId} onSelectChannel={selectTrendChannel} onBackToMap={() => navigate("cabinet")} />}
            {view === "alarms" && <AlarmsView acknowledged={acknowledged} onAcknowledge={acknowledge} workOrders={workOrders} onOpenWorkOrder={openWorkOrderFromAlarm} closedIds={closedAlarmIds} setClosedIds={setClosedAlarmIds} assignees={alarmAssignees} setAssignees={setAlarmAssignees} notes={alarmNotes} setNotes={setAlarmNotes} />}
            {view === "history" && <HistoryView />}
            {view === "assets" && <AssetsView onNavigate={navigate} />}
            {view === "reports" && <ReportsView />}
            {view === "maintenance" && <MaintenanceView orders={workOrders} setOrders={setWorkOrders} focusOrderId={focusOrderId} />}
            {view === "settings" && <SettingsView />}
            {view === "integrations" && <IntegrationsView />}
            {view === "users" && <UsersView />}
            {view === "notifications" && <NotificationsView />}
          </div>
        </div>
      </main>
      {notice && <div className={`portal-notice notice-${notice.tone}`} role="status" aria-live="polite" key={notice.id}><CheckCircle2 size={18} /><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Cerrar notificación"><X size={16} /></button></div>}
      {confirmRequest && <div className="confirm-backdrop" role="presentation" onMouseDown={() => setConfirmRequest(null)}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}><span className={`confirm-icon ${confirmRequest.tone === "danger" ? "danger" : ""}`}>{confirmRequest.tone === "danger" ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}</span><div><span className="eyebrow">Confirmación requerida</span><h2 id="confirm-title">{confirmRequest.title}</h2><p>{confirmRequest.detail}</p></div>{confirmRequest.note && <label className="confirm-note"><span>{confirmRequest.note.label}</span><textarea rows={3} value={confirmNote} placeholder={confirmRequest.note.placeholder} onChange={(event) => setConfirmNote(event.target.value)} autoFocus /></label>}<div className="confirm-actions"><button className="secondary-button" onClick={() => { setConfirmRequest(null); setConfirmNote(""); }}>Cancelar</button><button className={confirmRequest.tone === "danger" ? "danger-button" : "primary-button"} disabled={Boolean(confirmRequest.note?.required) && confirmNote.trim().length === 0} onClick={() => { const action = confirmRequest.onConfirm; const note = confirmNote.trim(); setConfirmRequest(null); setConfirmNote(""); action(note || undefined); }}>{confirmRequest.confirmLabel}</button></div></section></div>}
    </div>
    </RoleContext.Provider>
    </ConfirmContext.Provider>
    </FeedbackContext.Provider>
  );
}

export default function Home() {
  return (
    <Cam5DataProvider>
      <PortalShell />
    </Cam5DataProvider>
  );
}
