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
  
  console.log('🔧 Current room:', room);
  console.log('🔧 Current window.location:', typeof window !== 'undefined' ? window.location.href : 'SSR');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameIdRef = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (room) {
      initializeConnection();
    }

    return () => {
      cleanup();
    };
  }, [room]);

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
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    peerConnectionRef.current = new RTCPeerConnection(configuration);

    // Add video track
    stream.getTracks().forEach(track => {
      peerConnectionRef.current?.addTrack(track, stream);
    });

    // Create data channel for sending frames
    dataChannelRef.current = peerConnectionRef.current.createDataChannel('frames', {
      ordered: false // Allow out-of-order delivery for real-time
    });

    dataChannelRef.current.onopen = () => {
      console.log('Data channel opened');
      setIsConnected(true);
    };

    dataChannelRef.current.onclose = () => {
      console.log('Data channel closed');
      setIsConnected(false);
    };

    // Handle incoming messages (detection results)
    dataChannelRef.current.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data);
        setDetections(result.detections || []);
      } catch (error) {
        console.error('Error parsing detection result:', error);
      }
    };

    // Handle ICE candidates
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          room,
          candidate: event.candidate
        });
      }
    };
  };

  const setupSocketConnection = () => {
    // Use the signaling URL passed from getServerSideProps
    console.log('🔧 setupSocketConnection called');
    console.log('🔧 Connecting to signaling server:', signalingUrl);
    console.log('🔧 Room ID:', room);
    
    socketRef.current = io(signalingUrl, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      forceNew: true
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Connected to signaling server successfully');
      console.log('🔧 Socket ID:', socketRef.current?.id);
      socketRef.current?.emit('join-room', { room, type: 'phone' });
      console.log('🔧 Emitted join-room event');
    });
    
    socketRef.current.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Attempted URL:', signalingUrl);
    });
    
    socketRef.current.on('disconnect', (reason) => {
      console.log('🔧 Socket disconnected:', reason);
    });

    socketRef.current.on('offer', async (data) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(data.offer);
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        
        socketRef.current?.emit('answer', {
          room,
          answer
        });
      }
    });

    socketRef.current.on('ice-candidate', async (data) => {
      if (peerConnectionRef.current && data.candidate) {
        await peerConnectionRef.current.addIceCandidate(data.candidate);
      }
    });

    socketRef.current.on('peer-joined', (data) => {
      if (data.type === 'browser') {
        console.log('Browser connected');
        // Create and send offer
        createOffer();
      }
    });
  };

  const createOffer = async () => {
    if (!peerConnectionRef.current) return;

    try {
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      
      socketRef.current?.emit('offer', {
        room,
        offer
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const startStreaming = () => {
    if (!isConnected || !dataChannelRef.current) {
      setError('Not connected to browser');
      return;
    }

    setIsStreaming(true);
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
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    // Resize to lower resolution for performance
    canvas.width = 320;
    canvas.height = 240;
    
    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Prepare frame data
    const frameData = {
      frame_id: `frame_${frameIdRef.current++}`,
      capture_ts: Date.now(),
      width: canvas.width,
      height: canvas.height,
      imageData: {
        data: Array.from(imageData.data), // Convert to regular array for JSON
        width: imageData.width,
        height: imageData.height
      }
    };

    try {
      // Send frame data
      dataChannelRef.current.send(JSON.stringify(frameData));
      setFramesSent(prev => prev + 1);
    } catch (error) {
      console.error('Error sending frame:', error);
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

      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-6">
          {/* Header */}
          <header className="text-center mb-6">
            <h1 className="text-2xl font-bold mb-2">📱 Phone Camera</h1>
            <p className="text-gray-300 text-sm">Room: {room}</p>
            <div className="flex items-center justify-center mt-2 space-x-4">
              <div className="flex items-center space-x-1">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                <span className="text-xs">{isConnected ? 'Connected' : 'Connecting...'}</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-blue-400' : 'bg-gray-400'}`}></div>
                <span className="text-xs">{isStreaming ? 'Streaming' : 'Idle'}</span>
              </div>
            </div>
          </header>

          {/* Camera View */}
          <div className="relative mb-6">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-lg bg-black"
              style={{ transform: 'scaleX(-1)' }} // Mirror for selfie effect
            />
            
            {/* Detection Overlays */}
            {detections.map((detection, index) => (
              <div
                key={index}
                className="absolute border-2 border-green-400"
                style={{
                  left: `${detection.xmin * 100}%`,
                  top: `${detection.ymin * 100}%`,
                  width: `${(detection.xmax - detection.xmin) * 100}%`,
                  height: `${(detection.ymax - detection.ymin) * 100}%`,
                }}
              >
                <div className="bg-green-400 text-black text-xs px-1 -mt-5">
                  {detection.label} {(detection.score * 100).toFixed(1)}%
                </div>
              </div>
            ))}

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="flex space-x-3">
              {!isStreaming ? (
                <button
                  onClick={startStreaming}
                  disabled={!isConnected}
                  className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-500 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold"
                >
                  Start Streaming
                </button>
              ) : (
                <button
                  onClick={stopStreaming}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-lg font-semibold"
                >
                  Stop Streaming
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-gray-400">Frames Sent</div>
                <div className="text-xl font-bold">{framesSent}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-gray-400">Detections</div>
                <div className="text-xl font-bold">{detections.length}</div>
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-blue-500/20 border border-blue-500 rounded-lg p-4">
              <h3 className="font-semibold mb-2">📋 Instructions</h3>
              <ul className="text-sm text-blue-200 space-y-1">
                <li>• Point your camera at objects to detect</li>
                <li>• Keep the phone steady for better detection</li>
                <li>• Make sure you have good lighting</li>
                <li>• Stay connected to the same Wi-Fi network</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps() {
  console.log('🔧 getServerSideProps called');
  console.log('🔧 NEXT_PUBLIC_SIGNALING_SERVER_URL:', process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL);
  console.log('🔧 NEXT_PUBLIC_USE_NGROK:', process.env.NEXT_PUBLIC_USE_NGROK);
  
  let signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || 'http://localhost:8000';
  console.log('🔧 Initial signalingUrl:', signalingUrl);

  if (process.env.NEXT_PUBLIC_USE_NGROK === 'true') {
    console.log('🔧 Ngrok is enabled, fetching endpoints...');
    try {
      // Try ngrok API for endpoints (v3 format)
      console.log('🔧 Fetching from http://ngrok:4040/api/endpoints');
      const res = await fetch('http://ngrok:4040/api/endpoints');
      const data = await res.json();
      console.log('🔧 Ngrok API response:', JSON.stringify(data, null, 2));
      
      // ngrok v3 uses 'endpoints' array
      const endpoints = data.endpoints || [];
      console.log('🔧 Available endpoints:', endpoints);
      
      const backendEndpoint = endpoints.find((e: any) => 
        e.name === 'backend' && e.url?.startsWith('https://')
      );
      console.log('🔧 Found backend endpoint:', backendEndpoint);
      
      if (backendEndpoint) {
        signalingUrl = backendEndpoint.url;
        console.log('✅ Backend ngrok URL for phone:', signalingUrl);
      } else {
        console.log('⚠️ No backend ngrok endpoint found, using localhost URL');
        console.log('🔧 Available endpoint names:', endpoints.map((e: any) => e.name));
      }
    } catch (err) {
      console.error('❌ Failed to fetch ngrok endpoints:', err);
      console.log('⚠️ Falling back to localhost URL');
    }
  }

  console.log('🔧 Final signalingUrl being passed to component:', signalingUrl);
  return { props: { signalingUrl } };
}