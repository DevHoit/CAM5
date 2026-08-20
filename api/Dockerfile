# Contexto de build = raíz del proyecto (necesita api/ y db/)
FROM node:22-alpine
WORKDIR /app
COPY api/package.json api/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY api/src ./src
COPY api/test ./test
COPY db /db
ENV NODE_ENV=production
ENV CAM5_DB_DIR=/db
EXPOSE 8787
CMD ["node", "src/server.ts"]
