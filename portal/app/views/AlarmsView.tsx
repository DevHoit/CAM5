"use client";

import { useState } from "react";
import { IconAlertTriangle as AlertTriangle, IconBellRinging as BellRing, IconCircleCheck as CheckCircle2, IconChevronDown as ChevronDown, IconClipboardCheck as ClipboardCheck, IconClock as Clock3, IconSearch as Search, IconShieldCheck as ShieldCheck } from "@tabler/icons-react";
import { StatusPill } from "../components/StatusPill";
import { TableEmptyState } from "../components/TableEmptyState";
import { useActiveRole, useConfirm, useFeedback } from "../lib/contexts";
import { useCam5Data, type PortalAlarm } from "../lib/cam5-data";
import type { Severity, WorkOrder } from "../lib/types";

export function AlarmsView({ acknowledged, onAcknowledge, workOrders, onOpenWorkOrder, closedIds, setClosedIds, assignees, setAssignees, notes, setNotes }: { acknowledged: string[]; onAcknowledge: (id: string) => void; workOrders: WorkOrder[]; onOpenWorkOrder: (alarm: PortalAlarm, assignee: string) => void; closedIds: string[]; setClosedIds: React.Dispatch<React.SetStateAction<string[]>>; assignees: Record<string, string>; setAssignees: React.Dispatch<React.SetStateAction<Record<string, string>>>; notes: Record<string, string[]>; setNotes: React.Dispatch<React.SetStateAction<Record<string, string[]>>> }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  const role = useActiveRole();
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const cam5 = useCam5Data();
  const alarmList = cam5.portalAlarms;
  const [workflowStatus, setWorkflowStatus] = useState<"all" | "open" | "acknowledged" | "closed">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [noteInput, setNoteInput] = useState("");
  const getWorkflowStatus = (alarm: PortalAlarm) => closedIds.includes(alarm.id) ? "closed" : alarm.acknowledged || acknowledged.includes(alarm.id) ? "acknowledged" : "open";
  const filtered = alarmList.filter((alarm) => (severity === "all" || alarm.severity === severity) && (workflowStatus === "all" || getWorkflowStatus(alarm) === workflowStatus) && `${alarm.title} ${alarm.detail}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find((alarm) => alarm.id === selectedId) ?? filtered[0] ?? alarmList[0];
  if (!selected) return <TableEmptyState title="Sin eventos registrados" detail="No hay alarmas abiertas ni históricas para este activo." />;
  const selectedStatus = getWorkflowStatus(selected);
  const selectedNotes = notes[selected.id] ?? [];
  const linkedOrder = workOrders.find((order) => order.sourceAlarmId === selected.id);
  const interventionComplete = linkedOrder?.status === "Completada";
  const addNote = (event: React.FormEvent) => { event.preventDefault(); if (!noteInput.trim()) return; setNotes((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), noteInput.trim()] })); setNoteInput(""); };
  // El backend exige nota para cerrar y la registra en auditoría; el diálogo la
  // pide antes de permitir la acción, en vez de fallar después.
  const closeEvent = () => confirm({
    title: `Cerrar ${selected.id}`,
    detail: "Confirma que la condición fue revisada y que no requiere seguimiento operativo adicional.",
    confirmLabel: "Cerrar evento",
    tone: "danger",
    note: { label: "Nota de cierre (obligatoria)", placeholder: "Qué se verificó y por qué la condición ya no requiere seguimiento.", required: true },
    onConfirm: (note) => {
      const text = (note ?? "").trim();
      if (cam5.demo) {
        if (selectedStatus === "open") onAcknowledge(selected.id);
        setClosedIds((current) => current.includes(selected.id) ? current : [...current, selected.id]);
        setNotes((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), text] }));
        notify(`Evento ${selected.id} cerrado.`);
        return;
      }
      cam5.closeAlarm(selected.id, text)
        .then(() => notify(`Evento ${selected.id} cerrado.`))
        .catch((error) => notify(error.message ?? "No se pudo cerrar el evento.", "warning"));
    },
  });
  const reopenEvent = () => {
    if (!cam5.demo) { notify("La reapertura de eventos aún no está disponible en el servidor.", "warning"); return; }
    setClosedIds((current) => current.filter((id) => id !== selected.id));
    notify(`Evento ${selected.id} reabierto.`, "warning");
  };
  const openCritical = alarmList.filter((alarm) => alarm.severity === "critical" && !closedIds.includes(alarm.id)).length;
  const openWarnings = alarmList.filter((alarm) => alarm.severity === "warning" && !closedIds.includes(alarm.id)).length;
  return (
    <>
      <section className="alarm-summary">
        <div className="summary-tile critical"><span>Críticas abiertas</span><strong>{openCritical}</strong><AlertTriangle size={24} /></div>
        <div className="summary-tile warning"><span>Advertencias abiertas</span><strong>{openWarnings}</strong><BellRing size={24} /></div>
        <div className="summary-tile normal"><span>MTTA promedio</span><strong>8.5<small> min</small></strong><Clock3 size={24} /></div>
      </section>
      <article className={`panel alarm-table-panel ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="alarm-toolbar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar mensaje, sensor o zona…" /></label>
          <div className="alarm-filters"><label className="status-filter"><span>Estado</span><select value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as typeof workflowStatus)}><option value="all">Todos</option><option value="open">Abiertas</option><option value="acknowledged">Reconocidas</option><option value="closed">Cerradas</option></select><ChevronDown size={13} /></label><div className="segmented">{(["all", "critical", "warning", "info"] as const).map((item) => <button key={item} className={severity === item ? "active" : ""} onClick={() => setSeverity(item)}>{item === "all" ? "Todas" : item === "critical" ? "Críticas" : item === "warning" ? "Advertencias" : "Info"}</button>)}</div></div>
        </div>
        <div className="alarm-table-wrap"><div className="alarm-table">
          <div className="alarm-table-head"><span>Severidad</span><span>Evento / activo</span><span>Tiempo activo</span><span>Valor</span><span>Estado</span><span>Acción</span></div>
          {filtered.map((alarm) => {
            const status = getWorkflowStatus(alarm);
            return <div className={`alarm-table-row ${selected.id === alarm.id ? "selected" : ""}`} key={alarm.id}>
              <span><StatusPill state={alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Informativa"}</StatusPill></span>
              <span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.detail} · {alarm.id}</small></span>
              <span>{alarm.since}</span><span><strong>{alarm.value}</strong></span>
              <span>{status === "closed" ? <span className="closed-state"><CheckCircle2 size={15} /> Cerrada</span> : status === "acknowledged" ? <span className="ack-state"><CheckCircle2 size={15} /> Reconocida</span> : <span className="unack-state"><Clock3 size={15} /> Sin reconocer</span>}</span>
              <span><button className={selected.id === alarm.id ? "ack-button" : "ghost-button"} onClick={() => setSelectedId(alarm.id)}>Gestionar</button></span>
            </div>;
          })}
          {filtered.length === 0 && <TableEmptyState title="No hay eventos con estos filtros" detail="Ajusta el estado, la severidad o el texto de búsqueda." />}
        </div></div>
        {filtered.length > 0 && <section className={`event-detail-panel event-${selected.severity}`}>
          <div className="event-detail-header"><span className="event-detail-icon"><AlertTriangle size={20} /></span><div><span className="eyebrow">Evento seleccionado · {selected.id}</span><h2>{selected.title}</h2><p>{selected.detail}</p></div><span className={`workflow-badge workflow-${selectedStatus}`}>{selectedStatus === "closed" ? "Cerrada" : selectedStatus === "acknowledged" ? "Reconocida" : "Abierta"}</span></div>
          <div className="event-workspace">
            <div className="event-management">
              <dl className="event-facts"><div><dt>Valor detectado</dt><dd>{selected.value}</dd></div><div><dt>Inicio</dt><dd>{selected.since}</dd></div><div><dt>Responsable</dt><dd><select value={assignees[selected.id] ?? "Sin asignar"} onChange={(event) => setAssignees((current) => ({ ...current, [selected.id]: event.target.value }))}><option>Sin asignar</option><option>Emerson Allende</option><option>Paula Rojas</option><option>Felipe Soto</option></select></dd></div></dl>
              {interventionComplete && selectedStatus !== "closed" && <div className="event-remediation-state"><CheckCircle2 size={17} /><div><strong>Intervención completada</strong><p>{linkedOrder.id} finalizó. Verifica que la condición se haya normalizado antes de cerrar el evento.</p></div></div>}
              <div className="event-actions">{selectedStatus === "open" && <button className="primary-button" onClick={() => onAcknowledge(selected.id)}><CheckCircle2 size={15} /> Reconocer evento</button>}<button className={`work-order-action ${linkedOrder ? "linked" : ""}`} onClick={() => onOpenWorkOrder(selected, assignees[selected.id] ?? "Sin asignar")}><ClipboardCheck size={15} /> {linkedOrder ? `Abrir ${linkedOrder.id}` : "Crear orden de trabajo"}</button>{selectedStatus === "closed" ? <button className="secondary-button" onClick={reopenEvent}>Reabrir evento</button> : <button className="secondary-button" onClick={closeEvent}><ShieldCheck size={15} /> Cerrar evento</button>}</div>
            </div>
            <div className="event-timeline"><h3>Línea de tiempo</h3><div><span className="timeline-dot critical" /><p><strong>Evento detectado</strong><small>{selected.since} · Motor de reglas CAM5</small></p></div>{selectedStatus !== "open" && <div><span className="timeline-dot normal" /><p><strong>Evento reconocido</strong><small>Emerson Allende · Portal web</small></p></div>}{linkedOrder && <div><span className={`timeline-dot ${interventionComplete ? "normal" : "info"}`} /><p><strong>{interventionComplete ? "Orden de trabajo completada" : "Orden de trabajo vinculada"}</strong><small>{linkedOrder.id} · {linkedOrder.status}</small></p></div>}{selectedNotes.map((note, index) => <div key={`${selected.id}-${index}`}><span className="timeline-dot info" /><p><strong>Nota operativa</strong><small>{note}</small></p></div>)}{selectedStatus === "closed" && <div><span className="timeline-dot normal" /><p><strong>Evento cerrado</strong><small>Condición revisada por el operador</small></p></div>}</div>
          </div>
          <form className="event-note-form" onSubmit={addNote}><input value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="Agregar una nota de seguimiento…" /><button type="submit">Agregar nota</button></form>
        </section>}
      </article>
    </>
  );
}
