import EventEmitter from 'events';
import { Logger } from 'winston';
import {
  OnChainMetric,
  DeFiMetrics,
  LiquidationData,
  IntelAlert,
  IntelError,
  IntelErrorCode,
  DataSource
} from './types';

export class OnChainMetrics extends EventEmitter {
  private metricsBuffer: Map<string, OnChainMetric[]>;
  private defiMetrics: Map<string, DeFiMetrics>;
  private liquidationBuffer: LiquidationData[];
  private protocolMetrics: Map<string, ProtocolMetrics>;
  private chainMetrics: Map<string, ChainMetrics>;
  private dataSources: Map<string, DataSource>;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private blockSubscriptions: Map<string, any> = new Map();

  constructor(
    private logger: Logger,
    private config: {
      chains: string[];
      protocols: string[];
      metrics: string[];
      updateInterval: number;
      alertThresholds: {
        tvlChange: number;
        liquidationVolume: number;
        gasSpike: number;
        utilizationRate: number;
      };
    }
  ) {
    super();
    this.metricsBuffer = new Map();
    this.defiMetrics = new Map();
    this.liquidationBuffer = [];
    this.protocolMetrics = new Map();
    this.chainMetrics = new Map();
    this.dataSources = new Map();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new IntelError(
        IntelErrorCode.INVALID_CONFIG,
        'OnChainMetrics is already running'
      );
    }

    this.logger.info('Starting OnChain Metrics', {
      chains: this.config.chains,
      protocols: this.config.protocols
    });

    try {
      await this.initializeDataSources();
      await this.startBlockchainSubscriptions();
      this.startAnalysisLoop();
      this.isRunning = true;
    } catch (error) {
      this.logger.error('Failed to start OnChain Metrics', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping OnChain Metrics');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    await this.stopBlockchainSubscriptions();
    this.isRunning = false;
  }

  private async initializeDataSources(): Promise<void> {
    // Initialize connections to blockchain nodes and APIs
    for (const chain of this.config.chains) {
      const dataSource: DataSource = {
        name: chain,
        type: 'websocket',
        endpoint: this.getChainEndpoint(chain),
        status: 'inactive',
        lastUpdate: 0,
        reliability: 1.0
      };
      
      this.dataSources.set(chain, dataSource);
    }

    // Initialize protocol-specific data sources
    for (const protocol of this.config.protocols) {
      const dataSource: DataSource = {
        name: protocol,
        type: 'graphql',
        endpoint: this.getProtocolEndpoint(protocol),
        status: 'inactive',
        lastUpdate: 0,
        reliability: 1.0
      };
      
      this.dataSources.set(`protocol-${protocol}`, dataSource);
    }
  }

  private getChainEndpoint(chain: string): string {
    const endpoints: Record<string, string> = {
      ethereum: 'wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY',
      bsc: 'wss://bsc-ws-node.nariox.org:443',
      polygon: 'wss://polygon-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
      arbitrum: 'wss://arb1.arbitrum.io/ws',
      avalanche: 'wss://api.avax.network/ext/bc/C/ws',
      solana: 'wss://api.mainnet-beta.solana.com'
    };
    
    return endpoints[chain] || '';
  }

  private getProtocolEndpoint(protocol: string): string {
    const endpoints: Record<string, string> = {
      uniswap: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
      aave: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3',
      compound: 'https://api.compound.finance/api/v2',
      curve: 'https://api.curve.fi/api',
      makerdao: 'https://api.thegraph.com/subgraphs/name/messari/makerdao',
      sushiswap: 'https://api.thegraph.com/subgraphs/name/sushiswap/exchange'
    };
    
    return endpoints[protocol] || '';
  }

  private async startBlockchainSubscriptions(): Promise<void> {
    for (const [chain, dataSource] of this.dataSources) {
      if (chain.startsWith('protocol-')) continue;
      
      try {
        await this.subscribeToChain(chain, dataSource);
        dataSource.status = 'active';
      } catch (error) {
        this.logger.error(`Failed to subscribe to ${chain}`, error);
        dataSource.status = 'error';
      }
    }

    // Start protocol data polling
    for (const protocol of this.config.protocols) {
      this.startProtocolPolling(protocol);
    }
  }

  private async subscribeToChain(chain: string, dataSource: DataSource): Promise<void> {
    this.logger.info(`Subscribing to ${chain} blockchain events`);
    
    // Simulate blockchain subscription
    const subscription = setInterval(() => {
      this.processBlockData(chain, this.generateMockBlockData(chain));
    }, 2000);
    
    this.blockSubscriptions.set(chain, subscription);
  }

  private generateMockBlockData(chain: string): BlockData {
    return {
      chain,
      blockNumber: Math.floor(Math.random() * 1000000),
      timestamp: Date.now(),
      gasPrice: this.getMockGasPrice(chain),
      baseFee: Math.random() * 100,
      transactions: Math.floor(Math.random() * 3000),
      difficulty: Math.random() * 1000000,
      validators: chain === 'ethereum' ? undefined : Math.floor(Math.random() * 100),
      stakingRate: chain === 'ethereum' ? undefined : Math.random()
    };
  }

  private getMockGasPrice(chain: string): number {
    const basePrices: Record<string, number> = {
      ethereum: 30,
      bsc: 5,
      polygon: 50,
      arbitrum: 0.5,
      avalanche: 25,
      solana: 0.00025
    };
    
    const base = basePrices[chain] || 10;
    return base + Math.random() * base * 0.5;
  }

  private processBlockData(chain: string, blockData: BlockData): void {
    // Update chain metrics
    if (!this.chainMetrics.has(chain)) {
      this.chainMetrics.set(chain, {
        chain,
        lastBlock: 0,
        avgGasPrice: 0,
        avgBlockTime: 0,
        tps: 0,
        activeAddresses: 0,
        totalTransactions: 0
      });
    }
    
    const metrics = this.chainMetrics.get(chain)!;
    
    // Update metrics with exponential moving average
    const alpha = 0.1;
    metrics.avgGasPrice = metrics.avgGasPrice * (1 - alpha) + blockData.gasPrice * alpha;
    metrics.tps = blockData.transactions / 2; // Assuming 2 second blocks
    metrics.lastBlock = blockData.blockNumber;
    
    // Check for gas spike alerts
    if (blockData.gasPrice > metrics.avgGasPrice * (1 + this.config.alertThresholds.gasSpike)) {
      this.emitGasSpikeAlert(chain, blockData.gasPrice, metrics.avgGasPrice);
    }
  }

  private emitGasSpikeAlert(chain: string, currentGas: number, avgGas: number): void {
    const increase = ((currentGas - avgGas) / avgGas) * 100;
    
    const alert: IntelAlert = {
      id: `gas-spike-${Date.now()}-${chain}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: increase > 100 ? 'high' : 'medium',
      title: `Gas Price Spike on ${chain}`,
      description: `Gas prices on ${chain} have increased ${increase.toFixed(0)}% to ${currentGas.toFixed(2)} from average of ${avgGas.toFixed(2)}`,
      affectedAssets: [], // Could correlate with native token
      metrics: {
        chain,
        currentGas,
        avgGas,
        increase
      },
      actionRequired: increase > 100,
      suggestedActions: [
        'Consider delaying non-urgent transactions',
        'Monitor for network congestion events',
        'Check for popular NFT mints or DeFi events'
      ]
    };
    
    this.emit('alert', alert);
  }

  private startProtocolPolling(protocol: string): void {
    // Poll protocol data every minute
    setInterval(async () => {
      try {
        const data = await this.fetchProtocolData(protocol);
        this.processProtocolData(protocol, data);
      } catch (error) {
        this.logger.error(`Error fetching ${protocol} data`, error);
      }
    }, 60000);
  }

  private async fetchProtocolData(protocol: string): Promise<any> {
    // Simulate fetching protocol data
    return this.generateMockProtocolData(protocol);
  }

  private generateMockProtocolData(protocol: string): any {
    const tvlBase: Record<string, number> = {
      uniswap: 5000000000,
      aave: 8000000000,
      compound: 3000000000,
      curve: 4000000000,
      makerdao: 6000000000,
      sushiswap: 1000000000
    };
    
    const base = tvlBase[protocol] || 1000000000;
    const tvl = base + (Math.random() - 0.5) * base * 0.1;
    
    return {
      protocol,
      tvl,
      tvlChange24h: (Math.random() - 0.5) * 0.1,
      volume24h: tvl * 0.05 * Math.random(),
      fees24h: tvl * 0.0001 * Math.random(),
      activeUsers24h: Math.floor(Math.random() * 50000),
      transactions24h: Math.floor(Math.random() * 100000),
      topPools: this.generateMockPools(protocol),
      lendingData: this.generateMockLendingData(protocol)
    };
  }

  private generateMockPools(protocol: string): any[] {
    const pools = [];
    const pairs = ['ETH/USDC', 'WBTC/ETH', 'USDT/USDC', 'ETH/DAI'];
    
    for (let i = 0; i < 4; i++) {
      pools.push({
        pair: pairs[i],
        tvl: Math.random() * 100000000,
        volume24h: Math.random() * 10000000,
        apr: Math.random() * 20,
        utilization: Math.random()
      });
    }
    
    return pools;
  }

  private generateMockLendingData(protocol: string): any {
    if (!['aave', 'compound', 'makerdao'].includes(protocol)) return null;
    
    const assets = ['ETH', 'USDC', 'WBTC', 'DAI'];
    const lendingRates: any = {};
    
    for (const asset of assets) {
      lendingRates[asset] = {
        supplyRate: Math.random() * 5,
        borrowRate: Math.random() * 10,
        utilization: Math.random(),
        totalSupply: Math.random() * 1000000000,
        totalBorrow: Math.random() * 500000000,
        liquidationThreshold: 0.75 + Math.random() * 0.15
      };
    }
    
    return lendingRates;
  }

  private processProtocolData(protocol: string, data: any): void {
    // Store protocol metrics
    const metrics: ProtocolMetrics = {
      protocol,
      tvl: data.tvl,
      tvlChange24h: data.tvlChange24h,
      volume24h: data.volume24h,
      fees24h: data.fees24h,
      activeUsers: data.activeUsers24h,
      transactions: data.transactions24h,
      timestamp: Date.now()
    };
    
    this.protocolMetrics.set(protocol, metrics);
    
    // Update DeFi metrics
    this.updateDeFiMetrics();
    
    // Check for TVL alerts
    if (Math.abs(data.tvlChange24h) > this.config.alertThresholds.tvlChange) {
      this.emitTVLAlert(protocol, data);
    }
    
    // Process lending data if available
    if (data.lendingData) {
      this.processLendingData(protocol, data.lendingData);
    }
  }

  private updateDeFiMetrics(): void {
    let totalTVL = 0;
    let totalVolume = 0;
    let totalUsers = 0;
    let totalTransactions = 0;
    
    for (const [protocol, metrics] of this.protocolMetrics) {
      totalTVL += metrics.tvl;
      totalVolume += metrics.volume24h;
      totalUsers += metrics.activeUsers;
      totalTransactions += metrics.transactions;
    }
    
    const defiMetrics: DeFiMetrics = {
      totalValueLocked: totalTVL,
      totalValueLockedChange24h: this.calculateTVLChange(),
      lendingRates: this.aggregateLendingRates(),
      liquidations24h: this.liquidationBuffer.filter(
        l => l.timestamp > Date.now() - 86400000
      ).length,
      uniqueUsers24h: totalUsers,
      transactions24h: totalTransactions,
      bridgeVolume24h: Math.random() * 1000000000, // Mock bridge volume
      dexVolume24h: totalVolume
    };
    
    this.defiMetrics.set('global', defiMetrics);
  }

  private calculateTVLChange(): number {
    // Calculate weighted average TVL change
    let weightedChange = 0;
    let totalWeight = 0;
    
    for (const [protocol, metrics] of this.protocolMetrics) {
      const weight = metrics.tvl;
      weightedChange += metrics.tvlChange24h * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedChange / totalWeight : 0;
  }

  private aggregateLendingRates(): Record<string, any> {
    const aggregated: Record<string, any> = {};
    const lendingProtocols = ['aave', 'compound', 'makerdao'];
    
    // Aggregate rates across protocols
    const assets = ['ETH', 'USDC', 'WBTC', 'DAI'];
    
    for (const asset of assets) {
      let totalSupplyRate = 0;
      let totalBorrowRate = 0;
      let totalUtilization = 0;
      let count = 0;
      
      for (const protocol of lendingProtocols) {
        const metrics = this.protocolMetrics.get(protocol);
        if (!metrics) continue;
        
        // Mock calculation - in reality would use actual protocol data
        totalSupplyRate += Math.random() * 5;
        totalBorrowRate += Math.random() * 10;
        totalUtilization += Math.random();
        count++;
      }
      
      if (count > 0) {
        aggregated[asset] = {
          supplyRate: totalSupplyRate / count,
          borrowRate: totalBorrowRate / count,
          utilization: totalUtilization / count
        };
      }
    }
    
    return aggregated;
  }

  private emitTVLAlert(protocol: string, data: any): void {
    const change = data.tvlChange24h * 100;
    const direction = change > 0 ? 'increase' : 'decrease';
    
    const alert: IntelAlert = {
      id: `tvl-${Date.now()}-${protocol}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: Math.abs(change) > 20 ? 'high' : 'medium',
      title: `Significant TVL ${direction} in ${protocol}`,
      description: `${protocol} TVL ${direction}d by ${Math.abs(change).toFixed(1)}% to $${(data.tvl / 1000000000).toFixed(2)}B in 24h`,
      affectedAssets: [], // Would need to determine affected tokens
      metrics: {
        protocol,
        tvl: data.tvl,
        tvlChange: data.tvlChange24h,
        volume24h: data.volume24h
      },
      actionRequired: Math.abs(change) > 20,
      suggestedActions: [
        change > 0 ? 'Consider opportunities in protocol governance tokens' : 'Monitor for potential contagion effects',
        'Check for protocol-specific news or events',
        'Review exposure to protocol-related assets'
      ]
    };
    
    this.emit('alert', alert);
  }

  private processLendingData(protocol: string, lendingData: any): void {
    // Process lending market data
    for (const [asset, data] of Object.entries(lendingData)) {
      const assetData = data as any;
      
      // Check for high utilization
      if (assetData.utilization > this.config.alertThresholds.utilizationRate) {
        this.emitUtilizationAlert(protocol, asset, assetData);
      }
      
      // Simulate liquidation detection
      if (Math.random() < 0.01) { // 1% chance of liquidation
        this.processLiquidation(protocol, asset, assetData);
      }
    }
  }

  private emitUtilizationAlert(protocol: string, asset: string, data: any): void {
    const utilization = data.utilization * 100;
    
    const alert: IntelAlert = {
      id: `utilization-${Date.now()}-${protocol}-${asset}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: utilization > 90 ? 'critical' : 'high',
      title: `High ${asset} Utilization on ${protocol}`,
      description: `${asset} utilization on ${protocol} at ${utilization.toFixed(1)}% - borrowing rates may spike`,
      affectedAssets: [asset],
      metrics: {
        protocol,
        asset,
        utilization: data.utilization,
        borrowRate: data.borrowRate,
        supplyRate: data.supplyRate
      },
      actionRequired: utilization > 90,
      suggestedActions: [
        'Consider supplying to earn high yields',
        'Monitor for potential liquidation cascades',
        'Check borrowing positions for rate increases'
      ]
    };
    
    this.emit('alert', alert);
  }

  private processLiquidation(protocol: string, asset: string, data: any): void {
    const liquidation: LiquidationData = {
      protocol,
      chain: 'ethereum', // Would determine from protocol
      timestamp: Date.now(),
      liquidator: `0x${Math.random().toString(16).substr(2, 40)}`,
      borrower: `0x${Math.random().toString(16).substr(2, 40)}`,
      collateralAsset: asset,
      debtAsset: 'USDC',
      collateralAmount: Math.random() * 100,
      debtAmount: Math.random() * 100000,
      liquidationPrice: data.liquidationThreshold,
      txHash: `0x${Math.random().toString(16).substr(2, 64)}`,
      profitUSD: Math.random() * 1000
    };
    
    this.liquidationBuffer.push(liquidation);
    
    // Keep buffer size manageable
    if (this.liquidationBuffer.length > 10000) {
      this.liquidationBuffer.shift();
    }
    
    // Check for liquidation cascade
    this.checkLiquidationCascade(protocol, asset);
  }

  private checkLiquidationCascade(protocol: string, asset: string): void {
    const recentLiquidations = this.liquidationBuffer.filter(
      l => l.timestamp > Date.now() - 300000 && // Last 5 minutes
           l.protocol === protocol &&
           l.collateralAsset === asset
    );
    
    const totalVolume = recentLiquidations.reduce(
      (sum, l) => sum + l.debtAmount,
      0
    );
    
    if (totalVolume > this.config.alertThresholds.liquidationVolume) {
      this.emitLiquidationCascadeAlert(protocol, asset, recentLiquidations);
    }
  }

  private emitLiquidationCascadeAlert(
    protocol: string,
    asset: string,
    liquidations: LiquidationData[]
  ): void {
    const totalVolume = liquidations.reduce((sum, l) => sum + l.debtAmount, 0);
    
    const alert: IntelAlert = {
      id: `liquidation-cascade-${Date.now()}-${protocol}-${asset}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: 'critical',
      title: `Liquidation Cascade Detected`,
      description: `${liquidations.length} liquidations of ${asset} on ${protocol} totaling $${(totalVolume / 1000000).toFixed(2)}M in last 5 minutes`,
      affectedAssets: [asset],
      metrics: {
        protocol,
        asset,
        liquidationCount: liquidations.length,
        totalVolume,
        avgLiquidationSize: totalVolume / liquidations.length
      },
      actionRequired: true,
      suggestedActions: [
        'Check collateral positions immediately',
        'Consider reducing leverage',
        'Monitor for further price declines'
      ]
    };
    
    this.emit('alert', alert);
  }

  private startAnalysisLoop(): void {
    this.updateInterval = setInterval(() => {
      this.analyzeMetrics();
      this.detectAnomalies();
      this.calculateCorrelations();
      this.generateMetricsReport();
    }, this.config.updateInterval);
  }

  private analyzeMetrics(): void {
    // Analyze on-chain metrics for each tracked metric type
    for (const metricType of this.config.metrics) {
      this.analyzeMetricType(metricType);
    }
  }

  private analyzeMetricType(metricType: string): void {
    switch (metricType) {
      case 'tvl':
        this.analyzeTVLTrends();
        break;
      case 'volume':
        this.analyzeVolumeTrends();
        break;
      case 'fees':
        this.analyzeFeeTrends();
        break;
      case 'users':
        this.analyzeUserActivity();
        break;
      case 'liquidations':
        this.analyzeLiquidationTrends();
        break;
    }
  }

  private analyzeTVLTrends(): void {
    const metrics: OnChainMetric[] = [];
    
    for (const [protocol, data] of this.protocolMetrics) {
      const metric: OnChainMetric = {
        protocol,
        chain: 'multi-chain', // Would determine actual chains
        metric: 'tvl',
        value: data.tvl,
        timestamp: Date.now(),
        change24h: data.tvlChange24h,
        change7d: Math.random() * 0.2 - 0.1, // Mock 7d change
        trend: this.determineTrend(data.tvlChange24h),
        percentile: this.calculatePercentile('tvl', data.tvl)
      };
      
      metrics.push(metric);
      this.addMetricToBuffer(protocol, metric);
    }
  }

  private analyzeVolumeTrends(): void {
    // Similar analysis for volume metrics
    for (const [protocol, data] of this.protocolMetrics) {
      const metric: OnChainMetric = {
        protocol,
        chain: 'multi-chain',
        metric: 'volume',
        value: data.volume24h,
        timestamp: Date.now(),
        change24h: Math.random() * 0.4 - 0.2, // Mock change
        change7d: Math.random() * 0.3 - 0.15,
        trend: this.determineTrend(Math.random() - 0.5),
        percentile: this.calculatePercentile('volume', data.volume24h)
      };
      
      this.addMetricToBuffer(protocol, metric);
    }
  }

  private analyzeFeeTrends(): void {
    // Analyze protocol fee generation
    for (const [protocol, data] of this.protocolMetrics) {
      const feeYield = data.tvl > 0 ? (data.fees24h * 365) / data.tvl : 0;
      
      const metric: OnChainMetric = {
        protocol,
        chain: 'multi-chain',
        metric: 'fee-yield',
        value: feeYield,
        timestamp: Date.now(),
        change24h: Math.random() * 0.2 - 0.1,
        change7d: Math.random() * 0.3 - 0.15,
        trend: this.determineTrend(feeYield - 0.02), // 2% baseline
        percentile: this.calculatePercentile('fee-yield', feeYield)
      };
      
      this.addMetricToBuffer(protocol, metric);
    }
  }

  private analyzeUserActivity(): void {
    // Analyze user engagement metrics
    for (const [protocol, data] of this.protocolMetrics) {
      const metric: OnChainMetric = {
        protocol,
        chain: 'multi-chain',
        metric: 'active-users',
        value: data.activeUsers,
        timestamp: Date.now(),
        change24h: Math.random() * 0.3 - 0.15,
        change7d: Math.random() * 0.4 - 0.2,
        trend: this.determineTrend(Math.random() - 0.5),
        percentile: this.calculatePercentile('active-users', data.activeUsers)
      };
      
      this.addMetricToBuffer(protocol, metric);
    }
  }

  private analyzeLiquidationTrends(): void {
    // Analyze liquidation patterns
    const hourlyLiquidations = this.groupLiquidationsByHour();
    
    for (const [hour, liquidations] of hourlyLiquidations) {
      const totalVolume = liquidations.reduce((sum, l) => sum + l.debtAmount, 0);
      
      const metric: OnChainMetric = {
        protocol: 'all',
        chain: 'all',
        metric: 'liquidation-volume',
        value: totalVolume,
        timestamp: hour,
        change24h: 0, // Would calculate from historical data
        change7d: 0,
        trend: totalVolume > 1000000 ? 'increasing' : 'stable',
        percentile: this.calculatePercentile('liquidation-volume', totalVolume)
      };
      
      this.addMetricToBuffer('liquidations', metric);
    }
  }

  private groupLiquidationsByHour(): Map<number, LiquidationData[]> {
    const grouped = new Map<number, LiquidationData[]>();
    
    for (const liquidation of this.liquidationBuffer) {
      const hour = Math.floor(liquidation.timestamp / 3600000) * 3600000;
      
      if (!grouped.has(hour)) {
        grouped.set(hour, []);
      }
      
      grouped.get(hour)!.push(liquidation);
    }
    
    return grouped;
  }

  private determineTrend(change: number): 'increasing' | 'decreasing' | 'stable' {
    if (change > 0.05) return 'increasing';
    if (change < -0.05) return 'decreasing';
    return 'stable';
  }

  private calculatePercentile(metric: string, value: number): number {
    // Would calculate actual historical percentile
    // Mock implementation
    return Math.random() * 100;
  }

  private addMetricToBuffer(key: string, metric: OnChainMetric): void {
    if (!this.metricsBuffer.has(key)) {
      this.metricsBuffer.set(key, []);
    }
    
    const buffer = this.metricsBuffer.get(key)!;
    buffer.push(metric);
    
    // Keep buffer size manageable
    const cutoff = Date.now() - 7 * 24 * 3600000; // 7 days
    const filtered = buffer.filter(m => m.timestamp > cutoff);
    this.metricsBuffer.set(key, filtered);
  }

  private detectAnomalies(): void {
    // Detect unusual on-chain patterns
    this.detectTVLAnomalies();
    this.detectGasAnomalies();
    this.detectUserAnomalies();
    this.detectBridgeAnomalies();
  }

  private detectTVLAnomalies(): void {
    for (const [protocol, metrics] of this.protocolMetrics) {
      const history = this.metricsBuffer.get(protocol) || [];
      const tvlHistory = history.filter(m => m.metric === 'tvl');
      
      if (tvlHistory.length < 10) continue;
      
      // Detect rapid TVL changes
      const recent = tvlHistory[tvlHistory.length - 1];
      const historical = tvlHistory.slice(-24); // Last 24 data points
      const avgTVL = historical.reduce((sum, m) => sum + m.value, 0) / historical.length;
      
      const deviation = Math.abs(recent.value - avgTVL) / avgTVL;
      
      if (deviation > 0.3) {
        this.emitTVLAnomalyAlert(protocol, recent, avgTVL, deviation);
      }
    }
  }

  private emitTVLAnomalyAlert(
    protocol: string,
    current: OnChainMetric,
    average: number,
    deviation: number
  ): void {
    const direction = current.value > average ? 'surge' : 'drop';
    
    const alert: IntelAlert = {
      id: `tvl-anomaly-${Date.now()}-${protocol}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: deviation > 0.5 ? 'high' : 'medium',
      title: `Unusual TVL ${direction} in ${protocol}`,
      description: `${protocol} TVL ${direction} of ${(deviation * 100).toFixed(0)}% detected. Current: $${(current.value / 1000000000).toFixed(2)}B, Average: $${(average / 1000000000).toFixed(2)}B`,
      affectedAssets: [],
      metrics: {
        protocol,
        currentTVL: current.value,
        averageTVL: average,
        deviation
      },
      actionRequired: deviation > 0.5,
      suggestedActions: [
        'Investigate cause of TVL movement',
        'Check for protocol exploits or migrations',
        'Monitor related token prices'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectGasAnomalies(): void {
    for (const [chain, metrics] of this.chainMetrics) {
      // Detect unusual gas patterns
      if (metrics.avgGasPrice > 100 && chain === 'ethereum') {
        this.emitNetworkCongestionAlert(chain, metrics);
      }
    }
  }

  private emitNetworkCongestionAlert(chain: string, metrics: ChainMetrics): void {
    const alert: IntelAlert = {
      id: `congestion-${Date.now()}-${chain}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: 'high',
      title: `Network Congestion on ${chain}`,
      description: `High network activity detected on ${chain}. Gas: ${metrics.avgGasPrice.toFixed(0)} gwei, TPS: ${metrics.tps.toFixed(0)}`,
      affectedAssets: [],
      metrics: {
        chain,
        gasPrice: metrics.avgGasPrice,
        tps: metrics.tps
      },
      actionRequired: true,
      suggestedActions: [
        'Delay non-urgent transactions',
        'Use alternative chains if possible',
        'Monitor for specific events causing congestion'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectUserAnomalies(): void {
    // Detect unusual user behavior patterns
    const totalUsers = Array.from(this.protocolMetrics.values())
      .reduce((sum, m) => sum + m.activeUsers, 0);
    
    // Mock historical average
    const historicalAvg = 200000;
    const change = (totalUsers - historicalAvg) / historicalAvg;
    
    if (Math.abs(change) > 0.3) {
      this.emitUserActivityAlert(totalUsers, historicalAvg, change);
    }
  }

  private emitUserActivityAlert(current: number, average: number, change: number): void {
    const direction = change > 0 ? 'increase' : 'decrease';
    
    const alert: IntelAlert = {
      id: `user-activity-${Date.now()}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: Math.abs(change) > 0.5 ? 'high' : 'medium',
      title: `Significant DeFi User Activity ${direction}`,
      description: `Total DeFi users ${direction}d ${(Math.abs(change) * 100).toFixed(0)}% to ${current.toLocaleString()} from average of ${average.toLocaleString()}`,
      affectedAssets: [],
      metrics: {
        currentUsers: current,
        averageUsers: average,
        change
      },
      actionRequired: false,
      suggestedActions: [
        change > 0 ? 'Growing adoption - bullish signal' : 'Declining activity - monitor closely',
        'Check for specific protocol driving the change',
        'Correlate with market conditions'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectBridgeAnomalies(): void {
    // Detect unusual bridge activity
    const defiMetrics = this.defiMetrics.get('global');
    if (!defiMetrics) return;
    
    // Mock historical bridge volume
    const historicalBridgeVolume = 500000000;
    const currentVolume = defiMetrics.bridgeVolume24h;
    const change = (currentVolume - historicalBridgeVolume) / historicalBridgeVolume;
    
    if (Math.abs(change) > 0.5) {
      this.emitBridgeActivityAlert(currentVolume, historicalBridgeVolume, change);
    }
  }

  private emitBridgeActivityAlert(current: number, average: number, change: number): void {
    const direction = change > 0 ? 'surge' : 'decline';
    
    const alert: IntelAlert = {
      id: `bridge-activity-${Date.now()}`,
      timestamp: Date.now(),
      type: 'onchain',
      severity: 'medium',
      title: `Cross-Chain Bridge Volume ${direction}`,
      description: `Bridge volume ${direction} of ${(Math.abs(change) * 100).toFixed(0)}% to $${(current / 1000000).toFixed(0)}M from average of $${(average / 1000000).toFixed(0)}M`,
      affectedAssets: [],
      metrics: {
        currentVolume: current,
        averageVolume: average,
        change
      },
      actionRequired: false,
      suggestedActions: [
        'Monitor for arbitrage opportunities',
        'Check specific chain pairs for activity',
        'Consider multi-chain strategies'
      ]
    };
    
    this.emit('alert', alert);
  }

  private calculateCorrelations(): void {
    // Calculate correlations between on-chain metrics and market movements
    // This would require price data integration
    
    // Mock correlation analysis
    const tvlPriceCorrelation = 0.7 + Math.random() * 0.2;
    const volumeMomentumCorrelation = 0.6 + Math.random() * 0.2;
    
    this.logger.info('On-chain correlations calculated', {
      tvlPrice: tvlPriceCorrelation,
      volumeMomentum: volumeMomentumCorrelation
    });
  }

  private generateMetricsReport(): void {
    const defiMetrics = this.defiMetrics.get('global');
    if (!defiMetrics) return;
    
    const report = {
      timestamp: Date.now(),
      totalTVL: defiMetrics.totalValueLocked,
      tvlChange: defiMetrics.totalValueLockedChange24h,
      topProtocols: this.getTopProtocolsByTVL(),
      chainActivity: this.getChainActivity(),
      liquidationSummary: this.getLiquidationSummary(),
      gasMetrics: this.getGasMetrics()
    };
    
    this.emit('metrics-report', report);
  }

  private getTopProtocolsByTVL(): Array<{ protocol: string; tvl: number; change: number }> {
    return Array.from(this.protocolMetrics.entries())
      .map(([protocol, metrics]) => ({
        protocol,
        tvl: metrics.tvl,
        change: metrics.tvlChange24h
      }))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 10);
  }

  private getChainActivity(): Record<string, any> {
    const activity: Record<string, any> = {};
    
    for (const [chain, metrics] of this.chainMetrics) {
      activity[chain] = {
        gasPrice: metrics.avgGasPrice,
        tps: metrics.tps,
        lastBlock: metrics.lastBlock
      };
    }
    
    return activity;
  }

  private getLiquidationSummary(): any {
    const last24h = this.liquidationBuffer.filter(
      l => l.timestamp > Date.now() - 86400000
    );
    
    return {
      count24h: last24h.length,
      volume24h: last24h.reduce((sum, l) => sum + l.debtAmount, 0),
      topProtocols: this.getTopLiquidationProtocols(last24h),
      topAssets: this.getTopLiquidatedAssets(last24h)
    };
  }

  private getTopLiquidationProtocols(liquidations: LiquidationData[]): any[] {
    const protocolVolumes = new Map<string, number>();
    
    for (const liquidation of liquidations) {
      const volume = protocolVolumes.get(liquidation.protocol) || 0;
      protocolVolumes.set(liquidation.protocol, volume + liquidation.debtAmount);
    }
    
    return Array.from(protocolVolumes.entries())
      .map(([protocol, volume]) => ({ protocol, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }

  private getTopLiquidatedAssets(liquidations: LiquidationData[]): any[] {
    const assetVolumes = new Map<string, number>();
    
    for (const liquidation of liquidations) {
      const volume = assetVolumes.get(liquidation.collateralAsset) || 0;
      assetVolumes.set(liquidation.collateralAsset, volume + liquidation.debtAmount);
    }
    
    return Array.from(assetVolumes.entries())
      .map(([asset, volume]) => ({ asset, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }

  private getGasMetrics(): Record<string, number> {
    const gasMetrics: Record<string, number> = {};
    
    for (const [chain, metrics] of this.chainMetrics) {
      gasMetrics[chain] = metrics.avgGasPrice;
    }
    
    return gasMetrics;
  }

  private async stopBlockchainSubscriptions(): Promise<void> {
    // Stop all blockchain subscriptions
    for (const [chain, subscription] of this.blockSubscriptions) {
      clearInterval(subscription);
    }
    
    this.blockSubscriptions.clear();
    
    for (const [name, dataSource] of this.dataSources) {
      dataSource.status = 'inactive';
      this.logger.info(`Disconnected from ${name}`);
    }
  }

  // Public methods for querying on-chain data
  
  getMetricsSummary(protocol?: string): OnChainSummary {
    const defiMetrics = this.defiMetrics.get('global');
    
    if (protocol) {
      const protocolMetrics = this.protocolMetrics.get(protocol);
      const metrics = this.metricsBuffer.get(protocol) || [];
      
      return {
        protocol,
        metrics: protocolMetrics || null,
        history: metrics,
        defiMetrics: defiMetrics || null,
        lastUpdate: Date.now()
      };
    }
    
    return {
      protocol: 'all',
      metrics: null,
      history: [],
      defiMetrics: defiMetrics || null,
      lastUpdate: Date.now()
    };
  }

  getLiquidations(hours: number = 24): LiquidationData[] {
    const cutoff = Date.now() - hours * 3600000;
    
    return this.liquidationBuffer
      .filter(l => l.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getChainMetrics(chain: string): ChainMetrics | null {
    return this.chainMetrics.get(chain) || null;
  }

  getProtocolRanking(metric: 'tvl' | 'volume' | 'users' = 'tvl'): Array<{ protocol: string; value: number; rank: number }> {
    const rankings = Array.from(this.protocolMetrics.entries())
      .map(([protocol, metrics]) => {
        let value: number;
        switch (metric) {
          case 'tvl':
            value = metrics.tvl;
            break;
          case 'volume':
            value = metrics.volume24h;
            break;
          case 'users':
            value = metrics.activeUsers;
            break;
        }
        return { protocol, value };
      })
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({ ...item, rank: index + 1 }));
    
    return rankings;
  }
}

// Supporting types and interfaces

interface BlockData {
  chain: string;
  blockNumber: number;
  timestamp: number;
  gasPrice: number;
  baseFee: number;
  transactions: number;
  difficulty: number;
  validators?: number;
  stakingRate?: number;
}

interface ProtocolMetrics {
  protocol: string;
  tvl: number;
  tvlChange24h: number;
  volume24h: number;
  fees24h: number;
  activeUsers: number;
  transactions: number;
  timestamp: number;
}

interface ChainMetrics {
  chain: string;
  lastBlock: number;
  avgGasPrice: number;
  avgBlockTime: number;
  tps: number;
  activeAddresses: number;
  totalTransactions: number;
}

interface OnChainSummary {
  protocol: string;
  metrics: ProtocolMetrics | null;
  history: OnChainMetric[];
  defiMetrics: DeFiMetrics | null;
  lastUpdate: number;
} 