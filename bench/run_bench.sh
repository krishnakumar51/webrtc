#!/bin/bash

# WebRTC VLM Detection Benchmark Script
set -e

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [--duration SECONDS] [--mode wasm|server] [--output FILE]"
      echo "  --duration: Benchmark duration in seconds (default: 30)"
      echo "  --mode: Detection mode - wasm or server (default: wasm)"
      echo "  --output: Output metrics file (default: metrics.json)"
      exit 0
      ;;
    *)
      # Support legacy positional arguments
      if [[ -z "$DURATION" ]]; then
        DURATION="$1"
      elif [[ -z "$MODE" ]]; then
        MODE="$1"
      elif [[ -z "$OUTPUT_FILE" ]]; then
        OUTPUT_FILE="$1"
      fi
      shift
      ;;
  esac
done

# Set defaults
DURATION=${DURATION:-30}
MODE=${MODE:-wasm}
OUTPUT_FILE=${OUTPUT_FILE:-"metrics.json"}

# Validate inputs
if ! [[ "$DURATION" =~ ^[0-9]+$ ]] || [ "$DURATION" -lt 5 ]; then
    echo "❌ Duration must be a number >= 5 seconds"
    exit 1
fi

if [[ "$MODE" != "wasm" && "$MODE" != "server" ]]; then
    echo "❌ Mode must be 'wasm' or 'server'"
    exit 1
fi

echo "🚀 Starting WebRTC VLM Detection Benchmark"
echo "Duration: ${DURATION}s"
echo "Mode: ${MODE}"
echo "Output: ${OUTPUT_FILE}"

# Enhanced server health check with retry logic
echo "🔍 Checking server availability..."
for i in {1..10}; do
    if curl -s --max-time 5 http://localhost:3001/api/health > /dev/null 2>&1; then
        echo "✅ Server is healthy and ready"
        break
    elif [ $i -eq 10 ]; then
        echo "❌ Server not responding after 10 attempts. Please start the server first with ./start.sh"
        exit 1
    else
        echo "⏳ Waiting for server... (attempt $i/10)"
        sleep 2
    fi
done

# Create metrics directory if it doesn't exist
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Run Puppeteer script to collect metrics with error handling
echo "📊 Starting metrics collection..."
if ! node bench/collect_metrics.js "$DURATION" "$MODE" "$OUTPUT_FILE"; then
    echo "❌ Benchmark failed. Check the logs above for details."
    exit 1
fi

echo "🎯 Benchmark completed successfully!"
echo "📊 Results saved to ${OUTPUT_FILE}"

# Display quick summary if jq is available
if command -v jq &> /dev/null && [ -f "$OUTPUT_FILE" ]; then
    echo "\n📈 Quick Summary:"
    echo "   FPS: $(jq -r '.performance.processed_fps // "N/A"' "$OUTPUT_FILE")"
    echo "   E2E Latency (median): $(jq -r '.performance.e2e_latency.median_ms // "N/A"' "$OUTPUT_FILE")ms"
    echo "   Detection Rate: $(jq -r '.benchmark.detection_rate_percent // "N/A"' "$OUTPUT_FILE")%"
fi