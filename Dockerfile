# syntax=docker/dockerfile:1
#
# Образ для сервісу API. Лежить у корені, бо монорепозиторій: збірка потребує
# і packages/core, і services/api, тому контекст мусить бути коренем. Це ж
# дозволяє розгортати однією командою без окремого конфігу збірки.
# У лабораторній 2, коли з'явиться воркер, образи роз'їдуться по сервісах.

FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

# --- залежності окремим шаром: кешується, доки не змінився lock ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile

# --- збірка ---
FROM deps AS build
COPY packages/core packages/core
COPY services/api services/api
RUN pnpm --filter @tutorflow/core build \
 && pnpm --filter api build

# --- рантайм: тільки продакшн-залежності й скомпільований код ---
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/services/api/dist services/api/dist

USER node
# Платформа передає порт у $PORT; 8080 лише типове значення для локального запуску
EXPOSE 8080
CMD ["node", "services/api/dist/main.js"]
