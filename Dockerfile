# Production image for Coolify / Docker deployments.
# Builds the Vite client, then runs the Express API + static SPA.

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/

RUN npm ci

COPY client ./client
COPY fonts ./fonts
COPY imgs ./imgs

RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json ./
COPY client/package.json ./client/

RUN npm ci --omit=dev

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p server/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
