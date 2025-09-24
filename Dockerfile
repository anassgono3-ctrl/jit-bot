# Multi-stage Dockerfile for JIT Bot Foundation
# Node 20 with npm (more stable than pnpm in CI)

FROM node:20-alpine AS base

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
FROM base AS deps
RUN npm install --frozen-lockfile

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json ./
RUN npm install --only=production

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