import React from 'react';

interface ModeSelectorProps {
  mode: 'wasm' | 'server';
  onModeChange: (mode: 'wasm' | 'server') => void;
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onModeChange }) => {
  return (
    <div className="flex space-x-2">
      <button
        onClick={() => onModeChange('wasm')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
          mode === 'wasm'
            ? 'bg-blue-500 text-white'
            : 'bg-white/10 text-blue-200 hover:bg-white/20'
        }`}
      >
        WASM
      </button>
      <button
        onClick={() => onModeChange('server')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
          mode === 'server'
            ? 'bg-purple-500 text-white'
            : 'bg-white/10 text-purple-200 hover:bg-white/20'
        }`}
      >
        Server
      </button>
    </div>
  );
};

export default ModeSelector;