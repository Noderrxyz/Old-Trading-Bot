import { EventEmitter } from 'events';
import { SafetyController } from '../../safety-control/src/SafetyController';
import * as fs from 'fs';
import * as path from 'path';
import {
  CapitalSyncFailure,
  PendingOperationsCache,
  withRetry,
  classifyError,
  validateCapitalState
} from './CapitalErrorHandling';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

export interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  openTime: Date;
  lastUpdate: Date;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP';
  quantity: number;
  price?: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED';
  createdAt: Date;
}

export interface AgentWallet {
  agentId: string;
  strategyId: string;
  allocatedCapital: number;
  availableCapital: number;
  lockedCapital: number; // Capital in open positions
  openPositions: Position[];
  pendingOrders: Order[];
  lastActivity: Date;
  status: 'ACTIVE' | 'DRAINING' | 'FROZEN' | 'DECOMMISSIONED';
  performance: {
    totalPnL: number;
    realizedPnL: number;
    unrealizedPnL: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
  };
  createdAt: Date;
  decommissionedAt?: Date;
}

export interface DecommissionOptions {
  reason: string;
  liquidationStrategy: 'IMMEDIATE' | 'GRADUAL' | 'OPTIMAL' | 'TRANSFER';
  maxSlippage?: number;
  timeLimit?: number; // milliseconds
  transferTo?: string; // agentId to transfer positions
  forceClose?: boolean;
}

export interface DecommissionResult {
  agentId: string;
  timestamp: number;
  recalledCapital: number;
  liquidatedPositions: Position[];
  transferredPositions: Position[];
  cancelledOrders: Order[];
  totalPnL: number;
  executionTime: number;
  liquidationCost: number;
  finalStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errors?: string[];
}

interface CapitalSnapshot {
  timestamp: Date;
  totalCapital: number;
  reserveCapital: number;
  allocatedCapital: number;
  lockedCapital: number;
  agentCount: number;
  activeAgentCount: number;
}

export class UnifiedCapitalManager extends EventEmitter {
  private static instance: UnifiedCapitalManager;
  private logger: ReturnType<typeof createLogger>;
  private safetyController: SafetyController;
  
  private agentWallets: Map<string, AgentWallet> = new Map();
  private totalCapital: number = 0;
  private reserveCapital: number = 0;
  private minReserveRatio: number = 0.1; // Keep 10% in reserve
  
  private capitalHistory: CapitalSnapshot[] = [];
  private decommissionHistory: DecommissionResult[] = [];
  
  private capitalSnapshotInterval?: NodeJS.Timeout;
  private readonly SNAPSHOT_INTERVAL = 60000; // 1 minute
  
  // Error handling
  private pendingOperations: PendingOperationsCache;
  private lastValidState?: {
    totalCapital: number;
    reserveCapital: number;
    agents: any[];
  };
  
  private constructor() {
    super();
    this.logger = createLogger('UnifiedCapitalManager');
    this.safetyController = SafetyController.getInstance();
    
    // Initialize error handling
    this.pendingOperations = new PendingOperationsCache({
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000
    });
    
    this.setupErrorHandling();
    this.loadPersistedState();
    this.setupEventListeners();
    this.startCapitalMonitoring();
    
    this.logger.info('UnifiedCapitalManager initialized', {
      totalCapital: this.totalCapital,
      reserveCapital: this.reserveCapital,
      agentCount: this.agentWallets.size
    });
  }
  
  public static getInstance(): UnifiedCapitalManager {
    if (!UnifiedCapitalManager.instance) {
      UnifiedCapitalManager.instance = new UnifiedCapitalManager();
    }
    return UnifiedCapitalManager.instance;
  }
  
  private setupErrorHandling(): void {
    // Listen to pending operations events
    this.pendingOperations.on('operation-failed', (event) => {
      this.logger.error('Capital operation failed', {
        operationId: event.operationId,
        error: event.error,
        syncFailure: event.syncFailure,
        attempts: event.attempts
      });
      
      this.emit('capital-operation-failed', event);
    });
    
    this.pendingOperations.on('operation-exhausted', (event) => {
      this.logger.error('Capital operation exhausted all retries', {
        operation: event.operation,
        error: event.error,
        syncFailure: event.syncFailure
      });
      
      this.emit('capital-operation-exhausted', event);
      
      // Attempt to restore from last valid state if critical operation
      if (event.operation.type === 'PERSIST_STATE') {
        this.attemptStateRecovery();
      }
    });
    
    this.pendingOperations.on('circuit-breaker-open', (event) => {
      this.logger.error('Capital operations circuit breaker opened', event);
      this.emit('capital-circuit-breaker-open', event);
    });
  }
  
  private loadPersistedState(): void {
    try {
      const statePath = path.join(process.cwd(), '.capital-state.json');
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        
        // Validate loaded state
        const validation = validateCapitalState({
          totalCapital: state.totalCapital || 0,
          reserveCapital: state.reserveCapital || 0,
          allocatedCapital: (state.totalCapital || 0) - (state.reserveCapital || 0),
          agentAllocations: new Map()
        });
        
        if (!validation.valid) {
          throw new Error(`Invalid capital state: ${validation.errors.join(', ')}`);
        }
        
        this.totalCapital = state.totalCapital || 0;
        this.reserveCapital = state.reserveCapital || 0;
        
        // Restore agent wallets
        if (state.agents) {
          state.agents.forEach((agent: any) => {
            try {
              // Convert date strings back to Date objects
              agent.lastActivity = new Date(agent.lastActivity);
              agent.createdAt = new Date(agent.createdAt);
              if (agent.decommissionedAt) {
                agent.decommissionedAt = new Date(agent.decommissionedAt);
              }
              agent.openPositions.forEach((p: any) => {
                p.openTime = new Date(p.openTime);
                p.lastUpdate = new Date(p.lastUpdate);
              });
              agent.pendingOrders.forEach((o: any) => {
                o.createdAt = new Date(o.createdAt);
              });
              
              this.agentWallets.set(agent.agentId, agent);
            } catch (error) {
              this.logger.error(`Failed to restore agent ${agent.agentId}`, error);
              this.emit('telemetry:error', {
                type: 'agent_restore_failed',
                agentId: agent.agentId,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          });
        }
        
        // Store as last valid state
        this.lastValidState = {
          totalCapital: this.totalCapital,
          reserveCapital: this.reserveCapital,
          agents: state.agents || []
        };
        
        this.logger.info('Loaded persisted capital state');
      }
    } catch (error) {
      this.logger.error('Failed to load persisted state', error);
      this.emit('telemetry:error', {
        type: 'state_load_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        syncFailure: classifyError(error)
      });
    }
  }
  
  private async persistState(): Promise<void> {
    const operationId = this.pendingOperations.addOperation({
      type: 'PERSIST_STATE',
      data: {
        totalCapital: this.totalCapital,
        reserveCapital: this.reserveCapital,
        agentCount: this.agentWallets.size
      }
    });
    
    try {
      await withRetry(
        async () => {
          const state = {
            totalCapital: this.totalCapital,
            reserveCapital: this.reserveCapital,
            agents: Array.from(this.agentWallets.values()),
            lastUpdate: new Date()
          };
          
          // Validate state before persisting
          const validation = validateCapitalState({
            totalCapital: this.totalCapital,
            reserveCapital: this.reserveCapital,
            allocatedCapital: this.totalCapital - this.reserveCapital,
            agentAllocations: new Map(
              Array.from(this.agentWallets.entries()).map(([id, wallet]) => [id, wallet.allocatedCapital])
            )
          });
          
          if (!validation.valid) {
            throw new Error(`Invalid capital state: ${validation.errors.join(', ')}`);
          }
          
          const statePath = path.join(process.cwd(), '.capital-state.json');
          const backupPath = path.join(process.cwd(), '.capital-state.backup.json');
          
          // Create backup of current file
          if (fs.existsSync(statePath)) {
            fs.copyFileSync(statePath, backupPath);
          }
          
          // Write new state atomically
          const tempPath = `${statePath}.tmp`;
          fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
          fs.renameSync(tempPath, statePath);
          
          // Update last valid state
          this.lastValidState = {
            totalCapital: this.totalCapital,
            reserveCapital: this.reserveCapital,
            agents: Array.from(this.agentWallets.values())
          };
        },
        'persistState',
        undefined,
        {
          maxAttempts: 3,
          onError: (error, attempt) => {
            this.logger.error(`Failed to persist state (attempt ${attempt})`, error);
            this.emit('telemetry:error', {
              type: 'persist_failed',
              attempt,
              error: error instanceof Error ? error.message : 'Unknown error',
              syncFailure: classifyError(error)
            });
          }
        }
      );
      
      this.pendingOperations.markSuccess(operationId);
      
    } catch (error) {
      this.pendingOperations.markFailed(
        operationId,
        error instanceof Error ? error.message : 'Unknown error',
        classifyError(error)
      );
      
      this.logger.error('Failed to persist state after all retries', error);
      throw error;
    }
  }
  
  private attemptStateRecovery(): void {
    if (!this.lastValidState) {
      this.logger.error('No valid state available for recovery');
      return;
    }
    
    try {
      this.logger.warn('Attempting state recovery from last valid state');
      
      // Restore capital values
      this.totalCapital = this.lastValidState.totalCapital;
      this.reserveCapital = this.lastValidState.reserveCapital;
      
      // Clear and restore agent wallets
      this.agentWallets.clear();
      this.lastValidState.agents.forEach((agent: any) => {
        this.agentWallets.set(agent.agentId, agent);
      });
      
      this.logger.info('State recovery successful', {
        totalCapital: this.totalCapital,
        reserveCapital: this.reserveCapital,
        agentCount: this.agentWallets.size
      });
      
      this.emit('state-recovered', {
        timestamp: Date.now(),
        totalCapital: this.totalCapital,
        agentCount: this.agentWallets.size
      });
      
    } catch (error) {
      this.logger.error('State recovery failed', error);
      this.emit('state-recovery-failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
    }
  }
  
  private setupEventListeners(): void {
    // Listen for trading mode changes
    this.safetyController.on('mode-changed', (event) => {
      this.handleModeChange(event);
    });
    
    // Listen for emergency stops
    this.safetyController.on('emergency-stop', async (event) => {
      await this.freezeAllAgents(event.reason);
    });
  }
  
  private startCapitalMonitoring(): void {
    // Take regular snapshots
    this.capitalSnapshotInterval = setInterval(() => {
      this.takeCapitalSnapshot();
    }, this.SNAPSHOT_INTERVAL);
    
    // Take initial snapshot
    this.takeCapitalSnapshot();
  }
  
  // Initialize the capital pool
  public async initializeCapital(amount: number): Promise<void> {
    if (this.totalCapital > 0) {
      throw new Error('Capital already initialized');
    }
    
    this.totalCapital = amount;
    this.reserveCapital = amount;
    
    this.logger.info('Capital pool initialized', {
      totalCapital: amount,
      reserveCapital: amount
    });
    
    this.persistState();
    this.emit('capital-initialized', { amount });
  }
  
  // Register a new agent with capital allocation
  public async registerAgent(
    agentId: string, 
    strategyId: string, 
    requestedCapital: number
  ): Promise<AgentWallet> {
    const operationId = this.pendingOperations.addOperation({
      type: 'REGISTER_AGENT',
      agentId,
      data: { strategyId, requestedCapital }
    });
    
    try {
      return await withRetry(
        async () => {
          // Pre-validation
          if (this.agentWallets.has(agentId)) {
            throw new Error(`Agent ${agentId} already registered`);
          }
          
          if (requestedCapital <= 0) {
            throw new Error(`Invalid capital amount: ${requestedCapital}`);
          }
          
          // Check if we're in simulation mode
          if (!this.safetyController.isSimulationMode() && !this.safetyController.isPaused()) {
            this.logger.warn('Registering agent in non-simulation mode', { agentId });
          }
          
          // Check if we have enough reserve capital
          const minReserve = this.totalCapital * this.minReserveRatio;
          const availableForAllocation = this.reserveCapital - minReserve;
          
          if (requestedCapital > availableForAllocation) {
            throw new Error(
              `Insufficient reserve capital. Available: ${availableForAllocation.toFixed(2)}, ` +
              `Requested: ${requestedCapital.toFixed(2)}`
            );
          }
          
          const wallet: AgentWallet = {
            agentId,
            strategyId,
            allocatedCapital: requestedCapital,
            availableCapital: requestedCapital,
            lockedCapital: 0,
            openPositions: [],
            pendingOrders: [],
            lastActivity: new Date(),
            status: 'ACTIVE',
            performance: {
              totalPnL: 0,
              realizedPnL: 0,
              unrealizedPnL: 0,
              sharpeRatio: 0,
              maxDrawdown: 0,
              winRate: 0,
              totalTrades: 0
            },
            createdAt: new Date()
          };
          
          // Update capital tracking
          this.reserveCapital -= requestedCapital;
          this.agentWallets.set(agentId, wallet);
          
          this.logger.info(`Agent registered: ${agentId}`, {
            strategyId,
            allocatedCapital: requestedCapital,
            remainingReserve: this.reserveCapital
          });
          
          // Persist and emit
          await this.persistState();
          this.emit('agent-registered', { agentId, wallet });
          
          // Append to audit log
          this.appendToAuditLog('AGENT_REGISTERED', {
            agentId,
            strategyId,
            allocatedCapital: requestedCapital
          });
          
          return wallet;
        },
        'registerAgent',
        undefined,
        {
          maxAttempts: 2,
          onError: (error, attempt) => {
            this.logger.error(`Failed to register agent ${agentId} (attempt ${attempt})`, error);
            this.emit('telemetry:error', {
              type: 'agent_registration_failed',
              agentId,
              attempt,
              error: error instanceof Error ? error.message : 'Unknown error',
              syncFailure: classifyError(error)
            });
          }
        }
      );
      
    } catch (error) {
      this.pendingOperations.markFailed(
        operationId,
        error instanceof Error ? error.message : 'Unknown error',
        classifyError(error)
      );
      
      // Rollback if partially completed
      if (this.agentWallets.has(agentId)) {
        this.agentWallets.delete(agentId);
        this.reserveCapital += requestedCapital;
      }
      
      throw error;
      
    } finally {
      this.pendingOperations.markSuccess(operationId);
    }
  }
  
  // Update agent position and capital tracking
  public async updateAgentPosition(
    agentId: string,
    position: Position,
    action: 'OPEN' | 'UPDATE' | 'CLOSE'
  ): Promise<void> {
    const operationId = this.pendingOperations.addOperation({
      type: 'UPDATE_POSITION',
      agentId,
      data: { position, action }
    });
    
    try {
      await withRetry(
        async () => {
          const wallet = this.agentWallets.get(agentId);
          if (!wallet) {
            throw new Error(`Agent ${agentId} not found`);
          }
          
          if (wallet.status !== 'ACTIVE') {
            throw new Error(`Agent ${agentId} is not active (status: ${wallet.status})`);
          }
          
          // Validate position data
          if (!position.id || !position.symbol || position.quantity <= 0) {
            throw new Error('Invalid position data');
          }
          
          wallet.lastActivity = new Date();
          
          switch (action) {
            case 'OPEN':
              wallet.openPositions.push(position);
              const positionValue = position.quantity * position.entryPrice;
              
              // Check if agent has enough available capital
              if (wallet.availableCapital < positionValue) {
                throw new Error(`Insufficient available capital for position. Required: ${positionValue}, Available: ${wallet.availableCapital}`);
              }
              
              wallet.lockedCapital += positionValue;
              wallet.availableCapital -= positionValue;
              break;
              
            case 'UPDATE':
              const existingPos = wallet.openPositions.find(p => p.id === position.id);
              if (!existingPos) {
                throw new Error(`Position ${position.id} not found for agent ${agentId}`);
              }
              Object.assign(existingPos, position);
              break;
              
            case 'CLOSE':
              const closedPosIndex = wallet.openPositions.findIndex(p => p.id === position.id);
              if (closedPosIndex < 0) {
                throw new Error(`Position ${position.id} not found for agent ${agentId}`);
              }
              
              const closedPos = wallet.openPositions[closedPosIndex];
              const posValue = closedPos.quantity * closedPos.entryPrice;
              
              // Update capital
              wallet.lockedCapital -= posValue;
              wallet.availableCapital += posValue + position.unrealizedPnL;
              
              // Update performance
              wallet.performance.realizedPnL += position.unrealizedPnL;
              wallet.performance.totalPnL = wallet.performance.realizedPnL + wallet.performance.unrealizedPnL;
              wallet.performance.totalTrades++;
              
              if (position.unrealizedPnL > 0) {
                wallet.performance.winRate = 
                  (wallet.performance.winRate * (wallet.performance.totalTrades - 1) + 1) / 
                  wallet.performance.totalTrades;
              } else {
                wallet.performance.winRate = 
                  (wallet.performance.winRate * (wallet.performance.totalTrades - 1)) / 
                  wallet.performance.totalTrades;
              }
              
              // Remove position
              wallet.openPositions.splice(closedPosIndex, 1);
              break;
          }
          
          // Recalculate unrealized P&L
          wallet.performance.unrealizedPnL = wallet.openPositions.reduce(
            (sum, p) => sum + p.unrealizedPnL, 0
          );
          wallet.performance.totalPnL = wallet.performance.realizedPnL + wallet.performance.unrealizedPnL;
          
          // Validate capital consistency
          const validation = validateCapitalState({
            totalCapital: this.totalCapital,
            reserveCapital: this.reserveCapital,
            allocatedCapital: this.totalCapital - this.reserveCapital,
            agentAllocations: new Map(
              Array.from(this.agentWallets.entries()).map(([id, w]) => [id, w.allocatedCapital])
            )
          });
          
          if (!validation.valid) {
            throw new Error(`Capital state validation failed: ${validation.errors.join(', ')}`);
          }
          
          await this.persistState();
          
          this.emit('position-updated', {
            agentId,
            position,
            action,
            wallet: {
              availableCapital: wallet.availableCapital,
              lockedCapital: wallet.lockedCapital,
              totalPnL: wallet.performance.totalPnL
            }
          });
        },
        'updateAgentPosition',
        undefined,
        {
          maxAttempts: 3,
          onError: (error, attempt) => {
            this.logger.error(`Failed to update position for agent ${agentId} (attempt ${attempt})`, error);
            this.emit('telemetry:error', {
              type: 'position_update_failed',
              agentId,
              positionId: position.id,
              action,
              attempt,
              error: error instanceof Error ? error.message : 'Unknown error',
              syncFailure: classifyError(error)
            });
          }
        }
      );
      
      this.pendingOperations.markSuccess(operationId);
      
    } catch (error) {
      this.pendingOperations.markFailed(
        operationId,
        error instanceof Error ? error.message : 'Unknown error',
        classifyError(error)
      );
      
      throw error;
    }
  }
  
  // Decommission an agent and recall capital
  public async decommissionAgent(
    agentId: string, 
    options: DecommissionOptions
  ): Promise<DecommissionResult> {
    const startTime = Date.now();
    const wallet = this.agentWallets.get(agentId);
    
    if (!wallet) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    if (wallet.status === 'DECOMMISSIONED') {
      throw new Error(`Agent ${agentId} already decommissioned`);
    }
    
    this.logger.warn(`🚨 Starting agent decommission: ${agentId}`, options);
    
    const result: DecommissionResult = {
      agentId,
      timestamp: Date.now(),
      recalledCapital: 0,
      liquidatedPositions: [],
      transferredPositions: [],
      cancelledOrders: [],
      totalPnL: wallet.performance.totalPnL,
      executionTime: 0,
      liquidationCost: 0,
      finalStatus: 'SUCCESS',
      errors: []
    };
    
    try {
      // Step 1: Freeze the agent
      wallet.status = 'FROZEN';
      this.emit('agent-frozen', { agentId, reason: options.reason });
      
      // Step 2: Cancel all pending orders
      result.cancelledOrders = await this.cancelPendingOrders(wallet);
      
      // Step 3: Handle open positions
      if (wallet.openPositions.length > 0) {
        switch (options.liquidationStrategy) {
          case 'TRANSFER':
            if (!options.transferTo) {
              throw new Error('Transfer target not specified');
            }
            result.transferredPositions = await this.transferPositions(
              wallet, 
              options.transferTo
            );
            break;
            
          case 'IMMEDIATE':
          case 'GRADUAL':
          case 'OPTIMAL':
            const liquidationResult = await this.liquidatePositions(
              wallet, 
              options
            );
            result.liquidatedPositions = liquidationResult.positions;
            result.liquidationCost = liquidationResult.cost;
            wallet.availableCapital += liquidationResult.proceeds;
            break;
        }
      }
      
      // Step 4: Start draining process
      wallet.status = 'DRAINING';
      
      // Step 5: Calculate final capital
      result.recalledCapital = wallet.availableCapital + wallet.lockedCapital;
      
      // Step 6: Return capital to reserve
      this.reserveCapital += result.recalledCapital;
      
      // Step 7: Finalize decommission
      wallet.status = 'DECOMMISSIONED';
      wallet.allocatedCapital = 0;
      wallet.availableCapital = 0;
      wallet.lockedCapital = 0;
      wallet.openPositions = [];
      wallet.pendingOrders = [];
      wallet.decommissionedAt = new Date();
      
      result.executionTime = Date.now() - startTime;
      
      this.logger.info(`✅ Agent decommissioned: ${agentId}`, {
        recalledCapital: result.recalledCapital,
        totalPnL: result.totalPnL,
        executionTime: result.executionTime
      });
      
      // Persist and emit
      this.persistState();
      this.emit('agent-decommissioned', result);
      
      // Archive to history
      this.decommissionHistory.push(result);
      await this.archiveDecommissionResult(result);
      
      // Append to audit log
      this.appendToAuditLog('AGENT_DECOMMISSIONED', result);
      
    } catch (error: any) {
      result.finalStatus = 'FAILED';
      result.errors = [error.message];
      wallet.status = 'FROZEN'; // Keep frozen on error
      
      this.logger.error(`Failed to decommission agent ${agentId}`, error);
      this.emit('agent-decommission-failed', { agentId, error: error.message });
      
      throw error;
    }
    
    return result;
  }
  
  // Get real-time capital allocation view
  public getCapitalAllocationView(): {
    totalCapital: number;
    reserveCapital: number;
    allocatedCapital: number;
    lockedCapital: number;
    availableCapital: number;
    reserveRatio: number;
    agentCount: number;
    activeAgentCount: number;
    agentAllocations: Array<{
      agentId: string;
      strategyId: string;
      allocated: number;
      available: number;
      locked: number;
      utilized: number;
      performance: number;
      sharpe: number;
      status: string;
    }>;
  } {
    let allocatedCapital = 0;
    let lockedCapital = 0;
    let availableCapital = 0;
    let activeAgentCount = 0;
    const agentAllocations: Array<{
      agentId: string;
      strategyId: string;
      allocated: number;
      available: number;
      locked: number;
      utilized: number;
      performance: number;
      sharpe: number;
      status: string;
    }> = [];
    
    for (const [agentId, wallet] of this.agentWallets) {
      if (wallet.status !== 'DECOMMISSIONED') {
        allocatedCapital += wallet.allocatedCapital;
        lockedCapital += wallet.lockedCapital;
        availableCapital += wallet.availableCapital;
        
        if (wallet.status === 'ACTIVE') {
          activeAgentCount++;
        }
        
        const utilized = wallet.lockedCapital / (wallet.allocatedCapital || 1);
        
        agentAllocations.push({
          agentId,
          strategyId: wallet.strategyId,
          allocated: wallet.allocatedCapital,
          available: wallet.availableCapital,
          locked: wallet.lockedCapital,
          utilized,
          performance: wallet.performance.totalPnL,
          sharpe: wallet.performance.sharpeRatio,
          status: wallet.status
        });
      }
    }
    
    const reserveRatio = this.reserveCapital / (this.totalCapital || 1);
    
    return {
      totalCapital: this.totalCapital,
      reserveCapital: this.reserveCapital,
      allocatedCapital,
      lockedCapital,
      availableCapital,
      reserveRatio,
      agentCount: this.agentWallets.size,
      activeAgentCount,
      agentAllocations
    };
  }
  
  // Rebalance capital across agents
  public async rebalanceCapital(
    targetAllocations: Map<string, number>
  ): Promise<void> {
    // Only allow in SIMULATION or PAUSED mode
    if (this.safetyController.canExecuteLiveTrade()) {
      throw new Error('Cannot rebalance capital in LIVE mode without explicit override');
    }
    
    this.logger.info('Starting capital rebalance', {
      targetAgents: targetAllocations.size
    });
    
    const rebalanceResults: Array<{
      agentId: string;
      action: string;
      from: number;
      to: number;
      change: number;
    }> = [];
    
    for (const [agentId, targetAmount] of targetAllocations) {
      const wallet = this.agentWallets.get(agentId);
      if (!wallet || wallet.status !== 'ACTIVE') continue;
      
      const currentAmount = wallet.allocatedCapital;
      const difference = targetAmount - currentAmount;
      
      if (Math.abs(difference) < 1) continue; // Skip tiny changes
      
      if (difference > 0) {
        // Allocate more capital
        const availableForAllocation = this.reserveCapital - (this.totalCapital * this.minReserveRatio);
        const actualIncrease = Math.min(difference, availableForAllocation);
        
        if (actualIncrease > 0) {
          wallet.allocatedCapital += actualIncrease;
          wallet.availableCapital += actualIncrease;
          this.reserveCapital -= actualIncrease;
          
          rebalanceResults.push({
            agentId,
            action: 'INCREASE',
            from: currentAmount,
            to: wallet.allocatedCapital,
            change: actualIncrease
          });
        }
      } else {
        // Reduce capital
        const reduction = Math.abs(difference);
        const availableReduction = Math.min(reduction, wallet.availableCapital);
        
        if (availableReduction > 0) {
          wallet.allocatedCapital -= availableReduction;
          wallet.availableCapital -= availableReduction;
          this.reserveCapital += availableReduction;
          
          rebalanceResults.push({
            agentId,
            action: 'DECREASE',
            from: currentAmount,
            to: wallet.allocatedCapital,
            change: -availableReduction
          });
        }
      }
    }
    
    if (rebalanceResults.length > 0) {
      this.logger.info('Capital rebalance completed', {
        adjustments: rebalanceResults.length,
        results: rebalanceResults
      });
      
      this.persistState();
      this.emit('capital-rebalanced', {
        timestamp: Date.now(),
        adjustments: rebalanceResults,
        newAllocation: this.getCapitalAllocationView()
      });
      
      // Append to audit log
      this.appendToAuditLog('CAPITAL_REBALANCE', {
        adjustments: rebalanceResults
      });
    }
  }
  
  // Emergency freeze all agents
  private async freezeAllAgents(reason: string): Promise<void> {
    this.logger.error(`🚨 Freezing all agents: ${reason}`);
    
    const frozenAgents: string[] = [];
    
    for (const [agentId, wallet] of this.agentWallets) {
      if (wallet.status === 'ACTIVE') {
        wallet.status = 'FROZEN';
        await this.cancelPendingOrders(wallet);
        frozenAgents.push(agentId);
      }
    }
    
    this.persistState();
    
    this.emit('all-agents-frozen', { 
      reason, 
      timestamp: Date.now(),
      frozenCount: frozenAgents.length,
      agents: frozenAgents
    });
    
    // Append to audit log
    this.appendToAuditLog('EMERGENCY_FREEZE', {
      reason,
      frozenAgents
    });
  }
  
  // Get agent wallet
  public getAgentWallet(agentId: string): AgentWallet | undefined {
    return this.agentWallets.get(agentId);
  }
  
  // Get all agent wallets
  public getAllAgentWallets(): AgentWallet[] {
    return Array.from(this.agentWallets.values());
  }
  
  // Get capital history
  public getCapitalHistory(hours: number = 24): CapitalSnapshot[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return this.capitalHistory.filter(s => s.timestamp.getTime() > cutoff);
  }
  
  // Get decommission history
  public getDecommissionHistory(): DecommissionResult[] {
    return [...this.decommissionHistory];
  }
  
  // Helper methods
  private async cancelPendingOrders(wallet: AgentWallet): Promise<Order[]> {
    const cancelled = [...wallet.pendingOrders];
    wallet.pendingOrders = [];
    
    // In production, would call ExecutionOptimizer to cancel orders
    this.logger.info(`Cancelled ${cancelled.length} pending orders for agent ${wallet.agentId}`);
    
    return cancelled;
  }
  
  private async liquidatePositions(
    wallet: AgentWallet,
    options: DecommissionOptions
  ): Promise<{ positions: Position[]; proceeds: number; cost: number }> {
    const positions = [...wallet.openPositions];
    let proceeds = 0;
    let cost = 0;
    
    for (const position of positions) {
      // Calculate liquidation value with slippage
      const slippage = options.maxSlippage || 0.002;
      const liquidationPrice = position.side === 'LONG' 
        ? position.currentPrice * (1 - slippage)
        : position.currentPrice * (1 + slippage);
      
      const positionValue = position.quantity * liquidationPrice;
      proceeds += positionValue;
      
      // Calculate liquidation cost
      const entryValue = position.quantity * position.entryPrice;
      const pnl = position.side === 'LONG'
        ? (liquidationPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - liquidationPrice) * position.quantity;
      
      if (pnl < 0) {
        cost += Math.abs(pnl);
      }
    }
    
    // Clear positions
    wallet.openPositions = [];
    wallet.lockedCapital = 0;
    
    this.logger.info(`Liquidated ${positions.length} positions for agent ${wallet.agentId}`, {
      proceeds,
      cost
    });
    
    return { positions, proceeds, cost };
  }
  
  private async transferPositions(
    fromWallet: AgentWallet,
    toAgentId: string
  ): Promise<Position[]> {
    const toWallet = this.agentWallets.get(toAgentId);
    if (!toWallet || toWallet.status !== 'ACTIVE') {
      throw new Error(`Cannot transfer to agent ${toAgentId} (not active)`);
    }
    
    const transferred = [...fromWallet.openPositions];
    const transferValue = fromWallet.lockedCapital;
    
    // Check if target has capacity
    if (toWallet.availableCapital < transferValue) {
      throw new Error(
        `Target agent ${toAgentId} has insufficient capital for transfer ` +
        `(needed: ${transferValue}, available: ${toWallet.availableCapital})`
      );
    }
    
    // Transfer positions
    toWallet.openPositions.push(...transferred);
    toWallet.lockedCapital += transferValue;
    toWallet.availableCapital -= transferValue;
    
    // Clear source positions
    fromWallet.openPositions = [];
    fromWallet.lockedCapital = 0;
    
    this.logger.info(`Transferred ${transferred.length} positions from ${fromWallet.agentId} to ${toAgentId}`);
    
    return transferred;
  }
  
  private takeCapitalSnapshot(): void {
    const allocation = this.getCapitalAllocationView();
    
    const snapshot: CapitalSnapshot = {
      timestamp: new Date(),
      totalCapital: this.totalCapital,
      reserveCapital: this.reserveCapital,
      allocatedCapital: allocation.allocatedCapital,
      lockedCapital: allocation.lockedCapital,
      agentCount: allocation.agentCount,
      activeAgentCount: allocation.activeAgentCount
    };
    
    this.capitalHistory.push(snapshot);
    
    // Keep only last 7 days of history
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    this.capitalHistory = this.capitalHistory.filter(s => s.timestamp.getTime() > cutoff);
  }
  
  private async archiveDecommissionResult(result: DecommissionResult): Promise<void> {
    const archivePath = path.join(process.cwd(), 'decommission-history.jsonl');
    fs.appendFileSync(archivePath, JSON.stringify(result) + '\n');
  }
  
  private appendToAuditLog(event: string, data: any): void {
    const auditPath = path.join(process.cwd(), 'CAPITAL_AUDIT_LOG.jsonl');
    const auditEntry = {
      type: event,
      timestamp: new Date().toISOString(),
      ...data
    };
    fs.appendFileSync(auditPath, JSON.stringify(auditEntry) + '\n');
  }
  
  private handleModeChange(event: any): void {
    this.logger.info('Trading mode changed', event);
    
    if (event.newMode === 'PAUSED') {
      // Freeze all new allocations
      this.emit('allocations-paused', { reason: 'Trading mode paused' });
    }
  }
  
  // Cleanup
  public destroy(): void {
    if (this.capitalSnapshotInterval) {
      clearInterval(this.capitalSnapshotInterval);
    }
    this.persistState();
    this.logger.info('UnifiedCapitalManager destroyed');
  }
} 