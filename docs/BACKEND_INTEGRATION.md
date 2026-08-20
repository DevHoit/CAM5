# Guía de integración con backend

## Orden recomendado

1. Implementar autenticación, sesión y endpoint de salud.
2. Entregar activo, gateway, controlador, canales y mapa Modbus.
3. Conectar lectura actual y estado de calidad de cada canal.
4. Conectar tendencias e histórico paginado.
5. Mover el motor de alarmas y su ciclo de vida al servidor.
6. Conectar órdenes de trabajo, usuarios, notificaciones y reportes.
7. Eliminar gradualmente las claves `cam5.front.*` de `localStorage`.

## Adaptador del frontend

`app/cam5-api.ts` contiene el cliente HTTP y los tipos mínimos. Debe ampliarse siguiendo `openapi.yaml`. Los componentes no deberían construir URLs directamente.

## Convenciones

- Fechas: ISO 8601 en UTC.
- Identificadores: estables, no reutilizables y legibles (`MCC-01`, `PD1`, `AL-*`, `OT-*`).
- Unidades: siempre separadas del valor numérico.
- Calidad: `good`, `stale`, `bad` o `disabled`.
- Severidad: `normal`, `warning` o `critical`.
- Paginación: cursor opaco.
- Errores: objeto uniforme con `code`, `message`, `fieldErrors` y `traceId`.
- Idempotencia: requerida para reconocimiento/cierre de alarmas, órdenes y generación de reportes.

## Reemplazo del estado local

| Clave temporal | Fuente definitiva |
|---|---|
| `cam5.front.channel-config` | `GET/PUT /assets/{id}/channels` |
| `cam5.front.register-map` | `GET/PUT /assets/{id}/modbus-map` |
| `cam5.front.asset-config` | `GET/PATCH /assets/{id}` |
| `cam5.front.acknowledged` | ciclo de vida de alarmas |
| `cam5.front.closed-alarms` | ciclo de vida de alarmas |
| `cam5.front.work-orders` | `/work-orders` |
| `cam5.front.users` | `/users` |
| `cam5.front.notification-*` | `/notification-*` |
| `cam5.front.reports` | `/reports` |
| `cam5.front.api-keys` | `/api-keys` |

`cam5.front.system-mode`, `cam5.front.active-role` y preferencias visuales pueden mantenerse localmente solo en modo demostración.
