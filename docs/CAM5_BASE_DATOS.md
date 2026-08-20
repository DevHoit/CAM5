# CAM5 CORE — base de datos

**PostgreSQL 16+, sin extensiones.** Un solo archivo, `cam5-schema.sql`, crea las
24 tablas, sus relaciones, índices, restricciones y vistas. Es idempotente: se
puede re-ejecutar sobre una base con datos y sólo agrega lo que falte.

```bash
createdb cam5
psql -d cam5 -v ON_ERROR_STOP=1 -f cam5-schema.sql
```

Verificado sobre una base vacía: **26 tablas** (24 más 2 particiones del mes en
curso y el siguiente), **3 vistas**, **25 claves foráneas** y **47 índices**.
Con el esquema aplicado, las 22 pruebas de contrato de la API pasan.

---

## El modelo en una frase

Un **sitio** tiene **activos**; cada activo lo instrumenta un **gateway** que
sondea **unidades** (el CAM-5 y sus lectores IRM); cada unidad expone **canales**;
cada canal produce una o más **series medibles**; cada serie acumula **lecturas**,
mantiene un **último valor**, se **agrega** por minuto y por hora, y puede
disparar **alarmas** que derivan en **órdenes de trabajo**.

---

## Las cuatro decisiones que explican el resto

### 1. `unit.parent_unit_id` — la jerarquía CAM-5 → IRM

El CAM-5 es maestro RS485 de hasta 9 lectores IntelliSAW IRM. Modelarlos como
una auto-referencia en la misma tabla permite pasar de 1 a 10 unidades sin
migración. Un lector no es una entidad distinta: es una unidad con padre.

```
unit (CAM5-01, kind='cam5', parent=NULL)
 ├── unit (CAM5-01/IRM-01, kind='irm', parent='CAM5-01')
 └── … hasta IRM-09
```

### 2. `channel_metric` — un canal no es una serie

Un canal de temperatura produce una serie. Un canal de descarga parcial produce
**ocho**: `q_peak`, `sd_max`, `pd_max`, `noise_floor`, `snr`, `trend_alpha`,
`trend_beta`, `trend_phi`. Uno de humedad produce dos. Los umbrales, la banda
muerta y la histéresis se configuran **por serie**, no por canal.

Por eso la unidad de medida, el umbral y la lectura cuelgan de `channel_metric`
y no de `channel`. A capacidad completa: **71 series por unidad, 710 en total.**

### 3. `reading` particionada por mes

La poda de histórico se hace con `DROP TABLE` de la partición, no con `DELETE`.
Es instantáneo y no genera bloat. `ensure_reading_partition()` crea la partición
que falte, incluidas las de meses antiguos cuando el gateway reinyecta un corte.

`reading` **no** tiene clave foránea hacia `channel_metric`: en una tabla
particionada de alto volumen el costo de validación por fila no compensa, y la
integridad ya la garantiza la capa de ingesta, que resuelve el `channel_metric_id`
antes de insertar.

### 4. `rollup_state.last_received_at` — el watermark va sobre la llegada

Este campo es la corrección de un fallo real. La agregación avanzaba usando el
timestamp **de la lectura** (`ts`). Cuando el gateway recupera el enlace y
reinyecta ocho horas de datos con sus timestamps originales, esas filas quedan
*detrás* del watermark y **nunca entran en los agregados**: la serie cruda las
tiene, pero las tendencias largas muestran un hueco permanente.

El watermark correcto es sobre `received_at`. La agregación recalcula los buckets
tocados por cualquier fila que haya llegado después de la última pasada, venga en
tiempo real o reinyectada.

---

## Tablas

### Catálogo — dónde está el activo y qué se mide

| Tabla | Qué guarda | Relaciones |
|---|---|---|
| `site` | Instalación física | → `asset`, `gateway` |
| `asset` | Activo eléctrico (cabina, celda, barra) | `site` → `unit`, `alarm`, `work_order`, `report` |
| `gateway` | Equipo de campo que lee el CAM-5 | `site` → `unit`, `ingest_batch`, `gateway_event` |
| `unit` | CAM-5 principal o lector IRM | `asset`, `gateway`, `unit` (padre) → `channel` |
| `channel` | Punto instrumentado: `T01`–`T12`, `PD1`–`PD4`, `H01`–`H08`, `RLY1`–`RLY6`, `SYS` | `unit` → `channel_metric` |
| `channel_metric` | Serie medible con su unidad y umbrales | `channel` → `reading`, `alarm` |

Campos que suelen sorprender:

- `gateway.api_key_hash_next` — segunda clave válida durante la rotación, para
  cambiar credenciales sin cortar el servicio.
- `gateway.spool_depth` — lotes pendientes en el gateway. Delata un enlace
  degradado *antes* de que se pierdan datos.
- `channel.map_confirmed` — `FALSE` mientras la dirección Modbus sea un supuesto.
  Distingue lo verificado contra el equipo de lo asumido en el diseño. Hoy casi
  todos los canales están en `FALSE`, porque falta el manual Modbus del CAM-5.
- `channel.position_x/y` — coordenadas en el mapa de condición del portal, para
  no fijar posiciones en el código.

### Telemetría — lo que llega del gateway

| Tabla | Qué guarda | Notas |
|---|---|---|
| `ingest_batch` | Un registro por lote recibido | La clave primaria **es** la idempotencia: reenviar no duplica |
| `reading` | Serie cruda, particionada por mes | `ts` = origen, `received_at` = llegada |
| `reading_latest` | Último valor por serie | Sólo avanza en el tiempo |
| `reading_rollup_1m` | Agregado por minuto | Tendencias de 6 h a 7 días |
| `reading_rollup_1h` | Agregado por hora | Tendencias > 7 días y reportes |
| `rollup_state` | Marca de avance de la agregación | Watermark sobre `received_at` |
| `gateway_event` | Relés, excepciones Modbus, arranques | Infraestructura, no proceso |
| `unit_health` | Última salud por unidad | Alimenta Diagnóstico OT |

**`quality`** admite `good`, `stale`, `bad`, `disabled`. Un fallo de lectura
**nunca** se convierte en `0`: se conserva el último valor conocido y se degrada
la calidad. Convertir un fallo en cero es la causa clásica de falsas alarmas en
monitoreo de condición.

`ingest_batch.lag_ms` mide `received_at − sent_at`. En una operación normal son
milisegundos; tras un corte de enlace, el pico revela cuánto se acumuló.

### Alarmas — el servidor es la única fuente de verdad

| Tabla | Qué guarda |
|---|---|
| `alarm` | Ciclo `open → acknowledged → closed`, con reapertura auditada |
| `alarm_note` | Bitácora: notas del operador y anotaciones automáticas |
| `alarm_candidate` | Estado del evaluador: cuánto lleva una serie sobre umbral |

`alarm_candidate` existe porque sin persistir ese estado, el **retardo**
(`delay_s`) y la **histéresis** se perderían en cada reinicio del servicio, y una
condición que llevaba 50 de 60 segundos volvería a contar desde cero.

Dos índices imponen reglas de negocio directamente en la base:

```sql
-- Una serie no puede tener dos alarmas abiertas de la misma regla
CREATE UNIQUE INDEX alarm_active_unique
  ON alarm(channel_metric_id, rule) WHERE status <> 'closed';

-- Una alarma tiene como máximo una orden de trabajo activa
CREATE UNIQUE INDEX work_order_alarm_active
  ON work_order(alarm_id) WHERE alarm_id IS NOT NULL AND status <> 'completed';
```

Son índices únicos **parciales**: la restricción sólo aplica mientras el registro
está vigente. Una vez cerrada la alarma, puede abrirse otra sobre la misma serie.

### Gestión operativa

| Tabla | Qué guarda |
|---|---|
| `app_user` | Usuarios y rol (`admin`, `engineer`, `operator`, `viewer`) |
| `work_order` | Órdenes de trabajo, opcionalmente ligadas a una alarma |
| `audit_log` | Quién cambió qué, con valor anterior y nuevo en `jsonb` |
| `api_key` | Credenciales de integración; sólo el hash |
| `report` | Informes con generación asíncrona `pending → ready \| failed` |
| `notification_channel` | Destinos y severidad mínima |
| `notification_log` | Intento, entrega y error por separado |

`notification_log` distingue los tres estados a propósito: un canal que "no
falló" no es lo mismo que uno que entregó.

---

## Restricciones que la base hace cumplir

Estas no dependen de que la aplicación se comporte bien:

| Regla | Cómo |
|---|---|
| El umbral preventivo debe ser menor que el crítico | `CHECK threshold_order` en `channel_metric` |
| Una referencia Modbus no se repite en el mismo Unit ID | Índice único parcial en `channel(unit_id, register)` |
| Un canal no repite código dentro de su unidad | `UNIQUE (unit_id, code)` |
| Una serie no tiene dos alarmas abiertas de la misma regla | Índice único parcial en `alarm` |
| Una alarma no tiene dos órdenes activas | Índice único parcial en `work_order` |
| `quality`, `severity`, `status`, `role`, `priority` sólo admiten sus valores | `CHECK` en cada columna |
| Un lote de ingesta no se procesa dos veces | `PRIMARY KEY (batch_id)` |

---

## Vistas

| Vista | Para qué |
|---|---|
| `v_series` | Una fila por serie medible con su jerarquía completa. Punto de entrada para consultas ad hoc |
| `v_condition_now` | Condición actual resuelta: valor, calidad efectiva y severidad |
| `v_alarm_active` | Alarmas vigentes con su orden de trabajo asociada |

```sql
-- Qué está fuera de rango ahora mismo
SELECT unit_id, channel_code, metric, value, uom, severity, effective_quality
  FROM v_condition_now
 WHERE severity <> 'normal' AND enabled
 ORDER BY severity DESC, unit_id, channel_code;

-- Canales sin mapa Modbus confirmado
SELECT unit_id, channel_code, register, map_confirmed
  FROM v_series WHERE NOT map_confirmed AND is_primary;
```

---

## Volumen y retención

Medido en disco, no estimado. Bytes por fila reales: **128** en la serie cruda,
**162** en el agregado por minuto y **206** en el horario.

**Capacidad completa (10 unidades, 710 series, report-by-exception):**

| Escenario | Muestras/día | Serie cruda |
|---|---|---|
| Continuo a 1 Hz | 61,3 M | ~2,4 GB/día — insostenible |
| Report-by-exception (5–10 %) | 3–6 M | ~125–250 MB/día |

**Piloto de una unidad (71 series), 30 días medidos:**

| Muestreo | Con agregado 1m | Sin agregado 1m |
|---|---|---|
| cada 1 min | 716 MB | **356 MB** |
| cada 5 min | 156 MB | **88 MB** |

### El agregado por minuto es opcional, y con muestreo lento estorba

`reading_rollup_1m` sólo aporta cuando el muestreo es **sub-minuto**. Si las
muestras llegan cada 1–5 minutos, guarda exactamente las mismas filas que la
tabla cruda y más pesadas —162 contra 128 bytes—, así que **duplica el
almacenamiento sin acelerar ninguna consulta**.

Desactívalo con `CAM5_ROLLUP_1M=false`. El agregado horario se calcula entonces
directamente desde la serie cruda y sale **idéntico**, verificado fila por fila.
Las tendencias de rango medio pasan a leer la tabla cruda, que a ese ritmo son
unas 2.000 filas por serie en 7 días.

### Retención

`CAM5_RAW_RETENTION_DAYS` (90 por defecto) controla cuántos días de serie cruda
se conservan; los agregados **no se podan**. El horario pesa apenas 76 MB al año
para una unidad, así que las tendencias de largo plazo siguen disponibles para
siempre aunque la serie cruda se recorte. Es lo que hace viable una retención
corta en un plan gratuito.

---

## Respaldo

```bash
# Diario, comprimido, con formato personalizado para restauración selectiva
pg_dump -Fc -d cam5 -f /respaldos/cam5-$(date +%F).dump

# Restauración
pg_restore -d cam5_nueva --clean --if-exists /respaldos/cam5-2026-08-19.dump
```

Un respaldo que nunca se restauró no es un respaldo. Prueba la restauración
completa en una base aparte al menos una vez antes de salir a producción, y
después trimestralmente.
