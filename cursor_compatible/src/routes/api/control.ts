import express from 'express';
import { LaunchManager } from '../../orchestration/LaunchManager';
import { AutoMutationLoop } from '../../evolution/AutoMutationLoop';
import { AlphaMemoryEngine } from '../../memory/AlphaMemoryEngine';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { authenticate, authorizeRoles } from '../../auth/authMiddleware';
import { UserRole } from '../../auth/types';
import rateLimiter from '../../middleware/rateLimiter';
import { validateBody } from '../../middleware/validationMiddleware';
import { JSONSchemaType } from 'ajv';

const router = express.Router();
const launchManager = LaunchManager.getInstance();
const mutationLoop = AutoMutationLoop.getInstance();
const memoryEngine = AlphaMemoryEngine.getInstance();
const telemetryBus = TelemetryBus.getInstance();

// Log operator actions to file (High: switch to async to avoid blocking)
const logOperatorAction = (action: string, details: any = {}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    ...details
  };

  const logPath = path.join(process.cwd(), 'logs', 'operator_actions.log');
  fs.promises
    .mkdir(path.dirname(logPath), { recursive: true })
    .then(() => fs.promises.appendFile(logPath, JSON.stringify(logEntry) + '\n'))
    .catch((err) => logger.error('Failed to write operator action log', err));
};

// Panic freeze all agents
router.post(
  '/agents/panic',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 5 }),
  async (req, res) => {
  try {
    await launchManager.stopAllAgents();
    mutationLoop.stop();
    
    logOperatorAction('panic_freeze');
    telemetryBus.emit('panic_freeze', { timestamp: Date.now() });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to panic freeze:', error);
    res.status(500).json({ error: 'Failed to panic freeze' });
  }
});

// Pause/resume mutations
router.post(
  '/mutation/pause',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 30 }),
  // Medium: Ajv schema validation for body
  validateBody<{ pause: boolean }>({
    type: 'object',
    properties: { pause: { type: 'boolean' } },
    required: ['pause'],
    additionalProperties: false
  } as JSONSchemaType<{ pause: boolean }>),
  async (req, res) => {
  try {
    const { pause } = req.body;
    
    if (pause) {
      mutationLoop.stop();
    } else {
      mutationLoop.start();
    }
    
    logOperatorAction('mutation_pause', { paused: pause });
    telemetryBus.emit('mutation_pause', { paused: pause, timestamp: Date.now() });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to toggle mutation pause:', error);
    res.status(500).json({ error: 'Failed to toggle mutation pause' });
  }
});

// Restart top 3 agents by trust score
router.post(
  '/agents/restart-top',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 10 }),
  async (req, res) => {
  try {
    const strategies = await memoryEngine.querySnapshots({} as any);
    const topStrategies = strategies
      .sort((a, b) => b.metrics.trust - a.metrics.trust)
      .slice(0, 3);

    for (const strategy of topStrategies) {
      await launchManager.stopAgent(strategy.id);
      await launchManager.launch(strategy.id);
    }

    logOperatorAction('restart_top_agents', {
      agents: topStrategies.map(s => s.id)
    });
    telemetryBus.emit('top_agents_restarted', {
      agents: topStrategies.map(s => s.id),
      timestamp: Date.now()
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to restart top agents:', error);
    res.status(500).json({ error: 'Failed to restart top agents' });
  }
});

// Launch new strategy manually
router.post(
  '/agents/launch',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 20 }),
  async (req, res) => {
  try {
    const { id, market, config } = req.body;
    
    if (!id || !market || !config) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await launchManager.launch(id, market, config);
    
    logOperatorAction('manual_launch', { id, market });
    telemetryBus.emit('manual_launch', {
      id,
      market,
      timestamp: Date.now()
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to launch strategy:', error);
    res.status(500).json({ error: 'Failed to launch strategy' });
  }
});

export default router; 