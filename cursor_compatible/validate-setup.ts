/**
 * Validation Script - Check if all modules are properly set up
 * Run this before starting the local test to ensure everything is configured correctly
 */

console.log('🔍 Validating Noderr Protocol Setup...\n');

const modules = [
  { name: 'Safety Controller', path: './packages/safety-control/src/SafetyController' },
  { name: 'Alpha Orchestrator', path: './packages/alpha-orchestrator/src/AlphaOrchestrator' },
  { name: 'Capital Manager', path: './packages/capital-management/src/UnifiedCapitalManager' },
  { name: 'Execution Optimizer', path: './packages/execution-optimizer/src' },
  { name: 'Performance Registry', path: './packages/performance-registry/src/StrategyPerformanceRegistry' },
  { name: 'Data Connectors', path: './packages/data-connectors/src' },
  { name: 'System Orchestrator', path: './packages/system-orchestrator/src' }
];

let allModulesOk = true;

// Check each module
for (const module of modules) {
  try {
    require(module.path);
    console.log(`✅ ${module.name} - OK`);
  } catch (error) {
    console.error(`❌ ${module.name} - FAILED`);
    console.error(`   Error: ${error.message}`);
    allModulesOk = false;
  }
}

console.log('\n📦 Checking dependencies...');

// Check critical dependencies
const dependencies = [
  'winston',
  'ethers',
  'ws',
  'uuid',
  'lodash'
];

for (const dep of dependencies) {
  try {
    require(dep);
    console.log(`✅ ${dep} - Installed`);
  } catch (error) {
    console.error(`❌ ${dep} - Missing`);
    allModulesOk = false;
  }
}

// Check environment
console.log('\n🌍 Checking environment...');
console.log(`✅ Node.js version: ${process.version}`);
console.log(`✅ Platform: ${process.platform}`);
console.log(`✅ Working directory: ${process.cwd()}`);

// Check TypeScript
try {
  const ts = require('typescript');
  console.log(`✅ TypeScript version: ${ts.version}`);
} catch (error) {
  console.error('❌ TypeScript not found - Please install: npm install -g typescript');
  allModulesOk = false;
}

// Final result
console.log('\n' + '='.repeat(50));
if (allModulesOk) {
  console.log('✅ All checks passed! System is ready for local testing.');
  console.log('\nYou can now run:');
  console.log('  npm run dev');
  console.log('  or');
  console.log('  npx ts-node test-local.ts');
} else {
  console.log('❌ Some checks failed. Please fix the issues above.');
  console.log('\nTry running:');
  console.log('  npm install');
  console.log('  npm run build');
}
console.log('='.repeat(50));

process.exit(allModulesOk ? 0 : 1); 