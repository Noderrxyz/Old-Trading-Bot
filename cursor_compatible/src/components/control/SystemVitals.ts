import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  networkLatency: number;
  diskUsage: number;
  processCount: number;
  errorRate: number;
}

export interface AlertThresholds {
  cpuUsage: number;
  memoryUsage: number;
  networkLatency: number;
  diskUsage: number;
  errorRate: number;
}

export class SystemVitals {
  private static instance: SystemVitals;
  private readonly METRICS_FILE = 'data/system_metrics.jsonl';
  private readonly ALERTS_FILE = 'data/system_alerts.jsonl';
  private readonly DEFAULT_THRESHOLDS: AlertThresholds = {
    cpuUsage: 80,
    memoryUsage: 85,
    networkLatency: 100,
    diskUsage: 90,
    errorRate: 5
  };

  private constructor() {
    this.ensureFiles();
  }

  public static getInstance(): SystemVitals {
    if (!SystemVitals.instance) {
      SystemVitals.instance = new SystemVitals();
    }
    return SystemVitals.instance;
  }

  private ensureFiles() {
    const dir = path.dirname(this.METRICS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.METRICS_FILE)) {
      fs.writeFileSync(this.METRICS_FILE, '');
    }
    if (!fs.existsSync(this.ALERTS_FILE)) {
      fs.writeFileSync(this.ALERTS_FILE, '');
    }
  }

  public async collectMetrics(): Promise<SystemMetrics> {
    try {
      const metrics = await this.getSystemMetrics();
      this.recordMetrics(metrics);
      this.checkAlerts(metrics);
      return metrics;
    } catch (error) {
      logger.error('Failed to collect system metrics:', error);
      throw error;
    }
  }

  private async getSystemMetrics(): Promise<SystemMetrics> {
    // In a real implementation, this would collect actual system metrics
    return {
      cpuUsage: 45,
      memoryUsage: 60,
      networkLatency: 50,
      diskUsage: 70,
      processCount: 150,
      errorRate: 2
    };
  }

  private recordMetrics(metrics: SystemMetrics) {
    const timestamp = Date.now();
    const record = {
      timestamp,
      ...metrics
    };
    
    fs.appendFileSync(
      this.METRICS_FILE,
      JSON.stringify(record) + '\n'
    );
  }

  private checkAlerts(metrics: SystemMetrics) {
    const alerts: string[] = [];
    
    if (metrics.cpuUsage > this.DEFAULT_THRESHOLDS.cpuUsage) {
      alerts.push(`High CPU usage: ${metrics.cpuUsage}%`);
    }
    if (metrics.memoryUsage > this.DEFAULT_THRESHOLDS.memoryUsage) {
      alerts.push(`High memory usage: ${metrics.memoryUsage}%`);
    }
    if (metrics.networkLatency > this.DEFAULT_THRESHOLDS.networkLatency) {
      alerts.push(`High network latency: ${metrics.networkLatency}ms`);
    }
    if (metrics.diskUsage > this.DEFAULT_THRESHOLDS.diskUsage) {
      alerts.push(`High disk usage: ${metrics.diskUsage}%`);
    }
    if (metrics.errorRate > this.DEFAULT_THRESHOLDS.errorRate) {
      alerts.push(`High error rate: ${metrics.errorRate}%`);
    }
    
    if (alerts.length > 0) {
      this.recordAlerts(alerts);
    }
  }

  private recordAlerts(alerts: string[]) {
    const timestamp = Date.now();
    const record = {
      timestamp,
      alerts
    };
    
    fs.appendFileSync(
      this.ALERTS_FILE,
      JSON.stringify(record) + '\n'
    );
  }

  public getRecentMetrics(limit: number = 100): SystemMetrics[] {
    const content = fs.readFileSync(this.METRICS_FILE, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .slice(-limit);
  }

  public getRecentAlerts(limit: number = 100): string[] {
    const content = fs.readFileSync(this.ALERTS_FILE, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .slice(-limit)
      .flatMap(record => record.alerts);
  }

  public clearHistory() {
    fs.writeFileSync(this.METRICS_FILE, '');
    fs.writeFileSync(this.ALERTS_FILE, '');
  }
} 