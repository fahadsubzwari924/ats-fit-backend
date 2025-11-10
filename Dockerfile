# ========================================================================
# Multi-stage Docker build optimized for Google Cloud Run
# ========================================================================
# Build time optimization: ~15 min first build → ~2 min subsequent builds
# IMPORTANT: Cloud Run uses linux/amd64 architecture
# ========================================================================

# ========================================================================
# Stage 1: Base Image with System Dependencies (Cached Layer)
# ========================================================================
FROM --platform=linux/amd64 node:20-alpine AS base

# Install system dependencies for Puppeteer (this layer is cached)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    dumb-init

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# ========================================================================
# Stage 2: Dependencies (Separate layer for better caching)
# ========================================================================
FROM base AS dependencies

WORKDIR /usr/src/app

# Copy only package files first (better layer caching)
COPY package*.json ./

# Install ALL dependencies (needed for build)
RUN npm ci --prefer-offline --no-audit

# ========================================================================
# Stage 3: Build Stage
# ========================================================================
FROM dependencies AS builder

# Copy source code
COPY . .

# Build the application
RUN npm run build

# ========================================================================
# Stage 4: Production (Optimized & Secure)
# ========================================================================
FROM base AS production

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies (much faster)
RUN npm ci --omit=dev --prefer-offline --no-audit && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /usr/src/app/dist ./dist

# Copy necessary runtime files
COPY --from=builder --chown=nestjs:nodejs /usr/src/app/src/resume-templates ./src/resume-templates

# Switch to non-root user
USER nestjs

# Cloud Run will inject PORT env variable (default 8080)
EXPOSE 8080

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/main.js"]
