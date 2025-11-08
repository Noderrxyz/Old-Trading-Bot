import * as http from 'http';
import * as os from 'os';
import { telemetry } from '../Telemetry';
import { logger } from '../../utils/logger';

/**
 * Health endpoint configuration
 */
export interface HealthEndpointConfig {
  /**
   * Port to listen on
   */
  port: number;
  
  /**
   * Path for health endpoint
   */
  path: string;
  
  /**
   * Collect CPU metrics
   */
  collectCpuMetrics: boolean;
  
  /**
   * Collect memory metrics
   */
  collectMemoryMetrics: boolean;
  
  /**
   * Include component error counts
   */
  includeErrorCounts: boolean;
  
  /**
   * Include latency metrics
   */
  includeLatencyMetrics: boolean;
  
  /**
   * Maximum number of recent errors to include
   */
  maxRecentErrors: number;
  
  /**
   * Collection interval in milliseconds
   */
  collectionIntervalMs: number;
  
  /**
   * Health check callback functions
   */
  healthChecks: Record<string, () => Promise<boolean>>;
}

/**
 * Default health endpoint configuration
 */
const defaultConfig: HealthEndpointConfig = {
  port: 9099,
  path: '/health',
  collectCpuMetrics: true,
  collectMemoryMetrics: true,
  includeErrorCounts: true,
  includeLatencyMetrics: true,
  maxRecentErrors: 10,
  collectionIntervalMs: 10000,
  healthChecks: {}
};

/**
 * System metrics
 */
interface SystemMetrics {
  cpu: {
    loadAvg: number[];
    usagePercent: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  uptime: number;
  process: {
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    uptime: number;
  };
}

/**
 * Health status response
 */
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  system: SystemMetrics;
  components: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    errors: number;
    latency?: number;
  }>;
  recentErrors: Array<{
    component: string;
    message: string;
    timestamp: string;
    severity: string;
  }>;
  metrics: Record<string, number>;
}

/**
 * Health endpoint for monitoring system health and metrics
 */
export class HealthEndpoint {
  private static instance: HealthEndpoint;
  private config: HealthEndpointConfig;
  private server: http.Server | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private cpuUsage: number = 0;
  private lastCpuInfo: { idle: number; total: number } = { idle: 0, total: 0 };
  private componentCache: Map<string, any> = new Map();
  
  /**
   * Private constructor - use getInstance()
   */
  private constructor(config: Partial<HealthEndpointConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.start();
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<HealthEndpointConfig>): HealthEndpoint {
    if (!HealthEndpoint.instance) {
      HealthEndpoint.instance = new HealthEndpoint(config);
    } else if (config) {
      HealthEndpoint.instance.updateConfig(config);
    }
    return HealthEndpoint.instance;
  }
  
  /**
   * Start health endpoint server
   */
  private start(): void {
    // Start collecting system metrics
    if (this.config.collectCpuMetrics || this.config.collectMemoryMetrics) {
      this.startMetricsCollection();
    }
    
    // Create HTTP server
    this.server = http.createServer((req, res) => {
      if (req.url === this.config.path && req.method === 'GET') {
        this.handleHealthRequest(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    // Start server
    this.server.listen(this.config.port, () => {
      logger.info(`Health endpoint available at http://localhost:${this.config.port}${this.config.path}`);
    });
    
    this.server.on('error', (error) => {
      logger.error(`Health endpoint server error: ${error}`);
    });
  }
  
  /**
   * Update configuration
   */
  public updateConfig(config: Partial<HealthEndpointConfig>): void {
    const prevPort = this.config.port;
    this.config = { ...this.config, ...config };
    
    // Restart server if port changed
    if (prevPort !== this.config.port && this.server) {
      this.server.close(() => {
        this.start();
      });
    }
    
    // Update metrics collection
    if (this.config.collectCpuMetrics || this.config.collectMemoryMetrics) {
      this.startMetricsCollection();
    } else {
      this.stopMetricsCollection();
    }
  }
  
  /**
   * Start collecting system metrics
   */
  private startMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Initialize CPU usage info
    if (this.config.collectCpuMetrics) {
      this.lastCpuInfo = this.getCpuInfo();
    }
    
    // Set up interval for collecting metrics
    this.metricsInterval = setInterval(() => {
      try {
        // Collect CPU metrics
        if (this.config.collectCpuMetrics) {
          const currentCpuInfo = this.getCpuInfo();
          const idleDiff = currentCpuInfo.idle - this.lastCpuInfo.idle;
          const totalDiff = currentCpuInfo.total - this.lastCpuInfo.total;
          this.cpuUsage = 100 - Math.round((idleDiff / totalDiff) * 100);
          this.lastCpuInfo = currentCpuInfo;
          
          // Record CPU usage metric
          telemetry.recordMetric('system.cpu.usage_percent', this.cpuUsage);
        }
        
        // Collect memory metrics
        if (this.config.collectMemoryMetrics) {
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const memPercent = Math.round((usedMem / totalMem) * 100);
          
          // Record memory metrics
          telemetry.recordMetric('system.memory.total_bytes', totalMem);
          telemetry.recordMetric('system.memory.free_bytes', freeMem);
          telemetry.recordMetric('system.memory.used_bytes', usedMem);
          telemetry.recordMetric('system.memory.usage_percent', memPercent);
          
          // Process memory
          const procMem = process.memoryUsage();
          telemetry.recordMetric('system.process.memory.rss_bytes', procMem.rss);
          telemetry.recordMetric('system.process.memory.heap_total_bytes', procMem.heapTotal);
          telemetry.recordMetric('system.process.memory.heap_used_bytes', procMem.heapUsed);
          telemetry.recordMetric('system.process.memory.external_bytes', procMem.external);
        }
      } catch (error) {
        logger.error(`Error collecting system metrics: ${error}`);
      }
    }, this.config.collectionIntervalMs);
  }
  
  /**
   * Stop collecting system metrics
   */
  private stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }
  
  /**
   * Get CPU info
   */
  private getCpuInfo(): { idle: number; total: number } {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    
    return { idle, total };
  }
  
  /**
   * Handle health request
   */
  private async handleHealthRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const status = await this.getHealthStatus();
      
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      
      res.end(JSON.stringify(status, null, 2));
      
      // Record metric for health check
      telemetry.recordMetric('health_endpoint.request_count', 1);
    } catch (error) {
      logger.error(`Error handling health request: ${error}`);
      
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      
      res.end(JSON.stringify({
        status: 'unhealthy',
        error: String(error),
        timestamp: new Date().toISOString()
      }));
      
      // Record error metric
      telemetry.recordError('HealthEndpoint', error as Error);
    }
  }
  
  /**
   * Get current health status
   */
  private async getHealthStatus(): Promise<HealthStatus> {
    // Collect system metrics
    const cpuInfo = this.getCpuInfo();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);
    const procMem = process.memoryUsage();
    
    // Get recent errors
    const recentErrors = telemetry.getRecentErrors(this.config.maxRecentErrors).map(err => ({
      component: err.component,
      message: err.message,
      timestamp: new Date(err.timestamp).toISOString(),
      severity: err.severity.toString()
    }));
    
    // Get component status
    const components: Record<string, any> = {};
    const metricValues = telemetry.getMetrics();
    const componentErrors: Record<string, number> = {};
    
    // Count errors by component
    for (const error of telemetry.getRecentErrors()) {
      componentErrors[error.component] = (componentErrors[error.component] || 0) + 1;
    }
    
    // Run component health checks
    const healthCheckResults = await this.runComponentHealthChecks();
    
    // Identify components from metrics and errors
    const allComponents = new Set<string>();
    
    // Add components from metrics
    for (const metricName in metricValues) {
      if (metricName.includes('.')) {
        const component = metricName.split('.')[0];
        allComponents.add(component);
      }
    }
    
    // Add components from errors
    for (const component in componentErrors) {
      allComponents.add(component);
    }
    
    // Add components from health checks
    for (const component in healthCheckResults) {
      allComponents.add(component);
    }
    
    // Build component status
    for (const component of allComponents) {
      if (component === 'system') continue; // Skip system metrics
      
      const errors = componentErrors[component] || 0;
      const isHealthy = healthCheckResults[component] !== false;
      
      components[component] = {
        status: errors === 0 && isHealthy ? 'healthy' : errors > 10 || !isHealthy ? 'unhealthy' : 'degraded',
        errors
      };
      
      // Add latency if available
      if (this.config.includeLatencyMetrics) {
        for (const metricName in metricValues) {
          if (metricName.startsWith(`${component}.`) && 
              (metricName.includes('_latency') || metricName.includes('_duration'))) {
            components[component].latency = metricValues[metricName];
            break;
          }
        }
      }
    }
    
    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const componentStatuses = Object.values(components).map(c => c.status);
    
    if (componentStatuses.includes('unhealthy')) {
      overallStatus = 'unhealthy';
    } else if (componentStatuses.includes('degraded')) {
      overallStatus = 'degraded';
    }
    
    // Get key metrics
    const keyMetrics: Record<string, number> = {};
    const metricPrefixes = [
      'order_execution_latency',
      'position_update_latency',
      'risk_check_duration',
      'tick_processing_latency',
      'strategy_eval_latency'
    ];
    
    for (const metricName in metricValues) {
      if (metricPrefixes.some(prefix => metricName.includes(prefix))) {
        keyMetrics[metricName] = metricValues[metricName];
      }
    }
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      system: {
        cpu: {
          loadAvg: os.loadavg(),
          usagePercent: this.cpuUsage
        },
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          usagePercent: memPercent
        },
        uptime: os.uptime(),
        process: {
          memory: {
            rss: procMem.rss,
            heapTotal: procMem.heapTotal,
            heapUsed: procMem.heapUsed,
            external: procMem.external
          },
          uptime: process.uptime()
        }
      },
      components,
      recentErrors,
      metrics: keyMetrics
    };
  }
  
  /**
   * Run component health checks
   */
  private async runComponentHealthChecks(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [component, checkFn] of Object.entries(this.config.healthChecks)) {
      try {
        // Use cached result if checked recently (within 30s)
        const cached = this.componentCache.get(component);
        if (cached && (Date.now() - cached.timestamp < 30000)) {
          results[component] = cached.status;
          continue;
        }
        
        // Run health check with timeout
        const status = await Promise.race([
          checkFn(),
          new Promise<boolean>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
        
        results[component] = status;
        
        // Cache result
        this.componentCache.set(component, {
          status,
          timestamp: Date.now()
        });
      } catch (error) {
        logger.warn(`Health check failed for ${component}: ${error}`);
        results[component] = false;
        
        // Cache negative result
        this.componentCache.set(component, {
          status: false,
          timestamp: Date.now()
        });
      }
    }
    
    return results;
  }
  
  /**
   * Register a health check for a component
   */
  public registerHealthCheck(component: string, checkFn: () => Promise<boolean>): void {
    this.config.healthChecks[component] = checkFn;
  }
  
  /**
   * Unregister a health check
   */
  public unregisterHealthCheck(component: string): void {
    delete this.config.healthChecks[component];
  }
  
  /**
   * Stop the health endpoint
   */
  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    logger.info('Health endpoint stopped');
  }
}

// Export singleton instance
export const healthEndpoint = HealthEndpoint.getInstance(); 