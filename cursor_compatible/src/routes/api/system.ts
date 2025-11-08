import express from 'express';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { TrustDecayEngine } from '../../trust/TrustDecayEngine';
import { EntropyTracker } from '../../metrics/entropy_tracker';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const router = express.Router();
const telemetryBus = TelemetryBus.getInstance();
const decayEngine = TrustDecayEngine.getInstance();
const entropyTracker = EntropyTracker.getInstance();

// Read metrics from JSONL files
const readJsonlFile = (filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (error) {
    logger.error(`Failed to read ${filePath}:`, error);
    return [];
  }
};

// Get system metrics
router.get('/metrics', async (req, res) => {
  try {
    const engineMetrics = readJsonlFile(path.join(process.cwd(), 'telemetry', 'engine_metrics.jsonl'));
    const retryLogs = readJsonlFile(path.join(process.cwd(), 'retry', 'retry_log.jsonl'));
    
    const latestMetrics = engineMetrics[engineMetrics.length - 1] || {
      timestamp: new Date().toISOString(),
      memory_mb: 0,
      retry_rate: 0,
      entropy_avg: 0,
      trust_violations: 0,
      error_burst: false
    };

    // Calculate retry rate (last hour)
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentRetries = retryLogs.filter(log => 
      new Date(log.timestamp) > oneHourAgo
    ).length;

    // Get current entropy
    const currentEntropy = await entropyTracker.getCurrentEntropy();

    res.json({
      ...latestMetrics,
      retry_rate: recentRetries,
      entropy_avg: currentEntropy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get system metrics:', error);
    res.status(500).json({ error: 'Failed to get system metrics' });
  }
});

// Get engine health status
router.get('/health', async (req, res) => {
  try {
    const engines = [
      {
        name: 'AgentEngine',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        metrics: {
          latency: 0.1,
          errorRate: 0.5,
          throughput: 1000
        }
      },
      {
        name: 'Router',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        metrics: {
          latency: 0.2,
          errorRate: 0.3,
          throughput: 500
        }
      },
      {
        name: 'Mutation',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        metrics: {
          latency: 0.3,
          errorRate: 0.7,
          throughput: 200
        }
      }
    ];

    // Update status based on metrics
    engines.forEach(engine => {
      if (engine.metrics.errorRate > 5) {
        engine.status = 'critical';
      } else if (engine.metrics.errorRate > 2) {
        engine.status = 'degraded';
      }
    });

    res.json(engines);
  } catch (error) {
    logger.error('Failed to get engine health:', error);
    res.status(500).json({ error: 'Failed to get engine health' });
  }
});

export default router; 