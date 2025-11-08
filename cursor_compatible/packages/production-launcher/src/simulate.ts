#!/usr/bin/env node

import { runProductionSimulation } from './ProductionSimulator';

// Run the production readiness simulation
runProductionSimulation().catch(error => {
  console.error('❌ Simulation failed:', error);
  process.exit(1);
}); 