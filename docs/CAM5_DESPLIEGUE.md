# CAM5 CORE — despliegue en `hoitlive.com/cam5`

**Versión:** 1.0 · **Fecha:** 19 de agosto de 2026
**Objetivo:** portal en `https://hoitlive.com/cam5`, API en
`https://hoitlive.com/cam5/api/v1`, todo en un solo servidor.

---

## Lo que se decide aquí

Servir el sistema **bajo una ruta** del dominio, no en un subdominio, tiene una
consecuencia técnica que conviene conocer antes: el portal y la API quedan en el
**mismo origen**. Eso elimina CORS por completo — el navegador nunca cruza
orígenes — y simplifica cookies y sesiones cuando se implemente la autenticación
real. Es la opción más simple de operar.

El costo es que hay que configurar un `basePath` en Next.js y una regla de
reescritura en el proxy. Ambas cosas ya están hechas y verificadas.

> Si más adelante prefieres `cam5.hoitlive.com`, el cambio es quitar el
> `basePath` y apuntar un registro DNS. No hay nada más atado a la ruta.

---

## Arquitectura

```
                    Internet
                       │
                       ▼
        ┌──────────────────────────────┐
        │  Caddy  :80 :443             │  TLS automático (Let's Encrypt)
        │  hoitlive.com                │
        └──────────────┬───────────────┘
                       │
        ┌──────────────┴───────────────┐
        │                              │
  /cam5/api/*                      /cam5/*
  (quita el prefijo /cam5)         (sin reescribir)
        │                              │
        ▼                              ▼
  ┌───────────┐                 ┌─────────────┐
  │ cam5-api  │                 │ cam5-portal │
  │  :8787    │                 │   :3000     │
  │  Fastify  │                 │  Next.js    │
  └─────┬─────┘                 └──────┬──────┘
        │                              │
        │        ┌─────────────┐       │
        └───────►│  postgres   │◄──────┘
                 │   :5432     │
                 └─────────────┘
                        ▲
                 ┌──────┴──────┐
                 │ cam5-rollup │  agregación y poda, cada 60 s
                 └─────────────┘

        Gateway (campo) ──HTTPS──► https://hoitlive.com/cam5/api/v1/ingest/telemetry
```

Cinco contenedores en una máquina. Postgres **no publica puerto**: sólo lo
alcanzan la API y el agregador por la red interna de Docker.

---

## Dónde alojarlo

La autonomía sin internet vive en el gateway, así que el servidor puede estar en
cualquier parte. Lo que cambia entre opciones es latencia y costo.

| Opción | Región útil | Costo aprox. | Latencia desde Chile | Comentario |
|---|---|---|---|---|
| **Vultr / AWS Lightsail — São Paulo** | Brasil | USD 20–40/mes | 40–60 ms | **Recomendado.** El mejor equilibrio: el portal se siente inmediato y el precio es razonable |
| Hetzner — Alemania | Europa | EUR 8–20/mes | 200–230 ms | Lo más barato con diferencia. El dashboard se nota lento pero es usable |
| Proveedor chileno | Chile | Variable | 5–20 ms | La opción si hay requisito de **residencia de datos**, algo frecuente en infraestructura eléctrica |
| On-premise en la subestación | — | Hardware | LAN | Ya no es necesario para la autonomía, pero sirve si quieres que el portal también sobreviva al corte |

**Recomendación: un VPS en São Paulo con 4 vCPU, 8 GB de RAM y 160 GB de SSD.**
Con 710 series y report-by-exception, esa máquina va sobrada — el cuello de
botella sería el disco a los dos o tres años, no la CPU.

Antes de cerrar la elección conviene preguntar al cliente final si hay
requisitos de residencia de datos. En activos eléctricos aparece seguido, y
mudar después es más caro que elegir bien ahora.

---

## Paso a paso

### 1. DNS

```
A    hoitlive.com     →  <IP del servidor>
A    www.hoitlive.com →  <IP del servidor>
```

Si `hoitlive.com` ya apunta a otro sitio, **no cambies el registro**: agrega la
regla `/cam5` a la configuración del proxy que ya tienes (ver §7).

### 2. Preparar el servidor

```bash
ssh root@<ip>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh

# Cortafuegos: sólo SSH y web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

# Usuario sin privilegios para operar el stack
adduser --disabled-password --gecos "" cam5
usermod -aG docker cam5
```

### 3. Desplegar

```bash
su - cam5
git clone <tu-repo> cam5 && cd cam5     # o sube el zip y descomprime
cp .env.prod.example .env
nano .env                                # define POSTGRES_PASSWORD y CAM5_PUBLIC_URL
docker compose -f docker-compose.prod.yml up -d --build
```

### 4. Crear el esquema y sembrar

```bash
docker compose -f docker-compose.prod.yml exec api node src/migrate.ts
docker compose -f docker-compose.prod.yml exec api node src/seed.ts
```

`seed.ts` imprime la clave y el secreto del gateway **una sola vez**. Guárdalos
en el gestor de contraseñas antes de cerrar la terminal: no se pueden recuperar.

### 5. Verificar

```bash
curl https://hoitlive.com/cam5/api/v1/health
# {"status":"ok","timestamp":"…","dbLatencyMs":3}
```

Y abre `https://hoitlive.com/cam5` en el navegador.

### 6. Apuntar el gateway

En el gateway, `/etc/cam5-gw/config`:

```
CAM5_CORE_URL=https://hoitlive.com/cam5/api/v1
CAM5_GATEWAY_KEY=<la clave que imprimió el seed>
CAM5_GATEWAY_SECRET=<el secreto que imprimió el seed>
CAM5_GATEWAY_ID=CAM5-GW-01
```

La firma HMAC se calcula sobre la ruta **que ve la API**, sin el prefijo
`/cam5`. Es decir `POST\n/api/v1/ingest/telemetry\n…`, tal como está en
`CAM5_GATEWAY_SPEC.md` §3.2. El proxy quita el prefijo antes de entregar la
petición, así que el gateway no debe incluirlo al firmar.

### 7. Si ya sirves otra cosa en `hoitlive.com`

Agrega estas dos reglas **antes** de la que sirve el sitio actual. El orden
importa: `/cam5/api/*` tiene que evaluarse antes que `/cam5*`, y ambas antes del
comodín del sitio principal.

**Caddy**

```caddyfile
hoitlive.com {
    handle /cam5/api/* {
        uri strip_prefix /cam5
        reverse_proxy cam5-api:8787
    }
    handle /cam5* {
        reverse_proxy cam5-portal:3000
    }

    # … lo que ya tenías para el resto del sitio …
}
```

**nginx**

```nginx
location /cam5/api/ {
    rewrite ^/cam5(/api/.*)$ $1 break;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Los lotes de reinyección tras un corte son grandes.
    # El valor por defecto de nginx (1 MB) los rechaza con 413.
    client_max_body_size 32m;
    proxy_read_timeout 120s;
}

location /cam5 {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

> El `client_max_body_size` de nginx es la trampa más común de este montaje.
> Con el valor por defecto todo funciona en operación normal y **falla justo
> cuando el gateway reinyecta** un corte largo, que es el peor momento posible.
> Caddy no tiene ese límite por defecto.

---

## Operación

### Actualizar

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node src/migrate.ts
```

El esquema es idempotente, así que aplicar la migración tras cada despliegue es
seguro aunque no haya cambios.

Durante los segundos de reinicio de la API, el gateway acumula en su cola y
reinyecta al volver. No se pierde telemetría por un despliegue.

### Respaldo diario

```bash
# /etc/cron.daily/cam5-backup
#!/bin/sh
cd /home/cam5/cam5
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U cam5 -Fc cam5 > /respaldos/cam5-$(date +%F).dump
find /respaldos -name 'cam5-*.dump' -mtime +30 -delete
```

Súbelo además a almacenamiento externo (S3, B2, Drive). Un respaldo que vive en
el mismo disco que la base no protege del fallo más probable.

**Prueba la restauración completa antes de salir a producción**, y después cada
trimestre. Un respaldo que nunca se restauró no es un respaldo.

### Registros

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f rollup
```

### Qué vigilar

| Señal | Dónde | Qué significa si se dispara |
|---|---|---|
| `spool_depth` del gateway | Diagnóstico OT | El enlace hacia CORE está degradado |
| `max_lag_ms` de ingesta | Diagnóstico OT | Hubo un corte y se está reinyectando |
| Segundos sin contacto | Diagnóstico OT | El gateway lleva rato callado |
| Espacio en disco | `df -h` | La retención cruda es el consumo que crece |
| `reads_failed_24h` | Diagnóstico OT | Problema en el enlace Modbus hacia el CAM-5 |

El propio portal ya expone las cuatro primeras. Para alertar por fuera del
sistema, `GET /cam5/api/v1/health` sirve como sonda de disponibilidad.

---

## Seguridad

- **TLS obligatorio.** Caddy lo gestiona y renueva solo. No hay paso manual.
- **Postgres sin puerto publicado.** Sólo la red interna de Docker lo alcanza.
- **Contraseñas fuera del repositorio.** El `.env` va en `.gitignore`; el
  `.env.prod.example` sólo documenta los nombres.
- **Rotación de claves del gateway** sin corte: `api_key_hash_next` permite tener
  dos claves válidas mientras se hace el cambio en campo.
- **Firma HMAC** además de TLS, con ventana de ±5 minutos contra reenvío. Una
  clave filtrada en un log no basta para inyectar telemetría falsa.
- Considera `fail2ban` sobre los registros del proxy y limitar SSH a clave
  pública.

**Lo que falta antes de producción real:** la autenticación de usuario sigue
siendo un puente de desarrollo (`X-CAM5-User` o `CAM5_DEV_USER`). Cualquiera con
acceso a la URL entra como el usuario configurado. Antes de exponer el portal a
terceros hay que implementar sesión real — es la fase F7 pendiente.

---

## ¿Y Vercel? ¿Y una base de datos gratis?

Vale la pena dejarlo por escrito porque la pregunta vuelve.

### El portal sí; el sistema no

Vercel aloja el portal Next.js sin problema. El obstáculo es el backend, y son
cuatro cosas concretas, no una opinión.

**1. Los cron de Vercel en plan Hobby corren una vez al día.** No es una
recomendación: una expresión más frecuente *falla al desplegar*. El agregador de
CAM5 necesita correr cada minuto. En Pro sí se puede cada minuto.

**2. El plan Hobby es solo para uso personal, no comercial.** Está en las
*fair use guidelines* de Vercel. Un sistema de monitoreo de activos eléctricos
para un cliente es uso comercial.

**3. Las invocaciones alcanzan el techo.** Con el gateway enviando telemetría
cada 5 s más el latido cada 30 s, y **una sola pestaña del portal abierta** en
horario laboral, salen unas **985.000 invocaciones al mes** contra el millón
incluido. Sin margen para un segundo usuario.

**4. No hay procesos largos.** El agregador (`rollup --loop 60`) y la generación
asíncrona de reportes —que responde primero y sigue trabajando después— no
sobreviven: una función serverless se congela al responder. Habría que
reescribirlos como cron y como cola.

Con Vercel **Pro** (USD 20/usuario al mes) se resuelven 1, 2 y 3, y el agregador
pasa a ser un cron por minuto. Aun así hay que convertir la API Fastify en route
handlers y reescribir la generación de reportes. Sumando una Postgres pagada, el
total supera el VPS que hace todo sin tocar el código.

### Cuánto dura una base de datos gratis

Medido sobre la base real de este proyecto: **128 bytes por lectura cruda** y
**162 por fila de agregado por minuto**.

| Escenario | Escritura diaria | Cuánto dura 500 MB |
|---|---|---|
| 10 unidades, 710 series, deadband agresivo | ~553 MB/día | **0,9 días** |
| 10 unidades, 710 series, deadband típico | ~937 MB/día | **0,5 días** |

| Proveedor | Almacenamiento gratis | Aguanta |
|---|---|---|
| Neon Free | 0,5 GB por proyecto | menos de un día |
| Supabase Free | 500 MB (además pausa el proyecto tras ~7 días sin actividad) | menos de un día |
| Aurora Postgres Always Free | 1 GB por clúster | ~1–2 días |
| RDS Free | 20 GB, pero **solo 12 meses** | ~3 semanas |

A capacidad completa, ninguna capa gratuita de base de datos sirve. No es que
quede justa: se llena el primer día.

### Lo que sí cabe gratis — medido, no estimado

Con **un solo CAM-5** (71 series) y muestreo periódico, generé 30 días de datos
reales y medí el tamaño en disco. También descubrí que el **agregado por minuto
sobra** en esta configuración: con muestras cada 1–5 minutos guarda exactamente
las mismas filas que la tabla cruda y más pesadas (162 vs 128 bytes), de modo que
duplica el almacenamiento sin acelerar ninguna consulta. Desactivarlo
(`CAM5_ROLLUP_1M=false`) deja el agregado horario **idéntico**, verificado fila
por fila.

| Muestreo | Base a 30 días, con agregado 1m | Sin agregado 1m | Ahorro |
|---|---|---|---|
| cada 1 min | 716 MB | **356 MB** | 50 % |
| cada 5 min | 156 MB | **88 MB** | 44 % |

Proyección a un año, ya sin el agregado por minuto:

| Muestreo | Serie cruda/mes | Agregado horario/año | Año 1 con retención de 90 días |
|---|---|---|---|
| cada 1 min | 336 MB | 76 MB | **1.084 MB** |
| cada 5 min | 68 MB | 76 MB | **280 MB** |

**Con muestreo de 5 minutos y retención cruda de 90 días, el sistema completo
ocupa 280 MB al cabo de un año: cabe holgado en Neon Free o Supabase Free.**

| Configuración | Total año 1 | ¿Cabe en 500 MB? |
|---|---|---|
| cada 5 min, retención 90 días | 280 MB | **sí** |
| cada 5 min, retención 180 días | 484 MB | al límite |
| cada 5 min, retención 365 días | 892 MB | no |
| cada 1 min, cualquier retención | ≥ 1 GB | no |

El agregado horario **nunca se poda** y pesa apenas 76 MB al año, así que las
tendencias de largo plazo siguen disponibles para siempre aunque la serie cruda
se recorte a 90 días. Es lo que hace viable la retención corta.

Configuración para ese escenario:

```env
CAM5_SAMPLE_INTERVAL_S=300     # muestreo cada 5 minutos
CAM5_SAMPLE_MODE=periodic      # serie regular, más simple que report-by-exception
CAM5_ROLLUP_1M=false           # el agregado por minuto no aporta a este ritmo
CAM5_RAW_RETENTION_DAYS=90
CAM5_SEED_READERS=0            # una sola unidad, sin lectores IRM
```

Y en el portal, para que el tablero no se vea permanentemente atrasado:

```env
NEXT_PUBLIC_CAM5_STALE_AFTER_S=750    # 2,5 ciclos de muestreo
```

> **Este último es importante.** El umbral de frescura por defecto son 60
> segundos. Con lecturas cada 5 minutos, *toda* lectura tendría más de 60
> segundos y el portal mostraría «telemetría atrasada» de forma permanente,
> aunque el sistema esté perfecto. El servidor ahora lo deriva solo del período
> de muestreo, y lo expone en `GET /health` para poder verificarlo.

**Un servidor gratis de verdad: Oracle Cloud Always Free.** Corre el
`docker-compose.prod.yml` completo sin cambios, con 200 GB de disco. Dos
advertencias honestas: en junio de 2026 Oracle **redujo a la mitad** el ARM
gratuito —de 4 OCPU/24 GB a 2 OCPU/12 GB— sin avisar a nadie, y las instancias
que excedían el nuevo límite se apagaron hasta redimensionarlas; además conseguir
capacidad ARM es notoriamente intermitente. 2 OCPU y 12 GB siguen sobrando para
CAM5, pero es gratis-y-frágil.

### Recomendación

Con **un CAM-5 y muestreo de 5 minutos**, el panorama cambia respecto a la
capacidad completa:

- **Base de datos:** Neon Free o Supabase Free alcanzan de sobra (280 MB al año
  con retención de 90 días). Prefiere **Neon**: Supabase pausa el proyecto tras
  ~7 días de baja actividad, y una pausa en un sistema de monitoreo es
  exactamente lo que no quieres.
- **Backend y portal:** aquí Vercel sigue sin encajar, por los cron de una vez al
  día y la cláusula de uso no comercial. La opción gratuita real es **Oracle
  Always Free**; la opción sólida son los USD 20–40 del VPS.
- **Solo demostración:** el portal en Vercel en modo demostración, sin backend ni
  base de datos. Es para lo que sirve la capa gratuita.

Dicho de otro modo: a este ritmo de datos **la base de datos ya no es el
problema**; lo que decide es dónde corren la API y el agregador.

---

## Costos estimados

| Concepto | Mensual |
|---|---|
| VPS 4 vCPU / 8 GB / 160 GB (São Paulo) | USD 20–40 |
| Dominio `hoitlive.com` | ya lo tienes |
| Certificado TLS | USD 0 (Let's Encrypt) |
| Respaldo externo (S3/B2, ~10 GB) | USD 1–3 |
| **Total** | **USD 21–43** |

Con Hetzner en Alemania baja a unos USD 12–25, a cambio de la latencia.
