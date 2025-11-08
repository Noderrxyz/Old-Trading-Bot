/**
 * Normalizer for feature values
 * Ensures all numeric features are scaled between 0 and 1
 */

/**
 * Min-max scaler that normalizes values to a 0-1 range
 */
export function minMaxScale(value: number, min: number, max: number): number {
  if (max === min) return 0.5; // Avoid division by zero
  return (value - min) / (max - min);
}

/**
 * Z-score normalization (standardization)
 * Returns values centered around 0 with a standard deviation of 1
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0; // Avoid division by zero
  return (value - mean) / stdDev;
}

/**
 * Sigmoid normalization
 * Maps any real value to the range (0, 1) with a smooth curve
 */
export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Convert sentiment from range [-1, 1] to [0, 1]
 */
export function normalizeSentiment(sentiment: number): number {
  return (sentiment + 1) / 2;
}

/**
 * Log normalization for features with exponential distribution
 * (e.g., counts, frequencies)
 */
export function logNormalize(value: number, base: number = Math.E): number {
  if (value <= 0) return 0;
  return Math.log(value + 1) / Math.log(base + 1);
}

/**
 * Calculate Shannon entropy for measuring diversity
 * Higher entropy = more diverse
 * Normalized to [0, 1] range
 */
export function calculateNormalizedEntropy(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  
  // Calculate entropy
  let entropy = 0;
  for (const count of Object.values(counts)) {
    if (count === 0) continue;
    const probability = count / total;
    entropy -= probability * Math.log2(probability);
  }
  
  // Normalize by maximum possible entropy (log2 of the number of categories)
  const maxEntropy = Math.log2(Object.keys(counts).length);
  if (maxEntropy === 0) return 0;
  
  return entropy / maxEntropy;
}

/**
 * Normalize feature values to use consistent scales
 * Used to ensure all features have similar weight in ML models
 */
export function normalizeFeatures<T extends Record<string, any>>(
  features: T,
  fieldsToNormalize: {
    [K in keyof T]?: { 
      method: 'minmax' | 'sigmoid' | 'log' | 'sentiment',
      params?: { min?: number; max?: number; base?: number }
    }
  } 
): T {
  const normalizedFeatures = { ...features } as T;
  
  for (const [field, config] of Object.entries(fieldsToNormalize)) {
    if (!config || typeof features[field] !== 'number') continue;
    
    const value = features[field] as number;
    
    switch (config.method) {
      case 'minmax': {
        const min = config.params?.min ?? 0;
        const max = config.params?.max ?? 1;
        (normalizedFeatures as any)[field] = minMaxScale(value, min, max);
        break;
      }
      case 'sigmoid': {
        (normalizedFeatures as any)[field] = sigmoid(value);
        break;
      }
      case 'log': {
        const base = config.params?.base ?? Math.E;
        (normalizedFeatures as any)[field] = logNormalize(value, base);
        break;
      }
      case 'sentiment': {
        (normalizedFeatures as any)[field] = normalizeSentiment(value);
        break;
      }
    }
  }
  
  return normalizedFeatures;
} 