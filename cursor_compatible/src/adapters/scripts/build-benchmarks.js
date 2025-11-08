#!/usr/bin/env node
/**
 * Build script for blockchain adapter benchmarks
 * 
 * This script handles transpilation for benchmark tools to ensure compatibility
 * with both ES modules and TypeScript. It creates a dist directory with compiled files.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.resolve(PROJECT_ROOT, 'dist');
const BENCHMARK_SRC = path.resolve(__dirname, 'benchmark-adapters.mjs');
const BENCHMARK_DEST = path.resolve(DIST_DIR, 'benchmark-adapters.js');

console.log('Paths:');
console.log(`- Current directory: ${__dirname}`);
console.log(`- Project root: ${PROJECT_ROOT}`);
console.log(`- Source file: ${BENCHMARK_SRC}`);
console.log(`- Destination directory: ${DIST_DIR}`);
console.log(`- Destination file: ${BENCHMARK_DEST}`);

// Create dist directory if it doesn't exist
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  console.log(`Created directory: ${DIST_DIR}`);
}

// Copy benchmark script to dist with proper format
function buildBenchmarks() {
  try {
    // First check if source file exists
    if (!fs.existsSync(BENCHMARK_SRC)) {
      console.error(`Source file not found: ${BENCHMARK_SRC}`);
      return false;
    }

    // Use babel if available, otherwise do a simple copy
    try {
      // Check if babel is installed
      execSync('npx babel --version', { stdio: 'ignore' });
      
      // Use babel to transpile the file
      console.log('Transpiling benchmark script with Babel...');
      execSync(`npx babel ${BENCHMARK_SRC} --out-file ${BENCHMARK_DEST}`, {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
      });
    } catch (e) {
      // Babel not available, do a simple copy
      console.log('Babel not found, copying script directly...');
      const content = fs.readFileSync(BENCHMARK_SRC, 'utf8');
      fs.writeFileSync(BENCHMARK_DEST, content);
    }

    // Make the output file executable (Unix-based systems only)
    try {
      fs.chmodSync(BENCHMARK_DEST, '755');
    } catch (e) {
      console.log('Note: Could not set executable permission (Windows system)');
    }
    
    console.log(`Successfully built benchmark script: ${BENCHMARK_DEST}`);

    // Create a helper batch script for Windows
    const batchScript = path.resolve(DIST_DIR, 'run-benchmarks.bat');
    fs.writeFileSync(batchScript, `@echo off\nnode "%~dp0\\benchmark-adapters.js" %*\n`);
    console.log(`Created Windows batch helper: ${batchScript}`);

    // Create a helper shell script for Unix
    const shellScript = path.resolve(DIST_DIR, 'run-benchmarks.sh');
    fs.writeFileSync(shellScript, `#!/bin/bash\nnode "$(dirname "$0")/benchmark-adapters.js" "$@"\n`);
    
    try {
      fs.chmodSync(shellScript, '755');
    } catch (e) {
      console.log('Note: Could not set executable permission for shell script (Windows system)');
    }
    
    console.log(`Created Unix shell helper: ${shellScript}`);

    return true;
  } catch (error) {
    console.error('Failed to build benchmark script:', error);
    return false;
  }
}

// Main execution
console.log('Building blockchain adapter benchmarks...');
const success = buildBenchmarks();

if (success) {
  console.log('\nBuild completed successfully!');
  console.log('\nTo run benchmarks, use:');
  console.log(`  node ${BENCHMARK_DEST}`);
  console.log('or');
  console.log(`  ${path.relative(process.cwd(), path.resolve(DIST_DIR, 'run-benchmarks.bat'))} (Windows)`);
  console.log(`  ${path.relative(process.cwd(), path.resolve(DIST_DIR, 'run-benchmarks.sh'))} (Unix)`);
} else {
  console.error('\nBuild failed!');
  process.exit(1);
} 