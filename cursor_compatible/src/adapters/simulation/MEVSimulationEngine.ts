/**
 * MEV Simulation Engine
 * 
 * Simulates MEV (Maximum Extractable Value) attacks and market manipulation
 * scenarios to test trading strategies under realistic adverse conditions.
 */

import { IMEVSimulationEngine, MarketAnomaly } from '../interfaces/IDataFeed';
import { logger } from '../../utils/logger';

export interface MEVAttackConfig {
  sandwichAttackProbability: number; // Per hour
  frontRunningProbability: number; // Per hour
  flashLoanProbability: number; // Per hour
  arbitrageProbability: number; // Per hour
  maxSlippageImpact: number; // 0-0.1 (10%)
  maxPriceImpact: number; // 0-0.05 (5%)
  attackDuration: { min: number; max: number }; // milliseconds
}

export interface TradeIntent {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  expectedPrice: number;
  timestamp: number;
  userId?: string;
}

export interface MEVOpportunity {
  type: string;
  profitPotential: number;
  riskLevel: 'low' | 'medium' | 'high';
  gasCost: number;
  blockPriority: number;
  executionProbability: number;
}

export class MEVSimulationEngine implements IMEVSimulationEngine {
  private config: MEVAttackConfig;
  private lastAttackTimestamp: number = 0;
  private activeAnomalies: Map<string, MarketAnomaly> = new Map();
  private mempoolTransactions: Map<string, TradeIntent> = new Map();
  private rng: () => number;
  
  // Market maker bot simulation
  private marketMakerPositions: Map<string, number> = new Map();
  
  // Liquidity pool simulation
  private liquidityPools: Map<string, { reserves: [number, number]; fee: number }> = new Map();

  constructor(config?: Partial<MEVAttackConfig>, seed?: number) {
    this.config = {
      sandwichAttackProbability: 0.5, // 0.5 per hour
      frontRunningProbability: 0.8, // 0.8 per hour
      flashLoanProbability: 0.2, // 0.2 per hour
      arbitrageProbability: 1.0, // 1.0 per hour
      maxSlippageImpact: 0.03, // 3%
      maxPriceImpact: 0.01, // 1%
      attackDuration: { min: 1000, max: 30000 }, // 1-30 seconds
      ...config
    };
    
    this.rng = this.createSeededRandom(seed || Date.now());
    this.initializeLiquidityPools();
    
    logger.info('[MEV_SIM] MEV simulation engine initialized', {
      config: this.config,
      seed: seed
    });
  }

  /**
   * Simulate sandwich attack on target trade
   */
  async simulateSandwichAttack(symbol: string, targetTrade: TradeIntent): Promise<MarketAnomaly> {
    const severity = this.calculateAttackSeverity();
    const slippageImpact = this.rng() * this.config.maxSlippageImpact;
    const priceImpact = this.rng() * this.config.maxPriceImpact;
    
    // Front-run trade (buy before target)
    const frontRunAmount = targetTrade.amount * (0.5 + this.rng() * 0.5); // 50-100% of target
    
    // Back-run trade (sell after target)
    const backRunAmount = frontRunAmount;
    
    const anomaly: MarketAnomaly = {
      type: 'mev_sandwich',
      severity,
      timestamp: Date.now(),
      duration: this.config.attackDuration.min + 
                this.rng() * (this.config.attackDuration.max - this.config.attackDuration.min),
      affectedSymbols: [symbol],
      parameters: {
        frontRunAmount,
        backRunAmount,
        slippageImpact,
        priceImpact,
        targetTradeAmount: targetTrade.amount,
        targetPrice: targetTrade.expectedPrice,
        estimatedProfit: this.calculateSandwichProfit(targetTrade, slippageImpact),
        gasCost: this.estimateGasCost('sandwich')
      },
      description: `Sandwich attack on ${symbol}: Front-run ${frontRunAmount.toFixed(6)}, back-run ${backRunAmount.toFixed(6)}`
    };
    
    this.activeAnomalies.set(`sandwich-${Date.now()}`, anomaly);
    
    logger.warn('[MEV_SIM] Sandwich attack simulated', {
      symbol,
      severity,
      slippageImpact,
      estimatedProfit: anomaly.parameters.estimatedProfit
    });
    
    return anomaly;
  }

  /**
   * Simulate front-running attack
   */
  async simulateFrontRunning(symbol: string, anticipatedTrade: TradeIntent): Promise<MarketAnomaly> {
    const severity = this.calculateAttackSeverity();
    const priceImpact = this.rng() * this.config.maxPriceImpact;
    
    // Front-run with larger trade to maximize price impact
    const frontRunMultiplier = 1.2 + this.rng() * 0.8; // 1.2x to 2x
    const frontRunAmount = anticipatedTrade.amount * frontRunMultiplier;
    
    const anomaly: MarketAnomaly = {
      type: 'mev_frontrun',
      severity,
      timestamp: Date.now(),
      duration: this.config.attackDuration.min / 2, // Shorter duration
      affectedSymbols: [symbol],
      parameters: {
        frontRunAmount,
        priceImpact,
        anticipatedAmount: anticipatedTrade.amount,
        anticipatedPrice: anticipatedTrade.expectedPrice,
        estimatedProfit: this.calculateFrontRunProfit(anticipatedTrade, priceImpact),
        gasCost: this.estimateGasCost('frontrun'),
        priorityFee: this.calculatePriorityFee()
      },
      description: `Front-running attack on ${symbol}: ${frontRunAmount.toFixed(6)} ahead of ${anticipatedTrade.amount.toFixed(6)}`
    };
    
    this.activeAnomalies.set(`frontrun-${Date.now()}`, anomaly);
    
    logger.warn('[MEV_SIM] Front-running attack simulated', {
      symbol,
      severity,
      priceImpact,
      estimatedProfit: anomaly.parameters.estimatedProfit
    });
    
    return anomaly;
  }

  /**
   * Simulate flash loan arbitrage
   */
  async simulateFlashLoan(symbol: string, loanAmount: number): Promise<MarketAnomaly> {
    const severity = this.calculateAttackSeverity();
    const priceDiscrepancy = this.rng() * 0.005; // Up to 0.5% price difference
    
    // Simulate arbitrage between pools/exchanges
    const exchanges = ['uniswap', 'sushiswap', 'balancer'];
    const sourceExchange = exchanges[Math.floor(this.rng() * exchanges.length)];
    const targetExchange = exchanges[Math.floor(this.rng() * exchanges.length)];
    
    const anomaly: MarketAnomaly = {
      type: 'mev_sandwich', // Using sandwich as flash loan type
      severity,
      timestamp: Date.now(),
      duration: 1000 + this.rng() * 2000, // 1-3 seconds (single block)
      affectedSymbols: [symbol],
      parameters: {
        loanAmount,
        priceDiscrepancy,
        sourceExchange,
        targetExchange,
        flashLoanFee: loanAmount * 0.0009, // 0.09% typical flash loan fee
        estimatedProfit: this.calculateFlashLoanProfit(loanAmount, priceDiscrepancy),
        gasCost: this.estimateGasCost('flashloan')
      },
      description: `Flash loan arbitrage: ${loanAmount.toFixed(6)} ${symbol} between ${sourceExchange} and ${targetExchange}`
    };
    
    this.activeAnomalies.set(`flashloan-${Date.now()}`, anomaly);
    
    logger.warn('[MEV_SIM] Flash loan attack simulated', {
      symbol,
      loanAmount,
      priceDiscrepancy,
      estimatedProfit: anomaly.parameters.estimatedProfit
    });
    
    return anomaly;
  }

  /**
   * Simulate arbitrage opportunity
   */
  async simulateArbitrageOpportunity(symbol: string, exchanges: string[]): Promise<MarketAnomaly> {
    const severity: 'low' | 'medium' | 'high' = 'low'; // Arbitrage is generally low severity
    const priceSpread = this.rng() * 0.003; // Up to 0.3% spread
    
    const sourceExchange = exchanges[Math.floor(this.rng() * exchanges.length)];
    const targetExchange = exchanges[Math.floor(this.rng() * exchanges.length)];
    
    const anomaly: MarketAnomaly = {
      type: 'mev_sandwich', // Using sandwich as arbitrage type placeholder
      severity,
      timestamp: Date.now(),
      duration: 5000 + this.rng() * 10000, // 5-15 seconds
      affectedSymbols: [symbol],
      parameters: {
        priceSpread,
        sourceExchange,
        targetExchange,
        opportunitySize: 1000 + this.rng() * 9000, // $1k-$10k opportunity
        estimatedProfit: this.calculateArbitrageProfit(priceSpread),
        gasCost: this.estimateGasCost('arbitrage')
      },
      description: `Arbitrage opportunity: ${(priceSpread * 100).toFixed(3)}% spread between ${sourceExchange} and ${targetExchange}`
    };
    
    this.activeAnomalies.set(`arbitrage-${Date.now()}`, anomaly);
    
    logger.info('[MEV_SIM] Arbitrage opportunity simulated', {
      symbol,
      priceSpread,
      sourceExchange,
      targetExchange
    });
    
    return anomaly;
  }

  /**
   * Inject random MEV activity based on frequency
   */
  async injectRandomMEVActivity(frequency: number): Promise<void> {
    const now = Date.now();
    const timeSinceLastAttack = now - this.lastAttackTimestamp;
    const hoursSinceLastAttack = timeSinceLastAttack / (1000 * 60 * 60);
    
    // Calculate probability based on frequency and time elapsed
    const attackProbability = frequency * hoursSinceLastAttack / 60; // Per minute
    
    if (this.rng() < attackProbability) {
      // Select random attack type
      const attackTypes = ['sandwich', 'frontrun', 'flashloan', 'arbitrage'];
      const attackType = attackTypes[Math.floor(this.rng() * attackTypes.length)];
      
      // Generate mock trade for attack
      const symbols = ['BTC/USDT', 'ETH/USDT', 'BTC/ETH'];
      const symbol = symbols[Math.floor(this.rng() * symbols.length)];
      
      const mockTrade: TradeIntent = {
        symbol,
        side: this.rng() > 0.5 ? 'buy' : 'sell',
        amount: 0.1 + this.rng() * 4.9, // 0.1 to 5
        expectedPrice: 1000 + this.rng() * 49000, // Mock price
        timestamp: now
      };
      
      let anomaly: MarketAnomaly;
      
      switch (attackType) {
        case 'sandwich':
          anomaly = await this.simulateSandwichAttack(symbol, mockTrade);
          break;
        case 'frontrun':
          anomaly = await this.simulateFrontRunning(symbol, mockTrade);
          break;
        case 'flashloan':
          anomaly = await this.simulateFlashLoan(symbol, mockTrade.amount * 10);
          break;
        case 'arbitrage':
          anomaly = await this.simulateArbitrageOpportunity(symbol, ['uniswap', 'sushiswap']);
          break;
        default:
          return;
      }
      
      this.lastAttackTimestamp = now;
      
      logger.info('[MEV_SIM] Random MEV activity injected', {
        attackType,
        symbol,
        anomaly: anomaly.type
      });
    }
  }

  /**
   * Get active anomalies
   */
  getActiveAnomalies(): MarketAnomaly[] {
    const now = Date.now();
    const activeAnomalies: MarketAnomaly[] = [];
    
    for (const [id, anomaly] of this.activeAnomalies) {
      if (now - anomaly.timestamp < anomaly.duration) {
        activeAnomalies.push(anomaly);
      } else {
        this.activeAnomalies.delete(id);
      }
    }
    
    return activeAnomalies;
  }

  /**
   * Check if symbol is under MEV attack
   */
  isUnderAttack(symbol: string): boolean {
    return this.getActiveAnomalies().some(anomaly => 
      anomaly.affectedSymbols.includes(symbol)
    );
  }

  /**
   * Calculate current MEV impact on symbol
   */
  calculateMEVImpact(symbol: string, side: 'buy' | 'sell'): {
    priceImpact: number;
    slippageIncrease: number;
    gasCompetition: number;
  } {
    const activeAnomalies = this.getActiveAnomalies().filter(anomaly =>
      anomaly.affectedSymbols.includes(symbol)
    );
    
    let totalPriceImpact = 0;
    let totalSlippageIncrease = 0;
    let gasCompetition = 1;
    
    for (const anomaly of activeAnomalies) {
      totalPriceImpact += anomaly.parameters.priceImpact || 0;
      totalSlippageIncrease += anomaly.parameters.slippageImpact || 0;
      
      // Gas competition increases with MEV activity
      if (anomaly.type === 'mev_frontrun') {
        gasCompetition *= 1.5;
      }
    }
    
    return {
      priceImpact: Math.min(totalPriceImpact, 0.05), // Cap at 5%
      slippageIncrease: Math.min(totalSlippageIncrease, 0.1), // Cap at 10%
      gasCompetition: Math.min(gasCompetition, 3) // Cap at 3x gas
    };
  }

  // Private helper methods

  private createSeededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  private calculateAttackSeverity(): 'low' | 'medium' | 'high' | 'extreme' {
    const random = this.rng();
    if (random < 0.5) return 'low';
    if (random < 0.8) return 'medium';
    if (random < 0.95) return 'high';
    return 'extreme';
  }

  private calculateSandwichProfit(targetTrade: TradeIntent, slippageImpact: number): number {
    // Simplified profit calculation
    const tradeSizeUSD = targetTrade.amount * targetTrade.expectedPrice;
    const profitPercentage = slippageImpact * 0.5; // MEV bot captures ~50% of slippage
    return tradeSizeUSD * profitPercentage;
  }

  private calculateFrontRunProfit(anticipatedTrade: TradeIntent, priceImpact: number): number {
    const tradeSizeUSD = anticipatedTrade.amount * anticipatedTrade.expectedPrice;
    const profitPercentage = priceImpact * 0.3; // Front-runner captures ~30% of price impact
    return tradeSizeUSD * profitPercentage;
  }

  private calculateFlashLoanProfit(loanAmount: number, priceDiscrepancy: number): number {
    const flashLoanFee = loanAmount * 0.0009; // 0.09% fee
    const potentialProfit = loanAmount * priceDiscrepancy;
    return Math.max(0, potentialProfit - flashLoanFee);
  }

  private calculateArbitrageProfit(priceSpread: number): number {
    const baseTradeSize = 1000 + this.rng() * 4000; // $1k-$5k
    const tradingFees = baseTradeSize * 0.003; // 0.3% total fees
    const grossProfit = baseTradeSize * priceSpread;
    return Math.max(0, grossProfit - tradingFees);
  }

  private estimateGasCost(attackType: string): number {
    const gasPrice = 20 + this.rng() * 100; // 20-120 gwei
    const gasUsage = {
      sandwich: 200000, // Complex multi-step transaction
      frontrun: 150000, // Single transaction with high priority
      flashloan: 300000, // Complex DeFi interaction
      arbitrage: 250000 // Multi-exchange interaction
    };
    
    return (gasUsage[attackType as keyof typeof gasUsage] || 150000) * gasPrice * 1e-9; // Convert to ETH
  }

  private calculatePriorityFee(): number {
    // Higher priority fee for front-running
    return 5 + this.rng() * 45; // 5-50 gwei priority fee
  }

  private initializeLiquidityPools(): void {
    // Initialize mock liquidity pools for simulation
    this.liquidityPools.set('BTC/USDT', { reserves: [100, 4500000], fee: 0.003 });
    this.liquidityPools.set('ETH/USDT', { reserves: [1000, 3000000], fee: 0.003 });
    this.liquidityPools.set('BTC/ETH', { reserves: [100, 1500], fee: 0.003 });
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<MEVAttackConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[MEV_SIM] Configuration updated', this.config);
  }

  /**
   * Get MEV statistics
   */
  getStatistics(): {
    totalAnomalies: number;
    activeAnomalies: number;
    anomaliesByType: Record<string, number>;
    averageProfitability: number;
  } {
    const allAnomalies = Array.from(this.activeAnomalies.values());
    const anomaliesByType: Record<string, number> = {};
    let totalProfit = 0;
    
    for (const anomaly of allAnomalies) {
      anomaliesByType[anomaly.type] = (anomaliesByType[anomaly.type] || 0) + 1;
      totalProfit += anomaly.parameters.estimatedProfit || 0;
    }
    
    return {
      totalAnomalies: allAnomalies.length,
      activeAnomalies: this.getActiveAnomalies().length,
      anomaliesByType,
      averageProfitability: allAnomalies.length > 0 ? totalProfit / allAnomalies.length : 0
    };
  }

  /**
   * Reset MEV simulation state
   */
  reset(): void {
    this.activeAnomalies.clear();
    this.mempoolTransactions.clear();
    this.marketMakerPositions.clear();
    this.lastAttackTimestamp = 0;
    
    logger.info('[MEV_SIM] MEV simulation engine reset');
  }
} 