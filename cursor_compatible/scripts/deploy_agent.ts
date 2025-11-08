import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { LaunchOrchestrator } from './launch';
import { logger } from '../src/utils/logger';

interface DeploymentConfig {
  environment: string;
  cluster: {
    type: string;
    config: Record<string, any>;
  };
  agents: {
    count: number;
    strategy: string;
    markets: string[];
  }[];
}

export class AgentDeployer {
  private config: DeploymentConfig;
  private orchestrator: LaunchOrchestrator;

  constructor(configPath: string) {
    this.config = this.loadConfig(configPath);
    this.orchestrator = new LaunchOrchestrator(
      path.join(process.cwd(), 'config', 'launch_profiles.yaml')
    );
  }

  private loadConfig(configPath: string): DeploymentConfig {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return yaml.load(content) as DeploymentConfig;
    } catch (error) {
      logger.error('Failed to load deployment config:', error);
      throw error;
    }
  }

  private async deployToCluster() {
    const { type, config } = this.config.cluster;

    switch (type) {
      case 'local':
        logger.info('Deploying to local environment');
        break;
      case 'kubernetes':
        logger.info('Deploying to Kubernetes cluster:', config);
        // Implement Kubernetes deployment logic
        break;
      case 'docker':
        logger.info('Deploying to Docker cluster:', config);
        // Implement Docker deployment logic
        break;
      default:
        throw new Error(`Unsupported cluster type: ${type}`);
    }
  }

  public async deploy() {
    try {
      // Deploy to cluster
      await this.deployToCluster();

      // Launch agents
      for (const agent of this.config.agents) {
        logger.info(`Launching ${agent.count} agents for strategy ${agent.strategy}`);
        
        for (const market of agent.markets) {
          await this.orchestrator.deployStrategy(
            this.config.environment,
            agent.strategy
          );
        }
      }

      logger.info('Deployment completed successfully');
    } catch (error) {
      logger.error('Deployment failed:', error);
      throw error;
    }
  }
}

// CLI interface
if (require.main === module) {
  const configPath = process.argv[2] || path.join(process.cwd(), 'config', 'deployment.yaml');
  const deployer = new AgentDeployer(configPath);

  deployer.deploy().catch(error => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
} 