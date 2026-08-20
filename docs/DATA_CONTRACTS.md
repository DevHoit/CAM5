# Contratos de datos esperados

## Telemetría

Cada lectura debe incluir:

- `channelId`, `assetId` y `sequence`;
- `value` numérico y `unit`;
- `severity` calculada por el servidor;
- `quality` independiente de la severidad;
- `sourceTimestamp` generado en origen;
- `receivedAt` asignado por la plataforma.

Una lectura atrasada conserva su último valor, pero utiliza `quality: stale`. Una pérdida o error de decodificación utiliza `quality: bad`; nunca debe convertirse silenciosamente en cero.

## Canales

Campos mínimos: identificador, etiqueta, zona, tipo, habilitado, unidad, umbral preventivo, umbral crítico, histéresis, retardo, registro Modbus, tipo de dato, escala y orden de bytes.

Reglas:

- el umbral preventivo debe ser menor que el crítico;
- una referencia Modbus no puede repetirse dentro del mismo Unit ID;
- los cambios deben guardar usuario, fecha, valor anterior y valor nuevo.

## Alarmas

Estados válidos: `open → acknowledged → closed`, permitiendo `closed → open` con auditoría. El backend es la única fuente de verdad del estado.

## Órdenes de trabajo

Estados válidos: `pending`, `in_progress`, `completed`. Una alarma puede tener como máximo una orden activa vinculada.

## Respuesta de error

```json
{
  "code": "VALIDATION_ERROR",
  "message": "La configuración contiene campos inválidos",
  "fieldErrors": { "port": "Debe estar entre 1 y 65535" },
  "traceId": "01J..."
}
```
