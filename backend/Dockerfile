# Slim Node.js image for backend (CPU-only ONNX)
FROM node:18-slim

# Install system dependencies required by onnxruntime-node and curl for health checks
RUN apt-get update && apt-get install -y \
    libc6 \
    libgcc-s1 \
    libstdc++6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./ 

# Force CPU-only install to avoid GPU artifacts
ENV NODE_ENV=production
ENV npm_config_onnxruntime_node_prebuilt_tag=cpu

# Add npm retry config for flaky downloads
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000

# Install only production dependencies
RUN npm ci --only=production --no-audit --no-fund && npm cache clean --force

# Copy server and models only
COPY backend/webrtc-server.js ./ 
COPY public/models/ ./models/

# Expose signaling port
EXPOSE 8000

# Start the server
CMD ["node", "webrtc-server.js"]
