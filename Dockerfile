# Book by the People: one container with Next.js, eSpeak NG (audiobook voice) and ffmpeg (video).
# Media is made inside this server after a release, so run it as a long-lived service
# (Railway, Render, Fly), not on serverless functions.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends espeak-ng ffmpeg fonts-dejavu-core openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The Postgres schema is chosen when DATABASE_URL is postgres://. The build only needs the
# URL's shape, not a live database.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=$DATABASE_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 \
    LOCAL_MODELS=off AUTH_DEV_EXPOSE_LINKS=false FFMPEG_PATH=/usr/bin/ffmpeg
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/generated ./src/generated
RUN useradd --create-home --uid 1001 app && mkdir -p /app/data && chown -R app /app/data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Creates or updates tables (never drops data: db push stops on a destructive change), then serves.
CMD ["sh", "-c", "node scripts/prisma-schema.mjs && npx prisma db push --skip-generate && npx next start --hostname 0.0.0.0 -p ${PORT:-3000}"]
