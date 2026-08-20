"use client";

import { useState } from "react";
import { IconMail as Mail, IconShieldCheck as ShieldCheck, IconUserPlus as UserPlus, IconUsers as Users } from "@tabler/icons-react";
import { usePersistentState } from "../use-persistent-state";
import { PermissionState } from "../components/PermissionState";
import { TableEmptyState } from "../components/TableEmptyState";
import { useActiveRole, useConfirm, useFeedback } from "../lib/contexts";
import { useCam5Data } from "../lib/cam5-data";
import { useUsers } from "../lib/use-cam5";
import { cam5Api, type ApiUser } from "../lib/api";
import type { UserRole } from "../lib/types";

type Row = { id: string; name: string; email: string; role: UserRole; status: "Activo" | "Suspendido" | "Invitado"; lastAccess: string };

const ROLE_TO_API: Record<UserRole, string> = {
  "Administrador": "admin", "Ingeniero": "engineer", "Operador": "operator", "Solo lectura": "viewer",
};
const ROLE_FROM_API: Record<string, UserRole> = {
  admin: "Administrador", engineer: "Ingeniero", operator: "Operador", viewer: "Solo lectura",
};

function relative(iso: string | null) {
  if (!iso) return "Sin acceso";
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "Ahora";
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.round(seconds / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

const toRow = (user: ApiUser): Row => ({
  id: user.id,
  name: user.full_name,
  email: user.email,
  role: ROLE_FROM_API[user.role] ?? "Solo lectura",
  status: user.status === "suspended" ? "Suspendido" : "Activo",
  lastAccess: relative(user.last_login),
});

export function UsersView() {
  const notify = useFeedback();
  const confirm = useConfirm();
  const currentRole = useActiveRole();
  const cam5 = useCam5Data();
  const remote = useUsers();

  const [demoUsers, setDemoUsers] = usePersistentState<Row[]>("cam5.front.users", [
    { id: "1", name: "Emerson Allende", email: "emerson@cam5.local", role: "Administrador", status: "Activo", lastAccess: "Ahora" },
    { id: "2", name: "Paula Rojas", email: "paula.rojas@cam5.local", role: "Ingeniero", status: "Activo", lastAccess: "Hace 18 min" },
    { id: "3", name: "Felipe Soto", email: "felipe.soto@cam5.local", role: "Operador", status: "Activo", lastAccess: "Hace 2 h" },
    { id: "4", name: "Camila Díaz", email: "camila.diaz@cam5.local", role: "Solo lectura", status: "Invitado", lastAccess: "Pendiente" },
  ]);

  const users: Row[] = cam5.demo ? demoUsers : (remote.data ?? []).map(toRow);

  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("Operador");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const nameFromEmail = (value: string) =>
    value.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  const inviteUser = (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    const address = email.trim().toLowerCase();
    if (!address) return;
    if (users.some((user) => user.email.toLowerCase() === address)) {
      notify("Ese correo ya pertenece a un usuario registrado.", "warning");
      return;
    }
    if (cam5.demo) {
      setDemoUsers((current) => [...current, { id: String(Date.now()), name: fullName.trim() || nameFromEmail(address), email: address, role, status: "Invitado", lastAccess: "Pendiente" }]);
      notify(`Invitación preparada para ${address}.`);
      setEmail(""); setFullName(""); setShowInvite(false);
      return;
    }
    cam5Api.createUser({ email: address, fullName: fullName.trim() || nameFromEmail(address), role: ROLE_TO_API[role] })
      .then(() => { remote.refetch(); notify(`Usuario ${address} creado.`); setEmail(""); setFullName(""); setShowInvite(false); })
      // El servidor devuelve fieldErrors; se muestran junto al campo en vez de
      // un aviso genérico que obliga a adivinar qué estaba mal.
      .catch((error) => { setFieldErrors(error.fieldErrors ?? {}); notify(error.message ?? "No se pudo crear el usuario.", "warning"); });
  };

  const updateRole = (id: string, nextRole: UserRole) => {
    if (cam5.demo) { setDemoUsers((current) => current.map((user) => user.id === id ? { ...user, role: nextRole } : user)); return; }
    cam5Api.updateUser(id, { role: ROLE_TO_API[nextRole] })
      .then(() => { remote.refetch(); notify(`Rol actualizado a ${nextRole}.`, "info"); })
      .catch((error) => { remote.refetch(); notify(error.message ?? "No se pudo cambiar el rol.", "warning"); });
  };

  const toggleUser = (id: string) => {
    const user = users.find((item) => item.id === id);
    if (!user) return;
    const suspending = user.status === "Activo";
    const apply = () => {
      if (cam5.demo) {
        setDemoUsers((current) => current.map((item) => item.id === id ? { ...item, status: suspending ? "Suspendido" : "Activo" } : item));
        notify(`${user.name} ${suspending ? "suspendido" : "activado"}.`, suspending ? "warning" : "success");
        return;
      }
      cam5Api.updateUser(id, { status: suspending ? "suspended" : "active" })
        .then(() => { remote.refetch(); notify(`${user.name} ${suspending ? "suspendido" : "activado"}.`, suspending ? "warning" : "success"); })
        .catch((error) => notify(error.message ?? "No se pudo cambiar el estado.", "warning"));
    };
    if (suspending) {
      confirm({ title: `Suspender a ${user.name}`, detail: "El usuario perderá acceso operativo hasta que un administrador vuelva a activarlo.", confirmLabel: "Suspender usuario", tone: "danger", onConfirm: apply });
    } else apply();
  };

  if (currentRole !== "Administrador") return <PermissionState area="usuarios y roles" />;

  return (
    <>
      <section className="module-summary-grid user-summary-grid"><article><span className="module-summary-icon blue"><Users size={19} /></span><div><small>Usuarios registrados</small><strong>{users.length}</strong><span>{users.filter((user) => user.status === "Activo").length} activos</span></div></article><article><span className="module-summary-icon green"><ShieldCheck size={19} /></span><div><small>Administradores</small><strong>{users.filter((user) => user.role === "Administrador").length}</strong><span>Acceso total</span></div></article><article><span className="module-summary-icon amber"><Mail size={19} /></span><div><small>{cam5.demo ? "Invitaciones pendientes" : "Suspendidos"}</small><strong>{cam5.demo ? users.filter((user) => user.status === "Invitado").length : users.filter((user) => user.status === "Suspendido").length}</strong><span>{cam5.demo ? "Sin primer acceso" : "Sin acceso operativo"}</span></div></article></section>
      <article className="panel module-panel users-module">
        <div className="module-toolbar"><div><span className="eyebrow">Control de acceso</span><h2>Equipo con acceso al portal</h2></div><button className="primary-button" onClick={() => setShowInvite((current) => !current)}><UserPlus size={16} />{showInvite ? "Cancelar" : "Invitar usuario"}</button></div>
        {showInvite && <form className="invite-form" onSubmit={inviteUser}><label><span>Correo electrónico</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.cl" aria-invalid={Boolean(fieldErrors.email)} />{fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}</label><label><span>Nombre completo</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Se deduce del correo si lo dejas vacío" aria-invalid={Boolean(fieldErrors.fullName)} />{fieldErrors.fullName && <small className="field-error">{fieldErrors.fullName}</small>}</label><label><span>Rol inicial</span><select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{["Administrador", "Ingeniero", "Operador", "Solo lectura"].map((item) => <option key={item}>{item}</option>)}</select></label><button type="submit"><Mail size={15} /> {cam5.demo ? "Enviar invitación" : "Crear usuario"}</button></form>}
        <div className="module-table-wrap"><div className="users-table"><div className="module-table-head"><span>Usuario</span><span>Rol</span><span>Estado</span><span>Último acceso</span><span>Acción</span></div>{users.length === 0 ? <TableEmptyState title="Sin usuarios" detail="Aún no hay cuentas registradas en el sistema." /> : users.map((user) => <div className="module-table-row" key={user.id}><span className="user-identity"><b>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</b><span><strong>{user.name}</strong><small>{user.email}</small></span></span><span><select value={user.role} onChange={(event) => updateRole(user.id, event.target.value as UserRole)}>{["Administrador", "Ingeniero", "Operador", "Solo lectura"].map((item) => <option key={item}>{item}</option>)}</select></span><span><i className={`user-status status-${user.status.toLowerCase()}`}>{user.status}</i></span><span>{user.lastAccess}</span><span><button className="ghost-button" onClick={() => toggleUser(user.id)}>{user.status === "Activo" ? "Suspender" : "Activar"}</button></span></div>)}</div></div>
        <div className="role-matrix"><div><span className="eyebrow">Matriz de permisos</span><h3>Alcance de cada rol</h3></div><div className="role-matrix-grid"><span><strong>Administrador</strong><small>Configuración, usuarios y operación completa</small></span><span><strong>Ingeniero</strong><small>Diagnóstico, umbrales y reportes</small></span><span><strong>Operador</strong><small>Supervisión y reconocimiento de alarmas</small></span><span><strong>Solo lectura</strong><small>Consulta sin capacidad de modificación</small></span></div></div>
      </article>
    </>
  );
}
