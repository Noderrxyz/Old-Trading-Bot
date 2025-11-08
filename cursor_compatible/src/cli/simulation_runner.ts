import { MonteCarloSimulator } from '../simulation/MonteCarloSimulator.js';
import { HistoricalReplayEngine } from '../simulation/HistoricalReplayEngine.js';
import logger from '../utils/logger.js';

async function runMonteCarloSimulations(): Promise<void> {
  const simulator = MonteCarloSimulator.getInstance({
    numSimulations: 1000,
    pathLength: 1000,
    strategies: ['TWAP-StableLP', 'Arbitrage', 'MarketMaking']
  });

  try {
    await simulator.runSimulations();
  } catch (error) {
    logger.error('Monte Carlo simulation failed:', error);
  } finally {
    simulator.cleanup();
  }
}

async function runHistoricalReplay(): Promise<void> {
  const replayEngine = HistoricalReplayEngine.getInstance({
    startBlock: 15000000,
    endBlock: 15001000,
    speedMultiplier: 2,
    injectChaos: true
  });

  try {
    await replayEngine.loadHistoricalData();
    await replayEngine.startReplay();
  } catch (error) {
    logger.error('Historical replay failed:', error);
  } finally {
    replayEngine.cleanup();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0];

  switch (mode) {
    case 'monte-carlo':
      await runMonteCarloSimulations();
      break;
    case 'historical':
      await runHistoricalReplay();
      break;
    case 'both':
      await runMonteCarloSimulations();
      await runHistoricalReplay();
      break;
    default:
      logger.error('Invalid mode. Use: monte-carlo, historical, or both');
      process.exit(1);
  }
}

main().catch(error => {
  logger.error('Simulation runner failed:', error);
  process.exit(1);
}); 