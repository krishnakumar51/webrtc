FROM node:18

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create metrics directory
RUN mkdir -p /app/metrics

EXPOSE 3001 8000

# Start script that handles both modes
CMD ["sh", "-c", "if [ \"$MODE\" = \"server\" ]; then npm run server & npm start; else npm start; fi"]