import React, { useState } from 'react';
import { formatDistance } from 'date-fns';
import { AgentControlPanelProps, AgentPanelState } from './types';
import ConfigInjectionModal from './ConfigInjectionModal';
import styles from '../../styles/admin/AgentControlPanel.module.css';

export default function AgentControlPanel({
  agents,
  onPauseAgent,
  onResumeAgent,
  onPromoteAgent,
  onRestartAgent
}: AgentControlPanelProps) {
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleOpenConfigModal = (agentId: string) => {
    setSelectedAgentId(agentId);
    setConfigModalOpen(true);
  };

  const handleCloseConfigModal = () => {
    setConfigModalOpen(false);
    setSelectedAgentId(null);
  };

  const handleSubmitConfig = async (agentId: string, config: object) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/agent/inject-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId, config }),
      });

      if (!response.ok) {
        throw new Error('Failed to inject config');
      }

      // Close the modal on success
      handleCloseConfigModal();
    } catch (error) {
      console.error('Error injecting config:', error);
      // Could show an error message to the user
    }
  };

  // Function to render the status badge
  const renderStatusBadge = (status: string) => {
    let badgeClass = '';
    
    switch (status) {
      case 'running':
        badgeClass = styles.statusRunning;
        break;
      case 'paused':
        badgeClass = styles.statusPaused;
        break;
      case 'canary':
        badgeClass = styles.statusCanary;
        break;
      default:
        badgeClass = styles.statusUnknown;
    }
    
    return (
      <span className={`${styles.statusBadge} ${badgeClass}`}>
        {status}
      </span>
    );
  };

  // Function to format PnL value
  const formatPnL = (pnl: number) => {
    const formattedValue = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(pnl);
    
    return (
      <span className={pnl >= 0 ? styles.pnlPositive : styles.pnlNegative}>
        {formattedValue}
      </span>
    );
  };

  // Function to format last signal time
  const formatLastSignal = (timestamp: number) => {
    if (!timestamp) return 'No signals';
    
    try {
      return formatDistance(new Date(timestamp), new Date(), { addSuffix: true });
    } catch (e) {
      return 'Invalid time';
    }
  };

  // Function to render agent actions
  const renderActions = (agent: AgentPanelState) => {
    return (
      <div className={styles.actions}>
        {agent.status === 'running' && (
          <button 
            className={styles.actionButton}
            onClick={() => onPauseAgent(agent.agentId)}
          >
            Pause
          </button>
        )}
        
        {agent.status === 'paused' && (
          <button 
            className={styles.actionButton}
            onClick={() => onResumeAgent(agent.agentId)}
          >
            Resume
          </button>
        )}
        
        {agent.status === 'canary' && (
          <button 
            className={styles.promoteButton}
            onClick={() => onPromoteAgent(agent.agentId)}
          >
            Promote to Live
          </button>
        )}
        
        <button 
          className={styles.configButton}
          onClick={() => handleOpenConfigModal(agent.agentId)}
        >
          Inject Config
        </button>
        
        <button 
          className={styles.restartButton}
          onClick={() => onRestartAgent(agent.agentId)}
        >
          Restart
        </button>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <table className={styles.agentTable}>
        <thead>
          <tr>
            <th>Agent ID</th>
            <th>Status</th>
            <th>Last Signal</th>
            <th>PnL (24h)</th>
            <th>Last Updated</th>
            <th>Tags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => (
            <tr 
              key={agent.agentId}
              className={`${styles.agentRow} ${
                agent.status === 'canary' ? styles.canaryRow : 
                agent.status === 'paused' ? styles.pausedRow : ''
              }`}
            >
              <td className={styles.agentId}>
                {agent.name || agent.agentId}
                {!agent.name && (
                  <span className={styles.agentIdFull}>{agent.agentId}</span>
                )}
              </td>
              <td>{renderStatusBadge(agent.status)}</td>
              <td>{formatLastSignal(agent.lastSignal)}</td>
              <td>{formatPnL(agent.pnl24h)}</td>
              <td>{agent.lastUpdated ? formatDistance(new Date(agent.lastUpdated), new Date(), { addSuffix: true }) : 'Unknown'}</td>
              <td>
                <div className={styles.tags}>
                  {agent.tags?.map(tag => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
              </td>
              <td>{renderActions(agent)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {configModalOpen && selectedAgentId && (
        <ConfigInjectionModal
          agentId={selectedAgentId}
          onClose={handleCloseConfigModal}
          onSubmit={handleSubmitConfig}
        />
      )}
    </div>
  );
} 