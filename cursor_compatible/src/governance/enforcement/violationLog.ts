/**
 * Governance Violation Logging System
 * 
 * Records and broadcasts governance rule violations for monitoring,
 * auditing, and alerting purposes.
 */

import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';

// Logger for violation events
const logger = createLogger('GovernanceViolations');

/**
 * Violation severity levels for alerting
 */
export type ViolationSeverity = 'warning' | 'critical';

/**
 * Structure of a violation log entry
 */
export interface ViolationLogEntry {
  /**
   * Agent that triggered the violation
   */
  agentId: string;
  
  /**
   * Human-readable reason for the violation
   */
  reason: string;
  
  /**
   * Severity level of the violation
   */
  severity: ViolationSeverity;
  
  /**
   * Timestamp when the violation occurred
   */
  timestamp: number;
  
  /**
   * Additional context information (optional)
   */
  context?: Record<string, any>;
}

/**
 * Log a governance rule violation
 * 
 * @param redisClient Redis client
 * @param agentId Agent that triggered the violation
 * @param reason Reason for the violation
 * @param severity Severity level of the violation
 * @param context Additional context (optional)
 */
export async function logGovernanceViolation(
  redisClient: RedisClient,
  agentId: string,
  reason: string,
  severity: ViolationSeverity,
  context?: Record<string, any>
): Promise<void> {
  // Create log entry
  const logEntry: ViolationLogEntry = {
    agentId,
    reason,
    severity,
    timestamp: Date.now(),
    context
  };
  
  // Log to console for immediate visibility
  if (severity === 'critical') {
    logger.error(`CRITICAL VIOLATION: Agent ${agentId} - ${reason}`);
  } else {
    logger.warn(`Governance violation: Agent ${agentId} - ${reason}`);
  }
  
  // Save to Redis logs
  await redisClient.rpush(
    `gov:violations:${agentId}`,
    JSON.stringify(logEntry)
  );
  
  // Add to global violation log with TTL (30 days)
  await redisClient.rpush(
    'gov:violations:all',
    JSON.stringify(logEntry)
  );
  
  // Trim the global log to 1000 entries
  const globalLogLength = await redisClient.llen('gov:violations:all');
  if (globalLogLength > 1000) {
    await redisClient.ltrim('gov:violations:all', globalLogLength - 1000, -1);
  }
  
  // For critical violations, broadcast to admins
  if (severity === 'critical') {
    await broadcastToAdmins('🔴 Governance violation', logEntry);
  }
}

/**
 * Broadcast a violation to administrators
 * 
 * @param title Title of the alert
 * @param entry Violation entry
 */
async function broadcastToAdmins(
  title: string,
  entry: ViolationLogEntry
): Promise<void> {
  // In a real implementation, this would send notifications to admin channels
  // For now, we just log it
  logger.info(
    `[ADMIN ALERT] ${title}: Agent ${entry.agentId} - ${entry.reason}`
  );
  
  // Example of what would be done in a real system:
  // - Send to WebSocket
  // - Push to admin notification queue
  // - Send email/Slack/Discord alerts
}

/**
 * Get recent violations for an agent
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID to check
 * @param limit Maximum number of violations to retrieve
 * @returns Array of violation log entries
 */
export async function getAgentViolations(
  redisClient: RedisClient,
  agentId: string,
  limit: number = 10
): Promise<ViolationLogEntry[]> {
  // Get the latest violations from the log
  const violationData = await redisClient.lrange(
    `gov:violations:${agentId}`,
    -limit,
    -1
  );
  
  return violationData
    .map(data => {
      try {
        return JSON.parse(data) as ViolationLogEntry;
      } catch (e) {
        logger.error(`Failed to parse violation log: ${e}`);
        return null;
      }
    })
    .filter((entry): entry is ViolationLogEntry => entry !== null);
}

/**
 * Get all recent governance violations
 * 
 * @param redisClient Redis client
 * @param limit Maximum number of violations to retrieve
 * @param severityFilter Optional severity filter
 * @returns Array of violation log entries
 */
export async function getAllViolations(
  redisClient: RedisClient,
  limit: number = 50,
  severityFilter?: ViolationSeverity
): Promise<ViolationLogEntry[]> {
  // Get the latest violations from the global log
  const violationData = await redisClient.lrange(
    'gov:violations:all',
    -limit,
    -1
  );
  
  const entries = violationData
    .map(data => {
      try {
        return JSON.parse(data) as ViolationLogEntry;
      } catch (e) {
        logger.error(`Failed to parse violation log: ${e}`);
        return null;
      }
    })
    .filter((entry): entry is ViolationLogEntry => 
      entry !== null && 
      (severityFilter ? entry.severity === severityFilter : true)
    );
  
  // Sort by timestamp, newest first
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clear violation history for an agent (e.g., after governance pardon)
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID to clear history for
 */
export async function clearAgentViolations(
  redisClient: RedisClient,
  agentId: string
): Promise<void> {
  await redisClient.del(`gov:violations:${agentId}`);
  logger.info(`Cleared violation history for agent ${agentId}`);
} 