import React, { useEffect, useRef } from 'react';
import type { Detection } from '../types';

interface DetectionOverlayProps {
  detections: Detection[];
  videoElement: HTMLVideoElement | null;
}

const DetectionOverlay: React.FC<DetectionOverlayProps> = ({ detections, videoElement }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !videoElement) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match video
    const rect = videoElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw detection boxes
    detections.forEach((detection) => {
      const x = detection.xmin * canvas.width;
      const y = detection.ymin * canvas.height;
      const width = (detection.xmax - detection.xmin) * canvas.width;
      const height = (detection.ymax - detection.ymin) * canvas.height;

      // Draw bounding box with rounded corners and shadow
      ctx.save();
      ctx.strokeStyle = '#38bdf8'; // Tailwind sky-400
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(56,189,248,0.5)';
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

      // Draw label background with glassmorphism effect
      const scorePercent = detection.score && isFinite(detection.score) ? (detection.score * 100).toFixed(1) : 'N/A';
      const label = `${detection.label} ${scorePercent}%`;
      ctx.font = 'bold 16px Segoe UI, Arial, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const textHeight = 24;
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#0ea5e9'; // Tailwind sky-500
      ctx.filter = 'blur(0.5px)';
      ctx.beginPath();
      ctx.moveTo(x, y - textHeight);
      ctx.lineTo(x + textWidth + 16, y - textHeight);
      ctx.quadraticCurveTo(x + textWidth + 20, y - textHeight, x + textWidth + 20, y - textHeight + 8);
      ctx.lineTo(x + textWidth + 20, y - 8);
      ctx.quadraticCurveTo(x + textWidth + 20, y, x + textWidth + 16, y);
      ctx.lineTo(x, y);
      ctx.quadraticCurveTo(x - 4, y, x - 4, y - 8);
      ctx.lineTo(x - 4, y - textHeight + 8);
      ctx.quadraticCurveTo(x - 4, y - textHeight, x, y - textHeight);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Draw label text
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 2;
      ctx.fillText(label, x + 8, y - 10);
      ctx.restore();
    });
  }, [detections, videoElement]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 10 }}
    />
  );
};

export default DetectionOverlay;