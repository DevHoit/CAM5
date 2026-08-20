# CAM5 CORE

Portal de monitoreo predictivo de condición para activos eléctricos de media y
alta tensión, sobre la unidad **IntelliSAW CAM™-5 HMI** (Altanova Group).

Mide temperatura por sensores SAW pasivos, descarga parcial UHF y humedad
ambiente; los publica por Modbus, y este sistema los ingiere, almacena, evalúa
contra umbrales y los presenta en un portal web.

```
Sensores SAW / TPD Air Interface / IH-10
      │
      ▼
  CAM™-5 HMI ──RS485──► hasta 9 lectores IRM
      │  Modbus TCP
      ▼
  Gateway (Linux embebido ARM, C)  ── almacena 24–72 h si se cae el enlace
      │  HTTPS + JSON gzip, firmado
      ▼
  CAM5 CORE  ── ingesta · almacenamiento · motor de alarmas
      │
      ▼
  Portal web (Next.js)
```

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `api/` | Backend Fastify: ingesta, alarmas, agregación, gestión. TypeScript ejecutado directo por Node 22, sin compilación |
| `db/` | `cam5-schema.sql` — 24 tablas, relaciones, índices y vistas en un archivo idempotente |
| `portal/` | Interfaz Next.js. 13 vistas, 10 conectadas a la API |
| `tools/` | `fake-gateway.ts` — simulador que genera telemetría realista sin el equipo físico |
| `docs/` | Especificación del gateway, plan de implementación, guía de despliegue y modelo de datos |

## Arranque rápido

```bash
cp .env.example .env                 # define POSTGRES_PASSWORD
docker compose up -d db

cd api && npm install
npm run migrate && npm run seed      # imprime las credenciales del gateway UNA vez
npm start

# en otra terminal: telemetría simulada de las 710 series
node tools/fake-gateway.ts --minutes 5
```

```bash
cd portal && npm install
NEXT_PUBLIC_CAM5_API_URL=http://localhost:8787/api/v1 npm run dev
```

Sin `NEXT_PUBLIC_CAM5_API_URL` el portal arranca en **modo demostración** con
datos simulados, sin necesitar backend ni base de datos.

## Despliegue

Portal en `hoitlive.com/cam5`, API en `hoitlive.com/cam5/api/v1`, cinco
contenedores en un servidor. Guía completa en **[`docs/CAM5_DESPLIEGUE.md`](docs/CAM5_DESPLIEGUE.md)**.

```bash
cp .env.prod.example .env && nano .env
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node src/migrate.ts
docker compose -f docker-compose.prod.yml exec api node src/seed.ts
```

## Decisiones que conviene conocer antes de tocar el código

**PostgreSQL sin extensiones.** El esquema usa particionado declarativo nativo,
no TimescaleDB, para poder correr sobre cualquier Postgres gestionado. La poda de
histórico se hace con `DROP TABLE` de la partición, no con `DELETE`.

**Un canal no es una serie.** Un canal de descarga parcial produce ocho series
medibles. Por eso los umbrales y las lecturas cuelgan de `channel_metric`, no de
`channel`. A capacidad completa: 71 series por unidad, 710 en total.

**Las alarmas se evalúan en el servidor**, en el momento de la ingesta. Una
alarma existe aunque nadie tenga el portal abierto.

**Una lectura fallida nunca vale `0`.** Se conserva el último valor conocido y se
degrada la calidad a `stale` o `bad`. Convertir un fallo en cero es la causa
clásica de falsas alarmas en monitoreo de condición.

**La agregación avanza por `received_at`, no por `ts`.** Cuando el gateway
reinyecta un corte, esas lecturas traen timestamps antiguos; un watermark por
`ts` las dejaría fuera de los agregados para siempre.

**El ritmo de muestreo configura el resto.** `CAM5_SAMPLE_INTERVAL_S` deriva el
umbral de frescura, el latido y los retardos de alarma. Con muestreo de 1 minuto
o más espaciado, desactiva el agregado por minuto (`CAM5_ROLLUP_1M=false`): a ese
ritmo guarda las mismas filas que la tabla cruda y más pesadas.

## Estado

| Componente | Estado |
|---|---|
| Modelo de datos y esquema | Completo |
| Ingesta, idempotencia, firma HMAC, gzip | Completo |
| Motor de alarmas con histéresis y retardo | Completo |
| Agregación, retención y reportes asíncronos | Completo |
| Portal: 10 de 13 vistas en vivo | Faltan Activos, Configuración e Integraciones |
| Gateway en C | En desarrollo, equipo aparte |

**22 pruebas de contrato** cubren las invariantes del sistema:

```bash
cd api && npm test    # requiere el servidor y la base arriba
```

### Pendientes antes de producción

- **Autenticación real de usuario.** Hoy `X-CAM5-User` / `CAM5_DEV_USER` es un
  puente de desarrollo: cualquiera con acceso a la URL entra como ese usuario.
- Despacho real de notificaciones — la tabla y el registro existen, falta enviar.
- **Mapa Modbus del CAM-5.** La hoja de datos del fabricante no lo incluye; hay
  que pedir el *Modbus Register Map* a Altanova/IntelliSAW. Mientras tanto,
  `channel.register` queda nulo y `channel.map_confirmed` distingue lo verificado
  de lo supuesto.

## Documentación

- [Plan de implementación](docs/CAM5_PLAN_IMPLEMENTACION.md) — fases, estado y riesgos
- [Especificación del gateway](docs/CAM5_GATEWAY_SPEC.md) — contrato de ingesta, Modbus, alimentación
- [Guía de despliegue](docs/CAM5_DESPLIEGUE.md) — servidor, proxy, respaldos, costos
- [Base de datos](docs/CAM5_BASE_DATOS.md) — modelo, restricciones, volumen
- [Modelo de datos (diagrama)](docs/CAM5_MODELO_DATOS.svg)
- [Contrato HTTP](docs/openapi.yaml)

---

Software propietario. Todos los derechos reservados.
