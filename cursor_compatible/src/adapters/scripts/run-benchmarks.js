#!/usr/bin/env node

/**
 * Benchmark Runner Script
 * 
 * This script runs the blockchain adapter benchmarks, properly handling TypeScript transpilation.
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = new URL('.', import.meta.url).pathname;

// Get the path to the benchmark script
const scriptPath = resolve(__dirname, 'benchmark-adapters.ts');

// Check if the file exists
if (!existsSync(scriptPath)) {
  console.error(`Benchmark script not found at: ${scriptPath}`);
  process.exit(1);
}

console.log('Running blockchain adapter benchmarks...');
console.log('===========================================');

try {
  // Run the benchmark script using ts-node
  execSync(`npx ts-node --esm ${scriptPath}`, { stdio: 'inherit' });
} catch (error) {
  console.error('Benchmark failed with error:', error.message);
  process.exit(1);
} 