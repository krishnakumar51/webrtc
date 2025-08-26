import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { io, Socket } from 'socket.io-client';

interface PhoneProps {
  signalingUrl: string;
}

export default function Phone({ signalingUrl }: PhoneProps) {
  console.log('🔧 Phone component initialized with signalingUrl:', signalingUrl);
  
  const router = useRouter();
  const { room } = router.query;
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string>('');
  const [framesSent, setFramesSent] = useState(0);
  const [detections, setDetections] = useState<any[]>([]);
  
  // Dynamic signaling URL detection
  const [currentSignalingUrl, setCurrentSignalingUrl] = useState<string>('');
  
  console.log('🔧 Current room:', room);
  console.log('🔧 Current window.location:', typeof window !== 'undefined' ? window.location.href : 'SSR');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameIdRef = useRef(0);

  // Helper fetcher for NGROK dynamic URLs
  const fetchDynamicUrls = async () => {
    try {
      console.log('🔧 Fetching dynamic URLs from ngrok status API...');
      const response = await fetch('/api/ngrok-status');
      if (response.ok) {
        const data = await response.json();
        console.log('🔧 Dynamic URLs fetched:', data);
        
        // Use the signaling URL from the API directly (http/https for Socket.IO)
        if (data.signalingUrl) {
          setCurrentSignalingUrl(data.signalingUrl);
          console.log('🔧 Updated signaling URL to:', data.signalingUrl);
        }
      } else {
        console.warn('⚠️ Failed to fetch dynamic URLs, using fallback');
        if (!currentSignalingUrl) {
          // Use the current domain but port 8000 for signaling
          const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
          const hostname = window.location.hostname;
          const fallbackUrl = `${protocol}//${hostname}:8000`;
          setCurrentSignalingUrl(fallbackUrl);
          console.log('🔧 Using fallback signaling URL:', fallbackUrl);
        }
      }
    } catch (error) {
      console.error('❌ Error fetching dynamic URLs:', error);
      if (!currentSignalingUrl) {
        // Use the current domain but port 8000 for signaling
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const hostname = window.location.hostname;
        const fallbackUrl = `${protocol}//${hostname}:8000`;
        setCurrentSignalingUrl(fallbackUrl);
        console.log('🔧 Using fallback signaling URL:', fallbackUrl);
      }
    }
  };

  // Initial URL fetching
  useEffect(() => {
    fetchDynamicUrls();
  }, []);

  useEffect(() => {
    if (room && currentSignalingUrl) {
      initializeConnection();
    }

    return () => {
      cleanup();
    };
  }, [room, currentSignalingUrl]);

  const initializeConnection = async () => {
    console.log('🔧 Starting initializeConnection...');
    console.log('🔧 Using signalingUrl:', signalingUrl);
    
    try {
      // Get camera stream
      console.log('🔧 Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      console.log('🔧 Camera access granted');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Initialize WebRTC
      await setupWebRTC(stream);
      
      // Connect to signaling server
      setupSocketConnection();

    } catch (err) {
      console.error('Failed to initialize:', err);
      setError('Failed to access camera or connect to server');
    }
  };

  const setupWebRTC = async (stream: MediaStream) => {
    console.log('🔧 Phone - Setting up WebRTC peer connection...');
    
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10 // Pre-gather ICE candidates for faster connection
    };

    console.log('🧊 Phone - ICE servers configured:', configuration.iceServers);
    console.log('📊 Phone - ICE candidate pool size:', configuration.iceCandidatePoolSize);

    peerConnectionRef.current = new RTCPeerConnection(configuration);
    
    console.log('✅ Phone - RTCPeerConnection created successfully');
    console.log('📊 Phone - Initial connection state:', peerConnectionRef.current.connectionState);
    console.log('📊 Phone - Initial signaling state:', peerConnectionRef.current.signalingState);

    // Add video track
    console.log('📹 Phone - Adding video tracks to peer connection...');
    stream.getTracks().forEach((track, index) => {
      console.log(`📹 Phone - Adding track ${index}: ${track.kind} (${track.label})`);
      peerConnectionRef.current?.addTrack(track, stream);
    });
    console.log('✅ Phone - All video tracks added successfully');

    // Create data channel for sending frames
    console.log('📡 Phone - Creating data channel for frame transmission...');
    dataChannelRef.current = peerConnectionRef.current.createDataChannel('frames', {
      ordered: true // Use ordered delivery to match browser expectation
    });
    
    console.log('📊 Phone - Data channel configuration:', {
      label: dataChannelRef.current.label,
      ordered: true,
      readyState: dataChannelRef.current.readyState
    });

    dataChannelRef.current.onopen = () => {
      console.log('✅ Phone - Data channel opened successfully - ready for streaming');
      console.log('📊 Phone - Data channel ready state:', dataChannelRef.current?.readyState);
      console.log('📊 Phone - Data channel max message size:', dataChannelRef.current?.maxPacketLifeTime);
      setIsConnected(true);
      setError(''); // Clear any previous errors
      // Auto-start streaming once the data channel is open
      if (!isStreaming) {
        setTimeout(() => {
          if (dataChannelRef.current?.readyState === 'open') {
            startStreaming();
          }
        }, 100);
      }
    };

    dataChannelRef.current.onclose = () => {
      console.log('📡 Phone - Data channel closed');
      console.log('📊 Phone - Data channel ready state:', dataChannelRef.current?.readyState);
      // Ensure streaming loop is stopped when channel closes
      stopStreaming();
      setIsConnected(false);
    };

    dataChannelRef.current.onerror = (error) => {
      console.error('❌ Phone - Data channel error:', error);
      console.error('📊 Phone - Data channel ready state:', dataChannelRef.current?.readyState);
      console.error('📊 Phone - Error type:', error.type);
      // Stop streaming on error to prevent tight failing loop
      stopStreaming();
      setError('Data channel connection failed');
    };
    
    dataChannelRef.current.onbufferedamountlow = () => {
      console.log('📊 Phone - Data channel buffer amount low');
    };

    // Handle incoming messages (detection results)
    dataChannelRef.current.onmessage = (event) => {
      console.log('📨 Phone - Received detection results from browser');
      console.log('📊 Phone - Message size:', event.data.length);
      try {
        const result = JSON.parse(event.data);
        console.log('📊 Phone - Parsed detection results:', result.detections?.length || 0, 'detections');
        setDetections(result.detections || []);
      } catch (error) {
        console.error('❌ Phone - Error parsing detection result:', error);
        console.error('📊 Phone - Raw message data:', event.data.substring(0, 100) + '...');
      }
    };

    // Handle connection state changes
    peerConnectionRef.current.onconnectionstatechange = () => {
      const state = peerConnectionRef.current?.connectionState;
      console.log('🔄 Phone - WebRTC connection state changed:', state);
      console.log('📊 Phone - ICE connection state:', peerConnectionRef.current?.iceConnectionState);
      console.log('📊 Phone - ICE gathering state:', peerConnectionRef.current?.iceGatheringState);
      
      if (state === 'connected') {
        console.log('✅ Phone - WebRTC peer connection established successfully');
      } else if (state === 'disconnected') {
        console.log('⚠️ Phone - WebRTC connection disconnected');
        setIsConnected(false);
        setError('Connection to browser lost');
      } else if (state === 'failed') {
        console.log('❌ Phone - WebRTC connection failed');
        setIsConnected(false);
        setError('Connection to browser lost');
      } else if (state === 'connecting') {
        console.log('🔄 Phone - WebRTC connection in progress...');
      }
    };
    
    peerConnectionRef.current.onicegatheringstatechange = () => {
      console.log('🧊 Phone - ICE gathering state changed:', peerConnectionRef.current?.iceGatheringState);
    };
    
    peerConnectionRef.current.oniceconnectionstatechange = () => {
      console.log('🧊 Phone - ICE connection state changed:', peerConnectionRef.current?.iceConnectionState);
    };
    
    peerConnectionRef.current.onsignalingstatechange = () => {
      console.log('📡 Phone - Signaling state changed:', peerConnectionRef.current?.signalingState);
    };

    // Handle ICE candidates
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('🧊 Phone - Generated ICE candidate:', event.candidate.candidate);
        console.log('📊 Phone - ICE candidate type:', event.candidate.type);
        console.log('📊 Phone - ICE candidate protocol:', event.candidate.protocol);
        
        if (socketRef.current) {
          socketRef.current.emit('ice-candidate', {
            room,
            candidate: event.candidate
          });
          console.log('📤 Phone - ICE candidate sent to browser');
        } else {
          console.warn('⚠️ Phone - No socket available to send ICE candidate');
        }
      } else {
        console.log('🧊 Phone - ICE candidate gathering completed (null candidate)');
      }
    };
    
    console.log('✅ Phone - WebRTC peer connection setup completed');
  };

  const setupSocketConnection = () => {
    console.log('📱 Phone - setupSocketConnection called');
    console.log('📱 Phone - Using dynamic signaling server:', currentSignalingUrl);
    console.log('📱 Phone - Room ID:', room);

    // Cleanup previous socket
    if (socketRef.current) {
      console.log('🧹 Phone - Cleaning up previous socket connection...');
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    console.log('🔌 Phone - Creating new socket connection...');
    socketRef.current = io(currentSignalingUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      secure: currentSignalingUrl.startsWith('https://'),
      rejectUnauthorized: false,
      path: '/socket.io',
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Phone - Connected to signaling server successfully');
      console.log('📱 Phone - Socket ID:', socketRef.current?.id);
      console.log('🏠 Phone - Joining room as phone type...');
      socketRef.current?.emit('join-room', { room, type: 'phone' });
      console.log('📤 Phone - Emitted join-room event with room:', room);
      
      // Note: Offer will be created when browser joins (peer-joined event)
    });
    
    socketRef.current.on('connect_error', (error: any) => {
      console.error('❌ Phone - Socket connection error:', error);
      console.error('❌ Phone - Error details:', error?.message || 'Unknown error');
      console.error('❌ Phone - Error type:', error?.type || 'Unknown type');
      console.error('❌ Phone - Attempted URL:', currentSignalingUrl);
      console.error('❌ Phone - Transport:', error?.transport || 'Unknown transport');
    });
    
    socketRef.current.on('disconnect', (reason) => {
      console.log('📱 Phone - Socket disconnected, reason:', reason);
      console.log('📱 Phone - Connection state before disconnect:', socketRef.current?.connected);
    });

    socketRef.current.on('offer', async (data) => {
      console.log('📨 Phone - Received WebRTC offer from browser');
      console.log('📊 Phone - Offer SDP type:', data.offer?.type);
      console.log('📊 Phone - Offer SDP length:', data.offer?.sdp?.length || 0);
      if (peerConnectionRef.current) {
        try {
          console.log('🔄 Phone - Setting remote description (offer)...');
          await peerConnectionRef.current.setRemoteDescription(data.offer);
          console.log('✅ Phone - Set remote description (offer) successfully');
          
          console.log('🔄 Phone - Creating answer...');
          const answer = await peerConnectionRef.current.createAnswer();
          console.log('📊 Phone - Answer SDP type:', answer.type);
          console.log('📊 Phone - Answer SDP length:', answer.sdp?.length || 0);
          
          console.log('🔄 Phone - Setting local description (answer)...');
          await peerConnectionRef.current.setLocalDescription(answer);
          console.log('✅ Phone - Created and set local description (answer) successfully');
          
          console.log('📤 Phone - Sending answer to browser via socket...');
          socketRef.current?.emit('answer', {
            room,
            answer
          });
          console.log('✅ Phone - Answer sent to browser successfully');
        } catch (error) {
        console.error('❌ Phone - Error handling offer:', error);
        console.error('❌ Phone - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          setError('Failed to process browser connection');
        }
      } else {
        console.warn('⚠️ Phone - No peer connection available for offer');
      }
    });

    socketRef.current.on('answer', async (data) => {
      console.log('📨 Phone - Received WebRTC answer from browser');
      console.log('📊 Phone - Answer SDP type:', data.answer?.type);
      console.log('📊 Phone - Answer SDP length:', data.answer?.sdp?.length || 0);
      if (peerConnectionRef.current) {
        try {
          console.log('🔄 Phone - Setting remote description (answer)...');
          await peerConnectionRef.current.setRemoteDescription(data.answer);
          console.log('✅ Phone - Set remote description (answer) successfully');
        } catch (error) {
        console.error('❌ Phone - Error handling answer:', error);
        console.error('❌ Phone - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          setError('Failed to process browser answer');
        }
      } else {
        console.warn('⚠️ Phone - No peer connection available for answer');
      }
    });

    socketRef.current.on('ice-candidate', async (data) => {
      console.log('🧊 Phone - Received ICE candidate from browser');
      console.log('📊 Phone - ICE candidate type:', data.candidate?.candidate ? 'valid' : 'end-of-candidates');
      if (peerConnectionRef.current && data.candidate) {
        try {
          console.log('🔄 Phone - Adding ICE candidate...');
          await peerConnectionRef.current.addIceCandidate(data.candidate);
          console.log('✅ Phone - ICE candidate added successfully');
        } catch (error) {
        console.error('❌ Phone - Error adding ICE candidate:', error);
        console.error('❌ Phone - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        }
      } else if (!peerConnectionRef.current) {
        console.warn('⚠️ Phone - No peer connection available for ICE candidate');
      } else {
        console.log('🧊 Phone - Received end-of-candidates signal');
      }
    });

    socketRef.current.on('peer-joined', (data) => {
      console.log('👥 Phone - Peer joined event received:', data);
      if (data.type === 'browser') {
        console.log('🌐 Phone - Browser connected to room');
        console.log('📊 Phone - Browser socket ID:', data.socketId || 'unknown');
        console.log('⏳ Phone - Waiting for browser to send offer...');
        // Phone should wait for browser to create offer, not create one itself
      } else {
        console.log('👤 Phone - Non-browser peer joined:', data.type);
      }
    });
  };

  // Removed createOffer function - browser now creates the offer

  const startStreaming = () => {
    console.log('🔧 Attempting to start streaming...');
    console.log('🔧 Connection state:', {
      isConnected,
      dataChannelExists: !!dataChannelRef.current,
      dataChannelState: dataChannelRef.current?.readyState,
      peerConnectionState: peerConnectionRef.current?.connectionState
    });
    
    if (!isConnected) {
      const errorMsg = 'Not connected to browser - waiting for data channel to open';
      console.log('❌', errorMsg);
      setError(errorMsg);
      return;
    }
    
    if (!dataChannelRef.current) {
      const errorMsg = 'Data channel not available';
      console.log('❌', errorMsg);
      setError(errorMsg);
      return;
    }
    
    if (dataChannelRef.current.readyState !== 'open') {
      const errorMsg = `Data channel not ready (state: ${dataChannelRef.current.readyState})`;
      console.log('❌', errorMsg);
      setError(errorMsg);
      return;
    }

    console.log('✅ Starting video stream...');
    setIsStreaming(true);
    setError(''); // Clear any previous errors
    frameIdRef.current = 0;
    
    // Start sending frames at ~15 FPS
    streamingIntervalRef.current = setInterval(() => {
      sendFrame();
    }, 66); // ~15 FPS
  };

  const stopStreaming = () => {
    setIsStreaming(false);
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
    }
  };

  const sendFrame = () => {
    if (!videoRef.current || !canvasRef.current || !dataChannelRef.current || 
        dataChannelRef.current.readyState !== 'open') {
      console.warn('📱 Phone - Missing required refs or data channel not open');
      return;
    }

    const frameId = `frame_${frameIdRef.current++}`;
    const captureStart = Date.now();
    
    console.log(`📸 Phone - Starting frame capture ${frameId}`);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      console.error('❌ Phone - Cannot get canvas context');
      return;
    }

    // Get image data at full resolution for object detection
    // The browser will handle resizing based on mode (320x320 for WASM, 640x640 for server)
    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;
    
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    
    console.log(`📐 Phone - Video dimensions: ${videoWidth}x${videoHeight}`);
    
    // Draw current video frame to canvas at full resolution
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const drawTime = Date.now() - captureStart;
    
    console.log(`🎨 Phone - Frame drawn to canvas in ${drawTime}ms`);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Prepare frame data with metadata for processing
    const compressionStart = Date.now();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const compressionTime = Date.now() - compressionStart;
    
    console.log(`🗜️ Phone - Frame compressed in ${compressionTime}ms, size: ${(dataUrl.length / 1024).toFixed(1)}KB`);
    
    const frameData = {
      frame_id: frameId,
      capture_ts: captureStart,
      width: canvas.width,
      height: canvas.height,
      // Send as base64 encoded image for better compression and compatibility
      imageData: dataUrl
    };

    const jsonSize = JSON.stringify(frameData).length;
    console.log(`📦 Phone - Frame data JSON size: ${(jsonSize / 1024).toFixed(1)}KB`);

    try {
      const sendStart = Date.now();
      // Send frame data
      dataChannelRef.current.send(JSON.stringify(frameData));
      const sendTime = Date.now() - sendStart;
      
      console.log(`📤 Phone - Frame ${frameId} sent successfully in ${sendTime}ms (total: ${Date.now() - captureStart}ms)`);
      setFramesSent(prev => prev + 1);
    } catch (error) {
      console.error('❌ Phone - Error sending frame:', error);
      // Fallback: try with lower quality
      try {
        console.warn(`⚠️ Phone - Retrying frame ${frameId} with lower quality`);
        const retryStart = Date.now();
        
        const fallbackDataUrl = canvas.toDataURL('image/jpeg', 0.5);
        const fallbackData = {
          ...frameData,
          imageData: fallbackDataUrl
        };
        
        const retryJsonSize = JSON.stringify(fallbackData).length;
        console.log(`🔄 Phone - Retry JSON size: ${(retryJsonSize / 1024).toFixed(1)}KB`);
        
        dataChannelRef.current.send(JSON.stringify(fallbackData));
        const retryTime = Date.now() - retryStart;
        
        console.log(`📤 Phone - Frame ${frameId} sent with lower quality in ${retryTime}ms`);
        setFramesSent(prev => prev + 1);
      } catch (fallbackError) {
        console.error('❌ Phone - Error sending fallback frame:', fallbackError);
        console.error('❌ Phone - Fallback error stack:', fallbackError instanceof Error ? fallbackError.stack : 'No stack trace');
      }
    }
  };

  const cleanup = () => {
    stopStreaming();
    
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    // Stop camera
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
  };

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white text-center">
          <h1 className="text-2xl mb-4">Invalid Room</h1>
          <p>Please scan the QR code again</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Phone Camera - WebRTC VLM Detection</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-white font-sans">
        <div className="container mx-auto px-6 py-8 max-w-7xl">
          <header className="mb-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
              <div className="mb-6 lg:mb-0">
                <h1 className="text-4xl lg:text-5xl font-bold text-white mb-2">
                  WebRTC VLM Detection - Mobile
                </h1>
                <p className="text-slate-300 text-lg">Real-time multi-object detection via phone streaming</p>
              </div>
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2 px-4 py-2 bg-slate-900/60 rounded-full backdrop-blur-sm border border-blue-800/30">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
                    <span className="text-white text-sm font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                  <div className="flex items-center space-x-2 px-4 py-2 bg-blue-600/20 rounded-full backdrop-blur-sm border border-blue-500/30">
                    <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-blue-400' : 'bg-purple-400'}`}></div>
                    <span className="text-white text-sm font-medium">{isStreaming ? 'STREAMING' : 'IDLE'}</span>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content Section: Video Player (Left) + Phone Connection (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Video Player - Left Side (2/3 width) */}
            <div className="lg:col-span-2">
              <div className="bg-slate-900/40 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50 shadow-2xl h-full">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-lg">📹</span>
                    </div>
                    <h2 className="text-xl font-bold text-white">Live Stream</h2>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                      isStreaming 
                        ? 'bg-green-600/20 text-green-400 border-green-500/50' 
                        : 'bg-slate-700/50 text-slate-400 border-slate-600/50'
                    }`}>
                      {isStreaming ? 'Detecting' : 'Idle'}
                    </div>
                    <div className="bg-slate-700/50 px-4 py-2 rounded-lg border border-slate-600/50">
                      <span className="text-white text-sm font-medium">{detections.length} objects</span>
                    </div>
                  </div>
                </div>

                
                <div className="relative bg-slate-950/70 rounded-xl overflow-hidden shadow-inner border border-slate-700/50" style={{ aspectRatio: '16/9' }}>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    autoPlay
                    playsInline
                    muted
                    style={{ transform: 'scaleX(-1)' }} // Mirror for selfie effect
                  />
                  
                  {!isConnected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm">
                      <div className="text-center text-white p-8 rounded-xl bg-slate-800/50 backdrop-blur-md border border-slate-700/50">
                        <div className="w-16 h-16 mx-auto mb-4 bg-blue-600 rounded-full flex items-center justify-center">
                          <span className="text-2xl">📱</span>
                        </div>
                        <p className="text-xl font-semibold mb-2">Mobile Camera Active</p>
                        <p className="text-sm text-slate-300">Point your camera at objects to detect</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Detection Overlays */}
                  {detections.map((detection, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-green-400 rounded-lg"
                      style={{
                        left: `${detection.xmin * 100}%`,
                        top: `${detection.ymin * 100}%`,
                        width: `${(detection.xmax - detection.xmin) * 100}%`,
                        height: `${(detection.ymax - detection.ymin) * 100}%`,
                      }}
                    >
                      <div className="bg-green-400/90 backdrop-blur-sm text-black text-xs px-2 py-1 rounded-md -mt-6 font-semibold">
                        {detection.label} {(detection.score * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                  
                  {/* Detection count overlay */}
                  {isConnected && detections.length > 0 && (
                    <div className="absolute top-4 right-4 bg-slate-800/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-600/50">
                      <span className="text-white text-sm font-medium">
                        {detections.length} object{detections.length !== 1 ? 's' : ''} detected
                      </span>
                    </div>
                  )}

                  {/* Hidden canvas for frame capture */}
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                
                <button
                  onClick={isStreaming ? stopStreaming : startStreaming}
                  disabled={!isConnected}
                  className={`w-full mt-6 px-6 py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
                    isStreaming
                      ? 'bg-red-600 hover:bg-red-700 text-white border border-red-500/50'
                      : isConnected 
                        ? 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/50'
                        : 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600/50'
                  }`}
                >
                  <div className="flex items-center justify-center space-x-2">
                    <span className="text-xl">{isStreaming ? '⏹️' : '▶️'}</span>
                    <span>{isStreaming ? 'Stop Streaming' : 'Start Streaming'}</span>
                  </div>
                </button>
              </div>
            </div>
            
            {/* Phone Connection - Right Side (1/3 width) */}
            <div className="lg:col-span-1">
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50 shadow-2xl h-full">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-lg">📱</span>
                    </div>
                    <h3 className="text-lg font-bold text-white">Mobile Status</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                    <span className="text-white text-sm font-medium">
                      {isConnected ? 'Connected' : 'Connecting'}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-6">
                  {/* Room Info */}
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Room ID:
                    </label>
                    <div className="text-white font-mono text-lg">{room}</div>
                  </div>
                  
                  {/* Connection Details */}
                  <div className="space-y-4 flex-1 flex flex-col justify-center">
                    <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                      <p className="text-slate-300 text-sm mb-3 font-medium">Mobile Camera Instructions:</p>
                      <ul className="text-slate-400 text-sm space-y-2">
                        <li>1. Keep camera permissions enabled</li>
                        <li>2. Point camera at objects to detect</li>
                        <li>3. Maintain stable network connection</li>
                        <li>4. Keep phone steady for better results</li>
                      </ul>
                    </div>
                    
                    {error && (
                      <div className="bg-red-500/10 backdrop-blur-xl border border-red-500/30 rounded-lg p-4 text-red-200 text-sm">
                        <div className="flex items-center space-x-2">
                          <span className="text-red-400 text-lg">⚠️</span>
                          <span>{error}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Performance Metrics Panel - Below Video Player */}
          <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50 shadow-2xl mb-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-lg">⚡</span>
                </div>
                <h3 className="text-xl font-bold text-white">Performance Metrics</h3>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{framesSent}</div>
                <div className="text-xs text-slate-300">Frames Sent</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-blue-400 to-cyan-400 h-1 rounded-full transition-all duration-300" style={{ width: `${Math.min(framesSent / 10, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{detections.length}</div>
                <div className="text-xs text-slate-300">Objects Found</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className={`h-1 rounded-full transition-all duration-300 ${
                    detections.length > 0 ? 'bg-gradient-to-r from-green-400 to-emerald-400' : 'bg-gray-600'
                  }`} style={{ width: `${Math.min(detections.length * 20, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">0</div>
                <div className="text-xs text-slate-300">Processing FPS</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-purple-400 to-pink-400 h-1 rounded-full transition-all duration-300" style={{ width: '0%' }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">0</div>
                <div className="text-xs text-slate-300">Uplink (kbps)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-green-400 to-blue-400 h-1 rounded-full transition-all duration-300" style={{ width: '0%' }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">0</div>
                <div className="text-xs text-slate-300">Server (ms)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-orange-400 to-red-400 h-1 rounded-full transition-all duration-300" style={{ width: '0%' }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">0</div>
                <div className="text-xs text-slate-300">Network (ms)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-teal-400 to-cyan-400 h-1 rounded-full transition-all duration-300" style={{ width: '0%' }} />
                </div>
              </div>
            </div>
          </div>
          
          {/* Bottom Section: Detection Info (Left) + Quick Stats (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Detection Info Panel - Left Side */}
            <div>
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50 shadow-2xl h-full flex flex-col">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center">
                    <span className="text-white text-lg">🎯</span>
                  </div>
                  <h3 className="text-xl font-bold text-white">Detection Information</h3>
                </div>
                
                <div className="grid grid-cols-3 gap-4 items-start pt-4">
                  <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-600/50 text-center aspect-square flex flex-col justify-center">
                    <div className="text-3xl font-bold text-white mb-2">{detections.length}</div>
                    <div className="text-sm text-slate-300 mb-2">Objects Detected</div>
                    <div className={`w-3 h-3 rounded-full mx-auto ${
                      detections.length > 0 ? 'bg-green-400' : 'bg-slate-500'
                    }`} />
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-600/50 text-center aspect-square flex flex-col justify-center">
                    <div className={`text-3xl font-bold mb-2 ${
                      isStreaming ? 'text-green-400' : 'text-yellow-400'
                    }`}>
                      {isStreaming ? '●' : '○'}
                    </div>
                    <div className="text-sm text-slate-300 mb-2">Processing</div>
                    <div className={`w-3 h-3 rounded-full mx-auto ${
                      isStreaming ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
                    }`} />
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-600/50 text-center aspect-square flex flex-col justify-center">
                    <div className="text-lg font-bold text-white mb-2">MOBILE</div>
                    <div className="text-sm text-slate-300 mb-2">Mode</div>
                    <div className="w-3 h-3 rounded-full mx-auto bg-purple-400" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Quick Stats - Right Side */}
            <div>
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50 shadow-2xl h-full">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                    <span className="text-white text-lg">📊</span>
                  </div>
                  <h3 className="text-xl font-bold text-white">Quick Stats</h3>
                </div>

                
                <div className="space-y-4">
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">Frames Sent</span>
                      <span className="text-lg font-bold text-white">{framesSent}</span>
                    </div>
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">Objects Found</span>
                      <span className="text-lg font-bold text-white">{detections.length}</span>
                    </div>
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">Status</span>
                      <span className="text-lg font-bold text-white">{isStreaming ? 'Active' : 'Idle'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps() {
  console.log('🔧 getServerSideProps called for phone page');
  
  let signalingUrl = 'http://localhost:8000';
  
  // Always use the current browser location for signaling URL
  // Note: window is not available in SSR, so we set a default
  // The client-side effect will auto-detect the correct URL
  
  console.log('🔧 Default signalingUrl being passed to phone component:', signalingUrl);
  return { props: { signalingUrl } };
}