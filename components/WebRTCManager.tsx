import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { initYoloModel, runYoloModel } from './models/YoloWasm';
import type { Detection } from '../types';

interface WebRTCManagerProps {
  socket: Socket | null;
  mode: 'wasm' | 'server';
  roomId: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  onMetricsUpdate: (metrics: any) => void;
}

const WebRTCManager = forwardRef<any, WebRTCManagerProps>(({
  socket,
  mode,
  roomId,
  videoRef,
  onMetricsUpdate
}, ref) => {
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const isDetecting = useRef(false);
  const frameQueue = useRef<any[]>([]);
  const processingFrame = useRef(false);
  const metricsInterval = useRef<NodeJS.Timeout | null>(null);
  const frameCounter = useRef(0);
  const latencyHistory = useRef<number[]>([]);

  useImperativeHandle(ref, () => ({
    startDetection: () => {
      isDetecting.current = true;
      startMetricsCollection();
    },
    stopDetection: () => {
      isDetecting.current = false;
      stopMetricsCollection();
    }
  }));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setupSocketListeners();
    setupWebRTC();

    return () => {
      cleanup();
    };
  }, []);

  const setupWebRTC = () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    peerConnection.current = new RTCPeerConnection(configuration);

    // Handle incoming stream
    peerConnection.current.ontrack = (event) => {
      console.log('Received remote track');
      remoteStream.current = event.streams[0];
      
      if (videoRef.current) {
        videoRef.current.srcObject = remoteStream.current;
      }
    };

    // Handle data channel
    peerConnection.current.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannel(channel);
    };

    // Create data channel for sending detection results back
    dataChannel.current = peerConnection.current.createDataChannel('detections', {
      ordered: true
    });
    setupDataChannel(dataChannel.current);

    // Handle ICE candidates
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', {
          room: roomId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.current?.connectionState);
    };
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onopen = () => {
      console.log('Data channel opened');
    };

    channel.onmessage = async (event) => {
      if (!isDetecting.current) return;

      try {
        const frameData = JSON.parse(event.data);
        
        // Add to frame queue with limit
        frameQueue.current.push(frameData);
        if (frameQueue.current.length > 5) {
          frameQueue.current.shift(); // Drop old frames
        }

        // Process frames
        if (!processingFrame.current) {
          processFrameQueue();
        }
      } catch (error) {
        console.error('Error processing frame:', error);
      }
    };
  };

  const processFrameQueue = async () => {
    if (frameQueue.current.length === 0 || processingFrame.current) return;
    
    processingFrame.current = true;
    const frameData = frameQueue.current.shift();
    
    try {
      const result = await processFrame(frameData);
      
      // Send result back via data channel or socket
      if (dataChannel.current && dataChannel.current.readyState === 'open') {
        dataChannel.current.send(JSON.stringify(result));
      }
      
      frameCounter.current++;
      updateLatencyMetrics(result);
      
    } catch (error) {
      console.error('Frame processing error:', error);
    }
    
    processingFrame.current = false;
    
    // Process next frame
    if (frameQueue.current.length > 0) {
      requestAnimationFrame(() => processFrameQueue());
    }
  };

  const processFrame = async (frameData: any): Promise<any> => {
    const { frame_id, capture_ts, imageData } = frameData;
    const recv_ts = Date.now();
    
    let detections: Detection[] = [];
    let inference_ts = recv_ts;

    if (mode === 'wasm') {
      // Client-side inference using WASM
      const inference_start = Date.now();
      
      try {
        // Convert imageData to the format needed by YOLO
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        // Create ImageData from received data
        const imgData = new ImageData(
          new Uint8ClampedArray(imageData.data),
          imageData.width,
          imageData.height
        );
        
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        ctx.putImageData(imgData, 0, 0);
        
        // Run YOLO inference (this would need to be implemented)
        detections = await runYoloInference(canvas);
        
      } catch (error) {
        console.error('WASM inference error:', error);
      }
      
      inference_ts = Date.now();
      
    } else {
      // Server-side inference
      if (socket) {
        const processed = await new Promise<any>((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ detections: [], inference_ts: Date.now() });
          }, 100); // Timeout after 100ms
          
          socket.once('detection-result', (result) => {
            clearTimeout(timeout);
            resolve(result);
          });
          
          socket.emit('process-frame', {
            frame_id,
            capture_ts,
            imageData,
            room: roomId
          });
        });
        
        detections = processed.detections;
        inference_ts = processed.inference_ts;
      }
    }

    return {
      frame_id,
      capture_ts,
      recv_ts,
      inference_ts,
      detections
    };
  };

  const runYoloInference = async (canvas: HTMLCanvasElement): Promise<Detection[]> => {
    try {
      const imageData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      return await runYoloModel(imageData);
    } catch (error) {
      console.error('YOLO inference error:', error);
      return [];
    }
  };

  const updateLatencyMetrics = (result: any) => {
    const e2eLatency = Date.now() - result.capture_ts;
    latencyHistory.current.push(e2eLatency);
    
    // Keep only last 100 measurements
    if (latencyHistory.current.length > 100) {
      latencyHistory.current.shift();
    }
    
    const sorted = [...latencyHistory.current].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    
    onMetricsUpdate({
      e2eLatency: {
        current: e2eLatency,
        median,
        p95
      },
      processingFps: frameCounter.current / 30, // Assuming 30s window
      serverLatency: result.inference_ts - result.recv_ts,
      networkLatency: result.recv_ts - result.capture_ts,
      framesProcessed: frameCounter.current
    });
  };

  const startMetricsCollection = () => {
    frameCounter.current = 0;
    latencyHistory.current = [];
    
    metricsInterval.current = setInterval(() => {
      // Reset frame counter every 30 seconds for FPS calculation
      frameCounter.current = 0;
    }, 30000);
  };

  const stopMetricsCollection = () => {
    if (metricsInterval.current) {
      clearInterval(metricsInterval.current);
      metricsInterval.current = null;
    }
  };

  const setupSocketListeners = () => {
    if (!socket) return;

    socket.on('offer', async (data) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(data.offer);
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        
        socket.emit('answer', {
          room: roomId,
          answer
        });
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (peerConnection.current && data.candidate) {
        await peerConnection.current.addIceCandidate(data.candidate);
      }
    });
  };

  const cleanup = () => {
    isDetecting.current = false;
    stopMetricsCollection();
    
    if (dataChannel.current) {
      dataChannel.current.close();
    }
    
    if (peerConnection.current) {
      peerConnection.current.close();
    }
  };

  return null;
});

WebRTCManager.displayName = 'WebRTCManager';

export default WebRTCManager;