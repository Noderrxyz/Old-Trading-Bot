const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building all packages...\n');

const packagesDir = path.join(__dirname, 'packages');
const packages = fs.readdirSync(packagesDir).filter(dir => {
  const packagePath = path.join(packagesDir, dir);
  return fs.statSync(packagePath).isDirectory() && 
         fs.existsSync(path.join(packagePath, 'package.json'));
});

let failed = [];

for (const pkg of packages) {
  console.log(`Building ${pkg}...`);
  try {
    execSync('npm run build', {
      cwd: path.join(packagesDir, pkg),
      stdio: 'inherit'
    });
    console.log(`✓ ${pkg} built successfully\n`);
  } catch (error) {
    console.error(`✗ ${pkg} failed to build\n`);
    failed.push(pkg);
  }
}

if (failed.length > 0) {
  console.error('\nFailed packages:', failed.join(', '));
  process.exit(1);
} else {
  console.log('\nAll packages built successfully!');
} 