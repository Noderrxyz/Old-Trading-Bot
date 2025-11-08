import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { TrustDecayEngine } from '../../trust/TrustDecayEngine';
import { EntropyTracker } from '../../metrics/entropy_tracker';

Chart.register(...registerables);

interface SystemMetrics {
  timestamp: string;
  memory_mb: number;
  retry_rate: number;
  entropy_avg: number;
  trust_violations: number;
  error_burst: boolean;
}

interface EngineHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'critical';
  lastCheck: string;
  metrics: {
    latency: number;
    errorRate: number;
    throughput: number;
  };
}

interface SystemVitalsProps {
  width?: number;
  height?: number;
  refreshInterval?: number;
}

export const SystemVitals: React.FC<SystemVitalsProps> = ({
  width = 1200,
  height = 800,
  refreshInterval = 15000
}) => {
  const [metrics, setMetrics] = useState<SystemMetrics[]>([]);
  const [trustDecayAgents, setTrustDecayAgents] = useState<string[]>([]);
  const [engineHealth, setEngineHealth] = useState<EngineHealth[]>([]);
  const [errorBurst, setErrorBurst] = useState(false);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const response = await fetch('/api/system/metrics');
        const data = await response.json();
        setMetrics(prev => [...prev, data].slice(-30)); // Keep last 30 data points
        setErrorBurst(data.error_burst);
      } catch (error) {
        console.error('Failed to load system metrics:', error);
      }
    };

    const loadTrustDecay = async () => {
      try {
        const decayEngine = TrustDecayEngine.getInstance();
        const agents = await decayEngine.getDecayingAgents();
        setTrustDecayAgents(agents);
      } catch (error) {
        console.error('Failed to load trust decay agents:', error);
      }
    };

    const loadEngineHealth = async () => {
      try {
        const response = await fetch('/api/system/health');
        const data = await response.json();
        setEngineHealth(data);
      } catch (error) {
        console.error('Failed to load engine health:', error);
      }
    };

    const interval = setInterval(() => {
      loadMetrics();
      loadTrustDecay();
      loadEngineHealth();
    }, refreshInterval);

    // Initial load
    loadMetrics();
    loadTrustDecay();
    loadEngineHealth();

    return () => clearInterval(interval);
  }, [refreshInterval]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'critical':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const chartData = {
    labels: metrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
    datasets: [
      {
        label: 'Memory Usage (MB)',
        data: metrics.map(m => m.memory_mb),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      },
      {
        label: 'Retry Rate',
        data: metrics.map(m => m.retry_rate),
        borderColor: 'rgb(255, 99, 132)',
        tension: 0.1
      },
      {
        label: 'Entropy',
        data: metrics.map(m => m.entropy_avg),
        borderColor: 'rgb(255, 205, 86)',
        tension: 0.1
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true
      }
    }
  };

  return (
    <div className="p-4" style={{ width, height }}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {/* Memory Usage Card */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-2">Memory Usage</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? metrics[metrics.length - 1].memory_mb.toFixed(1) : '0'} MB
          </p>
          <div className="h-32 mt-2">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        {/* Retry Rate Card */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-2">Retry Rate</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? metrics[metrics.length - 1].retry_rate.toFixed(1) : '0'} / hour
          </p>
          <div className="h-32 mt-2">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        {/* Entropy Card */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-2">Entropy</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? metrics[metrics.length - 1].entropy_avg.toFixed(2) : '0.00'}
          </p>
          <div className="h-32 mt-2">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        {/* Trust Decay Card */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-2">Trust Decay Agents</h3>
          <p className="text-2xl font-bold mb-2">{trustDecayAgents.length}</p>
          <ul className="max-h-32 overflow-y-auto">
            {trustDecayAgents.map(agent => (
              <li key={agent} className="text-sm text-red-600">{agent}</li>
            ))}
          </ul>
        </div>

        {/* Error Burst Card */}
        <div className={`bg-white rounded-lg shadow p-4 ${errorBurst ? 'animate-pulse bg-red-100' : ''}`}>
          <h3 className="text-lg font-semibold mb-2">Error Burst Status</h3>
          <p className={`text-2xl font-bold ${errorBurst ? 'text-red-600' : 'text-green-600'}`}>
            {errorBurst ? '⚠️ Active' : '✅ Normal'}
          </p>
        </div>

        {/* Engine Health Card */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-2">Engine Health</h3>
          <div className="space-y-2">
            {engineHealth.map(engine => (
              <div key={engine.name} className="flex items-center justify-between">
                <span>{engine.name}</span>
                <div className="flex items-center space-x-2">
                  <span className={`w-3 h-3 rounded-full ${getStatusColor(engine.status)}`} />
                  <span className="text-sm">
                    {engine.metrics.errorRate.toFixed(1)}% error
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}; 