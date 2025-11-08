import React, { useEffect, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { AlphaMemoryEngine } from '../../memory/AlphaMemoryEngine';
import { ChartOptions } from 'chart.js';

Chart.register(...registerables);

interface RegimeSegment {
  timestamp_start: string;
  timestamp_end: string;
  regime: 'bull' | 'bear' | 'chop';
  strategy: string;
  roi: number;
  sharpe: number;
  trust: number;
  volatility: number;
  origin: 'manual' | 'mutation' | 'memory';
}

interface RegimeHeatmapProps {
  width?: number;
  height?: number;
  showOverlays?: boolean;
}

export const RegimeHeatmap: React.FC<RegimeHeatmapProps> = ({
  width = 1200,
  height = 200,
  showOverlays = true
}) => {
  const [segments, setSegments] = useState<RegimeSegment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<RegimeSegment | null>(null);
  const memoryEngine = AlphaMemoryEngine.getInstance();

  useEffect(() => {
    const loadSegments = async () => {
      try {
        const snapshots = await memoryEngine.querySnapshots({} as any);
        const regimeSegments: RegimeSegment[] = snapshots.map(snapshot => ({
          timestamp_start: new Date(snapshot.timestamp - 3600000).toISOString(), // 1 hour before
          timestamp_end: new Date(snapshot.timestamp).toISOString(),
          regime: snapshot.regime as 'bull' | 'bear' | 'chop',
          strategy: snapshot.strategy,
          roi: snapshot.metrics.roi,
          sharpe: snapshot.metrics.sharpeRatio,
          trust: snapshot.metrics.trust,
          volatility: snapshot.metrics.volatility,
          origin: (snapshot.parentId ? 'mutation' : 'manual') as 'manual' | 'mutation' | 'memory'
        }));
        setSegments(regimeSegments);
      } catch (error) {
        console.error('Failed to load regime segments:', error);
      }
    };

    loadSegments();

    const handleRegimeUpdate = (event: any) => {
      const newSegment: RegimeSegment = {
        timestamp_start: new Date(event.data.timestamp - 3600000).toISOString(),
        timestamp_end: new Date(event.data.timestamp).toISOString(),
        regime: event.data.regime as 'bull' | 'bear' | 'chop',
        strategy: event.data.strategy,
        roi: event.data.metrics.roi,
        sharpe: event.data.metrics.sharpeRatio,
        trust: event.data.metrics.trust,
        volatility: event.data.metrics.volatility,
        origin: (event.data.parentId ? 'mutation' : 'manual') as 'manual' | 'mutation' | 'memory'
      };
      setSegments(prev => [...prev, newSegment]);
    };

    const telemetryBus = TelemetryBus.getInstance();
    telemetryBus.on('regime_update', handleRegimeUpdate);

    return () => {
      telemetryBus.off('regime_update', handleRegimeUpdate);
    };
  }, []);

  const getRegimeColor = (regime: string) => {
    switch (regime) {
      case 'bull':
        return 'rgba(76, 175, 80, 0.7)';
      case 'bear':
        return 'rgba(244, 67, 54, 0.7)';
      case 'chop':
        return 'rgba(255, 193, 7, 0.7)';
      default:
        return 'rgba(158, 158, 158, 0.7)';
    }
  };

  const getStrategyColor = (strategy: string) => {
    // Generate a consistent color for each strategy
    const hash = strategy.split('').reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc);
    }, 0);
    return `hsl(${hash % 360}, 70%, 50%)`;
  };

  const chartData = {
    labels: segments.map(segment => 
      new Date(segment.timestamp_start).toLocaleTimeString()
    ),
    datasets: [
      {
        label: 'Regime',
        data: segments.map(segment => 1),
        backgroundColor: segments.map(segment => getRegimeColor(segment.regime)),
        borderColor: segments.map(segment => getStrategyColor(segment.strategy)),
        borderWidth: 2,
        barPercentage: 0.8,
        categoryPercentage: 0.9
      }
    ]
  };

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'category',
        title: {
          display: true,
          text: 'Time'
        }
      },
      y: {
        display: false
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const segment = segments[context.dataIndex];
            return [
              `Regime: ${segment.regime}`,
              `Strategy: ${segment.strategy}`,
              `ROI: ${(segment.roi * 100).toFixed(2)}%`,
              `Sharpe: ${segment.sharpe.toFixed(2)}`,
              `Trust: ${(segment.trust * 100).toFixed(1)}%`,
              `Volatility: ${(segment.volatility * 100).toFixed(2)}%`,
              `Origin: ${segment.origin}`
            ];
          }
        }
      }
    },
    onClick: (event: any, elements: any[]) => {
      if (elements.length > 0) {
        setSelectedSegment(segments[elements[0].index]);
      }
    }
  };

  return (
    <div style={{ width, height, position: 'relative' }}>
      <Bar data={chartData} options={chartOptions} />
      
      {selectedSegment && (
        <div style={{
          position: 'absolute',
          top: 10,
          right: 10,
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3>Selected Segment</h3>
          <p>Time: {new Date(selectedSegment.timestamp_start).toLocaleTimeString()} - {new Date(selectedSegment.timestamp_end).toLocaleTimeString()}</p>
          <p>Regime: {selectedSegment.regime}</p>
          <p>Strategy: {selectedSegment.strategy}</p>
          <p>ROI: {(selectedSegment.roi * 100).toFixed(2)}%</p>
          <p>Sharpe: {selectedSegment.sharpe.toFixed(2)}</p>
          <p>Trust: {(selectedSegment.trust * 100).toFixed(1)}%</p>
          <p>Volatility: {(selectedSegment.volatility * 100).toFixed(2)}%</p>
          <p>Origin: {selectedSegment.origin}</p>
        </div>
      )}
    </div>
  );
}; 