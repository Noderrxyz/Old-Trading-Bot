/**
 * Alertmanager webhook receiver for handling Prometheus alerts
 */
import express from 'express';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * Process incoming alert from Alertmanager
 * - Logs alerts
 * - Could be extended to:
 *   - Send to chat systems (Slack, Discord)
 *   - Create incidents in incident management system
 *   - Trigger automated remediation
 */
router.post('/', async (req, res) => {
  try {
    const alerts = req.body.alerts || [];
    
    if (alerts.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No alerts in payload' });
    }
    
    // Log all alerts
    for (const alert of alerts) {
      const status = alert.status; // firing or resolved
      const severity = alert.labels?.severity || 'unknown';
      const alertName = alert.labels?.alertname || 'unnamed_alert';
      const chainId = alert.labels?.chain_id || 'unknown';
      const summary = alert.annotations?.summary || '';
      
      if (status === 'firing') {
        if (severity === 'critical') {
          logger.error(`[ALERT:CRITICAL] ${alertName} - Chain: ${chainId} - ${summary}`);
        } else {
          logger.warn(`[ALERT:${severity.toUpperCase()}] ${alertName} - Chain: ${chainId} - ${summary}`);
        }
      } else {
        logger.info(`[ALERT:RESOLVED] ${alertName} - Chain: ${chainId} - ${summary}`);
      }
    }
    
    // Process circuit breaker alerts - could trigger automated recovery
    const circuitBreakerAlerts = alerts.filter(
      alert => alert.labels?.alertname === 'CircuitBreakerTripped' && alert.status === 'firing'
    );
    
    if (circuitBreakerAlerts.length > 0) {
      // TODO: Implement automated remediation for circuit breaker trips
      // Example: Healthcheck RPC node and switch to backup if needed
      logger.info(`Processing ${circuitBreakerAlerts.length} circuit breaker alerts for remediation`);
    }
    
    return res.status(200).json({ status: 'ok', processed: alerts.length });
  } catch (error) {
    logger.error('Error processing alerts:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

export default router; 