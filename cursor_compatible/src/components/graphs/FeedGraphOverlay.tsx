import React, { useEffect, useState, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { TelemetryBus } from '../../telemetry/TelemetryBus';

Chart.register(...registerables);

interface FeedNode {
  id: string;
  type: 'cex' | 'dex';
  latency: number;
  trust: number;
  status: 'healthy' | 'delayed' | 'broken';
  markets: string[];
  last_heartbeat: number;
}

interface FeedEdge {
  source: string;
  target: string;
  weight: number;
}

interface FeedGraphData {
  nodes: FeedNode[];
  edges: FeedEdge[];
}

interface FeedGraphOverlayProps {
  width?: number;
  height?: number;
  onQuarantine?: (nodeId: string) => void;
}

export const FeedGraphOverlay: React.FC<FeedGraphOverlayProps> = ({
  width = 800,
  height = 600,
  onQuarantine
}) => {
  const [graphData, setGraphData] = useState<FeedGraphData>({ nodes: [], edges: [] });
  const chartRef = useRef<any>(null);

  useEffect(() => {
    const handleFeedUpdate = (event: any) => {
      setGraphData(event.data);
    };

    const telemetryBus = TelemetryBus.getInstance();
    telemetryBus.on('feed_graph_updates', handleFeedUpdate);

    return () => {
      telemetryBus.off('feed_graph_updates', handleFeedUpdate);
    };
  }, []);

  const getNodeColor = (node: FeedNode) => {
    switch (node.status) {
      case 'healthy':
        return '#4CAF50';
      case 'delayed':
        return '#FFC107';
      case 'broken':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  };

  const getTrustColor = (trust: number) => {
    const hue = trust * 120; // Map 0-1 to 0-120 (red to green)
    return `hsl(${hue}, 100%, 50%)`;
  };

  const chartData = {
    labels: graphData.nodes.map(node => node.id),
    datasets: [
      {
        label: 'Latency (ms)',
        data: graphData.nodes.map(node => node.latency),
        backgroundColor: graphData.nodes.map(node => getNodeColor(node)),
        borderColor: graphData.nodes.map(node => getTrustColor(node.trust)),
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 12
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Latency (ms)'
        }
      },
      x: {
        title: {
          display: true,
          text: 'Feed Source'
        }
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const node = graphData.nodes[context.dataIndex];
            return [
              `Latency: ${node.latency}ms`,
              `Trust: ${(node.trust * 100).toFixed(1)}%`,
              `Status: ${node.status}`,
              `Markets: ${node.markets.join(', ')}`,
              `Last Heartbeat: ${new Date(node.last_heartbeat).toLocaleTimeString()}`
            ];
          }
        }
      }
    },
    onClick: (event: any, elements: any[]) => {
      if (elements.length > 0 && onQuarantine) {
        const nodeIndex = elements[0].index;
        onQuarantine(graphData.nodes[nodeIndex].id);
      }
    }
  };

  return (
    <div style={{ width, height, position: 'relative' }}>
      <Line
        data={chartData}
        options={chartOptions}
        ref={chartRef}
      />
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        padding: '10px',
        borderRadius: '5px',
        fontSize: '12px'
      }}>
        <div>🟢 Healthy</div>
        <div>🟡 Delayed</div>
        <div>🔴 Broken</div>
        <div>Click node to quarantine</div>
      </div>
    </div>
  );
}; 