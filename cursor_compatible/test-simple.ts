/**
 * Simple test to verify basic functionality
 */

console.log('🔍 Testing basic module loading...\n');

try {
  // Test SafetyController
  const { SafetyController } = require('./packages/safety-control/src/SafetyController');
  const safety = SafetyController.getInstance();
  console.log('✅ SafetyController loaded');
  console.log('   Current mode:', safety.getTradingMode());
  
  // Test AlphaOrchestrator
  const { AlphaOrchestrator } = require('./packages/alpha-orchestrator/src/AlphaOrchestrator');
  const alpha = AlphaOrchestrator.getInstance();
  console.log('✅ AlphaOrchestrator loaded');
  
  // Test Capital Manager
  const { UnifiedCapitalManager } = require('./packages/capital-management/src/UnifiedCapitalManager');
  const capital = UnifiedCapitalManager.getInstance();
  console.log('✅ UnifiedCapitalManager loaded');
  
  console.log('\n✅ Basic modules are working!');
  console.log('\nYou can now run:');
  console.log('  npm run dev');
  console.log('  or');
  console.log('  npx ts-node test-local.ts');
  
} catch (error: any) {
  console.error('❌ Error loading modules:', error?.message || error);
  console.error('\nPlease check:');
  console.error('1. All dependencies are installed (npm install)');
  console.error('2. TypeScript is properly configured');
} 