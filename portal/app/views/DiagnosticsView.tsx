"use client";

import { useState } from "react";
import { IconActivity as Activity, IconCircleCheck as CheckCircle2, IconChevronRight as ChevronRight, IconCircuitCell as CircuitBoard, IconRadio as Radio, IconRefresh as Refresh, IconServer as Server, IconShieldCheck as ShieldCheck, IconBolt as Zap } from "@tabler/icons-react";
import { StatusPill } from "../components/StatusPill";
import { useCam5Data } from "../lib/cam5-data";
import { formatAge } from "../lib/use-cam5";
import { useFeedback } from "../lib/contexts";

export function DiagnosticsView() {
  const notify = useFeedback();
  const cam5 = useCam5Data();
  const [diagnosticState, setDiagnosticState] = useState<"idle" | "running" | "success">("idle");
  const [lastRun, setLastRun] = useState("No ejecutado en esta sesión");

  const data = cam5.diagnostics.data;
  const gateway = data?.gateways?.[0];
  const unit = data?.units?.find((u: any) => u.id === cam5.unitId) ?? data?.units?.[0];
  const ingest = data?.ingest24h;

  const contactAge = gateway?.seconds_since_contact != null ? Math.round(Number(gateway.seconds_since_contact)) : null;
  const linkUp = contactAge !== null && contactAge < 120;

  // Éxito de lectura de las últimas 24 h, calculado sobre lo que reportó el gateway.
  const ok = Number(unit?.reads_ok_24h ?? 0);
  const failed = Number(unit?.reads_failed_24h ?? 0);
  const successRate = ok + failed > 0 ? ((ok / (ok + failed)) * 100).toFixed(2) : null;

  type Transaction = { time: string; request: string; range: string; result: string; latency: string };
  const transactions: Transaction[] = cam5.demo
    ? [
        { time: "11:52:08", request: "FC 03", range: "40001–40005", result: "5 registros", latency: "42 ms" },
        { time: "11:52:06", request: "FC 03", range: "40121–40122", result: "2 registros", latency: "38 ms" },
        { time: "11:52:04", request: "FC 03", range: "40201", result: "1 registro", latency: "31 ms" },
      ]
    : (data?.units ?? []).slice(0, 6).map((u: any) => ({
        time: u.last_seen_at ? new Date(u.last_seen_at).toISOString().slice(11, 19) : "—",
        request: u.transport === "modbus-rtu" ? "RTU" : "TCP",
        range: u.endpoint ?? "—",
        result: `${u.channels_good ?? 0} / ${u.channels_configured ?? 0} canales`,
        latency: u.poll_latency_ms != null ? `${u.poll_latency_ms} ms` : "—",
      }));

  const runDiagnostic = () => {
    setDiagnosticState("running");
    setLastRun("Comprobación en curso…");
    if (cam5.demo) {
      window.setTimeout(() => {
        setDiagnosticState("success");
        setLastRun("Ahora · 4 de 4 etapas correctas");
        notify("Diagnóstico completado: 4 de 4 etapas correctas.");
      }, 1200);
      return;
    }
    // Fuera de demostración el diagnóstico consulta el estado real del enlace.
    cam5.refetchAll();
    window.setTimeout(() => {
      const stages = [linkUp, Boolean(unit?.online), Boolean(gateway), Number(ingest?.readings ?? 0) > 0];
      const passed = stages.filter(Boolean).length;
      setDiagnosticState(passed === 4 ? "success" : "idle");
      setLastRun(`Ahora · ${passed} de 4 etapas correctas`);
      notify(passed === 4
        ? "Diagnóstico completado: 4 de 4 etapas correctas."
        : `Diagnóstico con hallazgos: ${passed} de 4 etapas correctas.`, passed === 4 ? "success" : "warning");
    }, 600);
  };

  const stateClass = diagnosticState === "running" ? "testing" : diagnosticState === "success" ? "passed" : "ready";
  const chainLabel = (live: string, demo: string) => (cam5.demo ? demo : live);

  return (
    <>
      <section className="module-summary-grid diagnostic-summary-grid">
        <article><span className={`module-summary-icon ${cam5.demo || linkUp ? "green" : "amber"}`}><Radio size={19} /></span><div><small>Cadena OT</small><strong>{cam5.demo ? "Operativa" : linkUp ? "Operativa" : "Sin contacto"}</strong><span>{cam5.demo ? "Controlador + gateway + CORE" : contactAge === null ? "El gateway nunca se ha comunicado" : `Último contacto hace ${formatAge(contactAge)}`}</span></div></article>
        <article><span className="module-summary-icon blue"><Refresh size={19} /></span><div><small>Ciclo de sondeo</small><strong>{cam5.demo ? "2.0 s" : unit?.poll_cycle_ms != null ? `${(Number(unit.poll_cycle_ms) / 1000).toFixed(1)} s` : "—"}</strong><span>{cam5.demo ? "8 registros por ciclo" : `${unit?.channels_configured ?? 0} canales por ciclo`}</span></div></article>
        <article><span className={`module-summary-icon ${cam5.demo || Number(unit?.modbus_exceptions_24h ?? 0) === 0 ? "green" : "amber"}`}><CheckCircle2 size={19} /></span><div><small>Éxito últimas 24 h</small><strong>{cam5.demo ? "99.98%" : successRate ? `${successRate}%` : "—"}</strong><span>{cam5.demo ? "0 excepciones Modbus" : `${unit?.modbus_exceptions_24h ?? 0} excepciones Modbus`}</span></div></article>
      </section>

      <article className="panel module-panel diagnostics-module">
        <div className="diagnostics-toolbar"><div><span className="eyebrow">Puesta en marcha</span><h2>Comprobación de extremo a extremo</h2><p>Verifica cada etapa de la adquisición antes de habilitar datos reales.</p></div><button className={`diagnostic-run-button ${diagnosticState}`} onClick={runDiagnostic} disabled={diagnosticState === "running"}>{diagnosticState === "running" ? <><Refresh size={16} /> Comprobando…</> : diagnosticState === "success" ? <><CheckCircle2 size={16} /> Repetir diagnóstico</> : <><Activity size={16} /> Ejecutar diagnóstico</>}</button></div>

        <div className={`diagnostic-chain ${stateClass}`} aria-live="polite">
          <article><span><CircuitBoard size={21} /></span><small>Etapa 01</small><strong>{chainLabel(unit?.id ?? "Sin unidad", "CAM5-CTRL-01")}</strong><p>{chainLabel(unit?.endpoint ?? "—", "192.168.10.42:502")}</p><i>{diagnosticState === "running" ? "Probando" : cam5.demo || unit?.online ? "Disponible" : "Sin respuesta"}</i></article>
          <b><ChevronRight size={19} /></b>
          <article><span><Radio size={21} /></span><small>Etapa 02</small><strong>{chainLabel(unit?.transport === "modbus-rtu" ? "Modbus RTU" : "Modbus TCP", "Modbus TCP")}</strong><p>{chainLabel(`Unit ID ${unit?.unit_address ?? "—"}`, "FC 03 · Unit ID 1")}</p><i>{diagnosticState === "running" ? "Leyendo" : cam5.demo ? "8/8 registros" : `${unit?.channels_good ?? 0}/${unit?.channels_configured ?? 0} canales`}</i></article>
          <b><ChevronRight size={19} /></b>
          <article><span><Server size={21} /></span><small>Etapa 03</small><strong>{chainLabel(gateway?.id ?? "Sin gateway", "CAM5-GW-01")}</strong><p>{chainLabel(gateway?.spool_depth ? `${gateway.spool_depth} lotes en cola` : "Cola vacía", "LAN 192.168.10.40")}</p><i>{diagnosticState === "running" ? "Enviando" : cam5.demo || linkUp ? "En línea" : "Sin contacto"}</i></article>
          <b><ChevronRight size={19} /></b>
          <article><span><Zap size={21} /></span><small>Etapa 04</small><strong>CAM5 CORE</strong><p>Ingesta y reglas</p><i>{diagnosticState === "running" ? "Validando" : cam5.demo ? "Actualizado hace 2 s" : cam5.modeDetail}</i></article>
        </div>

        <div className="diagnostics-result-bar"><span className={stateClass}>{diagnosticState === "running" ? <Refresh size={16} /> : <CheckCircle2 size={16} />}</span><div><strong>{diagnosticState === "running" ? "Comprobando la cadena OT" : diagnosticState === "success" ? "Diagnóstico completado sin hallazgos" : "Cadena preparada para comprobar"}</strong><p>{lastRun}</p></div><small>Tiempo objetivo ≤ 3 s</small></div>

        <div className="diagnostics-grid">
          <section className="diagnostic-health-card">
            <div className="report-library-head"><div><span className="eyebrow">Salud de comunicación</span><h2>Indicadores actuales</h2></div><StatusPill state={cam5.demo || linkUp ? "online" : "critical"}>{cam5.demo || linkUp ? "En línea" : "Sin contacto"}</StatusPill></div>
            <dl>
              <div><dt>Latencia controlador</dt><dd>{cam5.demo ? "42 ms" : unit?.poll_latency_ms != null ? `${unit.poll_latency_ms} ms` : "—"} <small>{cam5.demo || Number(unit?.poll_latency_ms ?? 0) < 200 ? "Normal" : "Elevada"}</small></dd></div>
              <div><dt>Atraso de ingesta</dt><dd>{cam5.demo ? "86 ms" : ingest ? `${Math.round(Number(ingest.avg_lag_ms))} ms` : "—"} <small>{cam5.demo ? "Normal" : `máx ${ingest ? Math.round(Number(ingest.max_lag_ms)) : 0} ms`}</small></dd></div>
              <div><dt>Última respuesta válida</dt><dd>{cam5.demo ? "Hace 2 s" : contactAge !== null ? `Hace ${formatAge(contactAge)}` : "—"} <small>{cam5.demo ? "FC 03" : `seq ${gateway?.last_seq ?? "—"}`}</small></dd></div>
              <div><dt>Reintentos / 24 h</dt><dd>{cam5.demo ? "2" : failed} <small>{cam5.demo ? "0.01%" : successRate ? `${(100 - Number(successRate)).toFixed(2)}%` : "—"}</small></dd></div>
              <div><dt>Excepciones Modbus</dt><dd>{cam5.demo ? "0" : (unit?.modbus_exceptions_24h ?? 0)} <small>{cam5.demo || Number(unit?.modbus_exceptions_24h ?? 0) === 0 ? "Sin errores" : "Revisar enlace"}</small></dd></div>
              <div><dt>Calidad de datos</dt><dd>{cam5.demo ? "8 / 8" : `${unit?.channels_good ?? 0} / ${unit?.channels_configured ?? 0}`} <small>Válidos</small></dd></div>
              <div><dt>Reloj del gateway</dt><dd>{cam5.demo ? "NTP" : (gateway?.clock_sync ?? "—")} <small>{cam5.demo || gateway?.clock_sync === "ntp" ? "Sincronizado" : "Sin sincronía"}</small></dd></div>
              <div><dt>Cola pendiente</dt><dd>{cam5.demo ? "0" : (gateway?.spool_depth ?? 0)} <small>lotes sin confirmar</small></dd></div>
            </dl>
          </section>

          <section className="diagnostic-transactions">
            <div className="report-library-head"><div><span className="eyebrow">{cam5.demo ? "Tráfico reciente" : "Unidades sondeadas"}</span><h2>{cam5.demo ? "Últimas lecturas Modbus" : "Estado por unidad"}</h2></div><span>{cam5.demo ? "FC 03" : `${data?.units?.length ?? 0} unidades`}</span></div>
            <div className="module-table-wrap">
              <div className="diagnostic-transaction-table">
                <div className="module-table-head"><span>{cam5.demo ? "Hora" : "Visto"}</span><span>{cam5.demo ? "Solicitud" : "Enlace"}</span><span>{cam5.demo ? "Rango" : "Destino"}</span><span>Resultado</span><span>Tiempo</span></div>
                {transactions.map((transaction, index) => <div className="module-table-row" key={`${transaction.time}-${transaction.range}-${index}`}><span className="mono-cell">{transaction.time}</span><span className="mono-cell">{transaction.request}</span><span className="mono-cell">{transaction.range}</span><span className="quality-ok"><CheckCircle2 size={14} /> {transaction.result}</span><span className="mono-cell">{transaction.latency}</span></div>)}
              </div>
            </div>
          </section>
        </div>

        <div className="configuration-note diagnostics-note"><ShieldCheck size={17} /><p>{cam5.demo
          ? <><strong>Modo de simulación activo.</strong> Al incorporar el servicio de adquisición, esta vista consumirá las respuestas reales del gateway y las excepciones Modbus del controlador.</>
          : <><strong>Datos en vivo desde CAM5 CORE.</strong> Las cifras provienen del latido de estado que envía el gateway y del registro de ingesta de las últimas 24 horas ({ingest?.batches ?? 0} lotes, {ingest?.readings ?? 0} lecturas).</>}</p></div>
      </article>
    </>
  );
}
