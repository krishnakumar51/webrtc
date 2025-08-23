import { InferenceSession, Tensor } from 'onnxruntime-web';

let session: InferenceSession | null = null;

import { createModelCpu, runModel } from '../../utils/runModel';
import * as ort from 'onnxruntime-web';

// Assuming YOLOv5n quantized model for low-resource
export const MODEL_PATH = '/models/yolov10n.onnx'; // Use actual yolov10n model path

export const initYoloModel = async () => {
  if (!session) {
    try {
      session = await createModelCpu(MODEL_PATH);
      console.log('YOLO model loaded successfully');
    } catch (error) {
      console.error('Failed to load YOLO model:', error);
      throw error;
    }
  }
  return session;
};

export const runYoloModel = async (imageData: ImageData) => {
  if (!session) {
    await initYoloModel();
  }

  try {
    const tensor = await preprocessImage(imageData);
    const [output, inferenceTime] = await runModel(session!, tensor);
    const detections = postprocessResults(output, imageData.width, imageData.height);
    return detections;
  } catch (error) {
    console.error('YOLO inference error:', error);
    return [];
  }
};

const preprocessImage = async (imageData: ImageData): Promise<ort.Tensor> => {
  const { width, height, data } = imageData;
  const targetSize = 320; // Downscale to 320x320 for low-resource
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
  
  const tensorData = new Float32Array(3 * targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    const pixelIndex = i * 4;
    const tensorIndex = i;
    tensorData[tensorIndex] = pixels[pixelIndex] / 255.0; // R
    tensorData[tensorIndex + targetSize * targetSize] = pixels[pixelIndex + 1] / 255.0; // G
    tensorData[tensorIndex + 2 * targetSize * targetSize] = pixels[pixelIndex + 2] / 255.0; // B
  }
  
  return new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
};

import type { Detection } from '../../types';

const postprocessResults = (output: ort.Tensor, originalWidth: number, originalHeight: number) => {
  // Simplified YOLO postprocessing with NMS
  // Assuming output shape [1, num_boxes, 85] (x,y,w,h,conf + 80 classes)

  const detections: Detection[] = [];
  const data = output.data as Float32Array;
  const numBoxes = output.dims[1];
  const boxSize = output.dims[2];

  let candidates: Detection[] = [];
  for (let i = 0; i < numBoxes; i++) {
    const offset = i * boxSize;
    const conf = data[offset + 4];
    if (conf > 0.5) {
      const classScores = data.slice(offset + 5, offset + boxSize);
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