const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const [, , durationStr, mode, outputFile] = process.argv;
  const duration = parseInt(durationStr, 10) * 1000;

  console.log(`🚀 Starting benchmark: ${duration/1000}s duration, ${mode} mode`);

  const browser = await puppeteer.launch({
    headless: false, // Keep visible for debugging
    args: [
      '--use-fake-ui-for-media-stream', 
      '--use-fake-device-for-media-stream',
      '--allow-running-insecure-content',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  const browserPage = await browser.newPage();
  
  // Enable console logging
  browserPage.on('console', msg => {
    if (msg.text().includes('Frontend WebRTC Manager') || msg.text().includes('YOLO')) {
      console.log('Browser:', msg.text());
    }
  });
  
  await browserPage.goto('http://localhost:3001');
  
  // Wait for page to load
  await browserPage.waitForTimeout(2000);

  // Set mode
  await browserPage.evaluate((selectedMode) => {
    // Find and click the mode button
    const modeButton = selectedMode === 'wasm' ? 
      document.querySelector('button:contains("WASM Mode")') || document.querySelector('[data-mode="wasm"]') :
      document.querySelector('button:contains("Server Mode")') || document.querySelector('[data-mode="server"]');
    
    if (modeButton) {
      modeButton.click();
      console.log(`Mode set to: ${selectedMode}`);
    } else {
      console.log('Mode button not found, using default');
    }
  }, mode);

  // Create phone page
  const phonePage = await browser.newPage();
  
  phonePage.on('console', msg => {
    if (msg.text().includes('Phone') || msg.text().includes('WebRTC')) {
      console.log('Phone:', msg.text());
    }
  });
  
  // Get room ID from browser page
  const roomId = await browserPage.evaluate(() => {
    // Try different ways to get room ID
    return window.roomId?.current || 
           document.querySelector('[data-room-id]')?.getAttribute('data-room-id') ||
           'default-room';
  });
  
  console.log(`📱 Connecting phone to room: ${roomId}`);
  await phonePage.goto(`http://localhost:3001/phone?room=${roomId}`);
  
  // Wait for phone page to load
  await phonePage.waitForTimeout(2000);

  // Start streaming from phone
  try {
    await phonePage.click('button');
    console.log('📱 Phone streaming started');
  } catch (e) {
    console.log('📱 Could not find start button, trying alternative');
    await phonePage.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('Start') || btn.textContent.includes('Stream')) {
          btn.click();
          break;
        }
      }
    });
  }

  // Wait for connection
  await browserPage.waitForTimeout(3000);

  // Start detection on browser
  try {
    await browserPage.click('button');
    console.log('🖥️ Browser detection started');
  } catch (e) {
    console.log('🖥️ Could not find detection button, trying alternative');
    await browserPage.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('Start') || btn.textContent.includes('Detection')) {
          btn.click();
          break;
        }
      }
    });
  }

  const startTime = Date.now();
  const latencies = [];
  const serverLatencies = [];
  const networkLatencies = [];
  let framesProcessed = 0;
  let framesWithDetections = 0;

  // Collect metrics from browser page
  await browserPage.exposeFunction('reportDetection', (result) => {
    const now = Date.now();
    const e2eLatency = now - result.capture_ts;
    const serverLatency = result.inference_ts - result.recv_ts;
    const networkLatency = result.recv_ts - result.capture_ts;
    
    latencies.push(e2eLatency);
    serverLatencies.push(serverLatency);
    networkLatencies.push(networkLatency);
    framesProcessed++;
    
    if (result.detections && result.detections.length > 0) {
      framesWithDetections++;
    }
    
    if (framesProcessed % 10 === 0) {
      console.log(`📊 Processed ${framesProcessed} frames, ${framesWithDetections} with detections`);
    }
  });

  // Hook into the WebRTC data channel to capture detection results
  await browserPage.evaluate(() => {
    // Monitor data channel messages
    const originalSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.frame_id && parsed.capture_ts && parsed.recv_ts && parsed.inference_ts) {
          window.reportDetection(parsed);
        }
      } catch (e) {
        // Not JSON or not a detection result
      }
      return originalSend.call(this, data);
    };
    
    console.log('📊 Metrics collection hooks installed');
  });

  console.log(`⏱️ Running benchmark for ${duration/1000} seconds...`);
  await new Promise(resolve => setTimeout(resolve, duration));

  console.log('📊 Collecting final WebRTC statistics...');
  const stats = await browserPage.evaluate(async () => {
    try {
      // Try to get WebRTC stats from various possible locations
      let pc = null;
      
      // Try different ways to access peer connection
      if (window.webrtcManagerRef?.current?.peerConnection) {
        pc = window.webrtcManagerRef.current.peerConnection;
      } else if (window.peerConnection) {
        pc = window.peerConnection;
      } else {
        // Look for peer connection in global scope
        const keys = Object.keys(window);
        for (let key of keys) {
          if (window[key] && window[key].getStats && typeof window[key].getStats === 'function') {
            pc = window[key];
            break;
          }
        }
      }
      
      if (!pc || !pc.getStats) {
        console.log('No peer connection found for stats');
        return { bytesSent: 0, bytesReceived: 0, error: 'No peer connection' };
      }
      
      const report = await pc.getStats();
      let bytesSent = 0, bytesReceived = 0;
      let outboundStats = [], inboundStats = [];
      
      report.forEach(stat => {
        // Video RTP stats (phone to browser)
        if (stat.type === 'inbound-rtp' && stat.mediaType === 'video') {
          bytesReceived += stat.bytesReceived || 0;
          inboundStats.push(stat);
        }
        // Data channel stats (detection results browser to phone)
        if (stat.type === 'data-channel') {
          bytesSent += stat.bytesSent || 0;
          bytesReceived += stat.bytesReceived || 0;
        }
        // Transport stats (more comprehensive)
        if (stat.type === 'transport') {
          bytesSent += stat.bytesSent || 0;
          bytesReceived += stat.bytesReceived || 0;
        }
        // Candidate pair stats (actual network traffic)
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
          bytesSent += stat.bytesSent || 0;
          bytesReceived += stat.bytesReceived || 0;
        }
      });
      
      console.log(`WebRTC Stats - Sent: ${bytesSent}, Received: ${bytesReceived}`);
      return { bytesSent, bytesReceived, outboundStats: outboundStats.length, inboundStats: inboundStats.length };
    } catch (error) {
      console.error('Error getting WebRTC stats:', error);
      return { bytesSent: 0, bytesReceived: 0, error: error.message };
    }
  });

  console.log('🛑 Stopping detection and streaming...');
  
  // Stop detection and streaming
  try {
    await browserPage.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('Stop') || btn.textContent.includes('Detection')) {
          btn.click();
          break;
        }
      }
    });
  } catch (e) {
    console.log('Could not stop detection');
  }
  
  try {
    await phonePage.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('Stop') || btn.textContent.includes('Stream')) {
          btn.click();
          break;
        }
      }
    });
  } catch (e) {
    console.log('Could not stop streaming');
  }

  // Calculate metrics
  console.log('📈 Calculating metrics...');
  
  const actualDuration = duration / 1000;
  
  // Sort latencies for percentile calculations
  latencies.sort((a, b) => a - b);
  serverLatencies.sort((a, b) => a - b);
  networkLatencies.sort((a, b) => a - b);
  
  const calculateStats = (arr) => {
    if (arr.length === 0) return { median: 0, p95: 0, average: 0, min: 0, max: 0 };
    
    const median = arr[Math.floor(arr.length / 2)];
    const p95 = arr[Math.floor(arr.length * 0.95)];
    const average = arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = arr[0];
    const max = arr[arr.length - 1];
    
    return { median, p95, average, min, max };
  };
  
  const e2eStats = calculateStats(latencies);
  const serverStats = calculateStats(serverLatencies);
  const networkStats = calculateStats(networkLatencies);
  
  const fps = framesProcessed / actualDuration;
  const detectionRate = framesWithDetections / framesProcessed * 100;
  const uplinkKbps = (stats.bytesSent * 8 / 1000) / actualDuration;
  const downlinkKbps = (stats.bytesReceived * 8 / 1000) / actualDuration;

  const metrics = {
    benchmark: {
      timestamp: new Date().toISOString(),
      mode,
      duration_seconds: actualDuration,
      total_frames: framesProcessed,
      frames_with_detections: framesWithDetections,
      detection_rate_percent: Math.round(detectionRate * 100) / 100
    },
    performance: {
      processed_fps: Math.round(fps * 100) / 100,
      e2e_latency: {
        median_ms: Math.round(e2eStats.median * 100) / 100,
        p95_ms: Math.round(e2eStats.p95 * 100) / 100,
        average_ms: Math.round(e2eStats.average * 100) / 100,
        min_ms: Math.round(e2eStats.min * 100) / 100,
        max_ms: Math.round(e2eStats.max * 100) / 100
      },
      server_latency: {
        median_ms: Math.round(serverStats.median * 100) / 100,
        p95_ms: Math.round(serverStats.p95 * 100) / 100,
        average_ms: Math.round(serverStats.average * 100) / 100,
        min_ms: Math.round(serverStats.min * 100) / 100,
        max_ms: Math.round(serverStats.max * 100) / 100
      },
      network_latency: {
        median_ms: Math.round(networkStats.median * 100) / 100,
        p95_ms: Math.round(networkStats.p95 * 100) / 100,
        average_ms: Math.round(networkStats.average * 100) / 100,
        min_ms: Math.round(networkStats.min * 100) / 100,
        max_ms: Math.round(networkStats.max * 100) / 100
      }
    },
    bandwidth: {
      uplink_kbps: Math.round(uplinkKbps * 100) / 100,
      downlink_kbps: Math.round(downlinkKbps * 100) / 100,
      total_bytes_sent: stats.bytesSent,
      total_bytes_received: stats.bytesReceived
    },
    webrtc_stats: stats
  };

  console.log('📊 Benchmark Results:');
  console.log(`   Duration: ${actualDuration}s`);
  console.log(`   Frames processed: ${framesProcessed}`);
  console.log(`   Frames with detections: ${framesWithDetections} (${detectionRate.toFixed(1)}%)`);
  console.log(`   Processing FPS: ${fps.toFixed(2)}`);
  console.log(`   E2E Latency - Median: ${e2eStats.median.toFixed(1)}ms, P95: ${e2eStats.p95.toFixed(1)}ms`);
  console.log(`   Server Latency - Average: ${serverStats.average.toFixed(1)}ms`);
  console.log(`   Network Latency - Average: ${networkStats.average.toFixed(1)}ms`);
  console.log(`   Bandwidth - Up: ${uplinkKbps.toFixed(1)} kbps, Down: ${downlinkKbps.toFixed(1)} kbps`);

  fs.writeFileSync(outputFile, JSON.stringify(metrics, null, 2));
  console.log(`💾 Metrics saved to: ${outputFile}`);

  await browser.close();
}

main().catch(console.error);