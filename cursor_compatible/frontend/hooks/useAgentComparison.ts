/**
 * useAgentComparison hook
 * 
 * React hook for fetching and subscribing to agent comparison data
 */

import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  AgentPerformanceSnapshot,
  AgentPerformanceHistoryPoint 
} from '../../src/api/types';

interface UseAgentComparisonOptions {
  apiUrl?: string;
  wsUrl?: string;
  selectedAgentIds?: string[];
  timeRange?: string;
  resolution?: string;
  updateInterval?: number;
}

interface UseAgentComparisonResult {
  agentSnapshots: AgentPerformanceSnapshot[];
  agentHistory: Record<string, AgentPerformanceHistoryPoint[]>;
  loading: boolean;
  error: Error | null;
  refreshData: () => Promise<void>;
  selectAgents: (agentIds: string[]) => void;
  setTimeRange: (range: string) => void;
  setResolution: (resolution: string) => void;
  setUpdateInterval: (intervalMs: number) => void;
}

/**
 * Hook for fetching and subscribing to agent comparison data
 */
export function useAgentComparison({
  apiUrl = 'http://localhost:3001/api',
  wsUrl = 'http://localhost:3001',
  selectedAgentIds,
  timeRange = '1d',
  resolution = '5m',
  updateInterval = 5000
}: UseAgentComparisonOptions = {}): UseAgentComparisonResult {
  // State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [agentSnapshots, setAgentSnapshots] = useState<AgentPerformanceSnapshot[]>([]);
  const [agentHistory, setAgentHistory] = useState<Record<string, AgentPerformanceHistoryPoint[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[] | undefined>(selectedAgentIds);
  const [currentTimeRange, setCurrentTimeRange] = useState<string>(timeRange);
  const [currentResolution, setCurrentResolution] = useState<string>(resolution);
  
  // Connect to WebSocket server
  useEffect(() => {
    const newSocket = io(wsUrl);
    
    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
      
      // Set update interval
      newSocket.emit('set_update_interval', updateInterval);
      
      // Subscribe to specific agents if provided
      if (selectedIds && selectedIds.length > 0) {
        newSocket.emit('subscribe_agents', selectedIds);
      }
    });
    
    newSocket.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err);
      setError(new Error(`WebSocket connection error: ${err.message}`));
    });
    
    // Handle agent comparison updates
    newSocket.on('agent_comparison_update', (data) => {
      // Map WebSocket data format to AgentPerformanceSnapshot
      const snapshots: AgentPerformanceSnapshot[] = data.agents.map((agent: any) => ({
        agentId: agent.id,
        name: agent.name || agent.id,
        mode: agent.mode === 'canary' ? 'canary' : 'live',
        state: 'RUNNING', // Default state since it's not included in WS data
        cumulativePnL: agent.cumulativePnL,
        realizedPnL: 0, // Not available in WS data
        unrealizedPnL: 0, // Not available in WS data
        winRate: agent.winRate,
        signalCount: agent.signalCount,
        avgLatency: agent.avgLatency,
        currentDrawdownPct: 0, // Not available in WS data
        maxDrawdownPct: agent.drawdownMax,
        uptime: 0, // Not available in WS data
        isCanary: agent.mode === 'canary',
        timestamp: agent.timestamp
      }));
      
      setAgentSnapshots(snapshots);
    });
    
    setSocket(newSocket);
    
    // Cleanup on unmount
    return () => {
      newSocket.disconnect();
    };
  }, [wsUrl, updateInterval, selectedIds]);
  
  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch agent snapshots
        const snapshotsUrl = `${apiUrl}/agents/compare`;
        const snapshotsParams = new URLSearchParams();
        if (selectedIds && selectedIds.length > 0) {
          snapshotsParams.set('agentIds', selectedIds.join(','));
        }
        if (currentTimeRange) {
          snapshotsParams.set('timeRange', currentTimeRange);
        }
        
        const snapshotsResponse = await fetch(`${snapshotsUrl}?${snapshotsParams.toString()}`);
        
        if (!snapshotsResponse.ok) {
          throw new Error(`Failed to fetch agent snapshots: ${snapshotsResponse.statusText}`);
        }
        
        const snapshots = await snapshotsResponse.json();
        setAgentSnapshots(snapshots);
        
        // Fetch agent history if we have selected agent IDs
        if (selectedIds && selectedIds.length > 0) {
          await fetchAgentHistory(selectedIds, currentTimeRange, currentResolution);
        }
        
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };
    
    fetchData();
  }, [apiUrl, selectedIds, currentTimeRange, currentResolution]);
  
  // Fetch agent history
  const fetchAgentHistory = async (
    agentIds: string[],
    timeRange: string,
    resolution: string
  ) => {
    try {
      const historyUrl = `${apiUrl}/agents/compare/history`;
      const historyParams = new URLSearchParams({
        agentIds: agentIds.join(','),
        timeRange,
        resolution
      });
      
      const historyResponse = await fetch(`${historyUrl}?${historyParams.toString()}`);
      
      if (!historyResponse.ok) {
        throw new Error(`Failed to fetch agent history: ${historyResponse.statusText}`);
      }
      
      const history = await historyResponse.json();
      setAgentHistory(history);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  };
  
  // Refresh data
  const refreshData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch agent snapshots
      const snapshotsUrl = `${apiUrl}/agents/compare`;
      const snapshotsParams = new URLSearchParams();
      if (selectedIds && selectedIds.length > 0) {
        snapshotsParams.set('agentIds', selectedIds.join(','));
      }
      if (currentTimeRange) {
        snapshotsParams.set('timeRange', currentTimeRange);
      }
      
      const snapshotsResponse = await fetch(`${snapshotsUrl}?${snapshotsParams.toString()}`);
      
      if (!snapshotsResponse.ok) {
        throw new Error(`Failed to fetch agent snapshots: ${snapshotsResponse.statusText}`);
      }
      
      const snapshots = await snapshotsResponse.json();
      setAgentSnapshots(snapshots);
      
      // Fetch agent history if we have selected agent IDs
      if (selectedIds && selectedIds.length > 0) {
        await fetchAgentHistory(selectedIds, currentTimeRange, currentResolution);
      }
      
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
  }, [apiUrl, selectedIds, currentTimeRange, currentResolution]);
  
  // Select agents
  const selectAgents = useCallback((agentIds: string[]) => {
    setSelectedIds(agentIds);
    
    // Update WebSocket subscriptions
    if (socket) {
      // Unsubscribe from all agents first
      socket.emit('unsubscribe_agents', selectedIds || []);
      
      // Subscribe to new set of agents
      if (agentIds.length > 0) {
        socket.emit('subscribe_agents', agentIds);
      }
    }
  }, [socket, selectedIds]);
  
  // Set time range
  const setTimeRange = useCallback((range: string) => {
    setCurrentTimeRange(range);
  }, []);
  
  // Set resolution
  const setResolution = useCallback((res: string) => {
    setCurrentResolution(res);
  }, []);
  
  // Set update interval
  const setUpdateInterval = useCallback((intervalMs: number) => {
    if (socket) {
      socket.emit('set_update_interval', intervalMs);
    }
  }, [socket]);
  
  return {
    agentSnapshots,
    agentHistory,
    loading,
    error,
    refreshData,
    selectAgents,
    setTimeRange,
    setResolution,
    setUpdateInterval
  };
} 