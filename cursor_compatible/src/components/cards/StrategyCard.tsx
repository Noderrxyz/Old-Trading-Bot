import React from 'react';
import { Sparkline } from '../charts/Sparkline';
import { AlphaSnapshot } from '../../types/AlphaSnapshot';

interface StrategyCardProps {
  strategy: AlphaSnapshot;
  onAction: (action: string, strategyId: string) => void;
}

export const StrategyCard: React.FC<StrategyCardProps> = ({ strategy, onAction }) => {
  const getRegimeColor = (regime: string) => {
    switch (regime.toLowerCase()) {
      case 'bull':
        return 'bg-green-100 text-green-800';
      case 'bear':
        return 'bg-red-100 text-red-800';
      case 'chop':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'live':
        return 'text-green-500';
      case 'paused':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'live':
        return '✅';
      case 'paused':
        return '⏸';
      case 'error':
        return '❌';
      default:
        return '❓';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow duration-200">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold">{strategy.id}</h3>
          <p className="text-sm text-gray-500">{strategy.market}</p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRegimeColor(strategy.regime)}`}>
          {strategy.regime}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-500">ROI</p>
          <p className="text-lg font-semibold">{strategy.metrics.roi.toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Sharpe</p>
          <p className="text-lg font-semibold">{strategy.metrics.sharpeRatio.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Trust</p>
          <p className="text-lg font-semibold">{strategy.metrics.trust.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Status</p>
          <p className={`text-lg font-semibold ${getStatusColor(strategy.status)}`}>
            {getStatusIcon(strategy.status)} {strategy.status}
          </p>
        </div>
      </div>

      <div className="h-16 mb-4">
        <Sparkline data={strategy.metrics.pnlHistory} />
      </div>

      <div className="flex justify-end space-x-2">
        <button
          onClick={() => onAction('pause', strategy.id)}
          className="px-3 py-1 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
        >
          ⏸ Pause
        </button>
        <button
          onClick={() => onAction('kill', strategy.id)}
          className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
        >
          🔥 Kill
        </button>
        <button
          onClick={() => onAction('clone', strategy.id)}
          className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
        >
          📋 Clone
        </button>
        <button
          onClick={() => onAction('debug', strategy.id)}
          className="px-3 py-1 text-sm bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
        >
          🐛 Debug
        </button>
      </div>
    </div>
  );
}; 