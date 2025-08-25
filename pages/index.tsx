import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import Image from 'next/image';
const ObjectDetectionCamera = dynamic(() => import('../components/ObjectDetectionCamera'), { ssr: false });
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import WebRTCManager from '../components/WebRTCManager';
import MetricsPanel from '../components/MetricsPanel';
import DetectionOverlay from '../components/DetectionOverlay';
import ModeSelector from '../components/ModeSelector';

import type { Detection } from '../types';

interface DetectionResult {
  frame_id: string;
  capture_ts: number;
  recv_ts: number;
  inference_ts: number;
  detections: Detection[];
}

interface Metrics {
  e2eLatency: {
    current: number;
    median: number;
    p95: number;
  };
  processingFps: number;
  uplink: number;
  downlink: number;
  serverLatency: number;
  networkLatency: number;
  framesProcessed: number;
}

interface HomeProps {
  baseUrl: string;
  signalingUrl: string;
}

export default function Home({ baseUrl, signalingUrl }: HomeProps) {
  const [mode, setMode] = useState<'wasm' | 'server'>(process.env.NEXT_PUBLIC_MODE as 'wasm' | 'server' || 'wasm');
  const [isConnected, setIsConnected] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [connectionUrl, setConnectionUrl] = useState('');
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>([]);
  const [currentDetections, setCurrentDetections] = useState<Detection[]>([]);
  const [currentBaseUrl, setCurrentBaseUrl] = useState(baseUrl);
  const [currentSignalingUrl, setCurrentSignalingUrl] = useState(signalingUrl);
  const [metrics, setMetrics] = useState<Metrics>({
    e2eLatency: { current: 0, median: 0, p95: 0 },
    processingFps: 0,
    uplink: 0,
    downlink: 0,
    serverLatency: 0,
    networkLatency: 0,
    framesProcessed: 0
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webrtcManagerRef = useRef<any>(null);
  const roomId = useRef(Math.random().toString(36).substr(2, 9));

  // Poll ngrok-status API for dynamic URL updates (only once on mount)
  useEffect(() => {
    let hasInitialized = false;
    
    const pollNgrokStatus = async () => {
      try {
        const response = await fetch('/api/ngrok-status');
        if (response.ok) {
          const data = await response.json();
          
          // Only update URLs on first poll or if there's a significant change
          if (!hasInitialized) {
            if (data.baseUrl && data.baseUrl !== currentBaseUrl) {
              console.log('🔄 Base URL initialized:', data.baseUrl);
              setCurrentBaseUrl(data.baseUrl);
            }
            
            if (data.signalingUrl && data.signalingUrl !== currentSignalingUrl) {
              console.log('🔄 Signaling URL initialized:', data.signalingUrl);
              setCurrentSignalingUrl(data.signalingUrl);
            }
            hasInitialized = true;
          }
        }
      } catch (error) {
        console.warn('Failed to poll ngrok status:', error);
      }
    };

    // Poll once immediately, then stop to prevent URL changes during session
    pollNgrokStatus();
  }, []);

  // Initialize connection and generate QR code only once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let isInitialized = false;
    
    const initialize = async () => {
      if (!isInitialized) {
        await initializeConnection();
        await generateQRCode();
        isInitialized = true;
      }
    };
    
    initialize();
    
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  // Only regenerate QR code when URLs are actually different and initialized
  useEffect(() => {
    if (currentBaseUrl !== baseUrl || currentSignalingUrl !== signalingUrl) {
      generateQRCode();
    }
  }, [currentBaseUrl, currentSignalingUrl]);

  const initializeConnection = () => {
    const serverUrl = currentSignalingUrl || (process.env.NODE_ENV === 'production'
      ? window.location.origin.replace(':3001', ':8000')
      : 'http://localhost:8000');
    const newSocket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000, // Reduced timeout for faster connection
      secure: serverUrl.startsWith('https://'),
      rejectUnauthorized: false,
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true'
      }
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to signaling server');
      newSocket.emit('join-room', { room: roomId.current, type: 'browser' });
    });

    newSocket.on('detection-result', (result: DetectionResult) => {
      handleDetectionResult(result);
    });

    newSocket.on('peer-joined', (data) => {
      if (data.type === 'phone') {
        setIsConnected(true);
        console.log('Phone connected');
      }
    });

    newSocket.on('peer-left', (data) => {
      if (data.type === 'phone') {
        setIsConnected(false);
        console.log('Phone disconnected');
      }
    });
  };

  const generateQRCode = async () => {
    let phoneUrl = `${currentBaseUrl}/phone?room=${roomId.current}`;
    
    setConnectionUrl(phoneUrl);
    
    try {
      const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      setQrCodeUrl(qrDataUrl);
      
      // Log the generated URL for debugging
      console.log('📱 Frontend Server - Generated QR Code URL:', phoneUrl);
      console.log('🔗 Backend WebRTC Server - Signaling URL:', currentSignalingUrl);
      
      if (phoneUrl.startsWith('https://')) {
        console.log('✅ HTTPS Frontend URL - Mobile camera access enabled via secure tunnel');
      } else {
        console.log('⚠️ HTTP Frontend URL - Mobile camera access may be blocked. Enable ngrok for HTTPS access.');
      }
      
      if (signalingUrl.startsWith('https://')) {
        console.log('✅ HTTPS WebRTC Server - Secure signaling connection established');
      } else {
        console.log('⚠️ HTTP WebRTC Server - Using local signaling. Mobile devices may require HTTPS tunnel.');
      }
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };

  const handleDetectionResult = (result: DetectionResult) => {
    setDetectionResults(prev => [...prev.slice(-99), result]);
    setCurrentDetections(result.detections);
    
    // Update metrics
    const now = Date.now();
    const e2eLatency = now - result.capture_ts;
    const serverLatency = result.inference_ts - result.recv_ts;
    const networkLatency = result.recv_ts - result.capture_ts;

    setMetrics(prev => {
      const latencies = [...detectionResults.slice(-100).map(r => now - r.capture_ts), e2eLatency];
      const sortedLatencies = latencies.sort((a, b) => a - b);
      
      return {
        ...prev,
        e2eLatency: {
          current: e2eLatency,
          median: sortedLatencies[Math.floor(sortedLatencies.length / 2)] || 0,
          p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0
        },
        serverLatency,
        networkLatency,
        framesProcessed: prev.framesProcessed + 1
      };
    });
  };

  const toggleDetection = () => {
    setIsDetecting(!isDetecting);
    if (webrtcManagerRef.current) {
      if (isDetecting) {
        webrtcManagerRef.current.stopDetection();
      } else {
        webrtcManagerRef.current.startDetection();
      }
    }
  };

  const exportMetrics = () => {
    const metricsData = {
      timestamp: new Date().toISOString(),
      mode,
      duration: 30, // seconds
      e2e_latency_median: metrics.e2eLatency.median,
      e2e_latency_p95: metrics.e2eLatency.p95,
      processed_fps: metrics.processingFps,
      uplink_kbps: metrics.uplink,
      downlink_kbps: metrics.downlink,
      frames_processed: metrics.framesProcessed
    };

    const blob = new Blob([JSON.stringify(metricsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metrics.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head>
        <title>WebRTC VLM Detection</title>
        <meta name="description" content="Real-time multi-object detection via phone streaming" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

  {/* removed stray import dynamic from 'next/dynamic'; */}
      <main className="min-h-screen bg-gray-900 text-gray-100">
        <div className="container mx-auto px-4 py-6">
          <header className="flex flex-col md:flex-row md:items-center md:justify-between text-center md:text-left mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">WebRTC VLM Detection</h1>
            <p className="text-gray-300">Real-time multi-object detection via phone streaming</p>
            <div className="flex items-center justify-center md:justify-end mt-4 md:mt-0 space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                <span className="text-white text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                <span className="text-white text-sm">{mode.toUpperCase()}</span>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Main Video Panel */}
            <div className="lg:col-span-8">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 h-fit">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-white">Live Stream</h2>
                  <ModeSelector mode={mode} onModeChange={setMode} />
                </div>
                
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    autoPlay
                    playsInline
                    muted
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
                  />
                  
                  {!isConnected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="text-center text-white">
                        <p className="text-lg mb-1">No video stream detected</p>
                        <p className="text-sm opacity-75">Connect your phone to start streaming</p>
                      </div>
                    </div>
                  )}
                  
                  <DetectionOverlay 
                    detections={currentDetections}
                    videoElement={videoRef.current}
                  />
                </div>
                
                <button
                  onClick={toggleDetection}
                  disabled={!isConnected}
                  className={`w-full mt-4 px-6 py-3 rounded-lg font-semibold transition-all ${
                    isDetecting
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-green-500 hover:bg-green-600 text-white disabled:bg-gray-500 disabled:cursor-not-allowed'
                  }`}
                >
                  {isDetecting ? 'Stop Detection' : 'Start Detection'}
                </button>
              </div>
            </div>

            {/* Metrics and Controls */}
            <div className="lg:col-span-4 flex flex-col space-y-6">
              <div className="flex-1">
                <MetricsPanel 
                  metrics={metrics}
                  onExportMetrics={exportMetrics}
                />
              </div>
              
              {/* Phone Connection Panel */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 flex-1">
                <div className="flex items-center mb-4">
                  <span className="text-xl mr-2">📱</span>
                  <h3 className="text-lg font-semibold text-white">Phone Connection</h3>
                </div>
                
                <div className="flex items-center mb-4">
                  <div className={`w-3 h-3 rounded-full mr-2 ${isConnected ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                  <span className="text-white text-sm">{isConnected ? 'Connected' : 'Waiting'}</span>
                </div>
                
                {qrCodeUrl && (
                  <div className="text-center mb-4">
                    <div className="inline-block bg-white p-3 rounded-lg shadow-lg">
                      <Image 
                        src={qrCodeUrl} 
                        alt="Connection QR Code" 
                        width={160} 
                        height={160} 
                        className="rounded"
                        priority
                      />
                    </div>
                    <p className="text-xs text-blue-200 mt-2">Scan with your phone camera</p>
                  </div>
                )}
                
                <div className="mb-4">
                  <label className="block text-sm text-blue-200 mb-2">Connection URL</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={connectionUrl}
                      readOnly
                      className="flex-1 px-3 py-2 bg-black/30 border border-white/20 rounded text-white text-sm font-mono text-xs break-all"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(connectionUrl);
                        // Optional: Show toast notification
                      }}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 border border-blue-500 rounded text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                      title="Copy to clipboard"
                    >
                      📋 Copy
                    </button>
                  </div>
                  {connectionUrl.startsWith('https://') ? (
                    <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                      <span>✅</span> HTTPS enabled - Mobile camera ready
                    </p>
                  ) : (
                    <p className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
                      <span>⚠️</span> HTTP only - Mobile camera may be blocked
                    </p>
                  )}
                </div>
                
                <div className="text-sm text-blue-200 space-y-1">
                  <p className="font-semibold">Connection Instructions:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Scan the QR code with your phone camera</li>
                    <li>Allow camera permissions when prompted</li>
                    <li>Keep your phone and laptop on the same network</li>
                    <li>Point your camera at objects to detect</li>
                  </ol>
                </div>
                
                <button className="w-full mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center">
                  <span className="mr-2">🔗</span>
                  Start Connection
                </button>
                
                <div className="mt-4 text-xs text-blue-300 space-y-1">
                  <p>• Ensure both devices are on the same Wi-Fi network</p>
                  <p>• Use Chrome on Android or Safari on iOS for best compatibility</p>
                  <p>• If connection fails, try using ngrok for tunneling</p>
                </div>
              </div>
              
              {/* Detection Info */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 flex-1">
                <div className="flex items-center mb-4">
                  <span className="text-xl mr-2">🎯</span>
                  <h3 className="text-lg font-semibold text-white">Detection Info</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-black/20 rounded-lg">
                    <span className="text-blue-200 text-sm">Objects Detected:</span>
                    <span className="text-white font-bold text-lg">{currentDetections.length}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-black/20 rounded-lg">
                    <span className="text-blue-200 text-sm">Processing:</span>
                    <span className={`font-semibold text-sm px-2 py-1 rounded-full ${
                      isDetecting 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                    }`}>
                      {isDetecting ? '🟢 Active' : '⚪ Idle'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-black/20 rounded-lg">
                    <span className="text-blue-200 text-sm">Mode:</span>
                    <span className={`font-semibold text-sm px-2 py-1 rounded-full ${
                      mode === 'wasm' 
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    }`}>
                      {mode.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <WebRTCManager
          ref={webrtcManagerRef}
          socket={socket}
          mode={mode}
          roomId={roomId.current}
          videoRef={videoRef}
          onMetricsUpdate={setMetrics}
        />
      </main>
    </>
  );
}

/**
 * BULLETPROOF Auto-Discovery getServerSideProps
 * This will ALWAYS find your ngrok HTTPS URLs automatically
 */
export async function getServerSideProps() {
  console.log('🔧 getServerSideProps called');
  
  // Default fallback URLs
  let signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || 'http://localhost:8000';
  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  
  try {
    // Use our ngrok-status API endpoint for URL discovery
    console.log('🔧 Fetching URLs from ngrok-status API...');
    
    const response = await fetch('http://localhost:3001/api/ngrok-status', {
      headers: { 'Accept': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Successfully fetched ngrok status:', data);
      
      if (data.baseUrl) {
        baseUrl = data.baseUrl;
        console.log('✅ Found frontend URL:', baseUrl);
      }
      
      if (data.signalingUrl) {
        signalingUrl = data.signalingUrl;
        console.log('✅ Found backend URL:', signalingUrl);
      }
    } else {
      console.warn('⚠️ ngrok-status API returned non-OK status:', response.status);
    }
  } catch (error: any) {
    console.error('🚨 Failed to fetch ngrok status:', error.message);
    console.log('⚠️ Using fallback localhost URLs');
  }
  
  console.log('🔧 Final URLs:', { baseUrl, signalingUrl });
  return { props: { baseUrl, signalingUrl } };
}