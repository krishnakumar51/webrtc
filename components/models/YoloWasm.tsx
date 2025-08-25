import { InferenceSession, Tensor } from 'onnxruntime-web';

let session: InferenceSession | null = null;

import { createModelCpu, runModel } from '../../utils/runModel';
import * as ort from 'onnxruntime-web';

// Configure WASM runtime so ORT can find the binaries that next.config.js copies
if (typeof window !== 'undefined') {
  try {
    // Prefer SIMD if available; keep threads to 1 to avoid needing threaded wasm binaries
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = 1;
    // This matches next.config.js CopyPlugin target ("static/chunks/pages")
    ort.env.wasm.wasmPaths = '/_next/static/chunks/pages/';
    console.log('🔧 YOLO WASM - Configured ORT wasm paths:', ort.env.wasm.wasmPaths);
  } catch (e) {
    console.warn('⚠️ YOLO WASM - Failed to configure ORT wasm env; will rely on defaults', e);
  }
}

// Using YOLOv10n quantized model for low-resource optimization
export const MODEL_PATH = '/models/yolov10n-int8-320.onnx'; // Use quantized int8 model for better performance

export const initYoloModel = async () => {
  if (!session) {
    try {
      console.log('🚀 YOLO WASM - Starting model initialization...');
      console.log('🤖 YOLO WASM - Initializing model for mobile inference...');
      console.log('📁 YOLO WASM - Loading model from:', MODEL_PATH);
      
      const loadStart = Date.now();
      session = await createModelCpu(MODEL_PATH);
      const loadTime = Date.now() - loadStart;
      
      console.log(`✅ YOLO WASM - Model loaded successfully in ${loadTime}ms`);
      console.log('✅ YOLO WASM - Model loaded successfully for mobile devices');
      console.log('🔧 YOLO WASM - Ready for client-side inference (HTTPS compatible)');
      
      // Log session metadata if available
      if (session && session.inputNames) {
        console.log('📊 YOLO WASM - Model input names:', session.inputNames);
        console.log('📊 YOLO WASM - Model output names:', session.outputNames);
      }
      
    } catch (error) {
      console.error('❌ YOLO WASM - Failed to load model:', error);
      console.error('❌ YOLO WASM - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.warn('⚠️ YOLO WASM - Mobile inference may not work without model');
      
      // Return null instead of throwing to prevent crashes
      return null;
    }
  }
  return session;
};

export const runYoloModel = async (imageData: ImageData) => {
  if (!session) {
    console.log('🔄 YOLO WASM - Session not initialized, loading model...');
    await initYoloModel();
  }

  if (!session) {
    console.warn('⚠️ YOLO WASM - No session available after initialization, returning empty detections');
    return [];
  }

  try {
    console.log('🧠 YOLO WASM - Starting inference...');
    console.log('📐 YOLO WASM - Input image dimensions:', imageData.width, 'x', imageData.height);
    
    const preprocessStart = Date.now();
    const tensor = await preprocessImage(imageData);
    const preprocessTime = Date.now() - preprocessStart;
    console.log(`⚙️ YOLO WASM - Preprocessing completed in ${preprocessTime}ms`);
    
    const [output, inferenceTime] = await runModel(session, tensor);
    console.log(`🚀 YOLO WASM - Model inference completed in ${inferenceTime}ms`);
    
    const postprocessStart = Date.now();
    const detections = postprocessResults(output, imageData.width, imageData.height);
    const postprocessTime = Date.now() - postprocessStart;
    console.log(`🔧 YOLO WASM - Postprocessing completed in ${postprocessTime}ms`);
    
    const totalTime = preprocessTime + inferenceTime + postprocessTime;
    
    if (detections.length > 0) {
      console.log(`🎯 YOLO WASM - Detected ${detections.length} objects (total: ${totalTime}ms)`);
      console.log('📊 YOLO WASM - Detection breakdown:', detections.map(d => `${d.label}: ${d.score && isFinite(d.score) ? d.score.toFixed(3) : 'N/A'}`));
    } else {
      console.log(`🔍 YOLO WASM - No objects detected (total: ${totalTime}ms)`);
    }
    
    return detections;
  } catch (error) {
    console.error('❌ YOLO WASM - Inference error:', error);
    console.error('❌ YOLO WASM - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('⚠️ YOLO WASM - This may affect mobile object detection');
    return [];
  }
};

const preprocessImage = async (imageData: ImageData): Promise<ort.Tensor> => {
  const { width, height, data } = imageData;
  const targetSize = 320; // Downscale to 320x320 for low-resource
  
  console.log(`📐 YOLO WASM - Preprocessing: ${width}x${height} -> ${targetSize}x${targetSize}`);
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = targetSize;
  canvas.height = targetSize;
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCanvas.width = width;
  tempCanvas.height = height;
  tempCtx.putImageData(imageData, 0, 0);
  
  ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, targetSize, targetSize);
  
  const resizedImageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = resizedImageData.data;
  
  console.log('🔄 YOLO WASM - Converting pixels to tensor format...');
  const tensorData = new Float32Array(3 * targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    const pixelIndex = i * 4;
    const tensorIndex = i;
    tensorData[tensorIndex] = pixels[pixelIndex] / 255.0; // R
    tensorData[tensorIndex + targetSize * targetSize] = pixels[pixelIndex + 1] / 255.0; // G
    tensorData[tensorIndex + 2 * targetSize * targetSize] = pixels[pixelIndex + 2] / 255.0; // B
  }
  
  const tensor = new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
  console.log('✅ YOLO WASM - Tensor created with shape:', tensor.dims);
  
  return tensor;
};

import type { Detection } from '../../types';

const postprocessResults = (output: ort.Tensor, originalWidth: number, originalHeight: number) => {
  // Simplified YOLO postprocessing with NMS
  // Assuming output shape [1, num_boxes, 85] (x,y,w,h,conf + 80 classes)

  console.log('🔧 YOLO WASM - Postprocessing output tensor with shape:', output.dims);
  
  const detections: Detection[] = [];
  const data = output.data as Float32Array;
  const numBoxes = output.dims[1];
  const boxSize = output.dims[2];
  
  console.log(`📊 YOLO WASM - Processing ${numBoxes} boxes with ${boxSize} values each`);

  let candidates: Detection[] = [];
  for (let i = 0; i < numBoxes; i++) {
    const offset = i * boxSize;
    const conf = data[offset + 4];
    if (conf > 0.5) {
      const classScores = data.slice(offset + 5, offset + boxSize);
      const maxClass = Math.max(...classScores);
      const classId = classScores.indexOf(maxClass);
      if (maxClass * conf > 0.25 && classId >= 0 && classId < YOLO_CLASSES.length) {
        const x = data[offset];
        const y = data[offset + 1];
        const w = data[offset + 2];
        const h = data[offset + 3];
        const xmin = Math.max(0, (x - w/2) / output.dims[3]);
        const ymin = Math.max(0, (y - h/2) / output.dims[2]);
        const xmax = Math.min(1, (x + w/2) / output.dims[3]);
        const ymax = Math.min(1, (y + h/2) / output.dims[2]);
        const finalScore = maxClass * conf;
        
        // Ensure all values are valid numbers
        if (isFinite(finalScore) && isFinite(xmin) && isFinite(ymin) && isFinite(xmax) && isFinite(ymax)) {
          candidates.push({
            label: YOLO_CLASSES[classId],
            score: finalScore,
            xmin, ymin, xmax, ymax
          });
        }
      }
    }
  }
  
  // Simple NMS
  candidates.sort((a, b) => b.score - a.score);
  const finalDetections: Detection[] = [];
  while (candidates.length > 0) {
    const det = candidates.shift();
    if (det) {
      finalDetections.push(det);
      candidates = candidates.filter(c => iou(det, c) < 0.5);
    }
  }
  
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