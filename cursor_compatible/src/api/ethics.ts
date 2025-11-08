import { ValueAlignmentProfile, EthicsRule } from '../types/agent.ethics';
import { EthicsViolation } from '../governance/EthicsGuardian';

/**
 * Get the value alignment profile for an agent
 */
export async function getAgentAlignmentProfile(agentId: string): Promise<ValueAlignmentProfile> {
  const response = await fetch(`/api/ethics/alignment/${agentId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch alignment profile: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Get recent ethics violations for an agent
 */
export async function getRecentViolations(
  agentId: string, 
  limit: number = 50
): Promise<EthicsViolation[]> {
  const response = await fetch(`/api/ethics/violations/${agentId}?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch violations: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Reset violations for an agent
 */
export async function resetViolations(agentId: string): Promise<void> {
  const response = await fetch(`/api/ethics/violations/${agentId}/reset`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to reset violations: ${response.statusText}`);
  }
}

/**
 * Update an agent's alignment profile
 */
export async function updateAlignmentProfile(
  agentId: string, 
  updates: Partial<ValueAlignmentProfile>
): Promise<ValueAlignmentProfile> {
  const response = await fetch(`/api/ethics/alignment/${agentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(`Failed to update alignment profile: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Get all available ethics rules
 */
export async function getEthicsRules(): Promise<EthicsRule[]> {
  const response = await fetch('/api/ethics/rules');
  if (!response.ok) {
    throw new Error(`Failed to fetch ethics rules: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Get system-wide ethics statistics
 */
export async function getEthicsSystemStats(): Promise<any> {
  const response = await fetch('/api/ethics/system/stats');
  if (!response.ok) {
    throw new Error(`Failed to fetch ethics system stats: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Log an ethics violation manually
 */
export async function logEthicsViolation(
  agentId: string,
  violation: Omit<EthicsViolation, 'timestamp'>
): Promise<void> {
  const response = await fetch(`/api/ethics/violations/${agentId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(violation),
  });
  if (!response.ok) {
    throw new Error(`Failed to log ethics violation: ${response.statusText}`);
  }
}

/**
 * Create a default alignment profile for a new agent
 */
export async function createDefaultAlignmentProfile(
  agentId: string, 
  baseProfile?: Partial<ValueAlignmentProfile>
): Promise<ValueAlignmentProfile> {
  const response = await fetch(`/api/ethics/alignment/${agentId}/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(baseProfile || {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to create alignment profile: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Get ethics reports for a time period
 */
export async function getEthicsReports(
  startDate: Date, 
  endDate: Date
): Promise<any> {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString()
  });
  
  const response = await fetch(`/api/ethics/reports?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ethics reports: ${response.statusText}`);
  }
  return await response.json();
} 