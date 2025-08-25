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

  // Setup WebRTC on mount
  useEffect(() => {
    setupWebRTC();

    return () => {
      cleanup();
    };
  }, []);

  // Setup socket listeners when socket becomes available
  useEffect(() => {
    if (socket) {
      console.log('🔧 Setting up socket listeners in WebRTCManager');
      setupSocketListeners();
    }
  }, [socket, roomId]);

  const setupWebRTC = () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10 // Pre-gather ICE candidates for faster connection
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

    // Handle data channel from phone
    peerConnection.current.ondatachannel = (event) => {
      console.log('📡 Browser - Received data channel from phone:', event.channel.label);
      const channel = event.channel;
      if (channel.label === 'frames') {
        console.log('📡 Browser - Setting up frames data channel from phone');
        setupDataChannel(channel);
      }
    };

    // Create data channel for sending detection results back to phone
    dataChannel.current = peerConnection.current.createDataChannel('detections', {
      ordered: true
    });
    console.log('📡 Browser - Created detections data channel for sending results to phone');
    setupDataChannel(dataChannel.current);

    peerConnection.current.onconnectionstatechange = () => {
      const state = peerConnection.current?.connectionState;
      console.log('🔄 Browser - WebRTC connection state changed:', state);
      console.log('📊 Browser - ICE connection state:', peerConnection.current?.iceConnectionState);
      console.log('📊 Browser - ICE gathering state:', peerConnection.current?.iceGatheringState);
      
      if (state === 'connected') {
        console.log('✅ Browser - WebRTC peer connection established successfully');
      } else if (state === 'disconnected') {
        console.log('⚠️ Browser - WebRTC connection disconnected');
      } else if (state === 'failed') {
        console.log('❌ Browser - WebRTC connection failed');
      } else if (state === 'connecting') {
        console.log('🔄 Browser - WebRTC connection in progress...');
      }
    };

    peerConnection.current.onicegatheringstatechange = () => {
      console.log('🧊 Browser - ICE gathering state changed:', peerConnection.current?.iceGatheringState);
    };
    
    peerConnection.current.oniceconnectionstatechange = () => {
      console.log('🧊 Browser - ICE connection state changed:', peerConnection.current?.iceConnectionState);
    };
    
    peerConnection.current.onsignalingstatechange = () => {
      console.log('📡 Browser - Signaling state changed:', peerConnection.current?.signalingState);
    };

    // Handle ICE candidates
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && socket) {
        console.log('🧊 Browser - Generated ICE candidate:', event.candidate.candidate);
        console.log('📊 Browser - ICE candidate type:', event.candidate.type);
        console.log('📊 Browser - ICE candidate protocol:', event.candidate.protocol);
        socket.emit('ice-candidate', {
          room: roomId,
          candidate: event.candidate
        });
        console.log('📤 Browser - ICE candidate sent to phone');
      } else if (event.candidate === null) {
        console.log('🧊 Browser - ICE gathering completed');
      }
    };
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    console.log('📡 Browser - Setting up data channel:', channel.label, 'readyState:', channel.readyState);
    
    channel.onopen = () => {
      console.log('✅ Browser - Data channel opened:', channel.label, 'readyState:', channel.readyState);
    };

    channel.onclose = () => {
      console.log('❌ Browser - Data channel closed:', channel.label);
    };

    channel.onerror = (error) => {
      console.error('❌ Browser - Data channel error:', channel.label, error);
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
    const { frame_id, capture_ts, imageData, width, height } = frameData;
    const recv_ts = Date.now();
    
    let detections: Detection[] = [];
    let inference_ts = recv_ts;

    if (mode === 'wasm') {
      // Client-side inference using WASM - resize to 320x320
      console.log(`🧠 Frontend WebRTC Manager - Starting WASM inference for frame ${frame_id}`);
      const inference_start = Date.now();
      
      try {
        // Create canvas and load base64 image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const img = new Image();
        
        await new Promise((resolve, reject) => {
          img.onload = () => {
            console.log(`🖼️ Frontend WebRTC Manager - Image loaded for frame ${frame_id}: ${img.width}x${img.height}`);
            resolve(null);
          };
          img.onerror = (error) => {
            console.error(`❌ Frontend WebRTC Manager - Failed to load image for frame ${frame_id}:`, error);
            reject(error);
          };
          img.src = imageData; // base64 data URL
        });
        
        // Resize to 320x320 for WASM YOLO model
        const startResize = Date.now();
        canvas.width = 320;
        canvas.height = 320;
        ctx.drawImage(img, 0, 0, 320, 320);
        const resizeTime = Date.now() - startResize;
        
        console.log(`🔧 Frontend WebRTC Manager - Image resized to 320x320 in ${resizeTime}ms`);
        
        // Run YOLO inference
        const startInference = Date.now();
        detections = await runYoloInference(canvas);
        const inferenceTime = Date.now() - startInference;
        
        console.log(`⚡ Frontend WebRTC Manager - WASM inference completed in ${inferenceTime}ms`);
        console.log(`🎯 Frontend WebRTC Manager - Found ${detections.length} detections`);
        
        // Log first few detections
        detections.slice(0, 3).forEach((det, idx) => {
          const scorePercent = det.score && isFinite(det.score) ? (det.score * 100).toFixed(1) : 'N/A';
          console.log(`🏷️ Frontend WebRTC Manager - Detection ${idx + 1}: ${det.label} (${scorePercent}%)`);
        });
        
      } catch (error) {
        console.error(`❌ Frontend WebRTC Manager - WASM inference error for frame ${frame_id}:`, error);
        console.error('❌ Frontend WebRTC Manager - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      }
      
      inference_ts = Date.now();
      
    } else {
      // Server-side inference - resize to 640x640
      if (socket) {
        try {
          // Create canvas and load base64 image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          const img = new Image();
          
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageData; // base64 data URL
          });
          
          // Resize to 640x640 for server YOLO model
          canvas.width = 640;
          canvas.height = 640;
          ctx.drawImage(img, 0, 0, 640, 640);
          
          // Convert to base64 for server processing
          const resizedImageData = canvas.toDataURL('image/jpeg', 0.9);
          
          const processed = await new Promise<any>((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ detections: [], inference_ts: Date.now() });
            }, 200); // Increased timeout for server processing
            
            socket.once('detection-result', (result) => {
              clearTimeout(timeout);
              resolve(result);
            });
            
            socket.emit('process-frame', {
              frame_id,
              capture_ts,
              imageData: resizedImageData,
              width: 640,
              height: 640,
              room: roomId
            });
          });
          
          detections = processed.detections;
          inference_ts = processed.inference_ts;
        } catch (error) {
          console.error('Server inference error:', error);
          inference_ts = Date.now();
        }
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
      console.log(`📊 Frontend WebRTC Manager - Extracting image data from canvas: ${canvas.width}x${canvas.height}`);
      const imageData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      console.log(`📊 Frontend WebRTC Manager - ImageData length: ${imageData.data.length}`);
      
      console.log(`🚀 Frontend WebRTC Manager - Running YOLO model...`);
      const detections = await runYoloModel(imageData);
      console.log(`✅ Frontend WebRTC Manager - YOLO model returned ${detections.length} detections`);
      
      return detections;
    } catch (error) {
      console.error('❌ Frontend WebRTC Manager - YOLO inference error:', error);
      console.error('❌ Frontend WebRTC Manager - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
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

    socket.on('peer-joined', (data) => {
      console.log('👥 Browser - Peer joined event received:', data);
      if (data.type === 'phone') {
        console.log('📱 Browser - Phone connected to room');
        console.log('🤝 Browser - Creating WebRTC offer for phone...');
        // Browser should create offer when phone joins
        setTimeout(() => {
          createOffer();
        }, 100); // Small delay to ensure connection is ready
      }
    });

    socket.on('answer', async (data) => {
      console.log('📥 Browser received answer from phone:', data);
      if (peerConnection.current) {
        try {
          await peerConnection.current.setRemoteDescription(data.answer);
          console.log('✅ Set remote description (answer)');
        } catch (error) {
          console.error('❌ Error handling answer:', error);
        }
      } else {
        console.error('❌ No peer connection available to handle answer');
      }
    });

    socket.on('ice-candidate', async (data) => {
      console.log('📥 Browser received ICE candidate:', data.candidate);
      if (peerConnection.current && data.candidate) {
        try {
          await peerConnection.current.addIceCandidate(data.candidate);
          console.log('✅ Added ICE candidate');
        } catch (error) {
          console.error('❌ Error adding ICE candidate:', error);
        }
      }
    });
  };

  const createOffer = async () => {
    console.log('🤝 Browser - createOffer function called');
    if (!peerConnection.current) {
      console.log('❌ Browser - Cannot create offer: no peer connection available');
      return;
    }

    try {
      console.log('🔄 Browser - Creating WebRTC offer...');
      const offer = await peerConnection.current.createOffer();
      console.log('📊 Browser - Offer SDP type:', offer.type);
      console.log('📊 Browser - Offer SDP length:', offer.sdp?.length || 0);
      
      console.log('🔄 Browser - Setting local description (offer)...');
      await peerConnection.current.setLocalDescription(offer);
      console.log('✅ Browser - Created and set local description (offer) successfully');
      
      console.log('📤 Browser - Sending offer to phone via socket...');
      if (socket) {
        socket.emit('offer', {
          room: roomId,
          offer
        });
        console.log('✅ Browser - Offer sent to phone successfully');
      } else {
        console.error('❌ Browser - No socket available to send offer');
      }
    } catch (error) {
      console.error('❌ Browser - Error creating offer:', error);
    }
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