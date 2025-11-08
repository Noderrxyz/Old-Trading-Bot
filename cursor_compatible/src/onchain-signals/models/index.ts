/**
 * Onchain Signal Models
 * 
 * This module exports models that analyze blockchain data to generate trading signals.
 */

// Import base model and volume model for the factory function
import { BaseOnchainModel } from './BaseModel.js';
import { VolumeAnalysisModel } from './VolumeAnalysisModel.js';

// Export model interfaces and base classes
export { 
  BaseOnchainModel, 
  OnchainModelConfig, 
  OnchainModelInput, 
  OnchainModelOutput 
} from './BaseModel.js';

// Export specific model implementations
export { VolumeAnalysisModel, VolumeAnalysisConfig } from './VolumeAnalysisModel.js';

// Factory function to create a model by type
export function createModel(
  type: string, 
  config: any
): BaseOnchainModel {
  switch (type.toLowerCase()) {
    case 'volume':
    case 'volumeanalysis':
      return new VolumeAnalysisModel(config);
    default:
      throw new Error(`Unknown model type: ${type}`);
  }
} 