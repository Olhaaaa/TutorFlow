# syntax=docker/dockerfile:1
#
# Образ для сервісу API. Лежить у корені, бо монорепозиторій: збірка потребує
# і packages/core, і services/api, і apps/web, тому контекст мусить бути
# коренем. Це ж дозволяє розгортати однією командою без окремого конфігу збірки.
# У лабораторній 2, коли з'явиться воркер, образи роз'їдуться по сервісах.
#
# Фронтенд збирається тут же: vite кладе бандл у services/api/static, звідки
# його віддає ServeStaticModule того самого процесу. Тому одиниця розгортання
# одна, і в Cloud Run не треба ні другого сервісу, ні налаштувань CORS.
# Стадії build-api і build-web не залежать одна від одної — BuildKit виконує
# їх паралельно.

FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

# --- залежності окремим шаром: кешується, доки не змінився lock ---
# Манифести ВСІХ воркспейсів обовʼязкові: --frozen-lockfile звіряє lock з
# кожним importer-ом, і без apps/web/package.json install падає ще до збірки.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# --- збірка бекенду ---
FROM deps AS build-api
COPY packages/core packages/core
COPY services/api services/api
RUN pnpm --filter @tutorflow/core build \
 && pnpm --filter api build

# --- збірка фронтенду: outDir у vite.config.ts веде в services/api/static ---
FROM deps AS build-web
COPY apps/web apps/web
RUN pnpm --filter web build

# --- рантайм: тільки продакшн-залежності й скомпільований код ---
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
# api... — сам api плюс його залежності по воркспейсу (core). React у рантайм
# не ставиться: бандлер уже вбудував його у статику, і сервер його не імпортує.
RUN pnpm install --frozen-lockfile --prod --filter api...
COPY --from=build-api /app/packages/core/dist packages/core/dist
COPY --from=build-api /app/services/api/dist services/api/dist
COPY --from=build-web /app/services/api/static services/api/static

USER node
# Платформа передає порт у $PORT; 8080 лише типове значення для локального запуску
EXPOSE 8080
CMD ["node", "services/api/dist/main.js"]
