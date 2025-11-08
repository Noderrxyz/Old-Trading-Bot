/**
 * Agent Chart Component
 * 
 * Chart for visualizing agent performance metrics
 */

import React, { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from 'recharts';
import { AgentPerformanceSnapshot, AgentPerformanceHistoryPoint } from '../../../src/api/types';

interface AgentChartProps {
  type: 'pnl' | 'drawdown' | 'latency';
  agentIds: string[];
  agentSnapshots: Record<string, AgentPerformanceSnapshot>;
  agentHistory: Record<string, AgentPerformanceHistoryPoint[]>;
  isPercentageView: boolean;
  timeRange: string;
}

// Chart colors for different agents
const CHART_COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088fe',
  '#00c49f', '#ffbb28', '#ff8042', '#a4de6c', '#d0ed57'
];

export function AgentChart({
  type,
  agentIds,
  agentSnapshots,
  agentHistory,
  isPercentageView,
  timeRange
}: AgentChartProps) {
  // Prepare chart data
  const chartData = useMemo(() => {
    if (agentIds.length === 0) {
      return [];
    }
    
    // Create a map of all timestamps across all agents
    const timestamps = new Set<number>();
    
    // Add timestamps from all agents' history
    for (const agentId of agentIds) {
      if (agentHistory[agentId]) {
        for (const point of agentHistory[agentId]) {
          timestamps.add(point.timestamp);
        }
      }
    }
    
    // Sort timestamps
    const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);
    
    // Create chart data
    return sortedTimestamps.map(timestamp => {
      const dataPoint: any = {
        timestamp,
        time: new Date(timestamp).toLocaleTimeString()
      };
      
      // Add data for each agent
      for (const [index, agentId] of agentIds.entries()) {
        if (!agentHistory[agentId]) continue;
        
        const pointIndex = agentHistory[agentId].findIndex(p => p.timestamp === timestamp);
        if (pointIndex === -1) continue;
        
        const point = agentHistory[agentId][pointIndex];
        
        if (type === 'pnl') {
          // Handle PnL
          const value = isPercentageView ? point.cumulativePnL * 100 : point.cumulativePnL;
          dataPoint[`${agentId}_pnl`] = value;
        } else if (type === 'drawdown') {
          // Handle drawdown
          dataPoint[`${agentId}_drawdown`] = point.drawdownPct;
        } else if (type === 'latency') {
          // For latency, we don't have history data, use the latest snapshot
          if (agentSnapshots[agentId]) {
            dataPoint[`${agentId}_latency`] = agentSnapshots[agentId].avgLatency;
          }
        }
      }
      
      return dataPoint;
    });
  }, [type, agentIds, agentSnapshots, agentHistory, isPercentageView]);
  
  // Get chart title
  const chartTitle = type === 'pnl'
    ? isPercentageView ? 'PnL (%)' : 'PnL ($)'
    : type === 'drawdown'
      ? 'Drawdown (%)'
      : 'Latency (ms)';
  
  // Get Y-axis domain based on chart type
  const getYAxisDomain = () => {
    if (type === 'pnl') {
      // Find min and max values
      let min = 0;
      let max = 0;
      
      for (const point of chartData) {
        for (const key of Object.keys(point)) {
          if (key.endsWith('_pnl')) {
            const value = point[key];
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
      }
      
      // Add padding
      const padding = Math.max(Math.abs(min), Math.abs(max)) * 0.1;
      return [min - padding, max + padding];
    } else if (type === 'drawdown') {
      // Drawdown is always negative or zero
      let min = 0;
      
      for (const point of chartData) {
        for (const key of Object.keys(point)) {
          if (key.endsWith('_drawdown')) {
            min = Math.min(min, point[key]);
          }
        }
      }
      
      // Add padding
      return [min * 1.1, 0];
    } else {
      // Latency is always positive
      let max = 100; // Default
      
      for (const point of chartData) {
        for (const key of Object.keys(point)) {
          if (key.endsWith('_latency')) {
            max = Math.max(max, point[key]);
          }
        }
      }
      
      // Add padding
      return [0, max * 1.1];
    }
  };
  
  // Format tooltip value based on chart type
  const formatTooltipValue = (value: number) => {
    if (type === 'pnl') {
      return isPercentageView ? `${value.toFixed(2)}%` : `$${value.toFixed(2)}`;
    } else if (type === 'drawdown') {
      return `${value.toFixed(2)}%`;
    } else {
      return `${value.toFixed(0)}ms`;
    }
  };
  
  return (
    <div className="agent-chart">
      <h3 className="chart-title">{chartTitle}</h3>
      
      {agentIds.length === 0 ? (
        <div className="no-agents-message">
          Please select at least one agent to display chart
        </div>
      ) : chartData.length === 0 ? (
        <div className="no-data-message">
          No historical data available for selected agents and time range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="time" 
              label={{ value: 'Time', position: 'insideBottomRight', offset: -10 }} 
            />
            <YAxis 
              domain={getYAxisDomain()}
              label={{ 
                value: chartTitle, 
                angle: -90, 
                position: 'insideLeft',
                style: { textAnchor: 'middle' }
              }} 
            />
            <Tooltip 
              formatter={(value: number) => [formatTooltipValue(value)]}
              labelFormatter={(label) => `Time: ${label}`}
            />
            <Legend />
            
            {agentIds.map((agentId, index) => {
              const agent = agentSnapshots[agentId];
              if (!agent) return null;
              
              const colorIndex = index % CHART_COLORS.length;
              const color = CHART_COLORS[colorIndex];
              const dataKey = `${agentId}_${type}`;
              
              return (
                <Line 
                  key={agentId}
                  type="monotone"
                  dataKey={dataKey}
                  name={agent.name || agent.agentId}
                  stroke={color}
                  activeDot={{ r: 8 }}
                  dot={false}
                  strokeWidth={2}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
} 