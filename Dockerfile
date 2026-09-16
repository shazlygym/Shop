FROM node:22-bookworm AS build

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY worker/package.json worker/
COPY dashboard/package.json dashboard/

RUN npm ci

COPY . .

RUN npx prisma generate --schema=api/prisma/schema.prisma
RUN npm run build

FROM node:22-bookworm AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && apt-get clean

COPY --from=build /app /app

CMD ["bash", "scripts/render-start.sh"]
