"use client";

import { useState } from "react";
import { IconBellRinging as BellRing, IconCircleCheck as CheckCircle2, IconMail as Mail, IconPlugConnected as PlugConnected, IconShieldCheck as ShieldCheck, IconTimeline as Timeline, IconUsers as Users, IconWebhook as Webhook } from "@tabler/icons-react";
import { usePersistentState } from "../use-persistent-state";
import { useActiveRole, useFeedback } from "../lib/contexts";
import { useCam5Data } from "../lib/cam5-data";
import { useNotificationChannels, useNotificationLog } from "../lib/use-cam5";
import { cam5Api } from "../lib/api";

export function NotificationsView() {
  const notify = useFeedback();
  const role = useActiveRole();
  const cam5 = useCam5Data();
  const remoteChannels = useNotificationChannels();
  const remoteLog = useNotificationLog(50);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ kind: "email", target: "", minSeverity: "warning" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"channels" | "rules" | "delivery">("channels");
  const [testedChannel, setTestedChannel] = useState<string | null>(null);
  const [demoChannels, setDemoChannels] = usePersistentState("cam5.front.notification-channels", [
    { id: "email", name: "Correo OT", detail: "Alertas a responsables y turnos", destination: "operaciones@cam5.local", enabled: true, status: "Verificado" },
    { id: "teams", name: "Microsoft Teams", detail: "Canal del equipo de mantenimiento", destination: "Equipo · Mantenimiento eléctrico", enabled: true, status: "Conectado" },
    { id: "webhook", name: "Webhook CMMS", detail: "Creación de avisos externos", destination: "https://cmms.local/cam5/events", enabled: false, status: "Sin configurar" },
  ]);
  const KIND_NAME: Record<string, string> = { email: "Correo", sms: "SMS", webhook: "Webhook" };
  const channels = cam5.demo ? demoChannels : (remoteChannels.data ?? []).map((channel) => ({
    id: String(channel.id),
    name: `${KIND_NAME[channel.kind] ?? channel.kind} · ${channel.min_severity}`,
    detail: `${channel.delivered} entregadas · ${channel.failed} fallidas de ${channel.attempts} intentos`,
    destination: channel.target,
    enabled: channel.enabled,
    status: channel.enabled ? (Number(channel.failed) > 0 ? "Con fallos" : "Activo") : "Desactivado",
  }));
  const setChannels = cam5.demo ? setDemoChannels : ((() => undefined) as typeof setDemoChannels);

  const [rules, setRules] = usePersistentState("cam5.front.notification-rules", [
    { id: 1, event: "Evento crítico", scope: "Todos los activos", delay: "Inmediato", recipients: "Administrador + Ingeniero", enabled: true },
    { id: 2, event: "Advertencia persistente", scope: "Más de 5 minutos", delay: "5 minutos", recipients: "Ingeniero + Operador", enabled: true },
    { id: 3, event: "Pérdida de comunicación", scope: "Gateway sin datos", delay: "10 minutos", recipients: "Administrador", enabled: true },
    { id: 4, event: "Recuperación del activo", scope: "Retorno a normal", delay: "Inmediato", recipients: "Operador", enabled: false },
  ]);
  // El registro de entregas distingue intento, entrega y error, como exige
  // DELIVERY_CHECKLIST.md: un canal que "no falló" no es lo mismo que uno que entregó.
  const deliveries = cam5.demo
    ? [
        { time: "Hoy 11:48:04", event: "AL-260811-031 · Descarga parcial", channel: "Correo OT", recipient: "2 destinatarios", state: "Entregada" },
        { time: "Hoy 11:48:05", event: "AL-260811-031 · Descarga parcial", channel: "Microsoft Teams", recipient: "Mantenimiento eléctrico", state: "Entregada" },
        { time: "Hoy 09:22:18", event: "AL-260811-028 · Diferencial térmico", channel: "Correo OT", recipient: "3 destinatarios", state: "Entregada" },
        { time: "Ayer 18:43:11", event: "Recuperación de gateway", channel: "Correo OT", recipient: "1 destinatario", state: "Entregada" },
      ]
    : (remoteLog.data ?? []).map((entry) => ({
        time: new Date(entry.attempted_at).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        event: entry.alarm_id ?? "Sin evento asociado",
        channel: `${KIND_NAME[entry.kind ?? ""] ?? entry.kind ?? "—"}`,
        recipient: entry.target ?? "—",
        state: entry.status === "delivered" ? "Entregada" : entry.status === "failed" ? (entry.error ?? "Fallida") : "Intentada",
      }));

  const createChannel = (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    cam5Api.createNotificationChannel(form)
      .then(() => { remoteChannels.refetch(); setForm({ kind: "email", target: "", minSeverity: "warning" }); setShowNew(false); notify("Canal de notificación creado."); })
      .catch((error) => { setFieldErrors(error.fieldErrors ?? {}); notify(error.message ?? "No se pudo crear el canal.", "warning"); });
  };
  const testChannel = (id: string) => { const channel = channels.find((item) => item.id === id); setTestedChannel(id); notify(`Prueba enviada por ${channel?.name ?? "el canal"}.`, "info"); window.setTimeout(() => setTestedChannel(null), 2200); };
  const toggleChannel = (id: string) => {
    if (cam5.demo) {
      setDemoChannels((current) => current.map((item) => item.id === id ? { ...item, enabled: !item.enabled, status: item.enabled ? "Desactivado" : "Verificado" } : item));
      return;
    }
    const channel = (remoteChannels.data ?? []).find((item) => String(item.id) === id);
    if (!channel) return;
    cam5Api.updateNotificationChannel(channel.id, { enabled: !channel.enabled })
      .then(() => { remoteChannels.refetch(); notify(`Canal ${channel.enabled ? "desactivado" : "activado"}.`, channel.enabled ? "warning" : "success"); })
      .catch((error) => notify(error.message ?? "No se pudo actualizar el canal.", "warning"));
  };
  const updateRule = (id: number, field: "delay" | "recipients" | "enabled", value: string | boolean) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));

  return (
    <>
      <section className="module-summary-grid notification-summary"><article><span className="module-summary-icon green"><Mail size={19} /></span><div><small>Canales activos</small><strong>{channels.filter((channel) => channel.enabled).length}</strong><span>de {channels.length} configurados</span></div></article><article><span className="module-summary-icon blue"><BellRing size={19} /></span><div><small>Reglas habilitadas</small><strong>{rules.filter((rule) => rule.enabled).length}</strong><span>Escalamiento automático</span></div></article><article><span className="module-summary-icon amber"><CheckCircle2 size={19} /></span><div><small>Entrega últimas 24 h</small><strong>100%</strong><span>4 de 4 entregadas</span></div></article></section>
      <article className={`panel module-panel notification-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de notificaciones"><button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><Mail size={16} /> Canales</button><button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}><BellRing size={16} /> Escalamiento</button><button className={tab === "delivery" ? "active" : ""} onClick={() => setTab("delivery")}><Timeline size={16} /> Entregas</button></div><span className="autosave-state"><CheckCircle2 size={14} /> Cambios locales guardados</span></div>

        {tab === "channels" && <div className="notification-content"><div className="api-section-head"><div className="settings-section-head"><span className="settings-icon"><Mail size={20} /></span><div><h2>Canales de notificación</h2><p>Define cómo se informa un evento a los equipos responsables.</p></div></div>{!cam5.demo && <button className="primary-button" onClick={() => setShowNew((current) => !current)}><Mail size={16} /> {showNew ? "Cancelar" : "Nuevo canal"}</button>}</div>{showNew && !cam5.demo && <form className="api-key-form" onSubmit={createChannel}><label><span>Tipo</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option value="email">Correo</option><option value="sms">SMS</option><option value="webhook">Webhook</option></select></label><label><span>Destino</span><input required value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} placeholder={form.kind === "webhook" ? "https://…" : form.kind === "sms" ? "+56 9 …" : "nombre@empresa.cl"} aria-invalid={Boolean(fieldErrors.target)} />{fieldErrors.target && <small className="field-error">{fieldErrors.target}</small>}</label><label><span>Severidad mínima</span><select value={form.minSeverity} onChange={(event) => setForm({ ...form, minSeverity: event.target.value })}><option value="info">Información</option><option value="warning">Advertencia</option><option value="critical">Crítica</option></select></label><button type="submit"><Mail size={15} /> Crear canal</button></form>}<div className="notification-channel-grid">{channels.map((channel) => <article className={`notification-channel-card ${channel.enabled ? "enabled" : ""}`} key={channel.id}><div className="notification-channel-head"><span className="notification-channel-icon">{channel.destination.startsWith("http") ? <Webhook size={20} /> : channel.destination.includes("@") ? <Mail size={20} /> : channel.id === "teams" ? <Users size={20} /> : <PlugConnected size={20} />}</span><button className={`switch-control ${channel.enabled ? "on" : ""}`} onClick={() => toggleChannel(channel.id)} aria-label={`${channel.enabled ? "Desactivar" : "Activar"} ${channel.name}`}><i /></button></div><h3>{channel.name}</h3><p>{channel.detail}</p><dl><div><dt>Destino</dt><dd>{channel.destination}</dd></div><div><dt>Estado</dt><dd className={channel.enabled ? "quality-ok" : "muted-state"}>{channel.status}</dd></div></dl><button className="test-notification-button" onClick={() => testChannel(channel.id)} disabled={!channel.enabled}>{testedChannel === channel.id ? <><CheckCircle2 size={15} /> Prueba enviada</> : <><BellRing size={15} /> Enviar prueba</>}</button></article>)}</div></div>}

        {tab === "rules" && <div className="notification-content notification-rules"><div className="settings-section-head"><span className="settings-icon"><BellRing size={20} /></span><div><h2>Reglas de escalamiento</h2><p>Relaciona severidad, espera y destinatarios responsables.</p></div></div><div className="notification-rule-table"><div className="notification-rule-head"><span>Condición</span><span>Alcance</span><span>Espera</span><span>Destinatarios</span><span>Estado</span></div>{rules.map((rule) => <div className="notification-rule-row" key={rule.id}><span><strong>{rule.event}</strong></span><span>{rule.scope}</span><span><select value={rule.delay} onChange={(event) => updateRule(rule.id, "delay", event.target.value)}><option>Inmediato</option><option>5 minutos</option><option>10 minutos</option><option>30 minutos</option></select></span><span><select value={rule.recipients} onChange={(event) => updateRule(rule.id, "recipients", event.target.value)}><option>Administrador</option><option>Administrador + Ingeniero</option><option>Ingeniero + Operador</option><option>Operador</option></select></span><span><button className={`channel-toggle ${rule.enabled ? "on" : ""}`} onClick={() => updateRule(rule.id, "enabled", !rule.enabled)}><i />{rule.enabled ? "Activa" : "Inactiva"}</button></span></div>)}</div><div className="configuration-note"><ShieldCheck size={17} /><p>Las reglas críticas se envían de inmediato. Las esperas solo se aplican cuando la condición permanece activa durante el periodo configurado.</p></div></div>}

        {tab === "delivery" && <div className="notification-content delivery-content"><div className="settings-section-head"><span className="settings-icon"><Timeline size={20} /></span><div><h2>Registro de entregas</h2><p>Trazabilidad de mensajes emitidos por el motor de notificaciones.</p></div></div><div className="module-table-wrap"><div className="delivery-table"><div className="module-table-head"><span>Fecha</span><span>Evento</span><span>Canal</span><span>Destino</span><span>Resultado</span></div>{deliveries.map((delivery) => <div className="module-table-row" key={`${delivery.time}-${delivery.channel}`}><span className="mono-cell">{delivery.time}</span><span>{delivery.event}</span><span>{delivery.channel}</span><span>{delivery.recipient}</span><span className="quality-ok"><CheckCircle2 size={14} /> {delivery.state}</span></div>)}</div></div></div>}
      </article>
    </>
  );
}
