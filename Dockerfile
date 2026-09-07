# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- deps
# Dependencies are installed in their own stage so this layer is only
# rebuilt when package.json or the lockfile changes, not on every commit.
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- builder
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
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
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}

RUN npm run build

# ---------------------------------------------------------------- runner
# next.config.mjs sets output: 'standalone', so the build emits a minimal
# server bundled with only the modules it actually traced. The runner stage
# therefore ships no package.json, no npm install and no dev dependencies.
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The standalone server binds to HOSTNAME; it must be 0.0.0.0 to be reachable
# from outside the container. PORT is overridden by the platform at runtime.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nextjs -G nodejs

# server.js plus its traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are deliberately not traced, so they are copied explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# Run the standalone server directly. Using "next start" here logs
# '"next start" does not work with "output: standalone"' and ignores the
# standalone bundle entirely.
CMD ["node", "server.js"]
