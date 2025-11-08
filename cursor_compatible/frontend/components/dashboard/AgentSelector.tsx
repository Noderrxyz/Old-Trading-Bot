/**
 * Agent Selector Component
 * 
 * Multi-select dropdown for choosing which agents to compare
 */

import React, { useState } from 'react';
import { AgentPerformanceSnapshot } from '../../../src/api/types';

interface AgentSelectorProps {
  agents: AgentPerformanceSnapshot[];
  selectedAgentIds: string[];
  onChange: (agentIds: string[]) => void;
}

export function AgentSelector({
  agents,
  selectedAgentIds,
  onChange
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filter agents based on search term
  const filteredAgents = searchTerm
    ? agents.filter(agent => 
        (agent.name || agent.agentId).toLowerCase().includes(searchTerm.toLowerCase())
      )
    : agents;
  
  // Group agents by mode
  const liveAgents = filteredAgents.filter(agent => !agent.isCanary);
  const canaryAgents = filteredAgents.filter(agent => agent.isCanary);
  
  // Toggle dropdown
  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };
  
  // Toggle agent selection
  const toggleAgent = (agentId: string) => {
    if (selectedAgentIds.includes(agentId)) {
      // Remove agent from selection
      onChange(selectedAgentIds.filter(id => id !== agentId));
    } else {
      // Add agent to selection
      onChange([...selectedAgentIds, agentId]);
    }
  };
  
  // Select all agents
  const selectAll = () => {
    onChange(filteredAgents.map(agent => agent.agentId));
  };
  
  // Deselect all agents
  const deselectAll = () => {
    onChange([]);
  };
  
  // Select all live agents
  const selectAllLive = () => {
    const liveAgentIds = liveAgents.map(agent => agent.agentId);
    onChange(liveAgentIds);
  };
  
  // Select all canary agents
  const selectAllCanary = () => {
    const canaryAgentIds = canaryAgents.map(agent => agent.agentId);
    onChange(canaryAgentIds);
  };
  
  return (
    <div className="agent-selector">
      <div className="selector-header">
        <h3>Select Agents</h3>
        <button 
          className="selector-toggle"
          onClick={toggleDropdown}
        >
          {isOpen ? '▲' : '▼'}
        </button>
      </div>
      
      {isOpen && (
        <div className="selector-dropdown">
          <div className="selector-search">
            <input
              type="text"
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="selector-actions">
            <button onClick={selectAll}>Select All</button>
            <button onClick={deselectAll}>Deselect All</button>
            <button onClick={selectAllLive}>Live Agents</button>
            <button onClick={selectAllCanary}>Canary Agents</button>
          </div>
          
          <div className="agent-list">
            {liveAgents.length > 0 && (
              <div className="agent-group">
                <div className="agent-group-header">Live Agents</div>
                {liveAgents.map(agent => (
                  <div 
                    key={agent.agentId}
                    className={`agent-item ${selectedAgentIds.includes(agent.agentId) ? 'selected' : ''}`}
                    onClick={() => toggleAgent(agent.agentId)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(agent.agentId)}
                      onChange={() => {}} // Handled by div click
                    />
                    <span className="agent-name">{agent.name || agent.agentId}</span>
                  </div>
                ))}
              </div>
            )}
            
            {canaryAgents.length > 0 && (
              <div className="agent-group">
                <div className="agent-group-header">Canary Agents</div>
                {canaryAgents.map(agent => (
                  <div 
                    key={agent.agentId}
                    className={`agent-item ${selectedAgentIds.includes(agent.agentId) ? 'selected' : ''}`}
                    onClick={() => toggleAgent(agent.agentId)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(agent.agentId)}
                      onChange={() => {}} // Handled by div click
                    />
                    <span className="agent-name">{agent.name || agent.agentId}</span>
                    <span className="canary-indicator">🧪</span>
                  </div>
                ))}
              </div>
            )}
            
            {filteredAgents.length === 0 && (
              <div className="no-agents">
                No agents match your search criteria
              </div>
            )}
          </div>
        </div>
      )}
      
      <div className="selected-summary">
        {selectedAgentIds.length === 0 ? (
          <span>No agents selected</span>
        ) : (
          <span>
            {selectedAgentIds.length} agent{selectedAgentIds.length !== 1 ? 's' : ''} selected
          </span>
        )}
      </div>
    </div>
  );
} 