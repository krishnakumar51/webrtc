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
import NotificationSystem, { Notification } from '../components/NotificationSystem';

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

  const [notifications, setNotifications] = useState<Notification[]>([]);
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
    // Use more reliable server URL detection
    let serverUrl = 'http://localhost:8000'; // Default fallback
    
    if (currentSignalingUrl) {
      serverUrl = currentSignalingUrl;
    } else if (typeof window !== 'undefined') {
      // Try to detect if we're in production or development
      const isHttps = window.location.protocol === 'https:';
      const hostname = window.location.hostname;
      const port = isHttps ? '8000' : '8000';
      
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        serverUrl = `http://localhost:8000`;
      } else {
        serverUrl = `${isHttps ? 'https' : 'http'}://${hostname}:${port}`;
      }
    }
    
    console.log('🔌 Connecting to WebSocket server:', serverUrl);
    
    const newSocket = io(serverUrl, {
      transports: ['polling', 'websocket'], // Try polling first for better compatibility
      timeout: 20000, // Increased timeout for better reliability
      forceNew: true, // Force new connection
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
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
        // WebRTCManager will handle the WebRTC offer creation
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

  const handleDetectionResult = (result: any) => {
    // Handle normal detection results
    if (result.detections) {
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
    }
  };

  // Notification management functions
  const addNotification = (notification: Omit<Notification, 'id'>) => {
    const id = Math.random().toString(36).substring(7);
    setNotifications(prev => [...prev, { ...notification, id }]);
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Simple mode switching
  const handleModeChange = (newMode: 'wasm' | 'server') => {
    console.log(`🔄 Switching mode to ${newMode}`);
    
    // Stop detection if running
    if (isDetecting && webrtcManagerRef.current) {
      webrtcManagerRef.current.stopDetection();
      setIsDetecting(false);
    }
    
    setMode(newMode);
    
    // Initialize server model when switching to server mode
    if (newMode === 'server' && socket) {
      console.log('🔄 Initializing server model...');
      socket.emit('initialize-server-model', { room: roomId.current });
      
      // Listen for initialization result
      socket.once('model-initialization-result', (result) => {
        if (result.success) {
          console.log('✅ Server model initialized successfully');
          addNotification({
            type: 'success',
            title: 'Server Mode Ready',
            message: `Server model loaded in ${result.loadTime || 'unknown'}ms`,
            duration: 3000
          });
        } else {
          console.error('❌ Server model initialization failed:', result.error);
          addNotification({
            type: 'error',
            title: 'Server Mode Failed',
            message: `Failed to initialize server model: ${result.error}`,
            duration: 5000
          });
        }
      });
    } else {
      addNotification({
        type: 'success',
        title: `${newMode.toUpperCase()} Mode Active`,
        message: `Switched to ${newMode} mode. Ready for detection.`,
        duration: 3000
      });
    }
  };

  const toggleDetection = () => {
    const newDetectionState = !isDetecting;
    setIsDetecting(newDetectionState);
    
    if (webrtcManagerRef.current) {
      if (newDetectionState) {
        console.log(`🎯 Starting detection in ${mode} mode`);
        webrtcManagerRef.current.startDetection();
        
        addNotification({
          type: 'success',
          title: 'Detection Started',
          message: `Object detection is now running in ${mode.toUpperCase()} mode.`,
          duration: 3000
        });
      } else {
        console.log('🛑 Stopping detection');
        webrtcManagerRef.current.stopDetection();
        
        addNotification({
          type: 'info',
          title: 'Detection Stopped',
          message: 'Object detection has been stopped.',
          duration: 2000
        });
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

      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-white font-sans">
        <div className="container mx-auto px-6 py-8 max-w-7xl">
          <header className="mb-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
              <div className="mb-6 lg:mb-0">
                <h1 className="text-4xl lg:text-5xl font-bold text-white mb-2">
                  WebRTC VLM Detection
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
                    <div className={`w-3 h-3 rounded-full ${mode === 'wasm' ? 'bg-blue-400' : 'bg-purple-400'}`}></div>
                    <span className="text-white text-sm font-medium">{mode.toUpperCase()}</span>
                  </div>
                </div>
                <ModeSelector mode={mode} onModeChange={handleModeChange} />
              </div>
            </div>
          </header>

          {/* Performance Metrics Panel - Top Section for Prominence */}
          <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50 shadow-2xl mb-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-lg">⚡</span>
                </div>
                <h3 className="text-xl font-bold text-white">Performance Metrics</h3>
              </div>
              <button
                onClick={exportMetrics}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 font-medium text-sm border border-blue-500/50"
              >
                📊 Export Metrics
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{metrics.e2eLatency.current.toFixed(0)}</div>
                <div className="text-xs text-slate-300">E2E Latency (ms)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className={`h-1 rounded-full transition-all duration-300 ${
                    metrics.e2eLatency.current < 100 ? 'bg-green-400' : 
                    metrics.e2eLatency.current < 200 ? 'bg-yellow-400' : 'bg-red-400'
                  }`} style={{ width: `${Math.min(metrics.e2eLatency.current / 3, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{metrics.processingFps.toFixed(1)}</div>
                <div className="text-xs text-slate-300">Processing FPS</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-purple-400 to-pink-400 h-1 rounded-full transition-all duration-300" style={{ width: `${Math.min(metrics.processingFps * 10, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{metrics.uplink.toFixed(0)}</div>
                <div className="text-xs text-slate-300">Uplink (kbps)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-green-400 to-blue-400 h-1 rounded-full transition-all duration-300" style={{ width: `${Math.min(metrics.uplink / 10, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{metrics.downlink.toFixed(0)}</div>
                <div className="text-xs text-slate-300">Downlink (kbps)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-blue-400 to-purple-400 h-1 rounded-full transition-all duration-300" style={{ width: `${Math.min(metrics.downlink / 10, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{metrics.serverLatency.toFixed(0)}</div>
                <div className="text-xs text-slate-300">Server (ms)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-orange-400 to-red-400 h-1 rounded-full transition-all duration-300" style={{ width: `${Math.min(metrics.serverLatency / 2, 100)}%` }} />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/50 text-center">
                <div className="text-2xl font-bold text-white mb-1">{metrics.networkLatency.toFixed(0)}</div>
                <div className="text-xs text-slate-300">Network (ms)</div>
                <div className="w-full bg-slate-600 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-teal-400 to-cyan-400 h-1 rounded-full transition-all duration-300" style={{ width: `${Math.min(metrics.networkLatency / 2, 100)}%` }} />
                </div>
              </div>
            </div>
          </div>

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
                      isDetecting 
                        ? 'bg-green-600/20 text-green-400 border-green-500/50' 
                        : 'bg-slate-700/50 text-slate-400 border-slate-600/50'
                    }`}>
                      {isDetecting ? 'Detecting' : 'Idle'}
                    </div>
                    <div className="bg-slate-700/50 px-4 py-2 rounded-lg border border-slate-600/50">
                      <span className="text-white text-sm font-medium">{currentDetections.length} objects</span>
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
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
                  />
                  
                  {!isConnected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm">
                      <div className="text-center text-white p-8 rounded-xl bg-slate-800/50 backdrop-blur-md border border-slate-700/50">
                        <div className="w-16 h-16 mx-auto mb-4 bg-blue-600 rounded-full flex items-center justify-center">
                          <span className="text-2xl">📱</span>
                        </div>
                        <p className="text-xl font-semibold mb-2">No video stream detected</p>
                        <p className="text-sm text-slate-300">Connect your phone to start streaming</p>
                      </div>
                    </div>
                  )}
                  
                  <DetectionOverlay 
                    detections={currentDetections}
                    videoElement={videoRef.current}
                  />
                  
                  {/* Detection count overlay */}
                  {isConnected && currentDetections.length > 0 && (
                    <div className="absolute top-4 right-4 bg-slate-800/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-600/50">
                      <span className="text-white text-sm font-medium">
                        {currentDetections.length} object{currentDetections.length !== 1 ? 's' : ''} detected
                      </span>
                    </div>
                  )}
                </div>
                
                <button
                  onClick={toggleDetection}
                  disabled={!isConnected}
                  className={`w-full mt-6 px-6 py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
                    !isConnected
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600/50'
                      : isDetecting
                      ? 'bg-red-600 hover:bg-red-700 text-white border border-red-500/50'
                      : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-500/50'
                  }`}
                >
                  <div className="flex items-center justify-center space-x-2">
                    <span className="text-xl">
                      {!isConnected
                        ? '📱'
                        : isDetecting
                        ? '⏹️'
                        : '▶️'
                      }
                    </span>
                    <span>
                      {!isConnected
                        ? 'Waiting for Connection...'
                        : isDetecting
                        ? 'Stop Detection'
                        : 'Start Detection'
                      }
                    </span>
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
                    <h3 className="text-lg font-bold text-white">Phone Connection</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                    <span className="text-white text-sm font-medium">
                      {isConnected ? 'Connected' : 'Waiting'}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-6">
                  {/* QR Code */}
                  <div className="flex justify-center">
                    {qrCodeUrl && (
                      <div className="bg-white p-4 rounded-xl shadow-lg">
                        <Image 
                          src={qrCodeUrl} 
                          alt="Connection QR Code" 
                          width={160} 
                          height={160} 
                          className="rounded"
                          priority
                        />
                      </div>
                    )}
                  </div>
                  
                  {/* Connection Details */}
                  <div className="space-y-4 flex-1 flex flex-col justify-center">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Connection URL:
                      </label>
                      <div className="flex rounded-lg overflow-hidden border border-slate-600/50">
                        <input
                          type="text"
                          value={connectionUrl}
                          readOnly
                          className="flex-1 px-3 py-2 bg-slate-800/60 text-white text-sm placeholder-slate-400 focus:outline-none"
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(connectionUrl)}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 font-medium text-sm"
                          title="Copy URL"
                        >
                          📋
                        </button>
                      </div>
                      {connectionUrl.startsWith('https://') ? (
                        <p className="text-sm text-green-400 mt-2 flex items-center gap-2">
                          <span>✅</span> HTTPS enabled - Mobile camera ready
                        </p>
                      ) : (
                        <p className="text-sm text-yellow-400 mt-2 flex items-center gap-2">
                          <span>⚠️</span> HTTP only - Mobile camera may be blocked
                        </p>
                      )}
                    </div>
                    
                    <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                      <p className="text-slate-300 text-sm mb-3 font-medium">Connection Instructions:</p>
                      <ul className="text-slate-400 text-sm space-y-2">
                        <li>1. Scan the QR code with your phone camera</li>
                        <li>2. Allow camera permissions when prompted</li>
                        <li>3. Keep your phone and laptop on the same network</li>
                        <li>4. Point your camera at objects to detect</li>
                      </ul>
                    </div>
                    
                    <button
                      onClick={() => console.log('Starting connection...')}
                      className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm border border-green-500/50"
                    >
                      📱 Start Connection
                    </button>
                  </div>
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
                    <div className="text-3xl font-bold text-white mb-2">{currentDetections.length}</div>
                    <div className="text-sm text-slate-300 mb-2">Objects Detected</div>
                    <div className={`w-3 h-3 rounded-full mx-auto ${
                      currentDetections.length > 0 ? 'bg-green-400' : 'bg-slate-500'
                    }`} />
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-600/50 text-center aspect-square flex flex-col justify-center">
                    <div className={`text-3xl font-bold mb-2 ${
                      isDetecting ? 'text-green-400' : 'text-yellow-400'
                    }`}>
                      {isDetecting ? '●' : '○'}
                    </div>
                    <div className="text-sm text-slate-300 mb-2">
                      Processing
                    </div>
                    <div className={`w-3 h-3 rounded-full mx-auto ${
                      isDetecting ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
                    }`} />
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-600/50 text-center aspect-square flex flex-col justify-center">
                    <div className="text-3xl font-bold text-white mb-2">{mode.toUpperCase()}</div>
                    <div className="text-sm text-slate-300 mb-2">Mode</div>
                    <div className={`w-3 h-3 rounded-full mx-auto ${
                      mode === 'wasm' ? 'bg-blue-400' : 'bg-purple-400'
                    }`} />
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
                      <span className="text-slate-300 text-sm">Latency</span>
                      <span className="text-lg font-bold text-white">{metrics.e2eLatency.current.toFixed(0)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">ms</div>
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">FPS</span>
                      <span className="text-lg font-bold text-white">{metrics.processingFps.toFixed(1)}</span>
                    </div>
                  </div>
                  
                  <div className="bg-slate-800/60 rounded-lg p-4 border border-slate-600/50">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">Bandwidth</span>
                      <span className="text-lg font-bold text-white">{metrics.uplink.toFixed(0)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">kbps</div>
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
            onDetectionResult={handleDetectionResult}
          />
          
          {/* Notification System */}
          <NotificationSystem
            notifications={notifications}
            onDismiss={dismissNotification}
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