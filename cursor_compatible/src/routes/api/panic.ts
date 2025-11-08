import express from 'express';
import { Guardrails } from '../../control/guardrails';
import { logger } from '../../utils/logger';
import { authenticate, authorizeRoles } from '../../auth/authMiddleware';
import { UserRole } from '../../auth/types';
import rateLimiter from '../../middleware/rateLimiter';
import { validateBody } from '../../middleware/validationMiddleware';
import { JSONSchemaType } from 'ajv';

const router = express.Router();
const guardrails = Guardrails.getInstance();

// Trigger panic
router.post(
  '/',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 5 }),
  // Medium: Optional reason payload for audit
  validateBody<{ reason?: string }>({
    type: 'object',
    properties: { reason: { type: 'string', nullable: true } },
    required: [],
    additionalProperties: false
  } as JSONSchemaType<{ reason?: string }>),
  async (req, res) => {
  try {
    await guardrails.triggerPanic();
    logger.info('Panic triggered manually');
    res.json({ status: 'success', message: 'Panic triggered' });
  } catch (error) {
    logger.error('Failed to trigger panic:', error);
    res.status(500).json({ status: 'error', message: 'Failed to trigger panic' });
  }
});

// Reset panic
router.post(
  '/reset',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 5 }),
  validateBody<{ reason?: string }>({
    type: 'object',
    properties: { reason: { type: 'string', nullable: true } },
    required: [],
    additionalProperties: false
  } as JSONSchemaType<{ reason?: string }>),
  async (req, res) => {
  try {
    await guardrails.resetPanic();
    logger.info('Panic reset manually');
    res.json({ status: 'success', message: 'Panic reset' });
  } catch (error) {
    logger.error('Failed to reset panic:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reset panic' });
  }
});

// Get panic status
router.get(
  '/status',
  authenticate,
  authorizeRoles(UserRole.ADMIN),
  rateLimiter({ windowMs: 60_000, max: 60 }),
  (req, res) => {
  try {
    const isPanicked = guardrails.isInPanic();
    res.json({ status: 'success', isPanicked });
  } catch (error) {
    logger.error('Failed to get panic status:', error);
    res.status(500).json({ status: 'error', message: 'Failed to get panic status' });
  }
});

export default router; 