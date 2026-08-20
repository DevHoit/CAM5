"use client";

import { IconShieldCheck as ShieldCheck } from "@tabler/icons-react";

export function PermissionState({ area }: { area: string }) {
  return <section className="panel permission-state"><span><ShieldCheck size={26} /></span><div><span className="eyebrow">Acceso restringido</span><h2>Tu rol no puede administrar {area}</h2><p>Puedes consultar los módulos de supervisión. Un administrador debe realizar cambios en esta sección.</p></div></section>;
}
