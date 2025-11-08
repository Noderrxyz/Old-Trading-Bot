import express from 'express';
import cors from 'cors';
import { TelemetryWebSocket } from './ws/telemetry_ws.js';
import { FeedGraphEngine } from '../telemetry/feed_graph/FeedGraphEngine.js';
import logger from '../utils/logger.js';
import { getMetricsAsString } from '../telemetry/metrics.js';
import alertsRouter from './routes/alerts.js';

export class APIServer {
  private app: express.Application;
  private wsServer: TelemetryWebSocket;
  private feedGraph: FeedGraphEngine;

  constructor() {
    this.app = express();
    this.feedGraph = FeedGraphEngine.getInstance();
    this.wsServer = TelemetryWebSocket.getInstance();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // Feed graph endpoint
    this.app.get('/feed-graph', (req, res) => {
      const graph = this.feedGraph.generateGraph();
      res.json(graph);
    });
    
    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        // Set the appropriate content type for Prometheus metrics
        res.set('Content-Type', 'text/plain');
        
        // Get metrics in Prometheus exposition format
        const metrics = await getMetricsAsString();
        
        // Send the metrics response
        res.send(metrics);
      } catch (error) {
        logger.error('Error serving metrics:', error);
        res.status(500).send('Error collecting metrics');
      }
    });
    
    // Alertmanager webhooks
    this.app.use('/api/alerts', alertsRouter);
  }

  public start(port: number) {
    this.app.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
      logger.info(`Prometheus metrics available at http://localhost:${port}/metrics`);
      logger.info(`Alert webhooks available at http://localhost:${port}/api/alerts`);
    });
  }

  public stop() {
    this.wsServer.stop();
  }
} 