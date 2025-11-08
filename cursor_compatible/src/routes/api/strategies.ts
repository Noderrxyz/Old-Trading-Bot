import express from 'express';
import { AlphaMemoryEngine } from '../../memory/AlphaMemoryEngine';
import { LaunchManager } from '../../orchestration/LaunchManager';
import { AgentSupervisor } from '../../runtime/AgentSupervisor';
import { AutoMutationLoop } from '../../evolution/AutoMutationLoop';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { authenticate, authorizeRoles } from '../../auth/authMiddleware';
import { UserRole } from '../../auth/types';
import { validateParams } from '../../middleware/validationMiddleware';
import { JSONSchemaType } from 'ajv';

const router = express.Router();
const memoryEngine = AlphaMemoryEngine.getInstance();
const launchManager = LaunchManager.getInstance();
const supervisor = AgentSupervisor.getInstance();
const mutationLoop = AutoMutationLoop.getInstance();
const telemetryBus = TelemetryBus.getInstance();

// Get all strategies
router.get('/', async (req, res) => {
  try {
    const strategies = await memoryEngine.querySnapshots({} as any);
    res.json(strategies);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
});

// Get strategy by ID
router.get('/:id', async (req, res) => {
  try {
    const strategies = await memoryEngine.querySnapshots({ id: req.params.id } as any);
    if (!strategies.length) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json(strategies[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch strategy' });
  }
});

// Pause strategy
router.post(
  '/:id/pause',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  validateParams<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } as JSONSchemaType<{ id: string }>),
  async (req, res) => {
  try {
    await launchManager.stopAgent(req.params.id);
    telemetryBus.emit('strategy_paused', { id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause strategy' });
  }
});

// Kill strategy
router.post(
  '/:id/kill',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  validateParams<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } as JSONSchemaType<{ id: string }>),
  async (req, res) => {
  try {
    await supervisor.quarantine(req.params.id, 'manual_kill');
    telemetryBus.emit('strategy_killed', { id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kill strategy' });
  }
});

// Clone strategy
router.post(
  '/:id/clone',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  validateParams<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } as JSONSchemaType<{ id: string }>),
  async (req, res) => {
  try {
    const strategies = await memoryEngine.querySnapshots({ id: req.params.id } as any);
    if (!strategies.length) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategy = strategies[0];
    const clonedStrategy = {
      ...strategy,
      id: `${strategy.id}_clone_${Date.now()}`,
      parentId: strategy.id,
      lineage: [...strategy.lineage, strategy.id]
    };

    await memoryEngine.saveSnapshot(clonedStrategy);
    telemetryBus.emit('strategy_cloned', { 
      id: clonedStrategy.id,
      parentId: strategy.id 
    });
    res.json(clonedStrategy);
  } catch (error) {
    res.status(500).json({ error: 'Failed to clone strategy' });
  }
});

// Debug strategy
router.post(
  '/:id/debug',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  validateParams<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } as JSONSchemaType<{ id: string }>),
  async (req, res) => {
  try {
    const state = supervisor.getAgentState(req.params.id);
    if (!state) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    telemetryBus.emit('strategy_debug', { 
      id: req.params.id,
      state 
    });
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: 'Failed to debug strategy' });
  }
});

export default router; 