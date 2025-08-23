const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const ort = require('onnxruntime-node');
const Jimp = require('jimp');

// YOLO class names (COCO dataset)
const YOLO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush'
];

let session = null;
const MODEL_PATH = path.join(__dirname, 'models', 'yolov10n.onnx');

(async () => {
  try {
    session = await ort.InferenceSession.create(MODEL_PATH);
    console.log('Server YOLO model loaded');
  } catch (error) {
    console.error('Failed to load server YOLO model:', error);
  }
})();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store active connections
const connections = new Map();
const phoneConnections = new Map();
const browserConnections = new Map();

// WebRTC signaling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('join-room', (data) => {
    const { room, type } = data; // type: 'phone' or 'browser'
    socket.join(room);
    connections.set(socket.id, { room, type });
    
    if (type === 'phone') {
      phoneConnections.set(room, socket.id);
      console.log(`Phone joined room: ${room}`);
    } else if (type === 'browser') {
      browserConnections.set(room, socket.id);
      console.log(`Browser joined room: ${room}`);
    }
    
    // Notify other clients in the room
    socket.to(room).emit('peer-joined', { peerId: socket.id, type });
  });
  
  // WebRTC signaling messages
  socket.on('offer', (data) => {
    socket.to(data.room).emit('offer', { ...data, from: socket.id });
  });
  
  socket.on('answer', (data) => {
    socket.to(data.room).emit('answer', { ...data, from: socket.id });
  });
  
  socket.on('ice-candidate', (data) => {
    socket.to(data.room).emit('ice-candidate', { ...data, from: socket.id });
  });
  
  // Frame processing for server mode
  socket.on('process-frame', async (data) => {
    try {
      const { frame_id, capture_ts, imageData, room } = data;
      const recv_ts = Date.now();
      
      if (!session) throw new Error('Model not loaded');
      
      const tensor = await preprocessImage(imageData);
      const output = await runInference(session, tensor);
      const detections = postprocessResults(output, imageData.width, imageData.height);
      
      const inference_ts = Date.now();
      
      const result = {
        frame_id,
        capture_ts,
        recv_ts,
        inference_ts,
        detections
      };
      
      const browserSocketId = browserConnections.get(room);
      if (browserSocketId) {
        io.to(browserSocketId).emit('detection-result', result);
      }
      
    } catch (error) {
      console.error('Frame processing error:', error);
      socket.emit('processing-error', { error: error.message });
    }
  });

// Add these functions at the end
async function preprocessImage(imageData) {
  const targetSize = 320;
  const buffer = Buffer.from(imageData.data);
  const image = await Jimp.read(buffer);
  image.resize(targetSize, targetSize);
  
  const pixels = image.bitmap.data;
  const tensorData = new Float32Array(3 * targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    const idx = i * 4;
    const tIdx = i;
    tensorData[tIdx] = pixels[idx] / 255.0; // R
    tensorData[tIdx + targetSize * targetSize] = pixels[idx + 1] / 255.0; // G
    tensorData[tIdx + 2 * targetSize * targetSize] = pixels[idx + 2] / 255.0; // B
  }
  
  return new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
}

async function runInference(session, tensor) {
  const feeds = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  return results[session.outputNames[0]];
}

function postprocessResults(output, originalWidth, originalHeight) {
  const detections = [];
  const data = output.data;
  const [numBoxes, boxSize] = output.dims.slice(1);
  
  const candidates = [];
  for (let i = 0; i < numBoxes; i++) {
    const offset = i * boxSize;
    const conf = data[offset + 4];
    if (conf > 0.5) {
      const classScores = Array.from(data.slice(offset + 5, offset + boxSize));
      const maxClass = Math.max(...classScores);
      const classId = classScores.indexOf(maxClass);
      if (maxClass * conf > 0.25) {
        const x = data[offset];
        const y = data[offset + 1];
        const w = data[offset + 2];
        const h = data[offset + 3];
        const xmin = Math.max(0, (x - w/2) / output.dims[3]);
        const ymin = Math.max(0, (y - h/2) / output.dims[2]);
        const xmax = Math.min(1, (x + w/2) / output.dims[3]);
        const ymax = Math.min(1, (y + h/2) / output.dims[2]);
        candidates.push({
          label: YOLO_CLASSES[classId],
          score: maxClass * conf,
          xmin, ymin, xmax, ymax
        });
      }
    }
  }
  
  candidates.sort((a, b) => b.score - a.score);
  const finalDetections = [];
  while (candidates.length > 0) {
    const det = candidates.shift();
    finalDetections.push(det);
    candidates = candidates.filter(c => iou(det, c) < 0.5);
  }
  
  return finalDetections;
}

function iou(box1, box2) {
  const x1 = Math.max(box1.xmin, box2.xmin);
  const y1 = Math.max(box1.ymin, box2.ymin);
  const x2 = Math.min(box1.xmax, box2.xmax);
  const y2 = Math.min(box1.ymax, box2.ymax);
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = (box1.xmax - box1.xmin) * (box1.ymax - box1.ymin);
  const area2 = (box2.xmax - box2.xmin) * (box2.ymax - box2.ymin);
  return intersection / (area1 + area2 - intersection);
}
  
  // Handle metrics collection
  socket.on('report-metrics', (metrics) => {
    const connection = connections.get(socket.id);
    if (connection) {
      console.log(`Metrics from ${connection.room}:`, metrics);
      // Broadcast metrics to other clients in room
      socket.to(connection.room).emit('metrics-update', metrics);
    }
  });
  
  socket.on('disconnect', () => {
    const connection = connections.get(socket.id);
    if (connection) {
      const { room, type } = connection;
      
      if (type === 'phone') {
        phoneConnections.delete(room);
      } else if (type === 'browser') {
        browserConnections.delete(room);
      }
      
      socket.to(room).emit('peer-left', { peerId: socket.id, type });
    }
    
    connections.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 WebRTC Server running on port ${PORT}`);
});

module.exports = { app, server, io };