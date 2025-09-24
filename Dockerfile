# Multi-stage Dockerfile for JIT Bot Foundation
# Node 20 with pnpm support

FROM node:20-alpine AS base

# Enable corepack for pnpm
RUN corepack enable
RUN corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml ./

# Install dependencies
FROM base AS deps
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

# Enable corepack for pnpm
RUN corepack enable
RUN corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built application
COPY --from=build /app/dist ./dist

# Create data directory for state persistence
RUN mkdir -p /app/data

# Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S jitbot -u 1001
RUN chown -R jitbot:nodejs /app
USER jitbot

EXPOSE 3000

CMD ["node", "dist/src/index.js"]