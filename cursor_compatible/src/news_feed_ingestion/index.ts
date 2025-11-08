/**
 * News Feed Ingestion Module
 * 
 * This module provides functionality for ingesting news from various sources
 * and processing them for downstream analysis.
 */

// Export the service
export { NewsIngestionService } from './NewsIngestionService.js';

// Export source handlers
export { BaseSourceHandler, FetchResult, NewsSourceConfig } from './source_handlers/BaseSourceHandler.js';
export { CryptoPanicHandler } from './source_handlers/CryptoPanicHandler.js';

// Export utilities
export { HeadlineFormatter } from './utils/headlineFormatter.js';

// Setup function to create and configure a news ingestion service with common sources
export async function setupNewsIngestionService(
  config: {
    cryptoPanicApiKey?: string;
    pollingIntervalMs?: number;
    autoStartPolling?: boolean;
  } = {}
) {
  const { NewsIngestionService } = await import('./NewsIngestionService.js');
  const { CryptoPanicHandler } = await import('./source_handlers/CryptoPanicHandler.js');
  
  // Create the service
  const service = new NewsIngestionService({
    pollingIntervalMs: config.pollingIntervalMs,
    autoStartPolling: config.autoStartPolling
  });
  
  // Add handlers if API keys are provided
  if (config.cryptoPanicApiKey) {
    const cryptoPanicHandler = new CryptoPanicHandler({
      apiKey: config.cryptoPanicApiKey,
      name: 'CryptoPanic',
      currencies: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'] // Default to major cryptos
    });
    
    service.addSourceHandler(cryptoPanicHandler);
  }
  
  return service;
} 