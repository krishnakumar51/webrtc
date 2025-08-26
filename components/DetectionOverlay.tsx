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

  useEffect(() => {
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Use requestAnimationFrame for smooth rendering
    animationFrameRef.current = requestAnimationFrame(() => {
      if (!canvasRef.current || !videoElement) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size to match video
      const rect = videoElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;

      // Always clear the entire canvas first to remove old detections
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // If no detections, just return after clearing
      if (!detections || detections.length === 0) {
        lastDetectionsRef.current = [];
        return;
      }

      // Store current detections for comparison
      lastDetectionsRef.current = [...detections];

    // Draw detection boxes
    detections.forEach((detection) => {
      const x = detection.xmin * canvas.width;
      const y = detection.ymin * canvas.height;
      const width = (detection.xmax - detection.xmin) * canvas.width;
      const height = (detection.ymax - detection.ymin) * canvas.height;
      
      // Get colors for this object class
      const colors = getClassColor(detection.label);

      // Draw bounding box with rounded corners and shadow
      ctx.save();
      ctx.strokeStyle = colors.box;
      ctx.lineWidth = 3;
      ctx.shadowColor = colors.box + '80'; // Add transparency
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const radius = 12;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Draw label background with glassmorphism effect (positioned at top baseline middle of bounding box)
      const scorePercent = detection.score && isFinite(detection.score) ? (detection.score * 100).toFixed(1) : 'N/A';
      const label = `${detection.label} ${scorePercent}%`;
      ctx.font = 'bold 16px Segoe UI, Arial, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const textHeight = 24;
      const labelX = x + (width - textWidth) / 2 - 8; // Center horizontally on bounding box
      const labelY = y - textHeight; // Position above the bounding box
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colors.bg;
      ctx.filter = 'blur(0.5px)';
      ctx.beginPath();
      ctx.moveTo(labelX, labelY);
      ctx.lineTo(labelX + textWidth + 16, labelY);
      ctx.quadraticCurveTo(labelX + textWidth + 20, labelY, labelX + textWidth + 20, labelY + 8);
      ctx.lineTo(labelX + textWidth + 20, labelY + textHeight - 8);
      ctx.quadraticCurveTo(labelX + textWidth + 20, labelY + textHeight, labelX + textWidth + 16, labelY + textHeight);
      ctx.lineTo(labelX, labelY + textHeight);
      ctx.quadraticCurveTo(labelX - 4, labelY + textHeight, labelX - 4, labelY + textHeight - 8);
      ctx.lineTo(labelX - 4, labelY + 8);
      ctx.quadraticCurveTo(labelX - 4, labelY, labelX, labelY)
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Draw label text
      ctx.save();
      ctx.fillStyle = colors.text;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 2;
      ctx.fillText(label, labelX + 8, labelY + 16); // Position text inside label background
      ctx.restore();
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