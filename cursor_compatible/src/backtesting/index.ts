/**
 * Noderr Backtesting & Simulation Engine
 */

// Core types and models
export * from './models/types';
export * from './models/context';

// Strategy
export * from './strategy/strategy';
export * from './strategy/simpleMovingAverageCrossover';

// Data management
export * from './data/dataManager';
export * from './data/csvDataSource';
export * from './data/CryptoHistoricalDataSource';

// Simulation
export * from './simulation/eventQueue';
export * from './simulation/marketSimulator';
export * from './simulation/simulationEngine';

// Portfolio
export * from './portfolio/portfolioManager';

// Performance
export * from './performance/metrics';

/**
 * Main interface for creating and running backtests
 */
import { DataManager, DataSource } from './data/dataManager';
import { SimulationConfig, SimulationEngine, CashHistoryEntry, PositionHistoryEntry } from './simulation/simulationEngine';
import { IStrategy, StrategyConfig } from './strategy/strategy';
import { MetricsCalculator, PerformanceMetrics, PortfolioState } from './performance/metrics';
import { Fill, Position } from './models/types';

/**
 * Results of a backtest
 */
export interface BacktestResult {
  metrics: PerformanceMetrics;
  logs: { level: string; message: string; timestamp: Date }[];
  notifications: { level: string; message: string; timestamp: Date }[];
  fills: Fill[];
  orders: any[];
  equityCurve: { timestamp: Date; equity: number }[];
}

/**
 * Creates and runs a backtest
 * 
 * @param config Simulation configuration
 * @param strategy Strategy to backtest
 * @param dataSources Data sources to use in the backtest
 * @param options Additional options for the backtest
 * @returns The backtest results
 */
export async function runBacktest(
  config: SimulationConfig,
  strategy: IStrategy,
  dataSources: DataSource[],
  options: {
    metricsOptions?: any
  } = {}
): Promise<BacktestResult> {
  // Create data manager
  const dataManager = new DataManager();
  
  // Register data sources
  for (const dataSource of dataSources) {
    dataManager.registerDataSource(dataSource);
  }
  
  // Create simulation engine
  const engine = new SimulationEngine(config, dataManager, strategy);
  
  // Run the simulation
  await engine.run();
  
  // Get simulation results
  const orders = engine.getOrders();
  const fills = engine.getFills();
  const cashHistory = engine.getCashHistory();
  const positionHistory = engine.getPositionHistory();
  
  // Calculate portfolio states for each day in the simulation
  const portfolioStates: PortfolioState[] = [];
  
  // Create a set of unique dates from cash history
  const uniqueDates = new Set<string>();
  cashHistory.forEach((entry: CashHistoryEntry) => uniqueDates.add(entry.timestamp.toISOString().split('T')[0]));
  
  // Convert to sorted array of dates
  const sortedDates = Array.from(uniqueDates).sort();
  
  // Build portfolio states for each date
  let previousEquity = config.initialCapital;
  
  for (const dateStr of sortedDates) {
    const date = new Date(dateStr);
    
    // Find last cash value for this date
    const cashEntries = cashHistory.filter(
      (entry: CashHistoryEntry) => entry.timestamp.toISOString().split('T')[0] === dateStr
    );
    const lastCashEntry = cashEntries.length > 0 ? cashEntries[cashEntries.length - 1] : null;
    
    // Find positions at the end of this day
    const positions: Position[] = [];
    const symbols = new Set<string>();
    
    // Collect all symbols that had positions on this date
    positionHistory.forEach((entry: PositionHistoryEntry) => {
      if (entry.timestamp.toISOString().split('T')[0] === dateStr) {
        symbols.add(entry.position.symbol);
      }
    });
    
    // Get the last position for each symbol on this date
    symbols.forEach(symbol => {
      const symbolPositions = positionHistory.filter(
        (entry: PositionHistoryEntry) => entry.position.symbol === symbol && 
                entry.timestamp.toISOString().split('T')[0] === dateStr
      );
      
      if (symbolPositions.length > 0) {
        const lastPosition = symbolPositions[symbolPositions.length - 1].position;
        if (lastPosition.quantity !== 0) {
          positions.push(lastPosition);
        }
      }
    });
    
    // Calculate portfolio value
    const positionValue = positions.reduce(
      (sum, pos) => sum + pos.quantity * pos.currentPrice,
      0
    );
    
    const equity = lastCashEntry ? lastCashEntry.cash + positionValue : previousEquity;
    
    // Calculate daily return
    const dailyReturn = portfolioStates.length > 0 
      ? (equity / previousEquity) - 1 
      : 0;
    
    // Create portfolio state
    portfolioStates.push({
      date,
      cash: lastCashEntry ? lastCashEntry.cash : config.initialCapital,
      positions,
      equity,
      dailyPnl: equity - previousEquity,
      dailyReturn
    });
    
    previousEquity = equity;
  }
  
  // Calculate performance metrics
  const metricsCalculator = new MetricsCalculator(options.metricsOptions);
  const metrics = metricsCalculator.calculateMetrics(portfolioStates, fills);
  
  // Create equity curve
  const equityCurve = portfolioStates.map(state => ({
    timestamp: state.date,
    equity: state.equity
  }));
  
  // Return results
  return {
    metrics,
    logs: engine.getLogs(),
    notifications: engine.getNotifications(),
    fills,
    orders,
    equityCurve
  };
}

/**
 * Creates and configures a backtest but doesn't run it
 * 
 * @param config Simulation configuration
 * @param strategy Strategy to backtest
 * @param dataSources Data sources to use in the backtest
 * @returns The configured backtest engine
 */
export function createBacktest(
  config: SimulationConfig,
  strategy: IStrategy,
  dataSources: DataSource[]
): SimulationEngine {
  // Create data manager
  const dataManager = new DataManager();
  
  // Register data sources
  for (const dataSource of dataSources) {
    dataManager.registerDataSource(dataSource);
  }
  
  // Create simulation engine
  return new SimulationEngine(config, dataManager, strategy);
} 