import React from 'react';

interface ModeSelectorProps {
  mode: 'wasm' | 'server';
  onModeChange: (mode: 'wasm' | 'server') => void;
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onModeChange }) => {
  return (
    <div className="flex flex-col space-y-4">
      <div className="flex space-x-4">
        <button
          onClick={() => onModeChange('wasm')}
          className={`flex-1 px-6 py-4 rounded-lg font-medium transition-all border-2 ${
            mode === 'wasm'
              ? 'bg-blue-500 text-white shadow-lg border-blue-400'
              : 'bg-white/10 text-blue-200 hover:bg-white/20 border-blue-300/30'
          }`}
        >
          <div className="text-center">
            <div className="text-lg font-bold">WASM Mode</div>
            <div className="text-sm opacity-80 mt-1">
              Client-side Processing
            </div>
          </div>
        </button>
        <button
          onClick={() => onModeChange('server')}
          className={`flex-1 px-6 py-4 rounded-lg font-medium transition-all border-2 ${
            mode === 'server'
              ? 'bg-purple-500 text-white shadow-lg border-purple-400'
              : 'bg-white/10 text-purple-200 hover:bg-white/20 border-purple-300/30'
          }`}
        >
          <div className="text-center">
            <div className="text-lg font-bold">Server Mode</div>
            <div className="text-sm opacity-80 mt-1">
              Server-side Processing
            </div>
          </div>
        </button>
      </div>
      
      {/* Simplified Mode Status */}
      <div className="bg-white/5 rounded-lg p-3 border border-white/10">
        <div className="text-sm font-semibold text-white text-center">
          {mode === 'wasm' ? '🌐 WASM Mode Active' : '🖥️ Server Mode Active'}
        </div>
      </div>
    </div>
  );
};

export default ModeSelector;