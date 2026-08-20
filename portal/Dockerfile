# Portal CAM5 — Next.js autónomo para servidor propio.
#
# El proyecto original se construía con `vinext` sobre Cloudflare Workers. Para
# un VPS se usa Next.js estándar: mismo código de `app/`, distinto empaquetado.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js resuelve las variables NEXT_PUBLIC_* en tiempo de COMPILACIÓN, no de
# ejecución: tienen que estar presentes en el build o quedan indefinidas.
ARG NEXT_PUBLIC_CAM5_API_URL=/cam5/api/v1
ARG NEXT_PUBLIC_CAM5_ASSET_ID=MCC-01
ARG NEXT_PUBLIC_CAM5_BASE_PATH=/cam5
ENV NEXT_PUBLIC_CAM5_API_URL=$NEXT_PUBLIC_CAM5_API_URL \
    NEXT_PUBLIC_CAM5_ASSET_ID=$NEXT_PUBLIC_CAM5_ASSET_ID \
    NEXT_PUBLIC_CAM5_BASE_PATH=$NEXT_PUBLIC_CAM5_BASE_PATH \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
