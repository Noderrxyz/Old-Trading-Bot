/**
 * Strategy Execution with Governance Middleware
 * 
 * Provides middleware hooks for strategy execution that enforce
 * governance rules before allowing strategies to be executed.
 */

import { RedisClient } from '../common/redis.js';
import { createLogger } from '../common/logger.js';
import { enforceGovernanceRules } from '../governance/enforcement/enforcer.js';

// Logger for strategy execution events
const logger = createLogger('StrategyExecution');

/**
 * Execute a strategy with governance enforcement
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID executing the strategy
 * @param strategyId Strategy ID to execute
 * @param context Additional context for the strategy execution
 * @returns Execution result
 */
export async function executeStrategy(
  redisClient: RedisClient,
  agentId: string,
  strategyId: string,
  context: Record<string, any> = {}
): Promise<Record<string, any>> {
  logger.info(`Agent ${agentId} attempting to execute strategy ${strategyId}`);
  
  // Enforce governance rules before execution
  const check = await enforceGovernanceRules(
    redisClient,
    agentId,
    'execute',
    { 
      strategyId,
      ...context
    }
  );

  if (!check.allowed) {
    const reasons = check.violations.map(v => v.reason).join('; ');
    logger.warn(`Strategy execution blocked: ${reasons}`);
    throw new Error(`Governance block: ${reasons}`);
  }
  
  // If governance check passes, proceed with execution
  logger.info(`Governance check passed, executing strategy ${strategyId}`);
  
  // Perform the actual strategy execution
  // In a real implementation, this would call the strategy engine
  const result = await executeStrategyImpl(redisClient, strategyId, context);
  
  // Log the execution for audit purposes
  await recordStrategyExecution(
    redisClient,
    agentId,
    strategyId,
    result
  );
  
  return result;
}

/**
 * Internal implementation of strategy execution
 * 
 * @param redisClient Redis client
 * @param strategyId Strategy ID to execute
 * @param context Additional context
 * @returns Execution result
 */
async function executeStrategyImpl(
  redisClient: RedisClient,
  strategyId: string,
  context: Record<string, any>
): Promise<Record<string, any>> {
  // In a real implementation, this would call the actual strategy code
  // For now, we'll just return a mock result
  
  return {
    strategyId,
    executed: true,
    timestamp: Date.now(),
    result: 'SUCCESS',
    metrics: {
      executionTimeMs: 100 + Math.random() * 900,
      score: 0.5 + Math.random() * 0.5
    }
  };
}

/**
 * Record a strategy execution for auditing
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param strategyId Strategy ID
 * @param result Execution result
 */
async function recordStrategyExecution(
  redisClient: RedisClient,
  agentId: string,
  strategyId: string,
  result: Record<string, any>
): Promise<void> {
  const executionLog = {
    agentId,
    strategyId,
    timestamp: Date.now(),
    result
  };
  
  // Log to Redis streams for audit trail
  await redisClient.xadd(
    'strategy:executions',
    '*',
    { 
      agentId,
      strategyId,
      timestamp: Date.now().toString(),
      result: JSON.stringify(result)
    }
  );
  
  // Keep track of agent's last execution
  await redisClient.set(
    `agent:${agentId}:lastExecution:${strategyId}`,
    JSON.stringify(executionLog)
  );
} 