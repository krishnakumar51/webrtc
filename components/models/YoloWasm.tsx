import { InferenceSession, Tensor } from 'onnxruntime-web';

let session: InferenceSession | null = null;

// Memory optimization: Reusable canvas pool
let canvasPool: HTMLCanvasElement[] = [];
let tempCanvasPool: HTMLCanvasElement[] = [];
let tensorDataPool: Float32Array[] = [];

const getCanvas = (width: number, height: number): HTMLCanvasElement => {
  let canvas = canvasPool.pop();
  if (!canvas) {
    canvas = document.createElement('canvas');
  }
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const returnCanvas = (canvas: HTMLCanvasElement) => {
  if (canvasPool.length < 3) { // Limit pool size
    canvasPool.push(canvas);
  }
};

const getTensorData = (size: number): Float32Array => {
  let data = tensorDataPool.pop();
  if (!data || data.length !== size) {
    data = new Float32Array(size);
  }
  return data;
};

const returnTensorData = (data: Float32Array) => {
  if (tensorDataPool.length < 2) { // Limit pool size
    tensorDataPool.push(data);
  }
};

import { createModelCpu, runModel } from '../../utils/runModel';
import * as ort from 'onnxruntime-web';

// Configure WASM runtime so ORT can find the binaries in public directory
if (typeof window !== 'undefined') {
  try {
    // Check for cross-origin isolation
    if (!crossOriginIsolated) {
      console.warn('⚠️ Page not cross-origin isolated. SharedArrayBuffer unavailable.');
    } else {
      console.log('✅ Cross-origin isolation enabled. SharedArrayBuffer available.');
    }
    
    // Browser-specific optimizations
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    // Ultra-conservative configuration for maximum compatibility
    ort.env.wasm.numThreads = 1; // Single thread only
    ort.env.wasm.simd = false; // Disable SIMD completely
    ort.env.wasm.proxy = false; // Disable proxy
    ort.env.wasm.initTimeout = 30000; // 30 second timeout
    console.log('🔧 Using ultra-conservative WASM configuration');
    
    // Configure WASM paths with fallback
    try {
      ort.env.wasm.wasmPaths = "/";
    } catch (e) {
      console.warn('⚠️ Failed to set WASM paths, using default');
    }
    
    console.log('✅ WASM configuration:', {
      numThreads: ort.env.wasm.numThreads,
      simd: ort.env.wasm.simd,
      wasmPaths: ort.env.wasm.wasmPaths,
      crossOriginIsolated: crossOriginIsolated
    });
  } catch (e) {
    console.warn('⚠️ Failed to configure ORT wasm env:', e);
  }
}

// Streamlined inference pipeline - WASM mode uses regular model for compatibility
export const MODEL_PATH = '/models/yolov10n.onnx'; // Regular model for better compatibility
const MODEL_INPUT_SIZE = 640; // Input size for WASM mode (640x640) - required by YOLO model

export const initYoloModel = async () => {
  if (!session) {
    try {
      const loadStart = Date.now();
      session = await createModelCpu(MODEL_PATH);
      const loadTime = Date.now() - loadStart;
      
      console.log(`✅ WASM model loaded (${loadTime}ms)`);
      
    } catch (error) {
      console.error('❌ Failed to load WASM model:', error);
      throw error; // No fallback - server mode serves as alternative
    }
  }
  return session;
};

export const runYoloModel = async (imageData: ImageData) => {
  const startTime = Date.now();
  // Only log when detections are found to reduce console spam
  let shouldLog = false; // Will be set to true if detections are found
  
  if (!session) {
    console.log('🔄 YOLO WASM - Session not initialized, loading model...');
    await initYoloModel();
  }

  if (!session) {
    console.warn('⚠️ YOLO WASM - No session available after initialization, returning empty detections');
    return [];
  }

  try {
    const preprocessStart = Date.now();
    const tensor = await preprocessImage(imageData);
    const preprocessTime = Date.now() - preprocessStart;
    
    const inferenceStart = Date.now();
    const [output, inferenceTime] = await runModel(session, tensor);
    const actualInferenceTime = Date.now() - inferenceStart;
    
    const postprocessStart = Date.now();
    const detections = postprocessResults(output, imageData.width, imageData.height);
    const postprocessTime = Date.now() - postprocessStart;
    const totalTime = Date.now() - startTime;
    
    // Return tensor data to pool for memory optimization
    if (tensor.data instanceof Float32Array) {
      returnTensorData(tensor.data as Float32Array);
    }
    
    // Only log when detections are found
    if (detections.length > 0) {
      shouldLog = true;
      console.log(`🔍 WASM Detection Start - Input: ${imageData.width}x${imageData.height}`);
      console.log(`⚙️ WASM Preprocessing: ${preprocessTime}ms, Tensor shape: [${tensor.dims.join(', ')}]`);
      console.log(`🧠 WASM Inference: ${actualInferenceTime}ms, Output shape: [${output.dims.join(', ')}]`);
      console.log(`🔧 WASM Postprocessing: ${postprocessTime}ms, Found ${detections.length} detections`);
      console.log(`⏱️ WASM Total Pipeline: ${totalTime}ms (preprocess: ${preprocessTime}ms, inference: ${actualInferenceTime}ms, postprocess: ${postprocessTime}ms)`);
      console.log(`🎯 WASM Detections: ${detections.map(d => `${d.label} (${(d.score * 100).toFixed(1)}% at [${d.xmin.toFixed(3)}, ${d.ymin.toFixed(3)}, ${d.xmax.toFixed(3)}, ${d.ymax.toFixed(3)}])`).join(', ')}`);
    }
    
    return detections;
  } catch (error) {
    console.error('❌ WASM inference failed:', error);
    console.error('❌ WASM Error stack:', error);
    return [];
  }
};

const preprocessImage = async (imageData: ImageData): Promise<ort.Tensor> => {
  const { width, height, data } = imageData;
  const targetSize = MODEL_INPUT_SIZE; // Use 640x640 for regular model
  
  // Use canvas pool for memory optimization
  const canvas = getCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d')!;
  
  const tempCanvas = getCanvas(width, height);
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imageData, 0, 0);
  
  ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, targetSize, targetSize);
  
  const resizedImageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = resizedImageData.data;
  
  // Use tensor data pool for memory optimization
  const tensorDataSize = 3 * targetSize * targetSize;
  const tensorData = getTensorData(tensorDataSize);
  
  // Optimized pixel processing with reduced function calls
  const pixelCount = targetSize * targetSize;
  const channelSize = pixelCount;
  
  for (let i = 0; i < pixelCount; i++) {
    const pixelIndex = i * 4;
    tensorData[i] = pixels[pixelIndex] / 255.0; // R
    tensorData[i + channelSize] = pixels[pixelIndex + 1] / 255.0; // G
    tensorData[i + 2 * channelSize] = pixels[pixelIndex + 2] / 255.0; // B
  }
  
  const tensor = new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
  
  // Return canvases to pool
  returnCanvas(canvas);
  returnCanvas(tempCanvas);
  
  return tensor;
};

import type { Detection } from '../../types';

const postprocessResults = (output: ort.Tensor, originalWidth: number, originalHeight: number) => {
  console.log(`🔧 WASM Postprocessing - Output dims: [${output.dims.join(', ')}], Original size: ${originalWidth}x${originalHeight}`);
  
  const data = output.data as Float32Array;
  const numBoxes = output.dims[1];
  const boxSize = output.dims[2];
  
  console.log(`📊 WASM Processing ${numBoxes} boxes with ${boxSize} values each`);

  let candidates: Detection[] = [];
  let totalBoxesAboveConfThreshold = 0;
  let totalBoxesAboveScoreThreshold = 0;
  
  // YOLOv10 format: [x0, y0, x1, y1, score, cls_id] - 6 values per detection (corner coordinates)
  for (let i = 0; i < Math.min(10, numBoxes); i++) {
    const offset = i * boxSize;
    const x0 = data[offset];
    const y0 = data[offset + 1];
    const x1 = data[offset + 2];
    const y1 = data[offset + 3];
    const score = data[offset + 4];
    const classId = Math.round(data[offset + 5]);
    console.log(`🔍 WASM Raw Box ${i}: [${x0.toFixed(2)}, ${y0.toFixed(2)}, ${x1.toFixed(2)}, ${y1.toFixed(2)}, ${score.toFixed(6)}, ${classId}]`);
  }
  
  for (let i = 0; i < numBoxes; i++) {
    const offset = i * boxSize;
    const x0 = data[offset];
    const y0 = data[offset + 1];
    const x1 = data[offset + 2];
    const y1 = data[offset + 3];
    const score = data[offset + 4];
    const classId = Math.round(data[offset + 5]);
    
    if (score > 0.45) { // Confidence threshold
      totalBoxesAboveConfThreshold++;
      
      if (i < 5) { // Log first 5 boxes for debugging
        console.log(`📦 WASM Box ${i}: score=${score.toFixed(3)}, classId=${classId}, class=${YOLO_CLASSES[classId] || 'unknown'}`);
      }
      
      if (score > 0.45 && classId >= 0 && classId < YOLO_CLASSES.length) {
        totalBoxesAboveScoreThreshold++;
        
        // YOLOv10 already provides corner coordinates, just normalize to [0,1] range
        const xmin = Math.max(0, Math.min(1, x0 / MODEL_INPUT_SIZE));
        const ymin = Math.max(0, Math.min(1, y0 / MODEL_INPUT_SIZE));
        const xmax = Math.max(0, Math.min(1, x1 / MODEL_INPUT_SIZE));
        const ymax = Math.max(0, Math.min(1, y1 / MODEL_INPUT_SIZE));
        
        // Ensure xmax > xmin and ymax > ymin for valid bounding boxes
        if (xmax <= xmin || ymax <= ymin) {
          if (i < 3) console.log(`⚠️ WASM Box ${i} invalid dimensions: xmin=${xmin.toFixed(3)}, xmax=${xmax.toFixed(3)}, ymin=${ymin.toFixed(3)}, ymax=${ymax.toFixed(3)}`);
          continue; // Skip invalid boxes
        }
        
        if (i < 3) { // Log coordinate calculation for first 3 valid boxes
          console.log(`📍 WASM Box ${i} coords: raw=[${x0.toFixed(1)}, ${y0.toFixed(1)}, ${x1.toFixed(1)}, ${y1.toFixed(1)}] -> normalized=[${xmin.toFixed(3)}, ${ymin.toFixed(3)}, ${xmax.toFixed(3)}, ${ymax.toFixed(3)}]`);
        }
        
        // Ensure all values are valid numbers
        if (isFinite(score) && isFinite(xmin) && isFinite(ymin) && isFinite(xmax) && isFinite(ymax)) {
          candidates.push({
            label: YOLO_CLASSES[classId],
            score: score,
            xmin, ymin, xmax, ymax
          });
        } else {
          console.warn(`⚠️ WASM Invalid coordinates for box ${i}:`, { score, xmin, ymin, xmax, ymax });
        }
      }
    }
  }
  
  console.log(`📈 WASM Filtering: ${totalBoxesAboveConfThreshold} boxes above conf threshold, ${totalBoxesAboveScoreThreshold} above score threshold, ${candidates.length} candidates`);
  
  // Simple NMS
  candidates.sort((a, b) => b.score - a.score);
  const finalDetections: Detection[] = [];
  let nmsRemovedCount = 0;
  
  while (candidates.length > 0) {
    const det = candidates.shift();
    if (det) {
      finalDetections.push(det);
      const beforeFilter = candidates.length;
      candidates = candidates.filter(c => iou(det, c) < 0.5);
      nmsRemovedCount += beforeFilter - candidates.length;
    }
  }
  
  console.log(`🎯 WASM NMS: Removed ${nmsRemovedCount} overlapping boxes, final count: ${finalDetections.length}`);
  
  return finalDetections;
};

const iou = (box1: Detection, box2: Detection): number => {
  const x1 = Math.max(box1.xmin, box2.xmin);
  const y1 = Math.max(box1.ymin, box2.ymin);
  const x2 = Math.min(box1.xmax, box2.xmax);
  const y2 = Math.min(box1.ymax, box2.ymax);
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = (box1.xmax - box1.xmin) * (box1.ymax - box1.ymin);
  const area2 = (box2.xmax - box2.xmin) * (box2.ymax - box2.ymin);
  return intersection / (area1 + area2 - intersection);
};

// YOLO class names (COCO dataset)
export const YOLO_CLASSES = [
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