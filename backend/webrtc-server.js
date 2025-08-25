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
    console.log('🔄 Backend WebRTC Server - Starting YOLO model loading...');
    console.log('📁 Backend WebRTC Server - Model path:', MODEL_PATH);
    
    const startTime = Date.now();
    session = await ort.InferenceSession.create(MODEL_PATH);
    const loadTime = Date.now() - startTime;
    
    console.log(`✅ Backend WebRTC Server - YOLO model loaded successfully in ${loadTime}ms`);
    console.log('📊 Backend WebRTC Server - Model input names:', session.inputNames);
    console.log('📊 Backend WebRTC Server - Model output names:', session.outputNames);
    
    // Log input/output shapes with defensive checks
    console.log('🔍 Backend WebRTC Server - Checking session metadata availability...');
    console.log('🔍 Backend WebRTC Server - session.inputMetadata exists:', !!session.inputMetadata);
    console.log('🔍 Backend WebRTC Server - session.outputMetadata exists:', !!session.outputMetadata);
    
    if (session.inputMetadata) {
      for (const inputName of session.inputNames) {
        const inputMetadata = session.inputMetadata[inputName];
        if (inputMetadata && inputMetadata.dims) {
          console.log(`📐 Backend WebRTC Server - Input '${inputName}' shape:`, inputMetadata.dims);
        } else {
          console.log(`⚠️ Backend WebRTC Server - Input '${inputName}' metadata not available`);
        }
      }
    } else {
      console.log('⚠️ Backend WebRTC Server - inputMetadata is not available on session object');
    }
    
    if (session.outputMetadata) {
      for (const outputName of session.outputNames) {
        const outputMetadata = session.outputMetadata[outputName];
        if (outputMetadata && outputMetadata.dims) {
          console.log(`📐 Backend WebRTC Server - Output '${outputName}' shape:`, outputMetadata.dims);
        } else {
          console.log(`⚠️ Backend WebRTC Server - Output '${outputName}' metadata not available`);
        }
      }
    } else {
      console.log('⚠️ Backend WebRTC Server - outputMetadata is not available on session object');
    }
    
    console.log('🔧 Backend WebRTC Server - Ready for server-side inference');
  } catch (error) {
    console.error('❌ Backend WebRTC Server - Failed to load YOLO model:', error);
    console.error('❌ Backend WebRTC Server - Error stack:', error.stack);
    console.error('❌ Backend WebRTC Server - Please check if the model file exists and is valid');
    console.error('⚠️ Backend WebRTC Server - Server-side inference will not work');
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

// Store active connections
const connections = new Map();
const phoneConnections = new Map();
const browserConnections = new Map();

// WebRTC signaling
io.on('connection', (socket) => {
  console.log(`🔗 Backend WebRTC Server - Client connected: ${socket.id} via ${socket.conn.transport.name}`);
  
  socket.on('join-room', (data) => {
    const { room, type } = data; // type: 'phone' or 'browser'
    socket.join(room);
    connections.set(socket.id, { room, type });
    
    if (type === 'phone') {
      phoneConnections.set(room, socket.id);
      console.log(`📱 Backend WebRTC Server - Phone joined room: ${room} (Mobile device connected)`);
    } else if (type === 'browser') {
      browserConnections.set(room, socket.id);
      console.log(`💻 Backend WebRTC Server - Browser joined room: ${room} (Desktop client connected)`);
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
  
  // Frame processing for server mode
  socket.on('process-frame', async (data) => {
    try {
      const { frame_id, capture_ts, imageData, width, height, room } = data;
      const recv_ts = Date.now();
      
      if (!session) throw new Error('Model not loaded');
      
      console.log(`🔧 Backend WebRTC Server - Processing frame ${frame_id} at ${width}x${height}`);
      
      const tensor = await preprocessImage(imageData, width, height);
      const output = await runInference(session, tensor);
      const detections = postprocessResults(output, width, height);
      
      const inference_ts = Date.now();
      
      console.log(`✅ Backend WebRTC Server - Frame ${frame_id} processed, found ${detections.length} detections`);
      
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
      console.error('❌ Backend WebRTC Server - Frame processing error:', error);
      socket.emit('processing-error', { error: error.message });
    }
  });

// Add these functions at the end
async function preprocessImage(base64ImageData, width, height) {
  const targetSize = 640;
  
  try {
    console.log(`🖼️ Backend WebRTC Server - Preprocessing image: ${width}x${height} -> ${targetSize}x${targetSize}`);
    
    // Validate input
    if (!base64ImageData || typeof base64ImageData !== 'string') {
      throw new Error('Invalid base64 image data provided');
    }
    
    // Convert base64 data URL to buffer
    const base64Data = base64ImageData.replace(/^data:image\/[a-z]+;base64,/, '');
    console.log(`📏 Backend WebRTC Server - Base64 data length: ${base64Data.length} characters`);
    
    const buffer = Buffer.from(base64Data, 'base64');
    console.log(`📦 Backend WebRTC Server - Buffer size: ${buffer.length} bytes`);
    
    // Load and process image with Jimp
    console.log('🔄 Backend WebRTC Server - Loading image with Jimp...');
    const image = await Jimp.read(buffer);
    console.log(`📐 Backend WebRTC Server - Original image dimensions: ${image.bitmap.width}x${image.bitmap.height}`);
    
    // Ensure image is exactly 640x640 (should already be from frontend)
    if (image.bitmap.width !== targetSize || image.bitmap.height !== targetSize) {
      console.log(`🔧 Backend WebRTC Server - Resizing image from ${image.bitmap.width}x${image.bitmap.height} to ${targetSize}x${targetSize}`);
      image.resize(targetSize, targetSize);
    } else {
      console.log('✅ Backend WebRTC Server - Image already at target size, no resizing needed');
    }
    
    const pixels = image.bitmap.data;
    console.log(`🎨 Backend WebRTC Server - Pixel data length: ${pixels.length} (expected: ${targetSize * targetSize * 4})`);
    
    const tensorData = new Float32Array(3 * targetSize * targetSize);
    console.log('🔄 Backend WebRTC Server - Converting RGBA to RGB tensor...');
    
    // Convert RGBA to RGB and normalize to [0,1]
    for (let i = 0; i < targetSize * targetSize; i++) {
      const idx = i * 4; // RGBA format
      const tIdx = i;
      tensorData[tIdx] = pixels[idx] / 255.0; // R
      tensorData[tIdx + targetSize * targetSize] = pixels[idx + 1] / 255.0; // G
      tensorData[tIdx + 2 * targetSize * targetSize] = pixels[idx + 2] / 255.0; // B
    }
    
    console.log(`✅ Backend WebRTC Server - Tensor created successfully: shape [1, 3, ${targetSize}, ${targetSize}]`);
    console.log(`📊 Backend WebRTC Server - Tensor data range: [${Math.min(...tensorData).toFixed(3)}, ${Math.max(...tensorData).toFixed(3)}]`);
    
    return new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
    
  } catch (error) {
    console.error('❌ Backend WebRTC Server - Error in preprocessImage:', error);
    console.error('❌ Backend WebRTC Server - Error stack:', error.stack);
    console.error('❌ Backend WebRTC Server - Input parameters:', { width, height, base64Length: base64ImageData?.length });
    throw error;
  }
}

async function runInference(session, tensor) {
  try {
    console.log('🧠 Backend WebRTC Server - Starting YOLO inference...');
    console.log(`📊 Backend WebRTC Server - Input tensor shape: [${tensor.dims.join(', ')}]`);
    console.log(`📊 Backend WebRTC Server - Input tensor type: ${tensor.type}`);
    
    if (!session) {
      throw new Error('YOLO model session is not initialized');
    }
    
    const startTime = Date.now();
    const feeds = { [session.inputNames[0]]: tensor };
    
    console.log('🔄 Backend WebRTC Server - Running inference...');
    const results = await session.run(feeds);
    const inferenceTime = Date.now() - startTime;
    
    console.log(`⚡ Backend WebRTC Server - Inference completed in ${inferenceTime}ms`);
    console.log('📊 Backend WebRTC Server - Output keys:', Object.keys(results));
    
    const outputTensor = results[session.outputNames[0]];
    if (!outputTensor) {
      console.error('❌ Backend WebRTC Server - No output tensor in inference results');
      console.error('❌ Backend WebRTC Server - Available outputs:', Object.keys(results));
      throw new Error('Missing expected output tensor from YOLO model');
    }
    
    console.log(`📊 Backend WebRTC Server - Output tensor shape: [${outputTensor.dims.join(', ')}]`);
    console.log(`📊 Backend WebRTC Server - Output data length: ${outputTensor.data.length}`);
    
    return outputTensor;
    
  } catch (error) {
    console.error('❌ Backend WebRTC Server - Error in runInference:', error);
    console.error('❌ Backend WebRTC Server - Error stack:', error.stack);
    console.error('❌ Backend WebRTC Server - Session state:', session ? 'initialized' : 'null');
    throw error;
  }
}

function postprocessResults(output, originalWidth, originalHeight) {
  try {
    console.log('🔍 Backend WebRTC Server - Starting postprocessing...');
    console.log(`📊 Backend WebRTC Server - Output tensor shape: [${output.dims.join(', ')}]`);
    console.log(`📊 Backend WebRTC Server - Original image dimensions: ${originalWidth}x${originalHeight}`);
    
    const data = output.data;
    const [numBoxes, boxSize] = output.dims.slice(1);
    
    console.log(`📦 Backend WebRTC Server - Processing ${numBoxes} boxes with ${boxSize} values each`);
    console.log(`📊 Backend WebRTC Server - Data array length: ${data.length}`);
    
    const candidates = [];
    let validBoxes = 0;
    
    for (let i = 0; i < numBoxes; i++) {
      const offset = i * boxSize;
      const conf = data[offset + 4];
      
      if (conf > 0.5) {
        validBoxes++;
        const classScores = Array.from(data.slice(offset + 5, offset + boxSize));
        const maxClass = Math.max(...classScores);
        const classId = classScores.indexOf(maxClass);
        
        if (maxClass * conf > 0.25) {
          const x = data[offset];
          const y = data[offset + 1];
          const w = data[offset + 2];
          const h = data[offset + 3];
          const xmin = Math.max(0, (x - w/2) / 640);
          const ymin = Math.max(0, (y - h/2) / 640);
          const xmax = Math.min(1, (x + w/2) / 640);
          const ymax = Math.min(1, (y + h/2) / 640);
          
          const detection = {
            label: YOLO_CLASSES[classId] || `class_${classId}`,
            score: maxClass * conf,
            xmin, ymin, xmax, ymax
          };
          
          candidates.push(detection);
          
          if (candidates.length <= 5) { // Log first few detections
            console.log(`🎯 Backend WebRTC Server - Detection ${candidates.length}: ${detection.label} (${(detection.score * 100).toFixed(1)}%) at [${xmin.toFixed(3)}, ${ymin.toFixed(3)}, ${xmax.toFixed(3)}, ${ymax.toFixed(3)}]`);
          }
        }
      }
    }
    
    console.log(`📊 Backend WebRTC Server - Found ${validBoxes} boxes above confidence threshold`);
    console.log(`📊 Backend WebRTC Server - Found ${candidates.length} candidate detections`);
    
    // Apply Non-Maximum Suppression
    candidates.sort((a, b) => b.score - a.score);
    const finalDetections = [];
    let suppressedCount = 0;
    
    while (candidates.length > 0) {
      const det = candidates.shift();
      finalDetections.push(det);
      
      const beforeLength = candidates.length;
      candidates = candidates.filter(c => iou(det, c) < 0.5);
      suppressedCount += beforeLength - candidates.length;
    }
    
    console.log(`🔧 Backend WebRTC Server - NMS suppressed ${suppressedCount} overlapping detections`);
    console.log(`✅ Backend WebRTC Server - Final detections: ${finalDetections.length}`);
    
    // Log final detections
    finalDetections.forEach((det, idx) => {
      console.log(`🏷️ Backend WebRTC Server - Final detection ${idx + 1}: ${det.label} (${(det.score * 100).toFixed(1)}%)`);
    });
    
    return finalDetections;
    
  } catch (error) {
    console.error('❌ Backend WebRTC Server - Error in postprocessResults:', error);
    console.error('❌ Backend WebRTC Server - Error stack:', error.stack);
    console.error('❌ Backend WebRTC Server - Output tensor info:', {
      dims: output?.dims,
      dataLength: output?.data?.length,
      originalWidth,
      originalHeight
    });
    throw error;
  }
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
      
      io.to(room).emit('peer-left', { peerId: socket.id, type });
    }
    
    connections.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend WebRTC Server - Running on ws://${server.address().address}:${PORT}`);
  console.log(`🚀 Backend WebRTC Server - Running on port ${PORT}`);
  console.log(`🔧 Backend WebRTC Server - Signaling server ready for WebRTC connections`);
  console.log(`📱 Backend WebRTC Server - For mobile camera access, ensure HTTPS via ngrok tunnel`);
  console.log(`🌐 Backend WebRTC Server - Local access: http://localhost:${PORT}`);
  console.log(`✅ Backend WebRTC Server - Health check available at /health`);
});

module.exports = { app, server, io };