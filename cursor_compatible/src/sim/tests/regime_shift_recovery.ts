import { AlphaMemoryManager } from '../../memory/AlphaMemoryManager.js';
import { MemoryRecallEngine } from '../../memory/MemoryRecallEngine.js';
import { MarketRegimeDetector } from '../../market/MarketRegimeDetector.js';
import { TelemetryBus } from '../../telemetry/TelemetryBus.js';
import logger from '../../utils/logger.js';

/**
 * Test regime shift recovery
 */
async function testRegimeShiftRecovery(): Promise<void> {
  const telemetryBus = TelemetryBus.getInstance();
  const alphaMemory = AlphaMemoryManager.getInstance();
  const memoryRecall = MemoryRecallEngine.getInstance();
  const regimeDetector = MarketRegimeDetector.getInstance();

  // Subscribe to telemetry events
  telemetryBus.on('memory_recall', (data: any) => {
    logger.info('Memory recall event:', data);
  });

  telemetryBus.on('regime_transition', (data: any) => {
    logger.info('Regime transition event:', data);
  });

  // Test agent ID
  const agentId = 'test_agent_1';

  // Simulate successful patterns in bull regime
  const bullPatterns = [
    {
      regime: 'bull' as const,
      strategy: 'momentum_v1',
      pnl: 0.15,
      trustScore: 0.9,
      consistency: 0.8,
      metadata: {
        venue: 'binance',
        slippage: 0.001,
        gas: 0.0001,
        latency: 50
      }
    },
    {
      regime: 'bull' as const,
      strategy: 'mean_revert_v2',
      pnl: 0.12,
      trustScore: 0.85,
      consistency: 0.75,
      metadata: {
        venue: 'ftx',
        slippage: 0.0008,
        gas: 0.0002,
        latency: 45
      }
    }
  ];

  // Remember successful patterns
  for (const pattern of bullPatterns) {
    alphaMemory.rememberSuccess(agentId, pattern);
  }

  // Simulate regime shift to bear
  regimeDetector.updateRegime('bear');
  memoryRecall.handleRegimeTransition();

  // Wait for transition buffer
  await new Promise(resolve => setTimeout(resolve, 310000)); // 5.17 minutes

  // Test recall in new regime
  const recallResult = await memoryRecall.recall(agentId);
  logger.info('Recall result:', recallResult);

  // Verify recall behavior
  if (recallResult.regime !== 'bear') {
    throw new Error('Recall did not adapt to new regime');
  }

  if (recallResult.confidence > 0.5) {
    throw new Error('Confidence too high for new regime');
  }

  // Simulate successful patterns in bear regime
  const bearPatterns = [
    {
      regime: 'bear' as const,
      strategy: 'short_momentum_v1',
      pnl: 0.18,
      trustScore: 0.92,
      consistency: 0.85,
      metadata: {
        venue: 'binance',
        slippage: 0.0012,
        gas: 0.00015,
        latency: 55
      }
    }
  ];

  // Remember successful patterns
  for (const pattern of bearPatterns) {
    alphaMemory.rememberSuccess(agentId, pattern);
  }

  // Test recall again
  const updatedRecallResult = await memoryRecall.recall(agentId);
  logger.info('Updated recall result:', updatedRecallResult);

  // Verify improved recall
  if (updatedRecallResult.confidence <= recallResult.confidence) {
    throw new Error('Confidence did not improve with new patterns');
  }

  if (updatedRecallResult.patterns.length === 0) {
    throw new Error('No patterns recalled in bear regime');
  }

  // Cleanup
  alphaMemory.cleanup();
  memoryRecall.cleanup();
  telemetryBus.cleanup();

  logger.info('Regime shift recovery test completed successfully');
}

// Run test
testRegimeShiftRecovery().catch(error => {
  logger.error('Regime shift recovery test failed:', error);
  process.exit(1);
}); 