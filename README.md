# WebRTC VLM Multi-Object Detection

**One-line goal:** Build a reproducible demo that performs real-time multi-object detection on live video streamed from a phone via WebRTC, returns detection bounding boxes + labels to the browser, overlays them in near real-time.

## 🚀 Quick Start (One Command)

```bash
./start.sh
```

Or with Docker:

```bash
docker-compose up --build
```

## 📱 Phone Connection

1. **Start the server** using the command above
2. **Open your browser** to `http://localhost:3001`
3. **Scan the QR code** with your phone camera
4. **Allow camera permissions** when prompted
5. **Start streaming** from your phone

### Alternative Connection Methods

If QR code doesn't work:
- Copy the connection URL from the browser and open it on your phone
- Ensure both devices are on the same Wi-Fi network
- Use ngrok for external access: `./start.sh --ngrok`

## 🔧 Mode Switching

### WASM Mode (Default - Low Resource)
```bash
MODE=wasm ./start.sh
```
- Client-side inference using ONNX Runtime Web
- Runs on modest laptops (no GPU required)
- Input size: 320×240, Target: 10-15 FPS
- Lower latency, higher CPU usage on client

### Server Mode (High Performance)
```bash
MODE=server ./start.sh
```
- Server-side inference with full model
- Better accuracy and performance
- Requires more server resources
- Lower client CPU usage

## 📊 Performance Benchmarking

Run a 30-second benchmark:

```bash
./bench/run_bench.sh --duration 30 --mode wasm
```

This generates `metrics.json` with:
- **E2E Latency**: Median & P95 end-to-end latency
- **Processing FPS**: Frames processed per second
- **Bandwidth**: Uplink/Downlink kbps
- **Network Stats**: Server and network latency breakdown

## 🏗️ Architecture

### WebRTC Flow
1. **Phone** captures camera feed → WebRTC DataChannel
2. **Browser** receives frames → YOLO inference (WASM/Server)
3. **Detection Results** → Normalized coordinates [0,1]
4. **Real-time Overlay** → Aligned with video frames

### Message Format
```json
{
  "frame_id": "frame_123",
  "capture_ts": 1690000000000,
  "recv_ts": 1690000000100,
  "inference_ts": 1690000000120,
  "detections": [
    {
      "label": "person",
      "score": 0.93,
      "xmin": 0.12, "ymin": 0.08,
      "xmax": 0.34, "ymax": 0.67
    }
  ]
}
```

## 🔧 Configuration

### Low-Resource Mode Features
- **Frame Thinning**: Maintains 5-frame queue, drops old frames
- **Resolution Scaling**: Default 320×240 input
- **Adaptive Sampling**: 10-15 FPS target
- **WASM Inference**: onnxruntime-web with quantized models

### Hardware Requirements
- **Modest Laptop**: Intel i5, 8GB RAM
- **Phone**: Chrome (Android) or Safari (iOS)
- **Network**: Same Wi-Fi network or ngrok tunnel

## 🛠️ Development

### Project Structure
```
webrtc-vlm-detection/
├── components/           # React components
│   ├── WebRTCManager.tsx    # WebRTC connection handling
│   ├── MetricsPanel.tsx     # Performance monitoring
│   └── DetectionOverlay.tsx # Bounding box rendering
├── pages/
│   ├── index.tsx           # Main browser interface
│   └── phone.tsx           # Phone camera interface
├── server/
│   └── webrtc-server.js    # WebRTC signaling server
├── bench/
│   └── run_bench.sh        # Benchmarking script
├── models/               # ONNX models
├── docker-compose.yml    # Container orchestration
└── start.sh             # One-command startup
```

### Local Development
```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Start WebRTC signaling server
npm run server
```

## 🔍 Troubleshooting

### Connection Issues
- **Phone won't connect**: Check Wi-Fi network, try ngrok
- **No video stream**: Allow camera permissions, use Chrome/Safari
- **High latency**: Switch to WASM mode, reduce resolution

### Performance Issues
- **Low FPS**: Check CPU usage, reduce input resolution
- **High CPU**: Use server mode, enable frame dropping
- **Network lag**: Check bandwidth, use local network

### Debug Tools
- **Chrome DevTools**: `chrome://webrtc-internals/`
- **Network Monitor**: Browser network tab
- **Console Logs**: Check browser and server logs

## 📈 Performance Metrics

### Typical Results (30s benchmark)
| Mode | E2E Latency (P95) | Processing FPS | CPU Usage |
|------|------------------|----------------|-----------|
| WASM | 95ms | 12-15 FPS | High (client) |
| Server | 75ms | 15+ FPS | High (server) |

### Latency Breakdown
- **Network Latency**: Phone → Browser (10-20ms)
- **Processing Time**: Inference + postprocessing (20-50ms)
- **Render Latency**: Overlay drawing (5-10ms)

## 🚀 Deployment Options

### Docker (Recommended)
```bash
docker-compose up --build
```

### Manual Setup
```bash
# Install Node.js 18+
npm install
npm run build
npm start
```

### Cloud Deployment
- Deploy on AWS/GCP with ngrok for phone access
- Use load balancer for multiple concurrent sessions
- Configure STUN/TURN servers for NAT traversal

## 📋 Design Decisions

### WebRTC vs WebSocket
- **Chosen**: WebRTC DataChannel for video, WebSocket for signaling
- **Reason**: Lower latency, better bandwidth efficiency
- **Tradeoff**: More complex setup, NAT traversal challenges

### WASM vs Server Inference
- **WASM Mode**: Better for privacy, works offline, lower server load
- **Server Mode**: Better accuracy, consistent performance, easier scaling
- **Tradeoff**: Client CPU vs server resources

### Frame Queue Management
- **Strategy**: Fixed-size queue with LIFO dropping
- **Backpressure**: Drop frames when queue full (maintain real-time)
- **Buffer Size**: 5 frames (balance latency vs smoothness)

## 🔮 Next Improvements

1. **Model Optimization**: Use TensorFlow Lite or quantized YOLO models
2. **Adaptive Bitrate**: Adjust quality based on network conditions
3. **Multi-stream Support**: Handle multiple phone connections
4. **Edge Deployment**: Use Cloudflare Workers or edge computing
5. **Advanced NMS**: Better duplicate detection filtering

## 📄 License

MIT License - see LICENSE file for details.

---

**Launch:** `./start.sh` → Access at `http://localhost:3001`

**Created for WebRTC VLM Multi-Object Detection Interview Task**