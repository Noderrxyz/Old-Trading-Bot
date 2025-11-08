/**
 * Trade Telemetry Service
 * 
 * Utilities for sending trade execution data to telemetry systems
 * and logging trade events.
 */

import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('TradeTelemetry');

/**
 * Trade execution result interface
 */
export interface TradeExecutionResult {
  // Agent ID
  agentId: string;
  
  // Order ID
  orderId: string;
  
  // Asset pair
  asset: string;
  
  // Trade direction
  side: 'buy' | 'sell';
  
  // Amount traded
  amount: number;
  
  // Requested price
  requestedPrice?: number;
  
  // Actual fill price
  fillPrice: number;
  
  // Execution timestamp
  timestamp: number;
  
  // Whether this was a simulated trade
  simulated: boolean;
  
  // Additional metadata
  [key: string]: any;
}

/**
 * Log trade to telemetry and Redis storage
 * @param redis Redis client
 * @param trade Trade execution result
 */
export async function logTradeToTelemetry(redis: RedisClient, trade: TradeExecutionResult): Promise<void> {
  try {
    // Define storage keys based on whether this is a simulated trade
    const streamKey = trade.simulated 
      ? `agent_canary_trades:${trade.agentId}`
      : `agent_trades:${trade.agentId}`;
    
    const historyKey = trade.simulated
      ? `agent:${trade.agentId}:canary_executions`
      : `agent:${trade.agentId}:executions`;
    
    // Format data for Redis stream (all values must be strings)
    const redisData: Record<string, string> = {
      agentId: trade.agentId,
      orderId: trade.orderId,
      asset: trade.asset,
      side: trade.side,
      amount: trade.amount.toString(),
      fillPrice: trade.fillPrice.toString(),
      timestamp: trade.timestamp.toString(),
      simulated: trade.simulated.toString()
    };
    
    // Add optional fields if present
    if (trade.requestedPrice !== undefined) {
      redisData.requestedPrice = trade.requestedPrice.toString();
    }
    
    // Add any additional custom fields
    Object.entries(trade).forEach(([key, value]) => {
      if (!['agentId', 'orderId', 'asset', 'side', 'amount', 'requestedPrice', 'fillPrice', 'timestamp', 'simulated'].includes(key) &&
          value !== undefined && value !== null) {
        redisData[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    });
    
    // Add to Redis stream
    await redis.xadd(streamKey, '*', redisData);
    
    // Store in order history
    await redis.lpush(historyKey, JSON.stringify(trade));
    
    // Limit history size
    await redis.ltrim(historyKey, 0, 99); // Keep last 100 executions
    
    // Log the trade with appropriate formatting
    if (trade.simulated) {
      logger.info(
        `[CANARY] Simulated ${trade.side} of ${trade.amount} ${trade.asset} ` +
        `@ ${trade.fillPrice} by agent ${trade.agentId}`
      );
    } else {
      logger.info(
        `Executed ${trade.side} of ${trade.amount} ${trade.asset} ` +
        `@ ${trade.fillPrice} by agent ${trade.agentId}`
      );
    }
  } catch (error) {
    logger.error(`Failed to log trade to telemetry: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get trade history for an agent
 * @param redis Redis client
 * @param agentId Agent ID
 * @param simulated Whether to get simulated trades
 * @param limit Maximum number of trades to return
 */
export async function getTradeHistory(
  redis: RedisClient, 
  agentId: string, 
  simulated: boolean = false,
  limit: number = 100
): Promise<TradeExecutionResult[]> {
  try {
    const historyKey = simulated
      ? `agent:${agentId}:canary_executions`
      : `agent:${agentId}:executions`;
    
    // Get trades from Redis
    const trades = await redis.lrange(historyKey, 0, limit - 1);
    
    // Parse JSON data
    return trades.map(t => JSON.parse(t)) as TradeExecutionResult[];
  } catch (error) {
    logger.error(`Failed to get trade history: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get trades from telemetry stream
 * @param redis Redis client
 * @param agentId Agent ID
 * @param simulated Whether to get simulated trades
 * @param count Maximum number of trades to return
 */
export async function getTelemetryTrades(
  redis: RedisClient,
  agentId: string,
  simulated: boolean = false,
  count: number = 100
): Promise<Record<string, any>[]> {
  try {
    const streamKey = simulated
      ? `agent_canary_trades:${agentId}`
      : `agent_trades:${agentId}`;
    
    // Get trades from Redis stream
    const result = await redis.xrevrange(streamKey, '+', '-', 'COUNT', count);
    
    // Process and return results
    return result.map(item => {
      const [id, fields] = item;
      
      // Convert the array of field/value pairs to an object
      const tradeData: Record<string, any> = { id };
      
      // Add all fields to the object
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];
        
        // Try to parse numeric values
        if (!isNaN(Number(value))) {
          tradeData[key] = Number(value);
        } else if (value === 'true' || value === 'false') {
          tradeData[key] = value === 'true';
        } else {
          tradeData[key] = value;
        }
      }
      
      return tradeData;
    });
  } catch (error) {
    logger.error(`Failed to get telemetry trades: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
} 