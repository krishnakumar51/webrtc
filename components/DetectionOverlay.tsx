import React, { useEffect, useRef } from 'react';
import type { Detection } from '../types';

// Color mapping for different object classes
const getClassColor = (label: string): { box: string; bg: string; text: string } => {
  const colorMap: { [key: string]: { box: string; bg: string; text: string } } = {
    'person': { box: '#ef4444', bg: '#dc2626', text: '#ffffff' }, // red
    'car': { box: '#3b82f6', bg: '#2563eb', text: '#ffffff' }, // blue
    'truck': { box: '#3b82f6', bg: '#2563eb', text: '#ffffff' }, // blue
    'bus': { box: '#3b82f6', bg: '#2563eb', text: '#ffffff' }, // blue
    'motorcycle': { box: '#8b5cf6', bg: '#7c3aed', text: '#ffffff' }, // purple
    'bicycle': { box: '#10b981', bg: '#059669', text: '#ffffff' }, // emerald
    'dog': { box: '#f59e0b', bg: '#d97706', text: '#ffffff' }, // amber
    'cat': { box: '#f59e0b', bg: '#d97706', text: '#ffffff' }, // amber
    'bird': { box: '#06b6d4', bg: '#0891b2', text: '#ffffff' }, // cyan
    'bottle': { box: '#84cc16', bg: '#65a30d', text: '#ffffff' }, // lime
    'cup': { box: '#84cc16', bg: '#65a30d', text: '#ffffff' }, // lime
    'chair': { box: '#a855f7', bg: '#9333ea', text: '#ffffff' }, // violet
    'couch': { box: '#a855f7', bg: '#9333ea', text: '#ffffff' }, // violet
    'tv': { box: '#ec4899', bg: '#db2777', text: '#ffffff' }, // pink
    'laptop': { box: '#ec4899', bg: '#db2777', text: '#ffffff' }, // pink
  };
  
  return colorMap[label] || { box: '#38bdf8', bg: '#0ea5e9', text: '#ffffff' }; // default sky
};

interface DetectionOverlayProps {
  detections: Detection[];
  videoElement: HTMLVideoElement | null;
}

const DetectionOverlay: React.FC<DetectionOverlayProps> = ({ detections, videoElement }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDetectionsRef = useRef<Detection[]>([]);
  const animationFrameRef = useRef<number>();
  const lastCanvasSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Skip rendering if detections haven't changed significantly
    const detectionsChanged = !lastDetectionsRef.current || 
      lastDetectionsRef.current.length !== detections.length ||
      JSON.stringify(lastDetectionsRef.current) !== JSON.stringify(detections);

    if (!detectionsChanged && detections.length > 0) {
      return; // Skip unnecessary redraws
    }

    // Use requestAnimationFrame for smooth rendering
    animationFrameRef.current = requestAnimationFrame(() => {
      if (!canvasRef.current || !videoElement) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size to match video (only if changed)
      const rect = videoElement.getBoundingClientRect();
      const newWidth = Math.floor(rect.width);
      const newHeight = Math.floor(rect.height);
      
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        lastCanvasSizeRef.current = { width: newWidth, height: newHeight };
      }

      // Always clear the entire canvas first to remove old detections
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // If no detections, just return after clearing
      if (!detections || detections.length === 0) {
        lastDetectionsRef.current = [];
        return;
      }

      // Store current detections for comparison
      lastDetectionsRef.current = [...detections];

      // Optimize canvas settings for better performance
      ctx.imageSmoothingEnabled = false; // Disable antialiasing for better performance
      ctx.textBaseline = 'top';

    // Draw detection boxes with optimized rendering
    ctx.lineWidth = 2;
    ctx.font = '14px Arial, sans-serif';
    
    detections.forEach((detection) => {
      const x = Math.floor(detection.xmin * canvas.width);
      const y = Math.floor(detection.ymin * canvas.height);
      const width = Math.floor((detection.xmax - detection.xmin) * canvas.width);
      const height = Math.floor((detection.ymax - detection.ymin) * canvas.height);
      
      // Get colors for this object class
      const colors = getClassColor(detection.label);

      // Draw simple bounding box (no shadows or rounded corners for performance)
      ctx.strokeStyle = colors.box;
      ctx.strokeRect(x, y, width, height);

      // Draw simple label (optimized for performance)
      const scorePercent = detection.score && isFinite(detection.score) ? (detection.score * 100).toFixed(0) : 'N/A';
      const label = `${detection.label} ${scorePercent}%`;
      const textWidth = ctx.measureText(label).width;
      const textHeight = 16;
      const labelX = x;
      const labelY = y - textHeight - 2;
      
      // Draw simple label background
      ctx.fillStyle = colors.bg;
      ctx.fillRect(labelX, labelY, textWidth + 6, textHeight + 2);
      
      // Draw label text
      ctx.fillStyle = colors.text;
      ctx.fillText(label, labelX + 3, labelY + 2);
    });
    });

    // Cleanup function
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [detections, videoElement]);

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !videoElement) return;
      const rect = videoElement.getBoundingClientRect();
      canvasRef.current.width = rect.width;
      canvasRef.current.height = rect.height;
      // Trigger redraw by updating detections dependency
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [videoElement]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 10 }}
    />
  );
};

export default DetectionOverlay;