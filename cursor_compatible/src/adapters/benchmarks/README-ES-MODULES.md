# Blockchain Adapter Benchmarks with ES Modules

This document explains how to run the blockchain adapter benchmarks using ES Modules compatibility mode.

## Background

The Noderr Protocol Trading Bot uses a mix of CommonJS and ES Modules, which can sometimes cause compatibility issues. The benchmarking tools have been adapted to work with both module systems.

## Running Benchmarks

### Option 1: Using the MJS File Directly

For environments that fully support ES Modules:

```bash
# Run directly with Node.js (requires Node.js 14+)
npm run benchmark:adapters:mjs

# Or directly 
node src/adapters/scripts/benchmark-adapters.mjs
```

### Option 2: Using the Build Script

For environments that may have compatibility issues:

```bash
# First build the benchmarks
npm run build:benchmarks

# Then run the transpiled version
npm run benchmark:adapters:es

# Or directly
node dist/benchmark-adapters.js
```

### Option 3: Using Helper Scripts

After running `build:benchmarks`, you can use the generated helper scripts:

- **Windows**: `dist/run-benchmarks.bat`
- **Unix/Mac/Linux**: `dist/run-benchmarks.sh`

## Troubleshooting

### ES Module vs CommonJS Issues

If you encounter errors like:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported.
```

or 

```
SyntaxError: Cannot use import statement outside a module
```

Try using the build script approach (Option 2) which transpiles the code to be compatible with your environment.

### TypeScript Compatibility

If you're working in a TypeScript project and want to import the benchmarks:

1. In TypeScript files, use dynamic imports:
   ```typescript
   // Example in a TypeScript file
   const runBenchmark = async () => {
     const { runBenchmarks } = await import('../dist/benchmark-adapters.js');
     await runBenchmarks();
   };
   ```

2. Or use the `--allowJs` TypeScript compiler option and import from the `.mjs` file directly.

## Customizing Benchmarks

You can customize benchmark parameters by modifying the following files:

- `src/adapters/scripts/benchmark-adapters.mjs` - Main benchmark implementation
- `src/adapters/benchmarks/harness.js` - Lower-level benchmark harness

## Output

The benchmarks will output results to:
- Console output with detailed metrics
- `benchmark-results.json` in the root directory with structured data
- Optional histogram data with distribution of operation times

## Performance Targets

The benchmarks validate against the following performance requirements:

- Connection time: < 2 seconds
- Quote latency: < 500ms
- Balance check latency: < 200ms
- Status check latency: < 200ms
- Success rate: > 99.5% 