# CAM5 CORE — Plan de implementación paso a paso

**Versión:** 1.0 · **Fecha:** 19 de agosto de 2026
**Punto de partida:** frontend completo en prototipo (13 vistas, `localStorage`, sin `fetch`), gateway por construir, backend inexistente.
**Alcance acordado:** capacidad completa del CAM™-5 (12 SAW + 4 PD + 8 humedad + 6 relés, hasta 9 lectores IRM por unidad).

> **Actualización — 19 ago 2026.** Decidido: la autonomía sin internet vive en el
> **gateway** (spool de 24–72 h con reinyección al reconectar), no en un servidor
> en la subestación. Con eso, el backend puede alojarse en la nube. Las fases
> **F1 y F2 ya están implementadas y probadas** — ver el proyecto `cam5-core/`.
> El mapa Modbus sigue pendiente, pero ya no bloquea: la lectura del CAM-5 la
> resuelve el equipo de gateway por separado, y el backend acepta datos hoy.

---

## Resumen del camino

```
F0 Cierre de incógnitas      ─┐
F1 Modelo de datos y contrato ├─ fundaciones (no negociables)
F2 Backend de ingesta        ─┘
F3 Gateway en C              ─┐
F4 Refactor del front         ├─ pueden ir en paralelo
F5 Conexión front ↔ API      ─┘
F6 Motor de alarmas en servidor
F7 Gestión: OT, usuarios, reportes, notificaciones
F8 Endurecimiento y aceptación
```

Las fases F3 y F4 son independientes entre sí y pueden correr en paralelo si hay dos personas. Todo lo demás es secuencial.

---

## Fase 0 — Cierre de incógnitas

*Nada de código. Es la fase que más riesgo elimina por hora invertida.*

| # | Tarea | Entregable | Bloquea a |
|---|---|---|---|
| 0.1 | Obtener el **manual Modbus del CAM-5** de Altanova/IntelliSAW | Documento con mapa de registros | F3 completo |
| 0.2 | Inventario real de la instalación: cuántas unidades CAM-5, cuántos lectores IRM, cuántos sensores por tipo y su ubicación física | Planilla de canales | F1 |
| 0.3 | Decidir **backend y base de datos** (§ *Decisión pendiente* más abajo) | Decisión escrita | F2 |
| 0.4 | Red: IPs del CAM-5 y del gateway, VLAN OT vs gestión, reglas de firewall, NTP disponible | Diagrama de red | F3 |
| 0.5 | Confirmar velocidad del bus RS485 multiunidad (subir de 9600 a **38400 baud** si hay >3 lectores) | Configuración aplicada en el CAM-5 | F3 |
| 0.6 | Definir política de retención y respaldo (cuánto histórico crudo, cuánto agregado) | Decisión escrita | F2 |
| 0.7 | Conseguir un **simulador Modbus** (`diagslave`, `modpoll`) para desarrollar sin el equipo físico | Entorno de pruebas | F3 |

**Criterio de salida:** existe una planilla de canales con nombre, tipo, unidad, registro y ubicación para cada punto real de la instalación, y el equipo sabe dónde vivirá la base de datos.

> Si 0.1 se retrasa, **no detengas F3**. El gateway está diseñado para leer un perfil de registros declarativo (`CAM5_GATEWAY_SPEC.md` §4.1): se desarrolla contra el simulador con direcciones ficticias y se cambia un JSON cuando llegue el manual.

---

## Fase 1 — Modelo de datos y contrato

Todo el resto del proyecto depende de que esto quede bien la primera vez.

**1.1 Esquema de base de datos**

```sql
site        (id, nombre, zona_horaria)
asset       (id, site_id, nombre, descripcion, tension_kv, ubicacion)
gateway     (id, site_id, nombre, clave_api_hash, ultimo_contacto, config_version)
unit        (id, asset_id, gateway_id, tipo['cam5'|'irm'], parent_unit_id, modelo, firmware, endpoint, unit_address)
channel     (id, unit_id, codigo, tipo, etiqueta, zona, uom, habilitado,
             umbral_preventivo, umbral_critico, histeresis, retardo_s, deadband,
             registro, tipo_dato, escala, byte_order)
reading     (channel_id, metric, ts, valor, quality, seq)   -- hipertabla
alarm       (id, asset_id, channel_id, tipo, severidad, estado, abierta_en, reconocida_en, cerrada_en, ...)
work_order  (id, alarm_id, titulo, prioridad, estado, asignado_a, vence_en)
audit_log   (id, ts, usuario_id, accion, objetivo, valor_anterior, valor_nuevo, origen)
user, role, api_key, report, notification_channel, notification_log
```

Puntos que suelen olvidarse y aquí no se pueden olvidar:

- `unit.parent_unit_id` es lo que permite modelar los 9 lectores IRM colgando de un CAM-5 **sin migración futura**.
- `reading` lleva `metric` además de `channel_id`: un canal PD produce 7 series distintas (`q_peak`, `sd_max`, `pd_max`, `noise_floor`, `snr`, `trend_alpha`, `trend_beta`, `trend_phi`).
- `audit_log` con valor anterior y nuevo es requisito explícito de `DATA_CONTRACTS.md`.
- Índice principal de `reading`: `(channel_id, metric, ts DESC)`.

**1.2 Ampliar `openapi.yaml`**

El contrato actual tiene 14 endpoints y cubre bien el portal. Faltan:

- `POST /ingest/telemetry`, `/ingest/status`, `/ingest/events`
- `GET /gateway/config`
- `GET/PUT /assets/{id}/modbus-map` (mencionado en `BACKEND_INTEGRATION.md` pero ausente del YAML)
- `GET /units`, `GET /units/{id}/channels` (jerarquía CAM-5 + IRM)
- `GET /audit`, `/users`, `/notification-channels`, `/api-keys`

**1.3 Alinear `app/cam5-api.ts`**

Hoy cubre ~10 de los 14 endpoints existentes. Debe cubrir el 100 % del YAML ampliado y ser el **único** lugar donde se construyen URLs.

**Criterio de salida:** el `openapi.yaml` valida con un linter, el esquema SQL está migrado en un entorno de desarrollo, y `cam5-api.ts` tiene una función por operación (aunque devuelvan datos simulados todavía).

---

## Fase 2 — Backend de ingesta

**2.1** Endpoint `GET /health` y `GET /session` con autenticación real.
**2.2** `POST /ingest/telemetry` con validación de esquema, verificación HMAC, idempotencia por `Idempotency-Key` (memoria de 24 h) y escritura por lotes.
**2.3** `POST /ingest/status` y `/ingest/events`.
**2.4** `GET /gateway/config` que sirve el perfil de registros y devuelve `configVersion`.
**2.5** Lecturas hacia el portal: `/assets/{id}/readings/latest`, `/assets/{id}/trends`.
**2.6** Agregados continuos por minuto, hora y día (las tendencias de 30 días no deben leer datos crudos).

**Criterio de salida:** `curl` con un JSON de ejemplo del spec inserta datos, y `GET /assets/mcc-01/readings/latest` los devuelve. Reenviar el mismo lote no duplica filas.

---

## Fase 3 — Gateway en C

Detalle completo en `CAM5_GATEWAY_SPEC.md`. Orden de construcción:

1. **Poller Modbus** contra `diagslave`, leyendo el perfil declarativo. Sin red hacia CORE todavía: imprime a `stdout`.
2. **Decodificación y calidad**: tipos, escala, byte order, bloque de estado → `good/stale/bad/disabled`. Nunca `0` ante un fallo.
3. **Deadband y lotes** (report-by-exception + latido).
4. **Spool SQLite** con reintentos y backoff.
5. **Sender HTTPS** con `libcurl`, gzip, HMAC e idempotencia.
6. **Pull de configuración** y aplicación en caliente.
7. **Systemd** con `Restart=always` y watchdog.
8. **Pruebas de corte**: desconectar el cable de red 4 h y verificar cero pérdida.

**Criterio de salida:** la lista de aceptación del §6 del spec del gateway pasa completa contra el simulador, y después contra el equipo real.

---

## Fase 4 — Refactor del frontend

*Puede correr en paralelo con F3. Es prerrequisito de F5.*

`app/page.tsx` tiene **1.206 líneas** con 13 vistas, y `app/globals.css` pesa **131 KB**. Conectarlo a una API en ese estado es doloroso y hace los conflictos de merge inevitables.

```
app/
  layout.tsx
  page.tsx                    → solo el shell y el router
  lib/  cam5-api.ts, types.ts, use-channels.ts, use-alarms.ts, format.ts
  components/  StatusPill, MetricCard, CabinetDiagram, TableEmptyState, Confirm, Notice
  views/  Overview, Cabinet, Diagnostics, Trends, Alarms, History,
          Assets, Reports, Maintenance, Settings, Integrations, Users, Notifications
  styles/  (dividir globals.css por módulo)
```

Dos cambios de fondo, no solo de organización:

- **Canales dinámicos.** El arreglo `sensors` está fijo con 8 elementos y el SVG de la cabina tiene marcadores en posiciones fijas. Con capacidad completa hay hasta 71 series por unidad y hasta 10 unidades: el mapa de condición debe renderizarse desde datos, con coordenadas guardadas por canal.
- **Selector de unidad.** La UI dice "Piloto monositio" y asume un solo activo. Hace falta un árbol Sitio → Activo → Unidad (CAM-5) → Lector (IRM) → Canal.

Aprovecha para introducir un cliente de datos (TanStack Query o similar): reintento, caché y estados de carga salen gratis y el modo "Actualizando / Atrasada / Sin conexión" que ya está simulado pasa a ser real.

**Criterio de salida:** cada vista es un archivo propio, `npm run build` y `npm test` pasan, y el comportamiento visible es idéntico al de hoy.

---

## Fase 5 — Conexión front ↔ API

Sigue el orden ya definido en `BACKEND_INTEGRATION.md`, un módulo por vez, borrando su clave `cam5.front.*` al terminar:

| Orden | Módulo | Clave a eliminar |
|---|---|---|
| 1 | Sesión y rol efectivo | `cam5.front.active-role` |
| 2 | Activo, gateway, unidades y canales | `cam5.front.asset-config`, `channel-config` |
| 3 | Mapa Modbus | `cam5.front.register-map` |
| 4 | Lectura actual y calidad | — |
| 5 | Tendencias e histórico paginado | — |
| 6 | Alarmas | `cam5.front.acknowledged`, `closed-alarms`, `alarm-*` |
| 7 | Órdenes de trabajo | `cam5.front.work-orders` |
| 8 | Usuarios, notificaciones, reportes, claves API | `cam5.front.users`, `notification-*`, `reports`, `api-keys` |

`cam5.front.system-mode` se conserva **solo** como herramienta de demostración, o se elimina si el estado real ya cubre los cuatro modos.

**Criterio de salida:** `grep -r "cam5.front" app/` no devuelve nada fuera del modo demo.

---

## Fase 6 — Motor de alarmas en el servidor

Hoy los umbrales se evalúan en el navegador (`useSensorData`). Eso significa que **una alarma solo existe si alguien tiene el portal abierto** — inaceptable en monitoreo de condición.

- Evaluación en CORE en el momento de la ingesta: umbral preventivo, crítico, histéresis y retardo por canal.
- Reglas compuestas que el prototipo ya insinúa: diferencial térmico entre fases L1/L2/L3, aceleración Φ de descarga parcial, humedad sostenida sobre umbral.
- Ciclo de vida `open → acknowledged → closed`, con `closed → open` permitido y auditado.
- Cierre exige nota (ya validado en la UI) y genera entrada de auditoría.
- Una alarma admite **como máximo una orden de trabajo activa**.

**Criterio de salida:** con el portal cerrado, superar un umbral genera una alarma y dispara la notificación configurada.

---

## Fase 7 — Gestión

Órdenes de trabajo, usuarios y roles (aplicados **también en el servidor**, no solo en la UI), notificaciones con registro de intento/entrega/error, y reportes con generación asíncrona (`pending → ready → failed`) más URL de descarga firmada y temporal.

---

## Fase 8 — Endurecimiento y aceptación

- Retención y agregación automática; respaldos probados con una **restauración real**, no solo un dump.
- Auditoría completa de cambios de configuración.
- Pruebas de carga con las 710 series a ritmo nominal.
- Prueba de corte del enlace y de reinicio del gateway.
- Recorrer la **lista de aceptación** de `DELIVERY_CHECKLIST.md` punto por punto.

---

## Decisión de backend — resuelta

### El dato que la definió

La autonomía sin internet queda **en el gateway**: almacena en disco y reinyecta
al reconectar, con los timestamps originales. Eso libera al backend de tener que
correr on-premise y descarta la necesidad de un servidor en la subestación.

La contrapartida hay que asumirla con los ojos abiertos: **durante el corte no
hay evaluación de alarmas ni notificaciones en CORE**. La red de seguridad en ese
lapso son los 6 relés de alarma del propio CAM-5 y su HMI local de 5", que operan
de forma independiente del portal. Si en algún momento se necesita que también el
portal y las alarmas sobrevivan al corte, la misma imagen de Docker corre en un
mini-PC en la subestación sin cambiar una línea de código.

### Dimensionamiento verificado

Capacidad completa: **71 series por unidad × 10 unidades = 710 series**.

| Escenario | Muestras/día | Crudo | Con agregados y poda |
|---|---|---|---|
| Continuo a 1 Hz | 61,3 M | ~2,4 GB/día · 74 GB/mes | insostenible sin deadband |
| Report-by-exception (5–10 %) | 3–6 M | ~125–250 MB/día | ~4–8 GB/mes de serie cruda a 90 días |

Spool del gateway para **72 h**: del orden de 100–300 MB comprimido. Cabe holgado
en el almacenamiento de un ARM embebido.

### Lo elegido

**PostgreSQL 16 en Docker + API Node 22/Fastify, en un solo servidor.**

Tres decisiones dentro de esa elección:

1. **Sin TimescaleDB.** El esquema usa particionado declarativo nativo de
   Postgres. Corre igual en un contenedor, en RDS o en Neon, sin depender de que
   el proveedor ofrezca la extensión. Si el volumen crece, convertir `reading` en
   hipertabla es una migración aditiva que no toca el código.
2. **Poda por partición completa** (`DROP TABLE`), no con `DELETE`. Instantáneo y
   sin bloat.
3. **Sin Cloudflare D1.** Es SQLite: sin compresión, con límite de tamaño por
   base y throughput de escritura acotado. Para 710 series es la herramienta
   equivocada. El portal puede seguir en Workers o mudarse al mismo contenedor;
   esa parte es independiente y de bajo costo.

Servidor sugerido para el piloto: 4 vCPU / 8 GB RAM / 160 GB SSD (unos USD 20–40
al mes en Hetzner o DigitalOcean). Si hay requisitos de residencia de datos por
tratarse de infraestructura eléctrica, conviene un proveedor en Chile — es una
pregunta para el cliente final, no una decisión técnica.

---

## Estado de implementación

| Fase | Estado |
|---|---|
| F0 Cierre de incógnitas | Parcial — falta el mapa Modbus (lo lleva el equipo de gateway) |
| F1 Modelo de datos y contrato | **Hecho** — 24 tablas, 10 unidades, 310 canales, 710 series |
| F2 Backend de ingesta | **Hecho** — ingesta, idempotencia, HMAC, agregados, motor de alarmas |
| F3 Gateway en C | En curso, por separado |
| F4 Refactor del front | **Hecho** — `page.tsx` pasó de 1.206 líneas a 33 archivos |
| F5 Conexión front ↔ API | **Parcial** — 10 de 13 vistas en vivo; faltan Activos, Configuración e Integraciones |
| F6 Motor de alarmas | **Hecho** (evaluación en servidor con histéresis y retardo) |
| F7 Gestión | **Hecho** — usuarios, notificaciones, claves de API, reportes asíncronos, histórico paginado y mapa Modbus |
| F8 Endurecimiento | Pendiente |

Verificado con 21 pruebas de contrato automatizadas, una corrida de gateway
simulado con corte de enlace de 45 s (cero pérdida, cero duplicados, reinyección
con timestamps originales), `npx next build` completo y las cinco vistas
principales cargadas en Chromium contra el backend real sin errores de consola.

**Fallo encontrado y corregido durante esta fase:** la agregación usaba un
watermark sobre `ts` en lugar de `received_at`. Con eso, los datos que el gateway
reinyecta tras un corte quedaban fuera de los agregados de forma permanente y las
tendencias largas mostraban un hueco que la serie cruda sí tenía. Es exactamente
el escenario para el que se diseñó el sistema. Corregido y cubierto por la prueba
«la reinyección tardía sí entra en los agregados».

Los flujos completos se probaron además en el navegador: generar un informe y
verlo pasar de «Generando…» a «Listo» sin recargar, y cerrar una alarma con el
diálogo bloqueado hasta escribir la nota que el servidor exige.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El manual Modbus del CAM-5 no llega | Bloquea la lectura real | Perfil de registros declarativo; desarrollo contra simulador; ruta alterna vía puerto CNFG y CSV del USB |
| Bus RS485 a 9600 baud no alcanza para 10 unidades | Ciclo de sondeo >5 s, tendencias pobres | Subir a 38400 en F0; degradación por prioridad de canal |
| `page.tsx` monolítico | Conflictos y regresiones al conectar la API | F4 antes de F5, no en paralelo |
| Alarmas evaluadas en el navegador | Eventos perdidos con el portal cerrado | F6 es obligatoria antes de producción |
| Volumen de datos subestimado | Base saturada en semanas | Report-by-exception desde el día uno + agregados continuos |
| Reloj del gateway sin sincronizar | Series desordenadas, tendencias falsas | NTP en F0; bandera `clockSync` y `receivedAt` como respaldo |
| Registros Modbus ficticios llegan a producción | Lecturas plausibles pero incorrectas | La nota *"Mapa asumido"* de la UI no se retira hasta validar contra el equipo real |

---

## Lo que necesito de ti para avanzar

1. **Inventario real**: cuántas unidades CAM-5, cuántos lectores IRM, y cuántos
   sensores de cada tipo están efectivamente conectados hoy. El `seed` asume la
   capacidad máxima; ajustarlo a la realidad es un archivo, no una migración.
2. **Umbrales reales** por tipo de canal. Los sembrados (65/75 °C, 40/60 QUHF,
   75/85 %RH) son plausibles pero no vienen de tu operación.
3. **Dónde levantamos el servidor** y si hay requisito de residencia de datos.
4. Cuando el equipo de gateway tenga el mapa Modbus, cargarlo en
   `channel.register` y marcar `map_confirmed = true`.

Documentos relacionados en esta entrega: `CAM5_GATEWAY_SPEC.md` (contrato completo del gateway), y los ya existentes `handoff/CAM5-frontend-ready/openapi.yaml`, `DATA_CONTRACTS.md`, `BACKEND_INTEGRATION.md` y `DELIVERY_CHECKLIST.md`.
