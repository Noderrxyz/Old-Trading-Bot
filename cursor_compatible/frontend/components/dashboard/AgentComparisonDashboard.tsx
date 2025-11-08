/**
 * Agent Comparison Dashboard
 * 
 * Main component for comparing multiple trading agents side-by-side
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAgentComparison } from '../../hooks/useAgentComparison';
import { AgentSelector } from './AgentSelector';
import { MetricTile } from './MetricTile';
import { AgentChart } from './AgentChart';
import { TimeRangeSelector } from './TimeRangeSelector';

interface AgentComparisonDashboardProps {
  apiUrl?: string;
  wsUrl?: string;
  initialAgentIds?: string[];
}

/**
 * Agent comparison dashboard
 */
export function AgentComparisonDashboard({
  apiUrl = 'http://localhost:3001/api',
  wsUrl = 'http://localhost:3001',
  initialAgentIds = []
}: AgentComparisonDashboardProps) {
  // Time range and resolution state
  const [timeRange, setTimeRange] = useState('1d');
  const [resolution, setResolution] = useState('5m');
  const [chartType, setChartType] = useState<'pnl' | 'drawdown' | 'latency'>('pnl');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(initialAgentIds);
  const [isPercentageView, setIsPercentageView] = useState(false);
  
  // Use the agent comparison hook
  const {
    agentSnapshots,
    agentHistory,
    loading,
    error,
    refreshData,
    selectAgents,
    setTimeRange: setComparisonTimeRange,
    setResolution: setComparisonResolution,
    setUpdateInterval
  } = useAgentComparison({
    apiUrl,
    wsUrl,
    selectedAgentIds: initialAgentIds,
    timeRange,
    resolution
  });
  
  // Organize agent data by category for easy access
  const organizedAgents = useMemo(() => {
    // Convert array to record by ID for quick lookup
    const agentsById: Record<string, any> = {};
    
    for (const agent of agentSnapshots) {
      agentsById[agent.agentId] = agent;
    }
    
    // Group agents by their type
    const live = agentSnapshots.filter(agent => !agent.isCanary);
    const canary = agentSnapshots.filter(agent => agent.isCanary);
    
    return {
      all: agentSnapshots,
      byId: agentsById,
      live,
      canary
    };
  }, [agentSnapshots]);
  
  // Handle time range change
  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
    setComparisonTimeRange(range);
  };
  
  // Handle resolution change
  const handleResolutionChange = (res: string) => {
    setResolution(res);
    setComparisonResolution(res);
  };
  
  // Handle agent selection
  const handleAgentSelection = (agentIds: string[]) => {
    setSelectedAgentIds(agentIds);
    selectAgents(agentIds);
  };
  
  // Handle chart type change
  const handleChartTypeChange = (type: 'pnl' | 'drawdown' | 'latency') => {
    setChartType(type);
  };
  
  // Handle update interval change
  const handleUpdateIntervalChange = (intervalMs: number) => {
    setUpdateInterval(intervalMs);
  };
  
  // Handle percentage view toggle
  const handlePercentageViewToggle = () => {
    setIsPercentageView(!isPercentageView);
  };
  
  return (
    <div className="agent-comparison-dashboard">
      <header className="dashboard-header">
        <h1 className="dashboard-title">Agent Comparison Dashboard</h1>
        <div className="dashboard-actions">
          <button 
            className="refresh-button"
            onClick={() => refreshData()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <TimeRangeSelector 
            value={timeRange}
            onChange={handleTimeRangeChange}
            options={[
              { value: '1h', label: '1 Hour' },
              { value: '4h', label: '4 Hours' },
              { value: '1d', label: '1 Day' },
              { value: '7d', label: '1 Week' },
              { value: '30d', label: '1 Month' },
              { value: 'all', label: 'All Time' }
            ]}
          />
          <div className="view-toggle">
            <label>
              <input
                type="checkbox"
                checked={isPercentageView}
                onChange={handlePercentageViewToggle}
              />
              Percentage View
            </label>
          </div>
        </div>
      </header>
      
      {error && (
        <div className="error-message">
          Error: {error.message}
        </div>
      )}
      
      <div className="dashboard-content">
        <aside className="dashboard-sidebar">
          <AgentSelector
            agents={organizedAgents.all}
            selectedAgentIds={selectedAgentIds}
            onChange={handleAgentSelection}
          />
          
          <div className="chart-type-selector">
            <h3>Chart Type</h3>
            <div className="chart-type-options">
              <button
                className={`chart-type-button ${chartType === 'pnl' ? 'active' : ''}`}
                onClick={() => handleChartTypeChange('pnl')}
              >
                PnL
              </button>
              <button
                className={`chart-type-button ${chartType === 'drawdown' ? 'active' : ''}`}
                onClick={() => handleChartTypeChange('drawdown')}
              >
                Drawdown
              </button>
              <button
                className={`chart-type-button ${chartType === 'latency' ? 'active' : ''}`}
                onClick={() => handleChartTypeChange('latency')}
              >
                Latency
              </button>
            </div>
          </div>
          
          <div className="resolution-selector">
            <h3>Resolution</h3>
            <select 
              value={resolution}
              onChange={(e) => handleResolutionChange(e.target.value)}
            >
              <option value="1m">1 Minute</option>
              <option value="5m">5 Minutes</option>
              <option value="15m">15 Minutes</option>
              <option value="1h">1 Hour</option>
              <option value="4h">4 Hours</option>
              <option value="1d">1 Day</option>
            </select>
          </div>
          
          <div className="update-interval-selector">
            <h3>Update Interval</h3>
            <select
              onChange={(e) => handleUpdateIntervalChange(parseInt(e.target.value))}
              defaultValue="5000"
            >
              <option value="1000">1 Second</option>
              <option value="5000">5 Seconds</option>
              <option value="10000">10 Seconds</option>
              <option value="30000">30 Seconds</option>
              <option value="60000">1 Minute</option>
            </select>
          </div>
        </aside>
        
        <main className="dashboard-main">
          <div className="chart-container">
            <AgentChart
              type={chartType}
              agentIds={selectedAgentIds}
              agentSnapshots={organizedAgents.byId}
              agentHistory={agentHistory}
              isPercentageView={isPercentageView}
              timeRange={timeRange}
            />
          </div>
          
          <div className="metrics-grid">
            {selectedAgentIds.map(agentId => {
              const agent = organizedAgents.byId[agentId];
              if (!agent) return null;
              
              return (
                <div className="agent-metrics-container" key={agentId}>
                  <h2 className="agent-name">
                    {agent.name || agent.agentId}
                    {agent.isCanary && (
                      <span className="canary-badge">CANARY</span>
                    )}
                  </h2>
                  
                  <div className="metrics-tiles">
                    <MetricTile
                      label="Cumulative PnL"
                      value={isPercentageView ? `${(agent.cumulativePnL * 100).toFixed(2)}%` : `$${agent.cumulativePnL.toFixed(2)}`}
                      trend={agent.cumulativePnL > 0 ? 'up' : 'down'}
                    />
                    
                    <MetricTile
                      label="Win Rate"
                      value={`${(agent.winRate).toFixed(1)}%`}
                      trend={agent.winRate > 50 ? 'up' : 'down'}
                    />
                    
                    <MetricTile
                      label="Max Drawdown"
                      value={`${(agent.maxDrawdownPct).toFixed(2)}%`}
                      trend="down"
                      inverseTrend
                    />
                    
                    <MetricTile
                      label="Avg Latency"
                      value={`${agent.avgLatency.toFixed(0)}ms`}
                      trend="down"
                      inverseTrend
                    />
                    
                    <MetricTile
                      label="Signal Count"
                      value={agent.signalCount.toString()}
                    />
                    
                    <MetricTile
                      label="Mode"
                      value={agent.isCanary ? 'Canary' : 'Live'}
                      highlight={agent.isCanary}
                    />
                    
                    {agent.lastTrade && (
                      <MetricTile
                        label="Last Trade"
                        value={`${agent.lastTrade.type} @ $${agent.lastTrade.price.toFixed(2)}`}
                        subtext={new Date(agent.lastTrade.timestamp).toLocaleTimeString()}
                      />
                    )}
                  </div>
                  
                  <div className="agent-actions">
                    <button className="agent-action-button">Restart</button>
                    <button className="agent-action-button">Suspend</button>
                    <button className="agent-action-button">View Details</button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
} 