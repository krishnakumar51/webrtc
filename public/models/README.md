# YOLO Model Directory

This directory contains YOLOv10n ONNX model files for different modes.

## Required Files:

### For WASM Mode (Client-side)
- `yolov10n-int8-320.onnx` - Quantized INT8 model optimized for web
  - Input Size: 320×320 pixels
  - Model Size: ~2.2 MB
  - Runtime: onnxruntime-web with WASM backend

### For Server Mode (Backend)
- `yolov10n.onnx` - Full precision FP32 model
  - Input Size: 640×640 pixels
  - Model Size: ~8.95 MB
  - Runtime: onnxruntime-node with CPU backend

## Download Instructions:
1. Visit: https://github.com/Hyuto/yolov10-onnxruntime-web
2. Download both model files from the `public/models/` directory
3. Place them in this directory

## Alternative Sources:
- https://github.com/Hyuto/yolov8-onnxruntime-web (for YOLOv8 models)
- Convert from PyTorch using ultralytics: `model.export(format='onnx')`
- Quantize models using ONNX quantization tools for web optimization