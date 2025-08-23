FROM node:18-bullseye

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy frontend source files
COPY components/ ./components/
COPY pages/ ./pages/
COPY styles/ ./styles/
COPY public/ ./public/
COPY utils/ ./utils/
COPY data/ ./data/
COPY types.d.ts ./
COPY next.config.js ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY tsconfig.json ./
COPY .eslintrc.json ./

# Copy models to both locations
COPY models/ ./models/
COPY models/ ./public/models/

# Build the Next.js application
RUN npm run build

# Expose port 3001 (avoiding Grafana on port 3000)
EXPOSE 3001

# Start the application
CMD ["npm", "start"]