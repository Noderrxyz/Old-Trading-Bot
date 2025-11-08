/**
 * API Server
 * 
 * Defines the main API server for the Noderr platform.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import governanceRoutes from './routes/governance.js';
import agentTrustRoutes from './routes/agentTrustRoutes.js';
import { createLogger } from '../common/logger.js';
import metricsRouter from '../metrics';
import marketDataRoutes from './routes/marketDataRoutes';
import operationalDataRoutes from './routes/operationalDataRoutes';
import userDataRoutes from './routes/userDataRoutes';
import configDataRoutes from './routes/configDataRoutes';
import quotesRouter from '../routes/api/quotes';

const logger = createLogger('APIServer');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware (Medium: security hardening for paper-mode API)
const DEV_ORIGIN = 'http://localhost:3000';
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet());
app.use(cors({ origin: isProd ? [] : [DEV_ORIGIN] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Log requests
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/trading', quotesRouter);
app.use('/governance', governanceRoutes);
app.use('/api/agents', agentTrustRoutes);
app.use('/api/marketdata', marketDataRoutes);
app.use('/api/operationaldata', operationalDataRoutes);
app.use('/api/userdata', userDataRoutes);
app.use('/api/configdata', configDataRoutes);
app.use(metricsRouter);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Noderr API',
    version: '1.0.0',
    endpoints: [
      '/governance/roles',
      '/governance/roles/:role',
      '/governance/agents/:agentId/role',
      '/governance/agents/:agentId/history',
      '/api/agents/trust',
      '/api/agents/trust/:agentId',
      '/api/agents/trust/enforcement/history',
      '/api/agents/trust/metrics',
      '/api/marketdata',
      '/api/operationaldata',
      '/api/userdata',
      '/api/configdata'
    ]
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({
    success: false,
    error: err.message
  });
});

// Start server
export function startServer() {
  return app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

// Export app for testing
export default app; 