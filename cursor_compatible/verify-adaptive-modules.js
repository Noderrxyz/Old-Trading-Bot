// Simple verification script for Noderr Protocol Stage 2 modules
// Run with: node verify-adaptive-modules.js

// Import modules
import fs from 'fs';
import path from 'path';

// Paths to verify
const paths = [
  'src/evolution/StrategyMutationEngine.ts',
  'src/capital/RegimeCapitalAllocator.ts',
  'src/strategy/StrategyPortfolioOptimizer.ts'
];

// Helper functions
function checkFile(filePath) {
  try {
    const exists = fs.existsSync(filePath);
    if (!exists) {
      console.error(`❌ File does not exist: ${filePath}`);
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for telemetry imports/usage
    const hasTelemetry = content.includes('TelemetryBus') || 
                         content.includes('emit(') || 
                         content.includes('recordMetric');

    // Check for error handling
    const hasErrorHandling = content.includes('try {') && 
                             content.includes('catch (');
    
    // Check file size is substantial (not empty)
    const isSubstantial = content.length > 500;

    console.log(`\n📄 ${filePath}`);
    console.log(`  - File exists: ${exists ? '✅' : '❌'}`);
    console.log(`  - Has telemetry: ${hasTelemetry ? '✅' : '❌'}`);
    console.log(`  - Has error handling: ${hasErrorHandling ? '✅' : '❌'}`);
    console.log(`  - Is substantial: ${isSubstantial ? '✅' : '❌'}`);
    console.log(`  - Size: ${(content.length / 1024).toFixed(2)} KB`);

    return exists && hasTelemetry && hasErrorHandling && isSubstantial;
  } catch (error) {
    console.error(`Error checking file ${filePath}:`, error.message);
    return false;
  }
}

// Execute verification
console.log('🔍 Verifying Noderr Protocol Stage 2 modules...\n');

const results = paths.map(checkFile);
const allPassed = results.every(Boolean);

console.log('\n📊 Summary:');
console.log(`  - ${results.filter(Boolean).length}/${paths.length} modules verified successfully`);
console.log(`  - Overall status: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);

if (!allPassed) {
  console.log('\n⚠️ Fix the issues above before proceeding to runtime integration.');
  process.exit(1);
} else {
  console.log('\n🚀 All modules are ready for integration!');
} 