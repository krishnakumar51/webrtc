const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function main() {
  const [, , durationStr, mode, outputFile] = process.argv;
  const duration = parseInt(durationStr, 10) * 1000;

  // Validate inputs
  if (!durationStr || !mode || !outputFile) {
    console.error('❌ Usage: node collect_metrics.js <duration> <mode> <output_file>');
    process.exit(1);
  }

  if (isNaN(duration) || duration < 5000) {
    console.error('❌ Duration must be a number >= 5 seconds');
    process.exit(1);
  }

  if (!['wasm', 'server'].includes(mode)) {
    console.error('❌ Mode must be "wasm" or "server"');
    process.exit(1);
  }

  console.log(`🚀 Starting benchmark: ${duration/1000}s duration, ${mode} mode`);

  const startTime = Date.now();
  let browser;

  // Optimized browser configuration for performance
  browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false', // Allow override via env var
    args: [
      '--use-fake-ui-for-media-stream', 
      '--use-fake-device-for-media-stream',
      '--allow-running-insecure-content',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu-sandbox',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-field-trial-config',
      '--disable-back-forward-cache',
      '--disable-ipc-flooding-protection',
      '--memory-pressure-off'
    ],
    defaultViewport: { width: 1280, height: 720 },
    timeout: 30000
  });

  let browserPage, phonePage;
  
  try {
    browserPage = await browser.newPage();
    
    // Enhanced console logging with filtering
    browserPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('Frontend WebRTC Manager') || 
          text.includes('YOLO') || 
          text.includes('Detection') ||
          text.includes('Error') ||
          text.includes('Warning')) {
        console.log('Browser:', text);
      }
    });
    
    // Enhanced error handling for page errors
    browserPage.on('pageerror', error => {
      console.error('Browser page error:', error.message);
    });
    
    browserPage.on('requestfailed', request => {
      console.warn('Browser request failed:', request.url(), request.failure()?.errorText);
    });
    
    console.log('🌐 Loading browser page...');
    await browserPage.goto('http://localhost:3001', { 
      waitUntil: 'networkidle2', 
      timeout: 15000 
    });
    
    // Wait for essential elements to load
    await browserPage.waitForSelector('body', { timeout: 10000 });
    
    // Enhanced mode selection with better element detection
    console.log(`🔧 Setting mode to: ${mode}`);
    const modeSet = await browserPage.evaluate((selectedMode) => {
      // Multiple strategies to find and click mode button
      const strategies = [
        () => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(btn => 
            btn.textContent.toLowerCase().includes(selectedMode.toLowerCase())
          );
        },
        () => document.querySelector(`[data-mode="${selectedMode}"]`),
        () => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return selectedMode === 'wasm' ? 
            buttons.find(btn => btn.textContent.includes('WASM')) :
            buttons.find(btn => btn.textContent.includes('Server'));
        }
      ];
      
      for (const strategy of strategies) {
        const button = strategy();
        if (button) {
          button.click();
          console.log(`Mode button clicked: ${selectedMode}`);
          return true;
        }
      }
      
      console.warn('Mode button not found, using default mode');
      return false;
    }, mode);
    
    if (modeSet) {
      // Wait for mode change to take effect
      await browserPage.waitForTimeout(1000);
    }

    // Create phone page with enhanced error handling
    phonePage = await browser.newPage();
    
    // Enhanced phone page logging
    phonePage.on('console', msg => {
      const text = msg.text();
      if (text.includes('Phone') || 
          text.includes('WebRTC') ||
          text.includes('Stream') ||
          text.includes('Error') ||
          text.includes('Warning')) {
        console.log('Phone:', text);
      }
    });
    
    phonePage.on('pageerror', error => {
      console.error('Phone page error:', error.message);
    });
    
    phonePage.on('requestfailed', request => {
      console.warn('Phone request failed:', request.url(), request.failure()?.errorText);
    });
    
    // Get room ID with multiple fallback strategies
    const roomId = await browserPage.evaluate(() => {
      // Try different ways to get room ID
      const strategies = [
        () => window.roomId?.current,
        () => document.querySelector('[data-room-id]')?.getAttribute('data-room-id'),
        () => {
          const url = new URL(window.location.href);
          return url.searchParams.get('room');
        },
        () => {
          // Generate a consistent room ID based on timestamp
          const now = new Date();
          return `bench-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
        }
      ];
      
      for (const strategy of strategies) {
        const id = strategy();
        if (id && typeof id === 'string' && id.length > 0) {
          return id;
        }
      }
      
      return 'benchmark-room';
    });
    
    console.log(`📱 Connecting phone to room: ${roomId}`);
    await phonePage.goto(`http://localhost:3001/phone?room=${roomId}`, {
      waitUntil: 'networkidle2',
      timeout: 15000
    });
    
    // Wait for phone page to be ready
    await phonePage.waitForSelector('body', { timeout: 10000 });
  
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

  } catch (error) {
    console.error('❌ Benchmark failed with error:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Attempt to save partial results if any data was collected
    if (latencies.length > 0 || framesProcessed > 0) {
      console.log('💾 Attempting to save partial results...');
      try {
        const partialMetrics = {
          benchmark: {
            timestamp: new Date().toISOString(),
            mode,
            duration_seconds: (Date.now() - startTime) / 1000,
            total_frames: framesProcessed,
            frames_with_detections: framesWithDetections,
            status: 'partial',
            error: error.message
          },
          performance: latencies.length > 0 ? {
            processed_fps: framesProcessed / ((Date.now() - startTime) / 1000),
            e2e_latency: {
              median_ms: latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] || 0,
              samples: latencies.length
            }
          } : null
        };
        
        const partialFile = outputFile.replace('.json', '_partial.json');
        fs.writeFileSync(partialFile, JSON.stringify(partialMetrics, null, 2));
        console.log(`💾 Partial results saved to: ${partialFile}`);
      } catch (saveError) {
        console.error('Failed to save partial results:', saveError.message);
      }
    }
    
    process.exit(1);
  } finally {
    // Ensure browser cleanup
    try {
      if (browser) {
        console.log('🧹 Cleaning up browser resources...');
        await browser.close();
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError.message);
    }
  }
}

// Enhanced error handling for the main function
main().catch((error) => {
  console.error('❌ Fatal error in benchmark:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Benchmark interrupted by user');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Benchmark terminated');
  process.exit(143);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled promise rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

