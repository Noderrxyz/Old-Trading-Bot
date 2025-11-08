import React, { useState } from 'react';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { AlphaMemoryEngine } from '../../memory/AlphaMemoryEngine';

interface HotbarControlsProps {
  onLaunchModalOpen?: () => void;
}

export const HotbarControls: React.FC<HotbarControlsProps> = ({ onLaunchModalOpen }) => {
  const [isPaused, setIsPaused] = useState(false);
  const telemetryBus = TelemetryBus.getInstance();
  const memoryEngine = AlphaMemoryEngine.getInstance();

  const handlePanic = async () => {
    if (window.confirm('Are you sure you want to panic freeze all agents? This will halt all strategies and mutation processes.')) {
      try {
        const response = await fetch('/api/control/agents/panic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          telemetryBus.emit('operator_action', { action: 'panic', timestamp: Date.now() });
        }
      } catch (error) {
        console.error('Failed to trigger panic:', error);
      }
    }
  };

  const handlePauseMutations = async () => {
    try {
      const response = await fetch('/api/control/mutation/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pause: !isPaused })
      });
      if (response.ok) {
        setIsPaused(!isPaused);
        telemetryBus.emit('operator_action', { 
          action: 'mutation_pause', 
          state: !isPaused,
          timestamp: Date.now() 
        });
      }
    } catch (error) {
      console.error('Failed to toggle mutation pause:', error);
    }
  };

  const handleRestartTopAgents = async () => {
    if (window.confirm('Are you sure you want to restart the top 3 agents? This will reboot the highest trust-score strategies.')) {
      try {
        const response = await fetch('/api/control/agents/restart-top', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          telemetryBus.emit('operator_action', { 
            action: 'restart_top_agents', 
            timestamp: Date.now() 
          });
        }
      } catch (error) {
        console.error('Failed to restart top agents:', error);
      }
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-white p-4 flex justify-center space-x-4 z-50">
      <button
        onClick={handlePanic}
        className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded flex items-center space-x-2"
        title="Panic Freeze All Agents - Instantly halt all strategies and mutation processes"
      >
        <span>🔴</span>
        <span>Panic Freeze</span>
      </button>

      <button
        onClick={handlePauseMutations}
        className={`px-4 py-2 ${isPaused ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-600 hover:bg-gray-700'} rounded flex items-center space-x-2`}
        title={`${isPaused ? 'Resume' : 'Pause'} Mutations - ${isPaused ? 'Resume' : 'Temporarily suspend'} the MutationEngine`}
      >
        <span>⏸</span>
        <span>{isPaused ? 'Resume Mutations' : 'Pause Mutations'}</span>
      </button>

      <button
        onClick={handleRestartTopAgents}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded flex items-center space-x-2"
        title="Restart Top Agents - Reboots the highest trust-score strategies"
      >
        <span>🔁</span>
        <span>Restart Top Agents</span>
      </button>

      <button
        onClick={onLaunchModalOpen}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded flex items-center space-x-2"
        title="Launch Strategy - Open modal for launching a manual strategy"
      >
        <span>⚙️</span>
        <span>Launch Strategy</span>
      </button>
    </div>
  );
}; 