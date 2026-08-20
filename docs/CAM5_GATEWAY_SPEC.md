# CAM5 CORE — Especificación del Gateway

**Versión:** 1.0 · **Fecha:** 19 de agosto de 2026
**Destinatario:** equipo que implementa el gateway (OpenLinux ARM, C)
**Alcance:** capacidad completa del CAM™-5 desde el día uno

---

## 0. Advertencia previa: el mapa Modbus no está en el datasheet

El documento `CAM5_SP.pdf` es la **hoja de datos comercial** del CAM™-5 HMI. Confirma protocolos y capacidades, pero **no contiene el mapa de registros Modbus**. Las direcciones `HR 40001…` que hoy usa el frontend son un supuesto de diseño (el propio código lo declara: *"Mapa asumido para el frontend"*).

**Acción bloqueante antes de escribir código Modbus:** obtener de Altanova/IntelliSAW el documento *CAM-5 Modbus Register Map / Communications Manual*. Alternativas si no llega a tiempo:

1. Conectar por el puerto CNFG (USB 2.0 Mini, drivers FTDI, 115200 baud) y leer la configuración con el protocolo nativo IntelliSAW.
2. Barrido de descubrimiento controlado: FC 03 y FC 04 en bloques de 125 registros sobre `Unit ID 1`, correlacionando valores contra lo que muestra la HMI de 5" en tiempo real.
3. Exportar un CSV desde la memoria USB del equipo (el CAM-5 almacena tendencias en CSV) y usar los nombres de columna como taxonomía de canales.

Esta especificación está diseñada para que **esa incógnita no bloquee el desarrollo**: el gateway no lleva direcciones compiladas, lee un *perfil de mapa de registros* declarativo (§4). Cuando llegue el manual, se cambia un archivo de configuración, no el firmware.

---

## 1. Arquitectura de la cadena de datos

```
Sensores SAW / TPD Air Interface / IH-10
        │  (RF 425–443 MHz, UHF, cableado)
        ▼
   CAM™-5 HMI  ──RS485 Master──►  Lector IRM 1 … Lector IRM 9
   (unidad principal)                (hasta 9 por CAM-5)
        │
        │  Modbus TCP (ETH-1, puerto 502)  ◄── enlace del gateway
        │  ó Modbus RTU esclavo (RS485, 9600–38400 baud)
        ▼
   GATEWAY  (OpenLinux ARM, C)
        │  HTTPS POST + JSON gzip (primario)
        │  MQTT/TLS (secundario, fase 2)
        ▼
   CAM5 CORE  (API de ingesta → almacenamiento → motor de reglas)
        │
        ▼
   Portal CAM5 (Next.js)
```

**Punto clave:** el gateway **no** habla con los lectores IRM directamente. El CAM-5 es maestro RS485 de sus lectores y agrega los datos en su propio espacio de registros. El gateway es un cliente SCADA del CAM-5.

Si hay varias unidades CAM-5, cada una tiene su propia IP y el gateway abre una conexión Modbus TCP por unidad.

### Decisión de transporte

Dado que el gateway soporta ambos, la recomendación es:

| | Elección | Razón |
|---|---|---|
| **Fase 1 (piloto)** | **HTTPS POST por lotes** | Un solo binario en C con `libcurl`. Atraviesa firewalls corporativos sin abrir puertos entrantes. Depurable con `curl` desde cualquier terminal. Sin broker que operar. |
| **Fase 2 (multisitio)** | MQTT sobre TLS | Cuando haya >3 sitios o se necesite latencia sub-segundo y comandos descendentes. |

El payload (§3) es **idéntico en ambos transportes**: solo cambia el sobre. Migrar no rompe el contrato ni el backend.

---

## 2. Modelo de datos: capacidad completa del CAM-5

### 2.1 Jerarquía

```
site        subestacion-norte
 └ gateway  CAM5-GW-01
    └ unit  CAM5-01            (unidad principal, Modbus TCP 192.168.10.42:502)
       ├ reader IRM-01 … IRM-09   (subunidades vía RS485 master del CAM-5)
       └ channel  T01…T12, PD1…PD4, H01…H08, RLY1…RLY6
          └ metric  temperature, q_peak, rh, ...
```

Identificadores estables, legibles, no reutilizables (regla ya fijada en `BACKEND_INTEGRATION.md`):

- `unitId`: `CAM5-01`, `CAM5-01/IRM-03`
- `channel`: código corto dentro de la unidad → `T07`, `PD2`, `H05`, `RLY4`
- Clave global de serie: `{siteId}/{unitId}/{channel}/{metric}`

### 2.2 Catálogo de canales por unidad

| Grupo | Códigos | Máx. | Métricas emitidas | Unidad (`uom`) |
|---|---|---|---|---|
| Temperatura SAW | `T01`–`T12` | 12 | `temperature` | `degC` |
| Descarga parcial UHF | `PD1`–`PD4` | 4 | `q_peak` | `QUHF` |
| | | | `sd_max` (descarga superficial) | `QUHF` |
| | | | `pd_max` (interna/parcial) | `QUHF` |
| | | | `noise_floor` | `QUHF` |
| | | | `snr` | `dB` |
| | | | `trend_alpha` (promedio rápido α) | `QUHF` |
| | | | `trend_beta` (promedio largo β, referencia) | `QUHF` |
| | | | `trend_phi` (aceleración de PD Φ) | `ratio` |
| Humedad / ambiente | `H01`–`H08` | 8 | `relative_humidity` | `percentRH` |
| | | | `ambient_temperature` | `degC` |
| Relés de alarma | `RLY1`–`RLY6` | 6 | `relay_state` (0/1) | `bool` |
| Salud de unidad | `SYS` | 1 | `comm_ok`, `poll_latency_ms`, `retries_24h`, `modbus_exceptions_24h`, `readers_online` | varias |

**Series por unidad a capacidad completa:** 12 (temp) + 32 (4 PD × 8 métricas) + 16 (8 humedad × 2) + 6 (relés) + 5 (salud) = **71 series**.
**Sistema completo (1 CAM-5 + 9 lectores):** **710 series**.

> Estas cifras están verificadas: el `seed` del backend crea exactamente 10 unidades, 310 canales y 710 series.

> Las métricas de PD marcadas como derivadas (`sd_max`, `pd_max`, `trend_*`) las calcula el propio CAM-5 según el datasheet. Si el manual Modbus confirma que **no** están expuestas, se calculan en CORE, no en el gateway. El gateway nunca calcula ni interpola: **solo transporta lo que lee**.

### 2.3 Calidad — reglas obligatorias

Valores permitidos: `good` · `stale` · `bad` · `disabled`.

| Situación en el gateway | `quality` | `value` |
|---|---|---|
| Lectura Modbus correcta y el CAM-5 marca el sensor válido | `good` | valor leído |
| Lectura correcta, pero el bit de estado del canal indica sin señal / fuera de rango | `bad` | último válido conocido |
| Timeout, excepción Modbus, CRC inválido | `stale` | último válido conocido |
| Canal deshabilitado en el perfil de configuración | `disabled` | se omite el envío |
| Error de decodificación (escala/byte order inconsistente) | `bad` | último válido conocido |

**Prohibido:** convertir un fallo en `0`. Está explícitamente vetado en `DATA_CONTRACTS.md` y es la causa clásica de falsas alarmas en monitoreo de condición.

Un valor `stale` se reenvía como máximo durante `staleMaxSeconds` (por defecto 300 s). Pasado ese umbral el gateway deja de emitir la serie y publica un evento `channel_lost`.

### 2.4 Tiempo y secuencia

- El gateway debe estar sincronizado por NTP (`chrony`). Si no hay sincronía, marca `clockSync: "unsynced"` en el bloque de estado y CORE usa `receivedAt` como referencia.
- `ts` es el instante de la **lectura en origen** (momento del ciclo Modbus), no el del envío.
- `seq` es un contador monótono **por gateway**, persistido en disco, que sobrevive reinicios. Permite a CORE detectar huecos sin ambigüedad.
- Todas las fechas en **ISO 8601 UTC con milisegundos**: `2026-08-19T14:23:04.900Z`.

---

## 3. Contrato de envío

### 3.1 Endpoints

| Método | Ruta | Uso | Frecuencia |
|---|---|---|---|
| `POST` | `/api/v1/ingest/telemetry` | Lotes de lecturas | cada 1–5 s |
| `POST` | `/api/v1/ingest/status` | Latido y salud del gateway | cada 30 s |
| `POST` | `/api/v1/ingest/events` | Cambios de relé, excepciones Modbus, arranque/parada, canal perdido | por evento |
| `GET` | `/api/v1/gateway/config` | El gateway descarga su perfil de sondeo | al arrancar y cuando cambia `configVersion` |
| `GET` | `/api/v1/health` | Verificación de disponibilidad | cada 60 s |

Base URL: la ya definida en `.env.example` → `NEXT_PUBLIC_CAM5_API_URL` para el portal; el gateway usa su propia variable `CAM5_CORE_URL`.

### 3.2 Cabeceras obligatorias

```http
POST /api/v1/ingest/telemetry HTTP/1.1
Host: core.cam5.local
Content-Type: application/json
Content-Encoding: gzip
Authorization: Bearer cam5_gw_<clave-larga-aleatoria>
Idempotency-Key: 01J8Z9QK7X3M2N5P8R1T4V6W9A
X-CAM5-Gateway-Id: CAM5-GW-01
X-CAM5-Timestamp: 2026-08-19T14:23:05.120Z
X-CAM5-Signature: v1=3f9a...c2
X-CAM5-Config-Version: 14
X-CAM5-Schema-Version: 1.0
```

**Firma HMAC-SHA256** (defensa en profundidad sobre TLS; evita que una clave filtrada en logs se reutilice):

```
StringToSign = METHOD + "\n" + PATH + "\n" + X-CAM5-Timestamp + "\n" + SHA256_HEX(cuerpo_sin_comprimir)
X-CAM5-Signature = "v1=" + HEX( HMAC_SHA256(secreto_compartido, StringToSign) )
```

CORE rechaza con `401` si `|ahora − X-CAM5-Timestamp| > 300 s` (protección contra reenvío).

`Idempotency-Key` = `batchId` del cuerpo (ULID). CORE debe recordar las claves vistas al menos 24 h y responder `200` con `duplicate: true` sin reprocesar. Esto es lo que hace seguro el reintento tras un corte.

### 3.3 Cuerpo — telemetría

Dos formatos, ambos válidos en el mismo endpoint. El gateway elige según el caso.

**(a) Formato disperso** — para report-by-exception y eventos aislados:

```json
{
  "schemaVersion": "1.0",
  "batchId": "01J8Z9QK7X3M2N5P8R1T4V6W9A",
  "siteId": "subestacion-norte",
  "gatewayId": "CAM5-GW-01",
  "sentAt": "2026-08-19T14:23:05.120Z",
  "configVersion": 14,
  "readings": [
    {
      "seq": 184203,
      "unitId": "CAM5-01",
      "channel": "T01",
      "metric": "temperature",
      "value": 68.4,
      "uom": "degC",
      "quality": "good",
      "ts": "2026-08-19T14:23:04.900Z",
      "raw": 684,
      "scale": 0.1
    },
    {
      "seq": 184204,
      "unitId": "CAM5-01",
      "channel": "PD1",
      "metric": "trend_phi",
      "value": 2.8,
      "uom": "ratio",
      "quality": "good",
      "ts": "2026-08-19T14:23:04.900Z"
    },
    {
      "seq": 184205,
      "unitId": "CAM5-01/IRM-03",
      "channel": "H05",
      "metric": "relative_humidity",
      "value": 78.0,
      "uom": "percentRH",
      "quality": "stale",
      "ts": "2026-08-19T14:23:04.900Z"
    }
  ]
}
```

`raw` y `scale` son **opcionales** pero muy recomendables durante la puesta en marcha: permiten a CORE detectar un `byteOrder` o una escala mal configurada sin ir al sitio.

**(b) Formato de serie comprimida** — para muestreo continuo de alta frecuencia:

```json
{
  "schemaVersion": "1.0",
  "batchId": "01J8Z9QK8Y4N3P6Q9S2U5W7X1B",
  "siteId": "subestacion-norte",
  "gatewayId": "CAM5-GW-01",
  "sentAt": "2026-08-19T14:23:10.000Z",
  "series": [
    {
      "unitId": "CAM5-01",
      "channel": "T01",
      "metric": "temperature",
      "uom": "degC",
      "seqStart": 184203,
      "t0": "2026-08-19T14:23:05.000Z",
      "dtMs": 1000,
      "values": [68.4, 68.4, 68.5, 68.6, 68.6],
      "quality": ["good", "good", "good", "good", "good"]
    }
  ]
}
```

Regla: si `quality` es un solo string en lugar de un arreglo, aplica a todas las muestras. Un `null` en `values` significa muestra ausente y exige `quality[i] = "bad"` o `"stale"`.

### 3.4 Cuerpo — estado (latido cada 30 s)

```json
{
  "schemaVersion": "1.0",
  "batchId": "01J8Z9QKA...",
  "gatewayId": "CAM5-GW-01",
  "siteId": "subestacion-norte",
  "sentAt": "2026-08-19T14:23:30.000Z",
  "gateway": {
    "firmware": "cam5-gw 1.0.3",
    "uptimeSec": 481203,
    "clockSync": "ntp",
    "clockOffsetMs": 12,
    "cpuLoad1": 0.21,
    "memFreeKb": 184320,
    "diskFreeKb": 2097152,
    "spoolDepth": 0,
    "spoolOldestTs": null,
    "configVersion": 14,
    "lastSeq": 184207
  },
  "units": [
    {
      "unitId": "CAM5-01",
      "transport": "modbus-tcp",
      "endpoint": "192.168.10.42:502",
      "unitAddress": 1,
      "online": true,
      "pollCycleMs": 1840,
      "pollLatencyMs": 42,
      "readsOk24h": 43198,
      "readsFailed24h": 2,
      "modbusExceptions24h": 0,
      "channelsConfigured": 71,
      "channelsGood": 71,
      "readersOnline": 9
    }
  ]
}
```

`spoolDepth` y `spoolOldestTs` alimentan directamente la vista **Diagnóstico OT** del portal: es la señal de que el enlace hacia CORE está degradado aunque los datos sigan llegando.

### 3.5 Cuerpo — eventos

```json
{
  "schemaVersion": "1.0",
  "batchId": "01J8Z9QKB...",
  "gatewayId": "CAM5-GW-01",
  "siteId": "subestacion-norte",
  "sentAt": "2026-08-19T14:24:01.000Z",
  "events": [
    {
      "seq": 184210,
      "ts": "2026-08-19T14:24:00.880Z",
      "unitId": "CAM5-01",
      "type": "relay_change",
      "severity": "warning",
      "channel": "RLY2",
      "detail": { "from": 0, "to": 1 }
    },
    {
      "seq": 184211,
      "ts": "2026-08-19T14:24:00.900Z",
      "unitId": "CAM5-01",
      "type": "modbus_exception",
      "severity": "warning",
      "detail": { "function": 3, "address": 40121, "exceptionCode": 2, "meaning": "ILLEGAL_DATA_ADDRESS" }
    }
  ]
}
```

Tipos de evento mínimos: `gateway_start`, `gateway_stop`, `unit_online`, `unit_offline`, `channel_lost`, `channel_recovered`, `relay_change`, `modbus_exception`, `config_applied`, `clock_step`.

> **El gateway no genera alarmas de proceso.** No evalúa umbrales ni decide severidad de condición. Eso vive en CORE (`BACKEND_INTEGRATION.md`, punto 5: *"Mover el motor de alarmas y su ciclo de vida al servidor"*). Los eventos del gateway son exclusivamente de infraestructura y de cambio de estado físico de los relés.

### 3.6 Respuestas de CORE

**Éxito:**

```json
HTTP/1.1 202 Accepted
{
  "accepted": 71,
  "rejected": [],
  "duplicate": false,
  "configVersion": 14,
  "serverTime": "2026-08-19T14:23:05.310Z"
}
```

Si `configVersion` devuelto ≠ el que envió el gateway, el gateway debe hacer `GET /api/v1/gateway/config` en el siguiente ciclo. Así el portal empuja cambios de umbral, deadband o habilitación de canal sin conexión entrante al gateway.

`serverTime` permite al gateway detectar deriva de reloj sin depender solo de NTP.

**Rechazo parcial** (el lote se acepta, algunas lecturas no):

```json
HTTP/1.1 202 Accepted
{
  "accepted": 66,
  "rejected": [
    { "seq": 184205, "code": "UNKNOWN_CHANNEL", "message": "CAM5-01/IRM-03.H05 no está registrado en el activo" }
  ],
  "configVersion": 15
}
```

**Errores:** formato uniforme ya acordado en `DATA_CONTRACTS.md`.

```json
{ "code": "VALIDATION_ERROR", "message": "...", "fieldErrors": {...}, "traceId": "01J..." }
```

| Código HTTP | Acción del gateway |
|---|---|
| `202` / `200` | Borrar el lote del spool |
| `400` `422` | **No reintentar.** Mover el lote a cuarentena en disco, registrar y continuar. Un lote malformado que se reintenta eternamente bloquea la cola. |
| `401` `403` | Detener envíos, reintentar cada 60 s, publicar evento local. Nunca borrar el spool. |
| `409` (duplicado) | Tratar como éxito, borrar del spool |
| `413` (lote muy grande) | Partir el lote a la mitad y reintentar |
| `429` | Respetar `Retry-After`; si no viene, backoff exponencial |
| `5xx`, timeout, DNS | Backoff exponencial con jitter |

### 3.7 Reintentos y almacenamiento local

- **Backoff:** 1 s → 2 → 4 → 8 → 16 → 30 → 60 s (tope), con jitter aleatorio ±20 % para evitar sincronización de reintentos entre gateways.
- **Store-and-forward obligatorio.** SQLite en disco (amalgamación C, WAL activado):

  ```sql
  CREATE TABLE spool (
    batch_id   TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,          -- telemetry | status | events
    created_at INTEGER NOT NULL,       -- epoch ms
    attempts   INTEGER NOT NULL DEFAULT 0,
    next_try   INTEGER NOT NULL,
    payload    BLOB NOT NULL           -- JSON gzip
  );
  CREATE INDEX spool_next ON spool(next_try);
  ```

- **Capacidad mínima acordada: 72 horas** de operación al ritmo configurado.
  Con report-by-exception y gzip son del orden de **100–300 MB**; dimensiona la
  partición con margen ×3 (≈1 GB reservado). Verifica el espacio libre en cada
  latido y publica `spool_overflow` antes de llegar al límite, no al llegar.
- **Política de desborde:** descartar lo **más antiguo** primero (`created_at ASC`), nunca lo más nuevo, y emitir `spool_overflow`. El dato reciente vale más que el histórico perdido.
- **Orden de envío:** FIFO estricto por `created_at`. Con idempotencia el orden no es crítico para la corrección, pero simplifica el diagnóstico.
- **Al reconectar:** enviar primero el latido de estado (para que el portal deje de mostrar "sin conexión") y luego drenar la cola con un límite de ritmo (p. ej. 5 lotes/s) para no tumbar CORE.

### 3.8 Perfil MQTT (fase 2)

Mismo JSON, distinto sobre.

| Tópico | Dirección | QoS | Retain |
|---|---|---|---|
| `cam5/v1/{siteId}/{gatewayId}/telemetry` | gateway → CORE | 1 | no |
| `cam5/v1/{siteId}/{gatewayId}/status` | gateway → CORE | 1 | **sí** |
| `cam5/v1/{siteId}/{gatewayId}/events` | gateway → CORE | 1 | no |
| `cam5/v1/{siteId}/{gatewayId}/config` | CORE → gateway | 1 | sí |

- **LWT (Last Will and Testament)** obligatorio en el tópico de estado: `{"gatewayId":"CAM5-GW-01","online":false}`. Es como el portal detecta una caída en segundos en vez de esperar el timeout del latido.
- TLS con certificado de cliente o usuario/clave; `clientId` = `gatewayId`, sesión persistente (`cleanSession: false`).

---

## 4. Lado Modbus del gateway

### 4.1 Perfil de mapa de registros (archivo declarativo)

El gateway **no lleva direcciones compiladas**. Lee `/etc/cam5-gw/profile.json`, que puede actualizarse desde `GET /api/v1/gateway/config`.

```json
{
  "profileVersion": 14,
  "units": [
    {
      "unitId": "CAM5-01",
      "transport": "modbus-tcp",
      "host": "192.168.10.42",
      "port": 502,
      "unitAddress": 1,
      "timeoutMs": 1000,
      "retries": 2,
      "pollIntervalMs": 1000,
      "blocks": [
        {
          "function": 3,
          "start": 40001,
          "count": 12,
          "channels": [
            { "offset": 0,  "channel": "T01", "metric": "temperature", "type": "Int16",  "scale": 0.1, "byteOrder": "AB", "uom": "degC", "deadband": 0.2, "enabled": true },
            { "offset": 1,  "channel": "T02", "metric": "temperature", "type": "Int16",  "scale": 0.1, "byteOrder": "AB", "uom": "degC", "deadband": 0.2, "enabled": true }
          ]
        },
        {
          "function": 3,
          "start": 40013,
          "count": 12,
          "statusBlock": true,
          "channels": [
            { "offset": 0, "channel": "T01", "metric": "_status", "type": "UInt16", "qualityMap": { "0": "good", "1": "bad", "2": "disabled" } }
          ]
        },
        {
          "function": 3,
          "start": 40121,
          "count": 32,
          "channels": [
            { "offset": 0, "channel": "PD1", "metric": "q_peak",      "type": "UInt16", "scale": 1,     "uom": "QUHF" },
            { "offset": 1, "channel": "PD1", "metric": "sd_max",      "type": "UInt16", "scale": 1,     "uom": "QUHF" },
            { "offset": 2, "channel": "PD1", "metric": "pd_max",      "type": "UInt16", "scale": 1,     "uom": "QUHF" },
            { "offset": 3, "channel": "PD1", "metric": "trend_phi",   "type": "UInt16", "scale": 0.01,  "uom": "ratio" }
          ]
        }
      ]
    }
  ],
  "transmit": {
    "mode": "report-by-exception",
    "heartbeatSec": 10,
    "batchMaxReadings": 500,
    "batchMaxIntervalMs": 5000,
    "staleMaxSeconds": 300
  }
}
```

**Las direcciones del ejemplo son placeholders** heredados del prototipo del frontend. Se reemplazan cuando llegue el manual Modbus, sin tocar el binario.

Notas de decodificación:

- Convención de direcciones: declarar si `start` es dirección **PDU** (base 0) o **de usuario** (base 1, `4xxxx`). Recomiendo campo explícito `"addressing": "user"` o `"pdu"` para no dejarlo a interpretación.
- `Int16` / `UInt16` con `scale` y `byteOrder` `AB`/`BA` (ya soportado en la UI de configuración del portal). Prever `Int32`/`Float32` con `ABCD`/`CDAB`/`BADC`/`DCBA` si el manual los usa.
- Máximo **125 registros** por petición FC 03/FC 04. Los bloques se definen contiguos para minimizar transacciones: 71 series se leen en 3–4 bloques, no en 71 peticiones.
- **Regla ya acordada:** una referencia Modbus no puede repetirse dentro del mismo Unit ID (validación en el portal, `DATA_CONTRACTS.md`).

### 4.2 Ciclo de sondeo

```
cada pollIntervalMs (por unidad):
  para cada bloque:
     leer FC03/FC04 (timeout 1000 ms, hasta 2 reintentos)
     si falla → marcar todos los canales del bloque como stale
                incrementar contador de excepciones
                emitir evento modbus_exception (con anti-rebote, máx 1 por minuto y tipo)
     si ok    → decodificar cada canal (tipo, byteOrder, scale)
                cruzar con el bloque de estado → asignar quality
  aplicar deadband
  encolar lo que pasa el filtro
```

**Presupuesto de tiempo.** El datasheet indica: interrogación RF ≤ 160 ms, respuesta PD 200 ms, humedad 500 ms, respuesta Modbus 500 ms típica, intervalo de interrogación 1 s típico. Un ciclo completo por unidad CAM-5 debe caber en **≤ 2 s**. Con 10 unidades sobre buses independientes es paralelizable; sobre RS485 compartido es secuencial y **hay que subir el bus a 38400 baud** (por defecto viene en 9600, que es insuficiente para 10 dispositivos).

Si el ciclo no cabe, degrada por prioridad: temperatura y PD a 1 s; humedad y ambiente a 5 s; relés por interrupción o sondeo a 1 s; salud a 30 s.

### 4.3 Report-by-exception (deadband)

Enviar 710 series a 1 Hz de forma continua son ~61 millones de muestras diarias. Innecesario y caro. Regla de emisión:

Se envía una muestra si **cualquiera** de estas condiciones se cumple:

1. `|valor − último_enviado| ≥ deadband` del canal
2. Cambió `quality`
3. Pasaron `heartbeatSec` desde el último envío de esa serie (garantiza continuidad en las tendencias)
4. Es un canal digital (relé) y cambió de estado → envío **inmediato**, sin esperar el lote

Deadbands sugeridos como punto de partida (ajustables desde el portal):

| Métrica | Deadband | Latido |
|---|---|---|
| `temperature` | 0.2 °C | 10 s |
| `ambient_temperature` | 0.2 °C | 30 s |
| `relative_humidity` | 0.5 %RH | 30 s |
| `q_peak`, `sd_max`, `pd_max` | 1 QUHF | 10 s |
| `trend_alpha` / `trend_beta` | 1 QUHF | 30 s |
| `trend_phi` | 0.05 | 10 s |
| `relay_state` | cualquier cambio | 60 s |
| salud de unidad | — | 30 s |

Efecto típico: **5–10 %** del volumen bruto, sin perder resolución donde importa.

### 4.4 Librerías C sugeridas (todas disponibles en OpenLinux ARM)

| Función | Librería | Licencia |
|---|---|---|
| Modbus TCP/RTU | `libmodbus` | LGPL-2.1 |
| HTTP/TLS | `libcurl` + `mbedTLS` u `OpenSSL` | MIT / Apache |
| JSON | `jansson` o `cJSON` | MIT |
| Cola persistente | `sqlite3` (amalgamación) | dominio público |
| gzip | `zlib` | zlib |
| HMAC-SHA256, ULID | `mbedTLS` / `OpenSSL` | — |
| MQTT (fase 2) | `paho.mqtt.c` | EPL/EDL |

Estructura sugerida de procesos: **un solo binario, tres hilos** — `poller` (Modbus, tiempo real blando), `spooler` (SQLite), `sender` (libcurl). Comunicación por cola en memoria acotada; si se llena, el `poller` escribe directo al spool. Supervisión con `systemd` (`Restart=always`, `WatchdogSec`).

---

## 5. Alimentación del gateway

**El CAM-5 no entrega alimentación auxiliar.** Verificado contra el manual de
usuario del equipo, no sólo contra la hoja de datos:

- El conector de poder es de **dos terminales de entrada**, `Línea / (+)` y
  `Neutro / (−)`, para 100–250 V AC (50/60 Hz) o 120–250 V DC. Consumo: 20 W.
  No hay terminal de salida de 12 V, 24 V, 5 V ni paso de 220 V.
- Las **6 salidas de alarma son contactos secos** (relés forma C, libres de
  potencial). Conmutan un circuito que alimentas tú; no entregan tensión.
- **RS485, Ethernet y el USB de configuración son sólo señal**, sin alimentación.
  El Ethernet es 10/100 BASE-T sin PoE.
- El conector de sensores de humedad sí lleva un pin `H-PWR`, pero es un bus
  dedicado a esos sensores. No es una fuente de servicio.
- El puerto USB 2.0 tipo A (host, para la memoria de tendencias) entrega los
  5 V del estándar USB. **No lo uses para alimentar el gateway:** no está
  dimensionado para eso, no hay garantía de corriente, y colgar una carga
  permanente de un equipo de monitoreo certificado compromete su fiabilidad y
  probablemente su garantía.

### De dónde alimentarlo entonces

El gateway va en el mismo compartimento de baja tensión que el CAM-5, así que la
alimentación sale del tablero, no del equipo.

| Opción | Cómo | Cuándo |
|---|---|---|
| **Batería de estación 110/125 V DC** → convertidor DC/DC a 12 o 24 V DC | Fuente en riel DIN, con su propio interruptor | **Recomendada** donde exista. Ya está respaldada por diseño |
| Mismo circuito que alimenta el CAM-5 (220 V AC en Chile) → fuente AC/DC en riel DIN | Derivación con protección propia, no en serie con el CAM-5 | Lo más simple si no hay batería de estación |
| 220 V AC + UPS pequeña | Igual que arriba, con respaldo | Si sólo hay AC y quieres autonomía ante corte de energía |

Dimensionamiento: un gateway ARM embebido consume del orden de **5–10 W**. Una
fuente de riel DIN de 25–30 W deja margen suficiente. Elígela con rango de
temperatura equivalente al del CAM-5 (−20 a +70 °C) y protección contra
sobretensión acorde a la categoría del tablero.

**Protección propia siempre.** El gateway debe tener su interruptor o fusible,
no colgar de la protección del CAM-5. Si el gateway falla en corto, no puede
llevarse consigo el monitoreo del activo.

### Un detalle de diagnóstico que conviene decidir a conciencia

Si el gateway se alimenta del **mismo circuito** que el CAM-5, un corte de
energía en el tablero apaga a los dos. Desde CORE eso se ve exactamente igual
que un gateway averiado: silencio. No sabes cuál de los dos falló.

Si el gateway está en la **batería de estación**, sobrevive al corte de AC y
sigue reportando: publica `unit_offline` para el CAM-5 y su propio latido de
estado. Aprendes *por qué* no hay datos, que es justo lo que necesitas a las tres
de la mañana. Es la razón principal para preferir la batería de estación por
sobre el ahorro de una fuente.

---

## 6. Seguridad y red

- **TLS 1.2+ obligatorio** hacia CORE. Validar la cadena de certificados (`CURLOPT_SSL_VERIFYPEER=1`). Si CORE usa CA interna, empaquetar el bundle en `/etc/cam5-gw/ca.pem`.
- **Credenciales en disco** con permisos `0600`, propiedad `root`, fuera del árbol de configuración versionado. Nunca en el JSON del perfil.
- **Rotación de claves:** la vista *Integraciones → Acceso API* del portal ya emite y revoca claves `cam5_*`. El gateway debe aceptar dos claves simultáneas (activa + siguiente) durante la ventana de rotación.
- **Sin puertos entrantes en el gateway.** Toda la comunicación la inicia él. La configuración se descarga (*pull*), no se empuja.
- **Segmentación:** el gateway con una pata en la VLAN OT (hacia el CAM-5) y otra en la VLAN de gestión (hacia CORE). Sin ruteo entre ambas.
- El puerto CNFG (USB) y la memoria USB del CAM-5 son "Tipo 1, protección industrial débil" según el datasheet: acceso físico controlado, no son un canal de datos.

---

## 7. Lista de aceptación del gateway

- [ ] Lee las 71 series de una unidad en un ciclo ≤ 2 s
- [ ] Un corte de red de 4 h no pierde ninguna muestra (spool íntegro y drenado al reconectar)
- [ ] Reenviar el mismo lote dos veces no duplica datos en CORE (idempotencia verificada)
- [ ] Un timeout Modbus produce `stale` con el último valor, nunca `0`
- [ ] Un cambio de relé llega a CORE en < 2 s
- [ ] Reiniciar el gateway no reinicia ni retrocede `seq`
- [ ] Un cambio de umbral en el portal llega al gateway en < 60 s vía `configVersion`
- [ ] Un lote malformado va a cuarentena y no bloquea la cola
- [ ] Sin NTP, el gateway sigue enviando y marca `clockSync: "unsynced"`
- [ ] `readsFailed24h` y `spoolDepth` se reflejan en la vista Diagnóstico OT del portal
- [ ] Un `429` con `Retry-After` se respeta sin perder datos
