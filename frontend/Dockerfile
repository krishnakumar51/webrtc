# Multi-stage build for optimized frontend
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package*.json ./
# Install dependencies with optimizations
RUN npm ci --only=production --no-audit --no-fund --prefer-offline && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund --prefer-offline

# Copy configuration files first (better caching)
COPY next.config.js tailwind.config.js postcss.config.js tsconfig.json .eslintrc.json types.d.ts ./

# Copy source files
COPY components/ ./components/
COPY pages/ ./pages/
COPY styles/ ./styles/
COPY utils/ ./utils/
COPY data/ ./data/

# Copy only essential models (reduce build size)
COPY public/models/yolov10n-int8-320.onnx ./public/models/
COPY public/favicon.svg public/icon.png public/manifest.json ./public/

# Build with optimizations
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Production environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Create user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only production dependencies
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy the public folder (only essential files)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy the built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Expose port 3001
EXPOSE 3001

# Health check for faster container startup detection
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["node", "server.js"]