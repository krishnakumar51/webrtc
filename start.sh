#!/bin/bash

# WebRTC VLM Detection Startup Script
set -e

MODE=${MODE:-wasm}
USE_NGROK=${USE_NGROK:-true}
FRONTEND_PORT=${FRONTEND_PORT:-3001}
BACKEND_PORT=${BACKEND_PORT:-8000}

echo "🚀 Starting WebRTC VLM Detection in $MODE mode"

# Check if Docker is available
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "📦 Using Docker for deployment"
    
    # Create metrics directory
    mkdir -p ./metrics
    
    echo "Starting in $MODE mode"
    export USE_NGROK
    docker-compose up --build
else
    echo "📱 Using local Node.js deployment"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        npm install
    fi
    
    # Create metrics directory
    mkdir -p ./metrics
    
    # Setup ngrok first if requested
    setup_ngrok
    
    # Build the project
    echo "🔨 Building project..."
    npm run build
    
    echo "🚦 Starting backend signaling server (WebRTC) on port $BACKEND_PORT"
    PORT=$BACKEND_PORT npm run server &
    SERVER_PID=$!
    
    echo "🌐 Starting frontend (Next.js) on port $FRONTEND_PORT"
    npm start &
    FRONTEND_PID=$!
    
    echo "✅ Services started successfully!"
    if [ "$USE_NGROK" = "true" ] && [ ! -z "$NGROK_URL" ]; then
        echo "📱 Mobile access URL: $NGROK_URL"
        echo "💻 Local access URL: http://localhost:$FRONTEND_PORT"
    else
        echo "💻 Local access URL: http://localhost:$FRONTEND_PORT"
        echo "💡 To enable mobile access, restart with: USE_NGROK=true ./start.sh"
    fi

    wait
fi

# Handle ngrok setup
setup_ngrok() {
    if [ "$USE_NGROK" = "true" ]; then
        if command -v ngrok &> /dev/null; then
            echo "🌐 Starting ngrok tunnel for frontend on port $FRONTEND_PORT..."
            ngrok http $FRONTEND_PORT --log=stdout > ngrok.log &
            NGROK_PID=$!
            
            # Wait for ngrok to start and get the HTTPS URL
            echo "⏳ Waiting for ngrok to initialize..."
            sleep 5
            
            # Get the HTTPS URL specifically - try v3 endpoints first, then v2 tunnels
            NGROK_URL=$(curl -s http://localhost:4040/api/endpoints 2>/dev/null | jq -r '.endpoints[]? | select(.proto == "https") | .public_url' 2>/dev/null || curl -s http://localhost:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[]? | select(.proto == "https") | .public_url' 2>/dev/null)
            
            if [ -z "$NGROK_URL" ] || [ "$NGROK_URL" = "null" ]; then
                echo "⚠️ Failed to get ngrok HTTPS URL. Checking available endpoints and tunnels..."
                echo "Endpoints:"
                curl -s http://localhost:4040/api/endpoints 2>/dev/null | jq '.' || echo "No endpoints API available"
                echo "Tunnels:"
                curl -s http://localhost:4040/api/tunnels 2>/dev/null | jq '.' || echo "No tunnels API available"
                kill $NGROK_PID 2>/dev/null || true
                exit 1
            else
                export NGROK_URL
                export NEXT_PUBLIC_NGROK_URL=$NGROK_URL
                echo "✅ Ngrok HTTPS URL: $NGROK_URL"
                echo "📱 Use this URL for mobile access: $NGROK_URL"
                
                # Save ngrok URL to a file for the Next.js app to read
                echo "NEXT_PUBLIC_NGROK_URL=$NGROK_URL" > .env.local
            fi
        else
            echo "⚠️ ngrok not found. Please install ngrok and try again."
            echo "💡 Install with: npm install -g ngrok or download from https://ngrok.com/"
            exit 1
        fi
    fi
}

# Cleanup function
cleanup() {
    echo "🛑 Shutting down services..."
    if [ ! -z "$SERVER_PID" ]; then kill $SERVER_PID 2>/dev/null || true; fi
    if [ ! -z "$FRONTEND_PID" ]; then kill $FRONTEND_PID 2>/dev/null || true; fi
    if [ ! -z "$NGROK_PID" ]; then kill $NGROK_PID 2>/dev/null || true; fi
    rm -f ngrok.log .env.local
    exit 0
}
trap cleanup SIGINT SIGTERM