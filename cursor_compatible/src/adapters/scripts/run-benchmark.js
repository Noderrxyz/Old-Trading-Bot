#!/usr/bin/env node
/**
 * Blockchain Adapter Benchmark Runner
 * 
 * This script detects the environment capabilities and runs the appropriate
 * benchmark version (ES Module or CommonJS).
 */

// Check if we're running in an ES Module environment
const isEsm = typeof require === 'undefined';

async function main() {
  console.log('Blockchain Adapter Benchmark Runner');
  console.log('===================================');
  
  try {
    if (isEsm) {
      console.log('Detected ES Module environment');
      
      try {
        // Try to directly import the .mjs file
        console.log('Running ES Module version...');
        const { runBenchmarks } = await import('./benchmark-adapters.mjs');
        await runBenchmarks();
        return;
      } catch (error) {
        console.warn('Failed to run ES Module version:', error.message);
        console.log('Falling back to CommonJS version...');
      }
    } else {
      console.log('Detected CommonJS environment');
    }
    
    // Try to run the transpiled version
    try {
      const fs = isEsm ? (await import('fs')).default : require('fs');
      const path = isEsm ? (await import('path')).default : require('path');
      const { execSync, spawn } = isEsm ? (await import('child_process')).default : require('child_process');
      const __dirname = isEsm ? path.dirname(new URL(import.meta.url).pathname) : __dirname;
      
      const projectRoot = path.resolve(__dirname, '../../..');
      const distFile = path.resolve(projectRoot, 'dist/benchmark-adapters.js');
      
      // Check if transpiled version exists
      if (!fs.existsSync(distFile)) {
        console.log('Transpiled version not found, building it now...');
        execSync('node ' + path.resolve(__dirname, 'build-benchmarks.js'), { stdio: 'inherit' });
      }
      
      console.log('Running CommonJS version...');
      const benchmarkProcess = spawn('node', [distFile], { stdio: 'inherit' });
      
      benchmarkProcess.on('close', (code) => {
        process.exit(code);
      });
    } catch (error) {
      console.error('Failed to run benchmark:', error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Detect environment and run appropriate version
if (isEsm) {
  main().catch(err => {
    console.error('Benchmark runner failed:', err);
    process.exit(1);
  });
} else {
  main();
} 