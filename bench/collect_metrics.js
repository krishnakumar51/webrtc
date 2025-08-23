const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const [, , durationStr, mode, outputFile] = process.argv;
  const duration = parseInt(durationStr, 10) * 1000;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const browserPage = await browser.newPage();
  await browserPage.goto('http://localhost:3001');

  const roomId = await browserPage.evaluate(() => window.roomId.current);

  await browserPage.evaluate((selectedMode) => {
    window.setMode(selectedMode);
  }, mode);

  const phonePage = await browser.newPage();
  await phonePage.goto(`http://localhost:3001/phone?room=${roomId}`);

  await phonePage.click('button:has-text("Start Streaming")');

  await browserPage.waitForFunction(() => window.isConnected);

  await browserPage.click('button:has-text("Start Detection")');

  const startTime = Date.now();
  const latencies = [];
  const serverLatencies = [];
  const networkLatencies = [];
  let framesProcessed = 0;

  await browserPage.exposeFunction('reportDetection', (result) => {
    const now = Date.now();
    latencies.push(now - result.capture_ts);
    serverLatencies.push(result.inference_ts - result.recv_ts);
    networkLatencies.push(result.recv_ts - result.capture_ts);
    framesProcessed++;
  });

  await browserPage.evaluate(() => {
    const orig = window.handleDetectionResult;
    window.handleDetectionResult = (r) => { window.reportDetection(r); orig(r); };
  });

  await new Promise(resolve => setTimeout(resolve, duration));

  const stats = await browserPage.evaluate(async () => {
    const pc = window.webrtcManagerRef.current.peerConnection;
    if (!pc) return { bytesSent: 0, bytesReceived: 0 };
    const report = await pc.getStats();
    let bytesSent = 0, bytesReceived = 0;
    report.forEach(stat => {
      if (stat.type === 'outbound-rtp' && stat.kind === 'video') bytesSent += stat.bytesSent || 0;
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') bytesReceived += stat.bytesReceived || 0;
    });
    return { bytesSent, bytesReceived };
  });

  await browserPage.click('button:has-text("Stop Detection")');
  await phonePage.click('button:has-text("Stop Streaming")');

  latencies.sort((a, b) => a - b);
  const medianLatency = latencies[Math.floor(latencies.length / 2)] || 0;
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const avgServer = serverLatencies.reduce((a, b) => a + b, 0) / serverLatencies.length || 0;
  const avgNetwork = networkLatencies.reduce((a, b) => a + b, 0) / networkLatencies.length || 0;
  const fps = framesProcessed / (duration / 1000);
  const uplinkKbps = (stats.bytesSent * 8 / 1000) / (duration / 1000);
  const downlinkKbps = (stats.bytesReceived * 8 / 1000) / (duration / 1000);

  const metrics = {
    timestamp: new Date().toISOString(),
    mode,
    duration: duration / 1000,
    e2e_latency_median: medianLatency,
    e2e_latency_p95: p95Latency,
    processed_fps: fps,
    uplink_kbps: uplinkKbps,
    downlink_kbps: downlinkKbps,
    frames_processed: framesProcessed,
    server_latency_avg: avgServer,
    network_latency_avg: avgNetwork
  };

  fs.writeFileSync(outputFile, JSON.stringify(metrics, null, 2));

  await browser.close();
}

main().catch(console.error);