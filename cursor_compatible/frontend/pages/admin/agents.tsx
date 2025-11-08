import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import io from 'socket.io-client';
import { AgentPanelState } from '../../components/admin/types';
import AgentControlPanel from '../../components/admin/AgentControlPanel';
import AgentFilters from '../../components/admin/AgentFilters';
import styles from '../../styles/admin/agents.module.css';

// URL for the API
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function AgentsAdminPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentPanelState[]>([]);
  const [filteredAgents, setFilteredAgents] = useState<AgentPanelState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    // Fetch agents on component mount
    fetchAgents();

    // Set up WebSocket connection for real-time updates
    const socket = io(`${API_URL}/agents`);
    
    socket.on('connect', () => {
      console.log('WebSocket connected for agent updates');
    });
    
    socket.on('agent_status_changed', (updatedAgent: AgentPanelState) => {
      setAgents(prev => 
        prev.map(agent => 
          agent.agentId === updatedAgent.agentId 
            ? { ...agent, ...updatedAgent } 
            : agent
        )
      );
    });
    
    socket.on('agent_telemetry_update', (updates: { 
      agentId: string, 
      lastSignal?: number, 
      pnl24h?: number 
    }) => {
      setAgents(prev => 
        prev.map(agent => 
          agent.agentId === updates.agentId 
            ? { 
                ...agent, 
                lastSignal: updates.lastSignal ?? agent.lastSignal,
                pnl24h: updates.pnl24h ?? agent.pnl24h
              } 
            : agent
        )
      );
    });
    
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    // Apply filters when agents or filter changes
    applyFilters();
  }, [agents, filter]);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/agent/list`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }
      
      const data = await response.json();
      setAgents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    if (filter === 'all') {
      setFilteredAgents(agents);
    } else if (filter === 'live') {
      setFilteredAgents(agents.filter(agent => agent.status !== 'canary'));
    } else if (filter === 'canary') {
      setFilteredAgents(agents.filter(agent => agent.status === 'canary'));
    } else if (filter === 'paused') {
      setFilteredAgents(agents.filter(agent => agent.status === 'paused'));
    }
  };

  const handlePauseAgent = async (agentId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/agent/pause`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to pause agent');
      }

      // Update will come via WebSocket, but we can also
      // update the local state for immediate feedback
      setAgents(prev => 
        prev.map(agent => 
          agent.agentId === agentId 
            ? { ...agent, status: 'paused' } 
            : agent
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause agent');
    }
  };

  const handleResumeAgent = async (agentId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/agent/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to resume agent');
      }

      // Update will come via WebSocket, but we can also
      // update the local state for immediate feedback
      setAgents(prev => 
        prev.map(agent => 
          agent.agentId === agentId 
            ? { ...agent, status: agent.status === 'paused' ? 'running' : agent.status } 
            : agent
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume agent');
    }
  };

  const handlePromoteAgent = async (agentId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/agent/promote-canary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to promote agent');
      }

      // Update will come via WebSocket, but we can also
      // update the local state for immediate feedback
      setAgents(prev => 
        prev.map(agent => 
          agent.agentId === agentId 
            ? { ...agent, status: 'running' } 
            : agent
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote agent');
    }
  };

  const handleRestartAgent = async (agentId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/agent/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to restart agent');
      }

      // The update will come via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart agent');
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Agent Control Panel</h1>
        <div className={styles.headerRight}>
          <button 
            className={styles.refreshButton}
            onClick={fetchAgents}
          >
            Refresh
          </button>
          <Link href="/dashboard">
            <button className={styles.dashboardButton}>
              View Dashboard
            </button>
          </Link>
        </div>
      </header>

      {error && (
        <div className={styles.errorMessage}>
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <AgentFilters 
        currentFilter={filter} 
        onFilterChange={setFilter} 
      />

      {loading ? (
        <div className={styles.loadingMessage}>Loading agents...</div>
      ) : filteredAgents.length === 0 ? (
        <div className={styles.noAgentsMessage}>
          No agents found matching the selected filter.
        </div>
      ) : (
        <AgentControlPanel
          agents={filteredAgents}
          onPauseAgent={handlePauseAgent}
          onResumeAgent={handleResumeAgent}
          onPromoteAgent={handlePromoteAgent}
          onRestartAgent={handleRestartAgent}
        />
      )}
    </div>
  );
} 