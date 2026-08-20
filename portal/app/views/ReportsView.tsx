"use client";

import { useState } from "react";
import { IconAlertTriangle as AlertTriangle, IconBellRinging as BellRing, IconCalendarEvent as CalendarEvent, IconCircleCheck as CheckCircle2, IconCircuitCell as CircuitBoard, IconDatabase as Database, IconDownload as Download, IconFileReport as FileReport, IconFileTypePdf as FileTypePdf, IconGauge as Gauge, IconDeviceDesktopAnalytics as MonitorDot, IconPrinter as Printer, IconShieldCheck as ShieldCheck, IconTimeline as Timeline, IconX as X, IconBolt as Zap } from "@tabler/icons-react";
import { usePersistentState } from "../use-persistent-state";
import { useFeedback } from "../lib/contexts";
import { sensors } from "../lib/fixtures";
import { useSensorData } from "../lib/use-sensor-data";

import { useCam5Data } from "../lib/cam5-data";
import { useReports } from "../lib/use-cam5";
import { cam5Api } from "../lib/api";

export function ReportsView() {
  const notify = useFeedback();
  const sensors = useSensorData();
  const activeChannelCount = sensors.filter((sensor) => sensor.enabled).length;
  const templates = [
    { id: "condition", name: "Condición del activo", detail: "Salud general, hallazgos y recomendación técnica", icon: "condition", accent: "blue" },
    { id: "events", name: "Eventos y alarmas", detail: "Tiempos de atención, causas y trazabilidad operativa", icon: "events", accent: "amber" },
    { id: "executive", name: "Resumen ejecutivo", detail: "Indicadores consolidados para jefatura y confiabilidad", icon: "executive", accent: "green" },
  ];
  const [templateId, setTemplateId] = useState("condition");
  const [period, setPeriod] = useState("30 días");
  const [format, setFormat] = useState("PDF");
  const [automatic, setAutomatic] = usePersistentState("cam5.front.report-schedule", true);
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [demoReports, setDemoReports] = usePersistentState("cam5.front.reports", [
    { id: "RPT-260811-012", name: "Condición mensual MCC-01", period: "12 jul – 11 ago", created: "Hoy 11:50", format: "PDF", owner: "Emerson Allende" },
    { id: "RPT-260804-011", name: "Eventos críticos · Semana 32", period: "29 jul – 4 ago", created: "4 ago 18:10", format: "PDF", owner: "Sistema" },
    { id: "RPT-260801-010", name: "Resumen ejecutivo · Julio", period: "1 – 31 jul", created: "1 ago 08:00", format: "XLSX", owner: "Sistema" },
  ]);
  const cam5 = useCam5Data();
  const remote = useReports(cam5.assetId);

  const PERIOD_DAYS: Record<string, number> = { "7 días": 7, "30 días": 30, "90 días": 90 };
  const statusLabel = (status: string) => status === "ready" ? "Listo" : status === "pending" ? "Generando…" : "Falló";

  // La biblioteca muestra el ESTADO de generación, no sólo el resultado: un
  // informe de 30 días tarda, y ocultarlo hasta que termina parece un error.
  const reports = cam5.demo ? demoReports.map((report) => ({ ...report, status: "ready", downloadUrl: null as string | null, error: null as string | null }))
    : (remote.data ?? []).map((report) => ({
        id: report.id,
        name: `${report.kind === "condition" ? "Condición" : report.kind} · ${report.asset_id}`,
        period: `${new Date(report.period_from).toLocaleDateString("es-CL", { day: "numeric", month: "short" })} – ${new Date(report.period_to).toLocaleDateString("es-CL", { day: "numeric", month: "short" })}`,
        created: new Date(report.created_at).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        format: "CSV",
        owner: report.requested_by_name ?? "Sistema",
        status: report.status,
        downloadUrl: report.download_url ? cam5Api.reportDownloadUrl(report.id) : null,
        error: report.error,
      }));
  const setReports = cam5.demo ? setDemoReports : ((() => undefined) as typeof setDemoReports);

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
  const generateReport = () => {
    setGenerating(true);
    if (cam5.demo) {
      window.setTimeout(() => {
        setDemoReports((current) => [{ id: `RPT-${Date.now().toString().slice(-9)}`, name: `${selectedTemplate.name} · MCC-01`, period, created: "Ahora", format, owner: "Emerson Allende" }, ...current]);
        setGenerating(false);
        setPreviewOpen(true);
        notify(`${selectedTemplate.name} generado y agregado a la biblioteca.`);
      }, 850);
      return;
    }
    const days = PERIOD_DAYS[period] ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    cam5Api.requestReport({ assetId: cam5.assetId, kind: selectedTemplate.id, from: from.toISOString(), to: to.toISOString() })
      .then((report) => {
        setGenerating(false);
        remote.refetch();
        notify(`${report.id} en preparación. La biblioteca se actualizará al terminar.`, "info");
      })
      .catch((error) => { setGenerating(false); notify(error.message ?? "No se pudo solicitar el informe.", "warning"); });
  };
  const downloadReport = (report: { id: string; downloadUrl: string | null; status: string }) => {
    if (report.status !== "ready" || !report.downloadUrl) {
      notify(report.status === "pending" ? "El informe aún se está generando." : "El informe falló y no tiene archivo.", "warning");
      return;
    }
    window.open(report.downloadUrl, "_blank", "noopener");
  };
  const downloadReportData = (name: string) => {
    const rows = ["reporte,activo,canal,valor,unidad,estado", ...sensors.filter((sensor) => sensor.enabled).map((sensor) => [name, "MCC-01", sensor.id, sensor.value, sensor.unit, sensor.state].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cam5-datos-reporte.csv"; anchor.click(); URL.revokeObjectURL(url);
    notify("Datos del reporte exportados correctamente.", "info");
  };

  return (
    <>
      <section className="module-summary-grid report-summary-grid">
        <article><span className="module-summary-icon blue"><FileReport size={19} /></span><div><small>Informes disponibles</small><strong>{reports.length}</strong><span>Últimos 90 días</span></div></article>
        <article><span className="module-summary-icon green"><CalendarEvent size={19} /></span><div><small>Programaciones activas</small><strong>{automatic ? 3 : 2}</strong><span>Próximo: lunes 08:00</span></div></article>
        <article><span className="module-summary-icon amber"><Database size={19} /></span><div><small>Cobertura de datos</small><strong>99.98%</strong><span>{activeChannelCount} canales incluidos</span></div></article>
      </section>

      <article className="panel module-panel report-module">
        <div className="module-toolbar"><div><span className="eyebrow">Constructor de informes</span><h2>Crear un reporte operacional</h2></div><span className="autosave-state"><ShieldCheck size={14} /> Trazabilidad habilitada</span></div>
        <div className="report-builder">
          <section className="report-template-section">
            <div className="settings-section-head"><span className="settings-icon"><FileReport size={20} /></span><div><h2>Tipo de informe</h2><p>Selecciona la estructura según la audiencia y el objetivo.</p></div></div>
            <div className="report-template-list">{templates.map((template) => <button key={template.id} className={`report-template-card ${templateId === template.id ? "selected" : ""}`} onClick={() => setTemplateId(template.id)}><span className={`report-template-icon ${template.accent}`}>{template.icon === "events" ? <BellRing size={19} /> : template.icon === "executive" ? <Gauge size={19} /> : <CircuitBoard size={19} />}</span><span><strong>{template.name}</strong><small>{template.detail}</small></span><i>{templateId === template.id && <CheckCircle2 size={16} />}</i></button>)}</div>
          </section>
          <aside className="report-config-card">
            <span className="eyebrow">Parámetros del reporte</span>
            <h3>{selectedTemplate.name}</h3>
            <p>El informe se genera para MCC-01 · Alimentador Norte con los canales activos.</p>
            <div className="report-config-fields"><label><span>Periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>24 horas</option><option>7 días</option><option>30 días</option><option>90 días</option></select></label><label><span>Formato</span><select value={format} onChange={(event) => setFormat(event.target.value)}><option>PDF</option><option>XLSX</option></select></label></div>
            <button className={`report-schedule ${automatic ? "active" : ""}`} onClick={() => setAutomatic((current) => !current)}><span><CalendarEvent size={17} /><span><strong>Programación automática</strong><small>Primer lunes de cada mes · 08:00</small></span></span><i>{automatic ? "Activa" : "Inactiva"}</i></button>
            <button className="report-preview-button" onClick={() => setPreviewOpen(true)}><MonitorDot size={17} /> Vista previa</button>
            <button className="generate-report-button" onClick={generateReport} disabled={generating}>{generating ? <><Timeline size={17} /> Generando informe…</> : <><FileTypePdf size={17} /> Generar informe</>}</button>
            <small className="report-disclaimer">La vista previa utiliza el mismo contrato que consumirá el servicio definitivo de reportes.</small>
          </aside>
        </div>

        {previewOpen && <section className="report-preview" aria-label="Vista previa del informe"><div className="report-preview-toolbar"><div><span className="eyebrow">Vista previa · {format}</span><h2>{selectedTemplate.name}</h2></div><div><button className="secondary-button" onClick={() => setPreviewOpen(false)}><X size={15} /> Cerrar</button><button className="primary-button" onClick={() => window.print()}><Printer size={15} /> Imprimir / guardar PDF</button></div></div><div className="report-sheet"><header><span className="brand-mark"><Zap size={21} /></span><div><strong>CAM5 CORE</strong><small>Informe de condición de activo crítico</small></div><time>Subestación Norte · MCC-01</time></header><section><span className="eyebrow">Resumen del periodo · {period}</span><h1>{selectedTemplate.name}</h1><p>Evaluación consolidada de temperatura, descarga parcial, humedad y disponibilidad de comunicaciones.</p></section><div className="report-kpi-row"><article><small>Condición</small><strong>Atención prioritaria</strong></article><article><small>Canales incluidos</small><strong>{sensors.filter((sensor) => sensor.enabled).length} de {sensors.length}</strong></article><article><small>Integridad</small><strong>99.98%</strong></article></div><section className="report-finding"><AlertTriangle size={20} /><div><strong>Hallazgo principal</strong><h2>Descarga parcial en aceleración · PD1</h2><p>El índice actual supera el umbral crítico configurado. Se recomienda inspección dirigida del compartimiento de cables.</p></div><b>72 idx</b></section><section className="report-channel-summary"><h2>Lecturas incluidas</h2><div>{sensors.filter((sensor) => sensor.enabled).map((sensor) => <span key={sensor.id}><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b><span><strong>{sensor.label}</strong><small>{sensor.zone}</small></span><em>{sensor.value} {sensor.unit}</em></span>)}</div></section><footer><ShieldCheck size={16} /><span>Documento generado desde datos simulados. La fuente definitiva será proporcionada por el historiador CAM5.</span></footer></div></section>}

        <div className="report-library-head"><div><span className="eyebrow">Biblioteca</span><h2>Informes recientes</h2></div><span>{reports.length} documentos</span></div>
        <div className="module-table-wrap"><div className="report-table"><div className="module-table-head"><span>Informe</span><span>Periodo</span><span>Generado</span><span>Formato</span><span>Responsable</span><span>Datos</span></div>{reports.map((report) => <div className="module-table-row" key={report.id}><span className="report-name-cell"><b><FileReport size={16} /></b><span><strong>{report.name}</strong><small>{report.id}</small></span></span><span>{report.period}</span><span>{report.created}</span><span><i className="report-format">{report.format}</i></span><span>{report.owner}</span><span>{cam5.demo ? <button className="ghost-button" onClick={() => downloadReportData(report.name)}><Download size={14} /> Descargar datos</button> : <button className={`ghost-button ${report.status !== "ready" ? "muted-state" : ""}`} title={report.error ?? undefined} onClick={() => downloadReport(report)} disabled={report.status === "pending"}><Download size={14} /> {statusLabel(report.status)}</button>}</span></div>)}</div></div>
      </article>
    </>
  );
}
