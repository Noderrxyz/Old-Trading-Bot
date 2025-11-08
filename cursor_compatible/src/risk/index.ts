// Export all components from the risk management module

// Position Manager
export { PositionManagerRust, OrderSide, OrderOrFill, SymbolPosition, AgentPosition, PositionManagerConfig } from './PositionManagerRust';
export { PositionManagerJs } from './PositionManagerJs';

// Integration
export { PositionManagerIntegration, PositionEvents, positionManagerIntegration } from './PositionManagerIntegration';

// Re-export the getInstance method directly for convenience
import { PositionManagerRust } from './PositionManagerRust';
export const getPositionManager = PositionManagerRust.getInstance; 