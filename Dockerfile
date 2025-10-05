# Multi-stage build optimized for Google Cloud Run
FROM node:20-alpine AS development

# Install system dependencies for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install system dependencies for Cloud Run + Puppeteer
RUN apk add --no-cache \
    dumb-init \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer environment for Cloud Run
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# Create app user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from development stage
COPY --from=development /usr/src/app/dist ./dist

# Copy necessary files
COPY --from=development /usr/src/app/src/resume-templates ./src/resume-templates

# Change ownership to app user
RUN chown -R nestjs:nodejs /usr/src/app
USER nestjs

# Expose port (Cloud Run will set PORT environment variable)
EXPOSE 8080

# Use dumb-init to handle signals properly in Cloud Run
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/main.js"]
