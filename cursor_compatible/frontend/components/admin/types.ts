/**
 * Admin component types
 */

/**
 * Agent panel state for agent control
 */
export interface AgentPanelState {
  // Agent identifier
  agentId: string;
  
  // Agent name (if available)
  name?: string;
  
  // Agent status: running, paused, or canary
  status: 'running' | 'paused' | 'canary';
  
  // Last signal timestamp
  lastSignal: number;
  
  // Performance over the last 24 hours
  pnl24h: number;
  
  // Available actions for this agent
  actions: ('pause' | 'resume' | 'promote' | 'restart')[];
  
  // Tags for categorization
  tags?: string[];
  
  // Last update timestamp
  lastUpdated: number;
}

/**
 * Agent control panel props
 */
export interface AgentControlPanelProps {
  agents: AgentPanelState[];
  onPauseAgent: (agentId: string) => void;
  onResumeAgent: (agentId: string) => void;
  onPromoteAgent: (agentId: string) => void;
  onRestartAgent: (agentId: string) => void;
}

/**
 * Agent filters props
 */
export interface AgentFiltersProps {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

/**
 * Config injection props
 */
export interface ConfigInjectionProps {
  agentId: string;
  onClose: () => void;
  onSubmit: (agentId: string, config: object) => void;
} 