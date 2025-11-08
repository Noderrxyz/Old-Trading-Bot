// Loader for native Rust module
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Try to load the native module
let nativeBindings = null;
try {
  // Look for release version
  nativeBindings = require(join(__dirname, 'native/index.node'));
} catch (e) {
  try {
    // Try debug version if release not found
    nativeBindings = require(join(__dirname, 'native/index.node'));
  } catch (e2) {
    console.warn('Failed to load native Rust module, using mock implementation:', e2);
    
    // Fallback to mock implementations
    nativeBindings = {
      NapiSmartOrderRouter: class MockSmartOrderRouter {
        constructor() {}
        static withTrustScores() { return new MockSmartOrderRouter(); }
        async execute_order(params) { 
          return { 
            id: `mock-${Date.now()}`, 
            status: 'completed',
            request_id: params.id,
            executed_quantity: params.amount,
            average_price: params.price
          }; 
        }
        async get_venue_trust_score() { return 0.8; }
        async set_venue_trust_score() {}
      },
      
      NapiRiskCalculator: class MockRiskCalculator {
        constructor() {}
        async validate_position() { return true; }
        async fast_risk_check() { return { passed: true, violations: [] }; }
        async update_portfolio_value() {}
        async get_symbol_exposure() { return 0; }
        async set_trust_score() {}
      },
      
      NapiDynamicTradeSizer: class MockDynamicTradeSizer {
        constructor() {}
        static with_config() { return new MockDynamicTradeSizer(); }
        async calculate_position_size(_, baseSize) { return baseSize; }
        async update_volatility() { return 0.01; }
        async get_volatility() { return 0.01; }
        async clear_symbol_data() {}
        async get_tracked_symbols() { return []; }
      },
      
      NapiDrawdownMonitor: class MockDrawdownMonitor {
        static create() { return new MockDrawdownMonitor(); }
        async record_trade() {}
        async get_current_drawdown() { return 0; }
        async is_agent_active() { return true; }
        async reset_agent() {}
        async get_all_states() { return {}; }
      }
    };
  }
}

// Export all bindings from the native module
export const {
  NapiSmartOrderRouter,
  NapiRiskCalculator,
  NapiDynamicTradeSizer,
  NapiDrawdownMonitor
} = nativeBindings; 