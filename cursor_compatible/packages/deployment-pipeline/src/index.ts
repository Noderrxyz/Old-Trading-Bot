// Autonomous Deployment Pipeline Module
// Phase 5 of Noderr Protocol Elite Expansion

export { DeploymentOrchestrator } from './DeploymentOrchestrator';
export { CIValidator } from './CIValidator';
export { CanaryLauncher } from './CanaryLauncher';
export { LivePromoter } from './LivePromoter';
export { RollbackEngine } from './RollbackEngine';
export { DeploymentDashboardHook } from './DeploymentDashboardHook';

// Version
export const DEPLOYMENT_PIPELINE_VERSION = '1.0.0'; 