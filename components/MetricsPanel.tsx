import React from 'react';

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

interface MetricsPanelProps {
  metrics: Metrics;
  onExportMetrics: () => void;
}

const safeFixed = (value: number | undefined | null, digits = 1) => {
  return typeof value === 'number' && isFinite(value) ? value.toFixed(digits) : '0.0';
};

const MetricsPanel: React.FC<MetricsPanelProps> = ({ metrics, onExportMetrics }) => {
  const getStatusColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) return 'text-green-400';
    if (value <= thresholds.warning) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getProgressValue = (current: number, max: number) => {
    const val = typeof current === 'number' && isFinite(current) ? current : 0;
    return Math.min((val / max) * 100, 100);
  };

  const e2eCurrent = metrics?.e2eLatency?.current ?? 0;
  const e2eP95 = metrics?.e2eLatency?.p95 ?? 0;
  const processingFps = metrics?.processingFps ?? 0;
  const uplink = metrics?.uplink ?? 0;
  const downlink = metrics?.downlink ?? 0;
  const serverLatency = metrics?.serverLatency ?? 0;
  const networkLatency = metrics?.networkLatency ?? 0;

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <span className="text-xl mr-2">📊</span>
          <h3 className="text-lg font-semibold text-white">Performance Metrics</h3>
        </div>
        <button
          onClick={onExportMetrics}
          className="flex items-center px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm"
        >
          <span className="mr-1">📥</span>
          Export JSON
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* E2E Latency */}
      <div className="mb-4">
        <div className="flex items-center mb-2">
          <span className="text-lg mr-2">⏱️</span>
          <span className="text-white font-medium">E2E Latency</span>
        </div>
        <div className="flex justify-between items-center mb-1">
          <span className={`font-bold text-lg ${getStatusColor(e2eCurrent, { good: 50, warning: 100 })}`}>
            {safeFixed(e2eCurrent, 1)}ms
          </span>
          <span className="text-blue-200 text-sm">
            P95: {safeFixed(e2eP95, 1)}ms
          </span>
        </div>
        <div className="w-full bg-black/30 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              e2eCurrent <= 50 ? 'bg-green-400' :
              e2eCurrent <= 100 ? 'bg-yellow-400' : 'bg-red-400'
            }`}
            style={{ width: `${getProgressValue(e2eCurrent, 200)}%` }}
          />
        </div>
      </div>

      {/* Processing FPS */}
      <div className="mb-4">
        <div className="flex items-center mb-2">
          <span className="text-lg mr-2">🎯</span>
          <span className="text-white font-medium">Processing FPS</span>
        </div>
        <div className="flex justify-between items-center mb-1">
          <span className={`font-bold text-lg ${getStatusColor(15 - processingFps, { good: 5, warning: 10 })}`}>
            {safeFixed(processingFps, 1)}
          </span>
          <span className="text-blue-200 text-sm">Target: 15 FPS</span>
        </div>
        <div className="w-full bg-black/30 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              processingFps >= 12 ? 'bg-green-400' :
              processingFps >= 8 ? 'bg-yellow-400' : 'bg-red-400'
            }`}
            style={{ width: `${getProgressValue(processingFps, 15)}%` }}
          />
        </div>
      </div>

      {/* Uplink */}
      <div className="mb-4">
        <div className="flex items-center mb-2">
          <span className="text-lg mr-2">📤</span>
          <span className="text-white font-medium">Uplink</span>
        </div>
        <div className="flex justify-between items-center mb-1">
          <span className="font-bold text-lg text-blue-300">
            {safeFixed(uplink, 1)} kbps
          </span>
          <span className="text-blue-200 text-sm">Upload rate</span>
        </div>
        <div className="w-full bg-black/30 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-blue-400 transition-all duration-300"
            style={{ width: `${getProgressValue(uplink, 2000)}%` }}
          />
        </div>
      </div>

      {/* Downlink */}
      <div className="mb-4">
        <div className="flex items-center mb-2">
          <span className="text-lg mr-2">📥</span>
          <span className="text-white font-medium">Downlink</span>
        </div>
        <div className="flex justify-between items-center mb-1">
          <span className="font-bold text-lg text-green-300">
            {safeFixed(downlink, 1)} kbps
          </span>
          <span className="text-blue-200 text-sm">Download rate</span>
        </div>
        <div className="w-full bg-black/30 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-green-400 transition-all duration-300"
            style={{ width: `${getProgressValue(downlink, 1000)}%` }}
          />
        </div>
      </div>

      {/* Network Performance */}
      <div className="border-t border-white/20 pt-4">
        <h4 className="text-white font-medium mb-3">Network Performance</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-blue-200">Server Latency:</span>
            <span className="text-white font-semibold">{safeFixed(serverLatency, 1)}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-200">Network Latency:</span>
            <span className="text-white font-semibold">{safeFixed(networkLatency, 1)}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-200">Frames Processed:</span>
            <span className="text-white font-semibold">{metrics.framesProcessed}</span>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="border-t border-white/20 pt-4 mt-4">
        <h4 className="text-white font-medium mb-3">System Status</h4>
        <div className="flex flex-wrap gap-2">
          <span className={`px-2 py-1 rounded text-xs ${
            processingFps > 0 ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'
          }`}>
            {processingFps > 0 ? 'Active' : 'Idle'}
          </span>
          <span className={`px-2 py-1 rounded text-xs ${
            processingFps < 10 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-green-500/20 text-green-300'
          }`}>
            {processingFps < 10 ? 'Low FPS' : 'Good FPS'}
          </span>
          <span className={`px-2 py-1 rounded text-xs ${
            e2eCurrent < 100 ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
          }`}>
            {e2eCurrent < 100 ? 'Low Latency' : 'High Latency'}
          </span>
        </div>
      </div>
      </div>
    </div>
  );
};

export default MetricsPanel;