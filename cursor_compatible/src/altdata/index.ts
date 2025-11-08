/**
 * Alternative Data Processing System
 * 
 * Processes news headlines and other alternative data sources,
 * transforms them into normalized features for ML models,
 * and makes them available for real-time and historical analysis.
 */

// Re-export the types from the module
export * from './types';

// Re-export feature store components
export {
  // Core feature store components
  initializeFeatureStore,
  startFeatureStore,
  stopFeatureStore,
  getLatestFeatures,
  getFeatureWindow,
  getAlignedFeatures,
  closeFeatureStore,
  
  // Types
  AssetFeatureSet,
  FeatureStoreConfig,
  FeatureStoreConnections,
  FeatureWindowConfig,
  TimeBin,
  
  // Time alignment utilities
  alignFeatureWithMarketData,
  createTimeAlignedDataset,
  flattenAlignedData,
  AlignedDataPoint,
  MarketDataPoint,
  TimeAlignmentOptions
} from './features';

// Export main pipeline components from scoring module
export { enrichHeadline } from './scoring/enrichHeadline';
export { scoreHeadlineImpact } from './scoring/impactScorer';

// Convenience function to initialize the entire altdata pipeline
export async function initializeAltdataPipeline(
  redisUrl: string,
  postgresUrl?: string
): Promise<void> {
  // Import here to avoid circular dependencies
  const { initializeFeatureStore, startFeatureStore } = await import('./features/index.js');
  
  // Initialize feature store
  await initializeFeatureStore({
    redisUrl,
    postgresUrl
  });
  
  // Start feature store worker
  await startFeatureStore();
  
  console.log('Altdata pipeline initialized and running');
}

// Convenience function to shutdown the altdata pipeline
export async function shutdownAltdataPipeline(): Promise<void> {
  // Import here to avoid circular dependencies
  const { closeFeatureStore } = await import('./features/index.js');
  
  // Close feature store
  await closeFeatureStore();
  
  console.log('Altdata pipeline shut down successfully');
} 