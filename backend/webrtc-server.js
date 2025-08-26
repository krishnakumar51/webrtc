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
const MODEL_PATH = path.join(__dirname, 'models', 'yolov10n.onnx'); // Server uses 640x640 model

// Performance optimization: frame processing throttling
const frameProcessingQueue = new Map(); // room -> last processing time
const FRAME_PROCESSING_INTERVAL = 100; // Minimum 100ms between frames per room

(async () => {
  try {
    const startTime = Date.now();
    
    // Optimized session options for better performance
    const sessionOptions = {
      executionProviders: [
        {
          name: 'cpu',
          useArena: false, // Disable memory arena for lower latency
          enableCpuMemArena: false,
          enableMemPattern: false,
          enableMemoryOptimization: true
        }
      ],
      graphOptimizationLevel: 'all', // Enable all graph optimizations
      enableProfiling: false, // Disable profiling for production
      logSeverityLevel: 3, // Only log errors
      logVerbosityLevel: 0,
      executionMode: 'sequential', // Sequential execution for consistency
      interOpNumThreads: 1, // Single thread for inter-op to reduce overhead
      intraOpNumThreads: 0 // Use all available cores for intra-op
    };
    
    session = await ort.InferenceSession.create(MODEL_PATH, sessionOptions);
    const loadTime = Date.now() - startTime;
    
    console.log(`✅ YOLO model loaded (${loadTime}ms)`);
  } catch (error) {
    console.error('❌ Failed to load YOLO model:', error.message);
    console.error('⚠️ Server-side inference will not work');
  }
})();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Model status and initialization endpoint
app.get('/model-status', (req, res) => {
  res.status(200).json({ 
    modelLoaded: session !== null, 
    modelPath: MODEL_PATH,
    timestamp: new Date().toISOString() 
  });
});

// Initialize model endpoint (for on-demand loading)
app.post('/initialize-model', async (req, res) => {
  try {
    if (session) {
      return res.status(200).json({ 
        success: true, 
        message: 'Model already loaded',
        modelPath: MODEL_PATH 
      });
    }
    
    console.log('🔄 Loading YOLO model on demand...');
    const startTime = Date.now();
    
    const sessionOptions = {
      executionProviders: [
        {
          name: 'cpu',
          useArena: false,
          enableCpuMemArena: false,
          enableMemPattern: false,
          enableMemoryOptimization: true
        }
      ],
      graphOptimizationLevel: 'all',
      enableProfiling: false,
      logSeverityLevel: 3,
      logVerbosityLevel: 0,
      executionMode: 'sequential',
      interOpNumThreads: 1,
      intraOpNumThreads: 0
    };
    
    session = await ort.InferenceSession.create(MODEL_PATH, sessionOptions);
    const loadTime = Date.now() - startTime;
    
    console.log(`✅ YOLO model loaded on demand (${loadTime}ms)`);
    
    res.status(200).json({ 
      success: true, 
      message: `Model loaded successfully in ${loadTime}ms`,
      modelPath: MODEL_PATH,
      loadTime 
    });
    
  } catch (error) {
    console.error('❌ Failed to load YOLO model on demand:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      modelPath: MODEL_PATH 
    });
  }
});

// Store active connections
const connections = new Map();
const phoneConnections = new Map();
const browserConnections = new Map();

// WebRTC signaling
io.on('connection', (socket) => {
  socket.on('join-room', (data) => {
    const { room, type } = data; // type: 'phone' or 'browser'
    socket.join(room);
    connections.set(socket.id, { room, type });
    
    if (type === 'phone') {
      phoneConnections.set(room, socket.id);
    } else if (type === 'browser') {
      browserConnections.set(room, socket.id);
    }

      // If a counterpart already exists, inform the newly joined client so it can connect immediately
      if (type === 'browser') {
        const existingPhoneId = phoneConnections.get(room);
        if (existingPhoneId) {
          socket.emit('peer-joined', { peerId: existingPhoneId, type: 'phone' });
        }
      } else if (type === 'phone') {
        const existingBrowserId = browserConnections.get(room);
        if (existingBrowserId) {
          socket.emit('peer-joined', { peerId: existingBrowserId, type: 'browser' });
        }
      }
      
      // Notify all clients in the room, including the sender
      io.to(room).emit('peer-joined', { peerId: socket.id, type });
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
  
  // Initialize server model when switching to server mode
  socket.on('initialize-server-model', async (data) => {
    try {
      const { room } = data;
      console.log(`🔄 Model initialization requested for room: ${room}`);
      
      if (session) {
        socket.emit('model-initialization-result', {
          success: true,
          message: 'Model already loaded',
          modelPath: MODEL_PATH,
          room
        });
        return;
      }
      
      console.log('🔄 Loading YOLO model for server mode...');
      const startTime = Date.now();
      
      const sessionOptions = {
        executionProviders: [
          {
            name: 'cpu',
            useArena: false,
            enableCpuMemArena: false,
            enableMemPattern: false,
            enableMemoryOptimization: true
          }
        ],
        graphOptimizationLevel: 'all',
        enableProfiling: false,
        logSeverityLevel: 3,
        logVerbosityLevel: 0,
        executionMode: 'sequential',
        interOpNumThreads: 1,
        intraOpNumThreads: 0
      };
      
      session = await ort.InferenceSession.create(MODEL_PATH, sessionOptions);
      const loadTime = Date.now() - startTime;
      
      console.log(`✅ YOLO model loaded for server mode (${loadTime}ms)`);
      
      socket.emit('model-initialization-result', {
        success: true,
        message: `Model loaded successfully in ${loadTime}ms`,
        modelPath: MODEL_PATH,
        loadTime,
        room
      });
      
    } catch (error) {
      console.error('❌ Failed to initialize YOLO model for server mode:', error.message);
      socket.emit('model-initialization-result', {
        success: false,
        error: error.message,
        modelPath: MODEL_PATH,
        room: data.room
      });
    }
  });
  
  // Frame processing for server mode with throttling
  socket.on('process-frame', async (data) => {
    try {
      const { frame_id, capture_ts, imageData, width, height, room } = data;
      const recv_ts = Date.now();
      
      console.log(`🔍 SERVER Detection Start - Frame ${frame_id}, Input: ${width}x${height}, Room: ${room}`);
      
      if (!session) throw new Error('Model not loaded');
      
      // Throttle frame processing per room to prevent overload
      const lastProcessTime = frameProcessingQueue.get(room) || 0;
      if (recv_ts - lastProcessTime < FRAME_PROCESSING_INTERVAL) {
        console.log(`⏭️ SERVER Skipping frame ${frame_id} due to throttling (${recv_ts - lastProcessTime}ms < ${FRAME_PROCESSING_INTERVAL}ms)`);
        return; // Skip this frame to maintain performance
      }
      frameProcessingQueue.set(room, recv_ts);
      
      // Process frame asynchronously to avoid blocking
      setImmediate(async () => {
        try {
          const preprocessStart = Date.now();
          const tensor = await preprocessImage(imageData, width, height);
          const preprocessTime = Date.now() - preprocessStart;
          console.log(`⚙️ SERVER Preprocessing: ${preprocessTime}ms, Tensor shape: [${tensor.dims.join(', ')}]`);
          
          const inferenceStart = Date.now();
          const output = await runInference(session, tensor);
          const inferenceTime = Date.now() - inferenceStart;
          console.log(`🧠 SERVER Inference: ${inferenceTime}ms, Output shape: [${output.dims.join(', ')}]`);
          
          const postprocessStart = Date.now();
          const detections = postprocessResults(output, width, height);
          const postprocessTime = Date.now() - postprocessStart;
          const totalTime = Date.now() - recv_ts;
          
          console.log(`🔧 SERVER Postprocessing: ${postprocessTime}ms, Found ${detections.length} detections`);
          console.log(`⏱️ SERVER Total Pipeline: ${totalTime}ms (preprocess: ${preprocessTime}ms, inference: ${inferenceTime}ms, postprocess: ${postprocessTime}ms)`);
          
          const inference_ts = Date.now();
          
          const result = {
            frame_id,
            capture_ts,
            recv_ts,
            inference_ts,
            detections
          };
          
          if (detections.length > 0) {
            console.log(`🎯 SERVER Detections: ${detections.map(d => `${d.label} (${(d.score * 100).toFixed(1)}% at [${d.xmin.toFixed(3)}, ${d.ymin.toFixed(3)}, ${d.xmax.toFixed(3)}, ${d.ymax.toFixed(3)}])`).join(', ')}`);
          } else {
            console.log('🔍 SERVER: No objects detected above threshold');
          }
          
          const browserSocketId = browserConnections.get(room);
          if (browserSocketId) {
            io.to(browserSocketId).emit('detection-result', result);
            console.log(`📤 SERVER Sent results to browser for frame ${frame_id}`);
          } else {
            console.warn(`⚠️ SERVER No browser connection found for room ${room}`);
          }
        } catch (processingError) {
          console.error('❌ SERVER Async frame processing error:', processingError.message);
          console.error('❌ SERVER Error stack:', processingError.stack);
          socket.emit('processing-error', { error: processingError.message });
        }
      });
      
    } catch (error) {
      console.error('❌ SERVER Frame processing error:', error.message);
      console.error('❌ SERVER Error stack:', error.stack);
      socket.emit('processing-error', { error: error.message });
    }
  });

// Optimized preprocessing with reduced Jimp overhead
async function preprocessImage(base64ImageData, width, height) {
  const targetSize = 640;
  
  try {
    if (!base64ImageData || typeof base64ImageData !== 'string') {
      throw new Error('Invalid base64 image data provided');
    }
    
    // Fast base64 to buffer conversion
    const base64Data = base64ImageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Use Jimp with minimal operations for speed
    const image = await Jimp.read(buffer);
    
    // Skip resize if already correct size (performance optimization)
    if (image.bitmap.width !== targetSize || image.bitmap.height !== targetSize) {
      image.resize(targetSize, targetSize, Jimp.RESIZE_BILINEAR); // Faster resize method
    }
    
    const pixels = image.bitmap.data;
    const tensorData = new Float32Array(3 * targetSize * targetSize);
    
    // Optimized pixel conversion with reduced array access
    const pixelCount = targetSize * targetSize;
    for (let i = 0; i < pixelCount; i++) {
      const pixelIdx = i * 4;
      tensorData[i] = pixels[pixelIdx] * 0.00392156862745098; // /255 optimized
      tensorData[i + pixelCount] = pixels[pixelIdx + 1] * 0.00392156862745098;
      tensorData[i + pixelCount * 2] = pixels[pixelIdx + 2] * 0.00392156862745098;
    }
    
    return new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
    
  } catch (error) {
    console.error('❌ Preprocessing error:', error.message);
    throw error;
  }
}

async function runInference(session, tensor) {
  try {
    if (!session) {
      throw new Error('YOLO model session is not initialized');
    }
    
    const feeds = { [session.inputNames[0]]: tensor };
    const results = await session.run(feeds);
    
    const outputTensor = results[session.outputNames[0]];
    if (!outputTensor) {
      throw new Error('Missing expected output tensor from YOLO model');
    }
    
    return outputTensor;
    
  } catch (error) {
    console.error('❌ Inference error:', error.message);
    throw error;
  }
}

function postprocessResults(output, originalWidth, originalHeight) {
  try {
    const data = output.data;
    const [_, numDets, detSize] = output.dims;
    const candidates = [];

    for (let i = 0; i < numDets; i++) {
      const offset = i * detSize;
      const x0 = data[offset];
      const y0 = data[offset + 1];
      const x1 = data[offset + 2];
      const y1 = data[offset + 3];
      const score = data[offset + 4];
      const classId = Math.round(data[offset + 5]);

      if (score > 0.45 && classId >= 0 && classId < YOLO_CLASSES.length) {
        const xmin = Math.max(0, Math.min(1, x0 / 640));
        const ymin = Math.max(0, Math.min(1, y0 / 640));
        const xmax = Math.max(0, Math.min(1, x1 / 640));
        const ymax = Math.max(0, Math.min(1, y1 / 640));

        if (xmax > xmin && ymax > ymin) {
          candidates.push({
            label: YOLO_CLASSES[classId] || `class_${classId}`,
            score: score,
            xmin: xmin,
            ymin: ymin,
            xmax: xmax,
            ymax: ymax
          });
        }
      }
    }

    // Fast NMS
    candidates.sort((a, b) => b.score - a.score);
    const finalDetections = [];
    const suppressed = new Array(candidates.length).fill(false);

    for (let i = 0; i < candidates.length; i++) {
      if (suppressed[i]) continue;
      const det = candidates[i];
      finalDetections.push(det);
      for (let j = i + 1; j < candidates.length; j++) {
        if (!suppressed[j] && fastIOU(det, candidates[j]) > 0.5) {
          suppressed[j] = true;
        }
      }
    }

    return finalDetections;
  } catch (error) {
    console.error('❌ Postprocessing error:', error.message);
    return [];
  }
}

function fastIOU(box1, box2) {
  const x1 = Math.max(box1.xmin, box2.xmin);
  const y1 = Math.max(box1.ymin, box2.ymin);
  const x2 = Math.min(box1.xmax, box2.xmax);
  const y2 = Math.min(box1.ymax, box2.ymax);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = (box1.xmax - box1.xmin) * (box1.ymax - box1.ymin);
  const area2 = (box2.xmax - box2.xmin) * (box2.ymax - box2.ymin);
  return intersection / (area1 + area2 - intersection + 1e-6);
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
      
      io.to(room).emit('peer-left', { peerId: socket.id, type });
    }
    
    connections.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = { app, server, io };