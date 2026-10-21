# syntax=docker/dockerfile:1

# ---- Construction : dépendances, interface et serveur ----
FROM node:24-trixie-slim AS build

# Même version de npm qu'en développement (prise en compte de « allowScripts »).
RUN npm install -g npm@11.21.1

WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# better-sqlite3 télécharge son binaire précompilé pour Node 24 (aucun compilateur nécessaire).
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

# ---- Image finale : uniquement ce qui sert à l'exécution ----
FROM node:24-trixie-slim

ENV NODE_ENV=production \
    PORT=8443 \
    DATA_DIR=/data

WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/apps/server/package.json ./apps/server/package.json
COPY --from=build /src/apps/server/dist ./apps/server/dist
COPY --from=build /src/apps/web/build ./apps/web/build

# Le serveur tourne avec l'utilisateur non privilégié « node » ; seules les données sont modifiables.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "apps/server/dist/healthcheck.js"]

CMD ["node", "apps/server/dist/main.js"]
