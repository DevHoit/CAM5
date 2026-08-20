# Portal CAM5 — empaquetado para servidor propio

Esta carpeta contiene sólo el andamiaje de despliegue. **El código de la
interfaz va en `app/`**, tal cual sale de `cam5-frontend.zip`.

```bash
cd portal
unzip ../cam5-frontend.zip
mv cam5-frontend/app .
cp cam5-frontend/README.md app/README.md   # opcional
rm -rf cam5-frontend
```

También hacen falta `postcss.config.mjs`, `tsconfig.json` y `public/` del
proyecto original.

## Un cambio de empaquetado, no de código

El proyecto original se construye con **`vinext` sobre Cloudflare Workers**.
Para un VPS se usa **Next.js estándar**: el mismo código de `app/`, con
`next build && next start` en vez de `vinext build`. Por eso este
`package.json` no incluye `vinext`, `wrangler` ni el plugin de Cloudflare.

Si más adelante prefieres volver a Workers, el código de la interfaz no cambia
— sólo el `package.json` y el `next.config.ts`.

## Variables de compilación

Next.js resuelve las variables `NEXT_PUBLIC_*` **en tiempo de compilación**, no
de ejecución. Si faltan en el `docker build`, quedan indefinidas en el bundle y
el portal arranca en modo demostración aunque el backend esté disponible.

| Variable | Producción | Desarrollo |
|---|---|---|
| `NEXT_PUBLIC_CAM5_API_URL` | `/cam5/api/v1` | `http://localhost:8787/api/v1` |
| `NEXT_PUBLIC_CAM5_BASE_PATH` | `/cam5` | vacío |
| `NEXT_PUBLIC_CAM5_ASSET_ID` | `MCC-01` | `MCC-01` |

En producción la URL de la API es **relativa**: portal y API comparten origen
bajo `/cam5`, así que el navegador nunca cruza orígenes y CORS no interviene.

## Desarrollo local

```bash
npm install
NEXT_PUBLIC_CAM5_API_URL=http://localhost:8787/api/v1 npm run dev
```

Sin `NEXT_PUBLIC_CAM5_API_URL` el portal arranca en modo demostración con los
datos simulados, sin necesitar backend.
