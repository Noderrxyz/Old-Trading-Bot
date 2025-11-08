#!/usr/bin/env node

/**
 * Build script for Rust components
 * This handles building the Rust crate and setting up the Node.js bindings
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const coreDir = join(rootDir, 'noderr_core');
const nativeDir = join(coreDir, 'native');

console.log('🦀 Building Rust components...');

// Ensure directories exist
if (!existsSync(nativeDir)) {
  mkdirSync(nativeDir, { recursive: true });
}

try {
  // Step 1: Build Rust library
  console.log('📦 Building Rust library...');
  execSync('cargo build --release', {
    cwd: coreDir,
    stdio: 'inherit',
  });
  console.log('✅ Rust library built successfully');

  // Step 2: Build Node.js bindings
  console.log('🔄 Building Node.js bindings...');
  execSync('napi build --release', {
    cwd: coreDir,
    stdio: 'inherit',
  });
  console.log('✅ Node.js bindings built successfully');

  // Step 3: Run benchmarks
  if (process.argv.includes('--bench')) {
    console.log('🚀 Running benchmarks...');
    execSync('cargo bench', {
      cwd: coreDir,
      stdio: 'inherit',
    });
    console.log('✅ Benchmarks completed');
  }

  console.log('✨ All Rust components built successfully!');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  console.log('If napi command is not found, install with: npm install -g @napi-rs/cli');
  process.exit(1);
} 