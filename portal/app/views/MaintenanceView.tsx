"use client";

import { useState } from "react";
import { IconAlertTriangle as AlertTriangle, IconCalendarEvent as CalendarEvent, IconChevronRight as ChevronRight, IconClipboardCheck as ClipboardCheck, IconPlus as Plus, IconShieldCheck as ShieldCheck, IconTool as Tool } from "@tabler/icons-react";
import { useActiveRole, useConfirm, useFeedback } from "../lib/contexts";
import type { WorkOrder, WorkPriority, WorkStatus } from "../lib/types";

import { useCam5Data } from "../lib/cam5-data";

export function MaintenanceView({ orders, setOrders, focusOrderId }: { orders: WorkOrder[]; setOrders: React.Dispatch<React.SetStateAction<WorkOrder[]>>; focusOrderId: string | null }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  const role = useActiveRole();
  const cam5 = useCam5Data();
  const [tab, setTab] = useState<"plan" | "orders">(focusOrderId ? "orders" : "plan");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", priority: "Alta", assignee: "Paula Rojas" });
  const plans = [
    { code: "PM-01", name: "Inspección termográfica", frequency: "Mensual", next: "21 ago 2026", progress: 82, state: "Próxima" },
    { code: "PM-02", name: "Diagnóstico UHF de descarga parcial", frequency: "Trimestral", next: "Hoy", progress: 100, state: "Vencida" },
    { code: "PM-03", name: "Limpieza y control ambiental", frequency: "Trimestral", next: "22 ago 2026", progress: 78, state: "Próxima" },
    { code: "PM-04", name: "Verificación de gateway y registros", frequency: "Mensual", next: "31 ago 2026", progress: 36, state: "En plazo" },
  ];
  const openOrders = orders.filter((order) => order.status !== "Completada").length;
  const createOrder = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    const id = `OT-${Date.now().toString().slice(-9)}`;
    setOrders((current) => [{ id, title: form.title.trim(), source: "Creación manual · Portal web", due: "Sin programar", priority: form.priority as WorkPriority, assignee: form.assignee, status: "Pendiente" }, ...current]);
    notify(`Orden ${id} creada correctamente.`);
    setForm({ title: "", priority: "Alta", assignee: "Paula Rojas" }); setShowCreate(false); setTab("orders");
  };
  const applyOrderStatus = (id: string, status: WorkStatus) => {
    if (cam5.demo) {
      setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order));
      notify(`${id} actualizada a “${status}”.`, "info");
      return;
    }
    cam5.updateWorkOrder(id, status)
      .then(() => notify(`${id} actualizada a “${status}”.`, "info"))
      .catch((error) => notify(error.message ?? "No se pudo actualizar la orden.", "warning"));
  };
  const updateOrder = (id: string, status: WorkStatus) => status === "Completada" ? confirm({ title: `Completar ${id}`, detail: "La orden quedará finalizada y el evento asociado podrá cerrarse desde el Centro de alertas.", confirmLabel: "Completar orden", onConfirm: () => applyOrderStatus(id, status) }) : applyOrderStatus(id, status);

  return (
    <>
      <section className="module-summary-grid maintenance-summary-grid">
        <article><span className="module-summary-icon green"><ClipboardCheck size={19} /></span><div><small>Cumplimiento preventivo</small><strong>87%</strong><span>Meta mensual: 90%</span></div></article>
        <article><span className="module-summary-icon amber"><CalendarEvent size={19} /></span><div><small>Tareas próximas</small><strong>3</strong><span>1 requiere atención hoy</span></div></article>
        <article><span className="module-summary-icon blue"><Tool size={19} /></span><div><small>Órdenes abiertas</small><strong>{openOrders}</strong><span>1 crítica · 2 altas</span></div></article>
      </section>

      <article className={`panel module-panel maintenance-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de mantenimiento"><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><CalendarEvent size={16} /> Plan preventivo</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><ClipboardCheck size={16} /> Órdenes de trabajo</button></div><button className="primary-button" onClick={() => setShowCreate((current) => !current)}><Plus size={16} /> {showCreate ? "Cancelar" : "Nueva orden"}</button></div>

        {showCreate && <form className="work-order-form" onSubmit={createOrder}><label><span>Trabajo requerido</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ej.: Revisar conexión del sensor T02" /></label><label><span>Prioridad</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>Crítica</option><option>Alta</option><option>Normal</option></select></label><label><span>Responsable</span><select value={form.assignee} onChange={(event) => setForm({ ...form, assignee: event.target.value })}><option>Paula Rojas</option><option>Emerson Allende</option><option>Felipe Soto</option></select></label><button type="submit"><ClipboardCheck size={15} /> Crear orden</button></form>}

        {tab === "plan" && <div className="maintenance-plan-content"><div className="settings-section-head"><span className="settings-icon"><CalendarEvent size={20} /></span><div><h2>Plan basado en condición</h2><p>La frecuencia se complementa con los hallazgos de telemetría y eventos activos.</p></div></div><div className="maintenance-plan-grid">{plans.map((plan) => <article className={`maintenance-plan-card plan-${plan.state.toLowerCase().replace(" ", "-")}`} key={plan.code}><div className="maintenance-plan-head"><span>{plan.code}</span><i>{plan.state}</i></div><h3>{plan.name}</h3><dl><div><dt>Frecuencia</dt><dd>{plan.frequency}</dd></div><div><dt>Próxima ejecución</dt><dd>{plan.next}</dd></div></dl><div className="maintenance-progress"><span><i style={{ width: `${plan.progress}%` }} /></span><small>{plan.progress}% del intervalo consumido</small></div><button onClick={() => { setForm({ title: plan.name, priority: plan.state === "Vencida" ? "Alta" : "Normal", assignee: "Paula Rojas" }); setShowCreate(true); }}><Plus size={14} /> Crear orden desde el plan</button></article>)}</div><div className="maintenance-recommendation"><AlertTriangle size={19} /><div><strong>Recomendación prioritaria</strong><p>Adelantar el diagnóstico UHF de PD1 y coordinar una ventana de inspección antes de cualquier intervención invasiva.</p></div><button onClick={() => setTab("orders")}>Revisar órdenes <ChevronRight size={15} /></button></div></div>}

        {tab === "orders" && <div className="maintenance-orders">{focusOrderId && <div className="work-order-focus-banner"><ClipboardCheck size={17} /><div><strong>Orden abierta desde el Centro de alertas</strong><p>{focusOrderId} quedó seleccionada para mantener la trazabilidad del evento.</p></div></div>}<div className="report-library-head"><div><span className="eyebrow">Ejecución</span><h2>Órdenes de trabajo</h2></div><span>{openOrders} abiertas</span></div><div className="module-table-wrap"><div className="work-order-table"><div className="module-table-head"><span>Orden / trabajo</span><span>Origen</span><span>Vencimiento</span><span>Prioridad</span><span>Responsable</span><span>Estado</span></div>{orders.map((order) => <div className={`module-table-row ${order.id === focusOrderId ? "focused-order" : ""}`} key={order.id}><span className="event-cell"><strong>{order.title}</strong><small>{order.id}</small></span><span>{order.source}</span><span>{order.due}</span><span><i className={`maintenance-priority priority-${order.priority.toLowerCase()}`}>{order.priority}</i></span><span>{order.assignee}</span><span><select className={`work-status status-${order.status.toLowerCase().replace(" ", "-")}`} value={order.status} onChange={(event) => updateOrder(order.id, event.target.value as WorkStatus)}><option>Pendiente</option><option>En curso</option><option>Completada</option></select></span></div>)}</div></div></div>}
        <div className="module-footer"><span><ShieldCheck size={14} /> Toda modificación queda asociada al usuario y al activo.</span><small>Estado local sincronizado · preparado para integración con CMMS.</small></div>
      </article>
    </>
  );
}
