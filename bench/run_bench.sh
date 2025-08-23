#!/bin/bash

# WebRTC VLM Detection Benchmark Script
set -e

DURATION=${1:-30}
MODE=${2:-wasm}
OUTPUT_FILE="metrics.json"

echo "🚀 Starting WebRTC VLM Detection Benchmark"
echo "Duration: ${DURATION}s"
echo "Mode: ${MODE}"
echo "Output: ${OUTPUT_FILE}"

# Ensure the server is running
if ! curl -s http://localhost:3001 > /dev/null; then
    echo "❌ Server not running. Please start the server first with ./start.sh"
    exit 1
fi

# Run Puppeteer script to collect metrics
node bench/collect_metrics.js $DURATION $MODE $OUTPUT_FILE

echo "🎯 Benchmark completed successfully!"
echo "📊 Results saved to ${OUTPUT_FILE}"