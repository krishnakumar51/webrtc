FROM node:18-bullseye

# Install system dependencies required for ONNX runtime
RUN apt-get update && apt-get install -y \
    libc6 \
    libgcc-s1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Force CPU-only install to avoid GPU NuGet bug in onnxruntime-node 1.22.0
ENV ONNXRUNTIME_PREFER_CPU=1

# Install only required dependencies
RUN npm ci --only=production --no-audit --no-fund

# Copy only the backend server file
COPY backend/webrtc-server.js ./

# Copy models directory
COPY models/ ./models/

# Expose port 8000 (avoiding Grafana on port 3000)
EXPOSE 8000

# Start the server
CMD ["node", "webrtc-server.js"]