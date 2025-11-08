import React, { useEffect, useState } from 'react';
import { StrategyCard } from '../cards/StrategyCard';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { AlphaMemoryEngine } from '../../memory/AlphaMemoryEngine';
import { AlphaSnapshot } from '../../types/AlphaSnapshot';

interface StrategyGridProps {
  onAction: (action: string, strategyId: string) => void;
}

export const StrategyGrid: React.FC<StrategyGridProps> = ({ onAction }) => {
  const [strategies, setStrategies] = useState<AlphaSnapshot[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const memoryEngine = AlphaMemoryEngine.getInstance();
  const telemetryBus = TelemetryBus.getInstance();

  useEffect(() => {
    const loadStrategies = async () => {
      const snapshots = await memoryEngine.querySnapshots({} as any);
      setStrategies(snapshots);
    };

    loadStrategies();

    const unsubscribe = telemetryBus.subscribe('strategy_update', (data: any) => {
      setStrategies(prev => {
        const index = prev.findIndex(s => s.id === data.id);
        if (index === -1) return [...prev, data];
        const updated = [...prev];
        updated[index] = { ...updated[index], ...data };
        return updated;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleStrategyAction = (action: string, strategyId: string) => {
    setSelectedStrategy(strategyId);
    onAction(action, strategyId);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {strategies.map(strategy => (
        <StrategyCard
          key={strategy.id}
          strategy={strategy}
          isSelected={selectedStrategy === strategy.id}
          onAction={handleStrategyAction}
        />
      ))}
    </div>
  );
}; 