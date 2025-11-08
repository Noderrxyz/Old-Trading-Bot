const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Verifying Enhancement Packages...\n');

const enhancementPackages = [
  'network-optimizer',
  'telemetry-enhanced',
  'ml-enhanced',
  'execution-enhanced',
  'chaos-enhanced',
  'decentralized-core'
];

const results = [];

for (const pkg of enhancementPackages) {
  const packagePath = path.join(__dirname, 'packages', pkg);
  
  if (!fs.existsSync(packagePath)) {
    results.push({ package: pkg, status: 'NOT FOUND', error: 'Package directory not found' });
    continue;
  }
  
  try {
    console.log(`Verifying ${pkg}...`);
    
    // Check if package.json exists
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found');
    }
    
    // Check if it builds
    execSync('npm run build', {
      cwd: packagePath,
      stdio: 'pipe'
    });
    
    // Check if dist folder was created
    const distPath = path.join(packagePath, 'dist');
    if (!fs.existsSync(distPath)) {
      throw new Error('dist folder not created');
    }
    
    results.push({ package: pkg, status: 'SUCCESS', error: null });
    console.log(`✓ ${pkg} verified successfully\n`);
    
  } catch (error) {
    results.push({ package: pkg, status: 'FAILED', error: error.message });
    console.error(`✗ ${pkg} verification failed: ${error.message}\n`);
  }
}

console.log('\n=== VERIFICATION SUMMARY ===\n');
console.log('Package               | Status    | Notes');
console.log('---------------------|-----------|-------');

for (const result of results) {
  const status = result.status === 'SUCCESS' ? '✅ SUCCESS' : '❌ ' + result.status;
  const notes = result.error || 'Builds successfully';
  console.log(`${result.package.padEnd(20)} | ${status.padEnd(9)} | ${notes}`);
}

const successCount = results.filter(r => r.status === 'SUCCESS').length;
console.log(`\nTotal: ${successCount}/${enhancementPackages.length} packages verified successfully`);

if (successCount === enhancementPackages.length) {
  console.log('\n🎉 All enhancement packages are working correctly!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some packages need attention');
  process.exit(1);
} 