#!/usr/bin/env node

import { launchProduction } from './FinalLaunchValidator';

// Run the production launch sequence
launchProduction().catch(error => {
  console.error('❌ Launch failed:', error);
  process.exit(1);
}); 