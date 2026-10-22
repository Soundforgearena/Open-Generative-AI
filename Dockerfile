# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- deps
# Dependencies are installed in their own stage so this layer is only
# rebuilt when package.json or the lockfile changes, not on every commit.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- builder
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Next.js inlines NEXT_PUBLIC_* values into the compiled output at build time,
# not at container start, so Railway must pass these in as build arguments
# (Railway forwards service variables of the same name automatically when a
# Dockerfile declares them with ARG). Without this, the client bundle ships
# with these permanently undefined even though the running container has them.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_DEMO_MODE
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_DROPBOX_APP_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}
ENV NEXT_PUBLIC_DROPBOX_APP_KEY=${NEXT_PUBLIC_DROPBOX_APP_KEY}

RUN npm run build

# ---------------------------------------------------------------- runner
# next.config.mjs sets output: 'standalone', so the build emits a minimal
# server bundled with only the modules it actually traced. The runner stage
# therefore ships no package.json, no npm install and no dev dependencies.
# Debian (glibc) rather than Alpine: the lyric-timing model's runtime ships
# only glibc builds.
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The standalone server binds to HOSTNAME; it must be 0.0.0.0 to be reachable
# from outside the container. PORT is overridden by the platform at runtime.
ENV HOSTNAME=0.0.0.0
# Commit baked in by the GitHub image workflow, so /api/health reports the
# revision even when Railway deploys a prebuilt image (no RAILWAY_GIT_* vars).
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
ENV PORT=3000

# ffmpeg renders the finished video (scenes joined, soundtrack, watermark)
# and cuts song slices. Python runs the lyric-timing model.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Lyric timing: faster-whisper with the "small" model baked into the image,
# so timing never depends on a download at request time.
RUN python3 -m venv /opt/whisper/venv \
  && /opt/whisper/venv/bin/pip install --no-cache-dir faster-whisper==1.2.1 \
  && /opt/whisper/venv/bin/python -c "from faster_whisper import download_model; download_model('small', output_dir='/opt/whisper/small')" \
  && test -f /opt/whisper/small/model.bin
ENV LYRIC_TIMING_PYTHON=/opt/whisper/venv/bin/python
ENV LYRIC_TIMING_MODEL_DIR=/opt/whisper/small

RUN groupadd -g 1001 nodejs \
  && useradd -u 1001 -g nodejs -M -s /usr/sbin/nologin nextjs

# server.js plus its traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are deliberately not traced, so they are copied explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/lyric_timing.py ./scripts/lyric_timing.py

USER nextjs

EXPOSE 3000

# Run the standalone server directly. Using "next start" here logs
# '"next start" does not work with "output: standalone"' and ignores the
# standalone bundle entirely.
CMD ["node", "server.js"]
