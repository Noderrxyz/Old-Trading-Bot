import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface Strategy {
  id: string;
  name: string;
  version: string;
  type: 'AI' | 'TECHNICAL' | 'FUNDAMENTAL' | 'HYBRID';
  dependencies: string[];
  requiredApprovals: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface DeploymentStage {
  name: 'DEVELOPMENT' | 'BACKTEST' | 'PAPER' | 'CANARY' | 'PRODUCTION';
  requirements: StageRequirement[];
  approvalNeeded: boolean;
  rollbackEnabled: boolean;
  maxDuration: number; // milliseconds
}

interface StageRequirement {
  metric: string;
  operator: '<' | '>' | '=' | '<=' | '>=';
  threshold: number;
  critical: boolean;
}

interface Deployment {
  id: string;
  strategy: Strategy;
  currentStage: DeploymentStage['name'];
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
  startTime: Date;
  endTime?: Date;
  metrics: DeploymentMetrics;
  approvals: Approval[];
  history: DeploymentEvent[];
}

interface DeploymentMetrics {
  backtestSharpe?: number;
  backtestMaxDrawdown?: number;
  paperTradingReturns?: number;
  paperTradingWinRate?: number;
  canaryAllocation?: number;
  productionReadiness?: number;
  latency?: number;
  errorRate?: number;
}

interface Approval {
  stage: DeploymentStage['name'];
  approver: string;
  timestamp: Date;
  decision: 'APPROVED' | 'REJECTED';
  reason?: string;
}

interface DeploymentEvent {
  timestamp: Date;
  type: 'STAGE_STARTED' | 'STAGE_COMPLETED' | 'VALIDATION_PASSED' | 'VALIDATION_FAILED' | 'ROLLBACK' | 'ERROR';
  stage: DeploymentStage['name'];
  details: string;
  metrics?: Record<string, number>;
}

export class DeploymentOrchestrator extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private deployments: Map<string, Deployment>;
  private stages: Map<DeploymentStage['name'], DeploymentStage>;
  private activeDeployments: Set<string>;
  private deploymentQueue: string[];
  
  constructor() {
    super();
    this.logger = createLogger('DeploymentOrchestrator');
    this.deployments = new Map();
    this.activeDeployments = new Set();
    this.deploymentQueue = [];
    this.stages = new Map();
    
    this.initializeStages();
    this.startOrchestrationLoop();
  }
  
  private initializeStages(): void {
    // Development Stage
    this.stages.set('DEVELOPMENT', {
      name: 'DEVELOPMENT',
      requirements: [
        { metric: 'unitTestCoverage', operator: '>=', threshold: 0.80, critical: true },
        { metric: 'linterErrors', operator: '=', threshold: 0, critical: true },
        { metric: 'complexityScore', operator: '<=', threshold: 10, critical: false }
      ],
      approvalNeeded: false,
      rollbackEnabled: false,
      maxDuration: 3600000 // 1 hour
    });
    
    // Backtest Stage
    this.stages.set('BACKTEST', {
      name: 'BACKTEST',
      requirements: [
        { metric: 'sharpeRatio', operator: '>=', threshold: 1.0, critical: true },
        { metric: 'maxDrawdown', operator: '<=', threshold: 0.20, critical: true },
        { metric: 'winRate', operator: '>=', threshold: 0.50, critical: false },
        { metric: 'profitFactor', operator: '>=', threshold: 1.2, critical: true }
      ],
      approvalNeeded: false,
      rollbackEnabled: true,
      maxDuration: 7200000 // 2 hours
    });
    
    // Paper Trading Stage
    this.stages.set('PAPER', {
      name: 'PAPER',
      requirements: [
        { metric: 'returns', operator: '>=', threshold: 0.0, critical: false },
        { metric: 'consistency', operator: '>=', threshold: 0.70, critical: true },
        { metric: 'correlationWithBacktest', operator: '>=', threshold: 0.80, critical: true },
        { metric: 'executionLatency', operator: '<=', threshold: 100, critical: true }
      ],
      approvalNeeded: true,
      rollbackEnabled: true,
      maxDuration: 604800000 // 7 days
    });
    
    // Canary Stage
    this.stages.set('CANARY', {
      name: 'CANARY',
      requirements: [
        { metric: 'pnl', operator: '>=', threshold: -0.02, critical: true },
        { metric: 'errorRate', operator: '<=', threshold: 0.01, critical: true },
        { metric: 'slippage', operator: '<=', threshold: 0.005, critical: false },
        { metric: 'riskLimit', operator: '<=', threshold: 1.0, critical: true }
      ],
      approvalNeeded: true,
      rollbackEnabled: true,
      maxDuration: 259200000 // 3 days
    });
    
    // Production Stage
    this.stages.set('PRODUCTION', {
      name: 'PRODUCTION',
      requirements: [
        { metric: 'healthCheck', operator: '=', threshold: 1, critical: true },
        { metric: 'allocationLimit', operator: '<=', threshold: 1.0, critical: true }
      ],
      approvalNeeded: true,
      rollbackEnabled: true,
      maxDuration: 0 // No limit
    });
  }
  
  private startOrchestrationLoop(): void {
    setInterval(() => {
      this.processDeploymentQueue();
      this.monitorActiveDeployments();
    }, 5000); // Check every 5 seconds
  }
  
  public async deployStrategy(strategy: Strategy, startStage: DeploymentStage['name'] = 'DEVELOPMENT'): Promise<string> {
    const deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const deployment: Deployment = {
      id: deploymentId,
      strategy,
      currentStage: startStage,
      status: 'PENDING',
      startTime: new Date(),
      metrics: {},
      approvals: [],
      history: []
    };
    
    this.deployments.set(deploymentId, deployment);
    this.deploymentQueue.push(deploymentId);
    
    this.logger.info('Strategy queued for deployment', {
      deploymentId,
      strategy: strategy.name,
      version: strategy.version,
      startStage
    });
    
    this.emit('deployment-queued', deployment);
    
    return deploymentId;
  }
  
  private async processDeploymentQueue(): Promise<void> {
    if (this.deploymentQueue.length === 0) return;
    
    // Process deployments with capacity limit
    const maxConcurrent = 5;
    const availableSlots = maxConcurrent - this.activeDeployments.size;
    
    for (let i = 0; i < Math.min(availableSlots, this.deploymentQueue.length); i++) {
      const deploymentId = this.deploymentQueue.shift();
      if (!deploymentId) continue;
      
      const deployment = this.deployments.get(deploymentId);
      if (!deployment || deployment.status !== 'PENDING') continue;
      
      this.activeDeployments.add(deploymentId);
      deployment.status = 'IN_PROGRESS';
      
      this.logger.info('Starting deployment', {
        deploymentId,
        stage: deployment.currentStage
      });
      
      // Start deployment in background
      this.executeDeploymentStage(deployment);
    }
  }
  
  private async executeDeploymentStage(deployment: Deployment): Promise<void> {
    const stage = this.stages.get(deployment.currentStage);
    if (!stage) {
      this.handleDeploymentError(deployment, 'Invalid stage');
      return;
    }
    
    try {
      // Record stage start
      this.recordDeploymentEvent(deployment, 'STAGE_STARTED', stage.name, `Starting ${stage.name} stage`);
      
      // Execute stage-specific logic
      const stageResult = await this.runStageExecution(deployment, stage);
      
      if (!stageResult.success) {
        this.recordDeploymentEvent(deployment, 'VALIDATION_FAILED', stage.name, 
          `Stage validation failed: ${stageResult.reason}`, stageResult.metrics);
        
        if (stage.rollbackEnabled) {
          await this.rollbackDeployment(deployment);
        } else {
          deployment.status = 'FAILED';
        }
        return;
      }
      
      // Update metrics
      deployment.metrics = { ...deployment.metrics, ...stageResult.metrics };
      
      // Check if approval needed
      if (stage.approvalNeeded) {
        await this.requestApproval(deployment, stage);
        return; // Will continue after approval
      }
      
      // Move to next stage
      await this.promoteToNextStage(deployment);
      
    } catch (error) {
      this.handleDeploymentError(deployment, error as Error);
    }
  }
  
  private async runStageExecution(deployment: Deployment, stage: DeploymentStage): Promise<{
    success: boolean;
    metrics: Record<string, number>;
    reason?: string;
  }> {
    // Simulate stage execution based on stage type
    const metrics: Record<string, number> = {};
    
    switch (stage.name) {
      case 'DEVELOPMENT':
        metrics.unitTestCoverage = 0.85 + Math.random() * 0.15;
        metrics.linterErrors = Math.random() > 0.9 ? 1 : 0;
        metrics.complexityScore = 5 + Math.random() * 10;
        break;
        
      case 'BACKTEST':
        metrics.sharpeRatio = 0.5 + Math.random() * 2.5;
        metrics.maxDrawdown = Math.random() * 0.3;
        metrics.winRate = 0.4 + Math.random() * 0.4;
        metrics.profitFactor = 0.8 + Math.random() * 2;
        break;
        
      case 'PAPER':
        metrics.returns = -0.05 + Math.random() * 0.15;
        metrics.consistency = 0.6 + Math.random() * 0.4;
        metrics.correlationWithBacktest = 0.7 + Math.random() * 0.3;
        metrics.executionLatency = 20 + Math.random() * 150;
        break;
        
      case 'CANARY':
        metrics.pnl = -0.03 + Math.random() * 0.08;
        metrics.errorRate = Math.random() * 0.02;
        metrics.slippage = Math.random() * 0.01;
        metrics.riskLimit = Math.random() * 1.2;
        break;
        
      case 'PRODUCTION':
        metrics.healthCheck = Math.random() > 0.1 ? 1 : 0;
        metrics.allocationLimit = Math.random();
        break;
    }
    
    // Validate requirements
    for (const req of stage.requirements) {
      const value = metrics[req.metric];
      if (value === undefined) continue;
      
      const passed = this.checkRequirement(value, req.operator, req.threshold);
      
      if (!passed && req.critical) {
        return {
          success: false,
          metrics,
          reason: `Critical requirement failed: ${req.metric} ${req.operator} ${req.threshold} (actual: ${value})`
        };
      }
    }
    
    return { success: true, metrics };
  }
  
  private checkRequirement(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '<': return value < threshold;
      case '>': return value > threshold;
      case '=': return value === threshold;
      case '<=': return value <= threshold;
      case '>=': return value >= threshold;
      default: return false;
    }
  }
  
  private async requestApproval(deployment: Deployment, stage: DeploymentStage): Promise<void> {
    this.logger.info('Approval required', {
      deploymentId: deployment.id,
      stage: stage.name
    });
    
    this.emit('approval-required', {
      deployment,
      stage,
      metrics: deployment.metrics
    });
    
    // In production, this would integrate with approval systems
    // For now, simulate auto-approval after delay
    setTimeout(() => {
      const approved = Math.random() > 0.2; // 80% approval rate
      
      const approval: Approval = {
        stage: stage.name,
        approver: 'AUTO_APPROVER',
        timestamp: new Date(),
        decision: approved ? 'APPROVED' : 'REJECTED',
        reason: approved ? 'Metrics meet requirements' : 'Risk threshold exceeded'
      };
      
      deployment.approvals.push(approval);
      
      if (approved) {
        this.promoteToNextStage(deployment);
      } else {
        deployment.status = 'FAILED';
        this.recordDeploymentEvent(deployment, 'VALIDATION_FAILED', stage.name, 
          `Approval rejected: ${approval.reason}`);
      }
    }, 10000); // 10 second delay
  }
  
  private async promoteToNextStage(deployment: Deployment): Promise<void> {
    const stageOrder: DeploymentStage['name'][] = ['DEVELOPMENT', 'BACKTEST', 'PAPER', 'CANARY', 'PRODUCTION'];
    const currentIndex = stageOrder.indexOf(deployment.currentStage);
    
    if (currentIndex === -1 || currentIndex === stageOrder.length - 1) {
      // Deployment complete
      deployment.status = 'COMPLETED';
      deployment.endTime = new Date();
      this.activeDeployments.delete(deployment.id);
      
      this.logger.info('Deployment completed successfully', {
        deploymentId: deployment.id,
        duration: deployment.endTime.getTime() - deployment.startTime.getTime()
      });
      
      this.emit('deployment-completed', deployment);
      return;
    }
    
    // Move to next stage
    const nextStage = stageOrder[currentIndex + 1];
    deployment.currentStage = nextStage;
    
    this.recordDeploymentEvent(deployment, 'STAGE_COMPLETED', stageOrder[currentIndex], 
      `Promoted to ${nextStage}`);
    
    // Continue deployment
    await this.executeDeploymentStage(deployment);
  }
  
  private async rollbackDeployment(deployment: Deployment): Promise<void> {
    this.logger.warn('Rolling back deployment', {
      deploymentId: deployment.id,
      stage: deployment.currentStage
    });
    
    deployment.status = 'ROLLED_BACK';
    this.recordDeploymentEvent(deployment, 'ROLLBACK', deployment.currentStage, 
      'Deployment rolled back due to validation failure');
    
    this.activeDeployments.delete(deployment.id);
    
    this.emit('deployment-rolled-back', deployment);
  }
  
  private handleDeploymentError(deployment: Deployment, error: string | Error): void {
    const errorMessage = typeof error === 'string' ? error : error.message;
    
    this.logger.error('Deployment error', {
      deploymentId: deployment.id,
      error: errorMessage
    });
    
    deployment.status = 'FAILED';
    this.recordDeploymentEvent(deployment, 'ERROR', deployment.currentStage, 
      `Error: ${errorMessage}`);
    
    this.activeDeployments.delete(deployment.id);
    
    this.emit('deployment-failed', { deployment, error: errorMessage });
  }
  
  private recordDeploymentEvent(
    deployment: Deployment, 
    type: DeploymentEvent['type'],
    stage: DeploymentStage['name'],
    details: string,
    metrics?: Record<string, number>
  ): void {
    const event: DeploymentEvent = {
      timestamp: new Date(),
      type,
      stage,
      details,
      metrics
    };
    
    deployment.history.push(event);
  }
  
  private monitorActiveDeployments(): void {
    for (const deploymentId of this.activeDeployments) {
      const deployment = this.deployments.get(deploymentId);
      if (!deployment) continue;
      
      const stage = this.stages.get(deployment.currentStage);
      if (!stage || stage.maxDuration === 0) continue;
      
      const elapsed = Date.now() - deployment.startTime.getTime();
      
      if (elapsed > stage.maxDuration) {
        this.logger.warn('Deployment timeout', {
          deploymentId,
          stage: stage.name,
          elapsed
        });
        
        this.handleDeploymentError(deployment, `Stage timeout: ${stage.name}`);
      }
    }
  }
  
  public getDeploymentStatus(deploymentId: string): Deployment | undefined {
    return this.deployments.get(deploymentId);
  }
  
  public getActiveDeployments(): Deployment[] {
    return Array.from(this.activeDeployments)
      .map(id => this.deployments.get(id))
      .filter(d => d !== undefined) as Deployment[];
  }
  
  public getDeploymentHistory(limit: number = 100): Deployment[] {
    return Array.from(this.deployments.values())
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }
  
  public async forcePromote(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || deployment.status !== 'IN_PROGRESS') {
      throw new Error('Invalid deployment state for force promotion');
    }
    
    this.logger.warn('Force promoting deployment', {
      deploymentId,
      currentStage: deployment.currentStage
    });
    
    await this.promoteToNextStage(deployment);
  }
  
  public async cancelDeployment(deploymentId: string, reason: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return;
    
    this.logger.info('Cancelling deployment', {
      deploymentId,
      reason
    });
    
    deployment.status = 'FAILED';
    this.recordDeploymentEvent(deployment, 'ERROR', deployment.currentStage, 
      `Deployment cancelled: ${reason}`);
    
    this.activeDeployments.delete(deploymentId);
    this.deploymentQueue = this.deploymentQueue.filter(id => id !== deploymentId);
    
    this.emit('deployment-cancelled', { deployment, reason });
  }
} 