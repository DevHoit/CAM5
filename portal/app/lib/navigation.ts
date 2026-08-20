import { IconBellRinging as BellRing, IconCircuitCell as CircuitBoard, IconDatabase as Database, IconBuildingFactory2 as Factory, IconFileReport as FileReport, IconHistory as History, IconLayoutDashboard as LayoutDashboard, IconMail as Mail, IconPlugConnected as PlugConnected, IconRadio as Radio, IconSettings as Settings, IconTool as Tool, IconUsers as Users } from "@tabler/icons-react";
import type { View } from "./types";

export const navGroups = [
  {
    index: "01",
    label: "Supervisión",
    items: [
      { id: "overview" as View, label: "Resumen operativo", description: "Condición general", icon: LayoutDashboard },
      { id: "cabinet" as View, label: "Mapa de condición", description: "Sensores y cabina", icon: CircuitBoard },
    ],
  },
  {
    index: "02",
    label: "Diagnóstico",
    items: [
      { id: "diagnostics" as View, label: "Diagnóstico OT", description: "Controlador y gateway", icon: Radio },
      { id: "trends" as View, label: "Tendencias", description: "Evolución por canal", icon: History },
      { id: "alarms" as View, label: "Centro de alertas", description: "Triage y seguimiento", icon: BellRing, badge: "3" },
      { id: "history" as View, label: "Histórico", description: "Mediciones y trazabilidad", icon: Database },
    ],
  },
  {
    index: "03",
    label: "Gestión",
    items: [
      { id: "assets" as View, label: "Activos y ubicaciones", description: "Jerarquía y cobertura", icon: Factory },
      { id: "reports" as View, label: "Reportes", description: "Informes y programación", icon: FileReport },
      { id: "maintenance" as View, label: "Mantenimiento", description: "Planes y órdenes", icon: Tool },
    ],
  },
  {
    index: "04",
    label: "Administración",
    items: [
      { id: "settings" as View, label: "Configuración", description: "Activo, Modbus y gateway", icon: Settings },
      { id: "integrations" as View, label: "Integraciones", description: "Datos y sistemas externos", icon: PlugConnected },
      { id: "users" as View, label: "Usuarios y roles", description: "Acceso y permisos", icon: Users },
      { id: "notifications" as View, label: "Notificaciones", description: "Canales y escalamiento", icon: Mail },
    ],
  },
];

export const viewTitles: Record<View, { title: string; description: string }> = {
  overview: { title: "Resumen de condición", description: "Estado predictivo de activos críticos en tiempo real." },
  cabinet: { title: "Mapa de condición", description: "Ubicación, lectura y estado de cada canal instrumentado." },
  diagnostics: { title: "Diagnóstico OT", description: "Puesta en marcha y comprobación de la cadena Controlador → Gateway → CORE." },
  trends: { title: "Tendencias", description: "Evolución térmica, descarga parcial y humedad ambiental." },
  alarms: { title: "Centro de alertas", description: "Triage operativo, reconocimiento y trazabilidad de eventos." },
  history: { title: "Histórico", description: "Mediciones, alarmas y cambios administrativos en una sola trazabilidad." },
  assets: { title: "Activos y ubicaciones", description: "Inventario técnico, jerarquía operacional y cobertura de instrumentación." },
  reports: { title: "Reportes", description: "Informes de condición, eventos y cumplimiento para operación y mantenimiento." },
  maintenance: { title: "Mantenimiento", description: "Plan preventivo y órdenes de trabajo priorizadas por condición." },
  settings: { title: "Configuración", description: "Parámetros del activo, canales de adquisición y comunicaciones." },
  integrations: { title: "Integraciones", description: "Conexiones, flujo de datos y acceso seguro para sistemas externos." },
  users: { title: "Usuarios y roles", description: "Control de acceso y permisos para la operación OT." },
  notifications: { title: "Notificaciones", description: "Canales de entrega, reglas de escalamiento y trazabilidad." },
};
