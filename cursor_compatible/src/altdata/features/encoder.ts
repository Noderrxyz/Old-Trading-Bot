/**
 * Encoder for categorical features
 * Provides methods to convert categorical data to numerical representations
 */

/**
 * Creates a one-hot encoding for a categorical value
 * @param value The value to encode
 * @param categories All possible categories
 * @returns Record with categories as keys and 0/1 as values
 */
export function oneHotEncode<T extends string | number>(
  value: T, 
  categories: T[]
): Record<string, number> {
  const encoding: Record<string, number> = {};
  
  // Initialize all categories to 0
  for (const category of categories) {
    encoding[String(category)] = 0;
  }
  
  // Set the matching category to 1
  encoding[String(value)] = 1;
  
  return encoding;
}

/**
 * Applies multi-hot encoding for multiple values
 * @param values Array of values to encode
 * @param categories All possible categories
 * @returns Record with categories as keys and 0/1 as values
 */
export function multiHotEncode<T extends string | number>(
  values: T[], 
  categories: T[]
): Record<string, number> {
  const encoding: Record<string, number> = {};
  
  // Initialize all categories to 0
  for (const category of categories) {
    encoding[String(category)] = 0;
  }
  
  // Set matching categories to 1
  for (const value of values) {
    if (categories.includes(value)) {
      encoding[String(value)] = 1;
    }
  }
  
  return encoding;
}

/**
 * Applies label encoding (ordinal encoding) for a categorical value
 * @param value The value to encode
 * @param categories Ordered array of categories
 * @returns The index of the value in the categories array
 */
export function labelEncode<T extends string | number>(
  value: T, 
  categories: T[]
): number {
  const index = categories.indexOf(value);
  return index >= 0 ? index : 0; // Default to 0 if category not found
}

/**
 * Target encoding (mean encoding) for categorical features
 * @param value The value to encode
 * @param categoryStats Map of categories to their mean target values
 * @param defaultValue Default value if category not found
 * @returns The mean target value for the category
 */
export function targetEncode<T extends string | number>(
  value: T,
  categoryStats: Map<T, number>,
  defaultValue: number = 0
): number {
  return categoryStats.get(value) ?? defaultValue;
}

/**
 * Frequency encoding - replaces categories with their frequencies
 * @param value The value to encode
 * @param categoryFrequencies Map of categories to their frequencies
 * @returns The frequency of the category
 */
export function frequencyEncode<T extends string | number>(
  value: T,
  categoryFrequencies: Map<T, number>
): number {
  return categoryFrequencies.get(value) ?? 0;
}

/**
 * Create count encodings for a record of categorical values
 * @param categoryCounts Record with categories as keys and counts as values
 * @param allCategories All possible categories to include
 * @returns A normalized record with all categories included
 */
export function encodeCountsToFeatures<T extends string>(
  categoryCounts: Record<T, number>,
  allCategories: T[]
): Record<string, number> {
  const result: Record<string, number> = {};
  
  // Ensure all categories are included, defaulting to 0
  for (const category of allCategories) {
    const featureName = `${String(category).toLowerCase()}_count`;
    result[featureName] = categoryCounts[category] || 0;
  }
  
  return result;
}

/**
 * Create proportion encodings for a record of categorical values
 * @param categoryCounts Record with categories as keys and counts as values
 * @param allCategories All possible categories to include
 * @returns A normalized record with proportions instead of raw counts
 */
export function encodeCountsToProportions<T extends string>(
  categoryCounts: Record<T, number>,
  allCategories: T[]
): Record<string, number> {
  const result: Record<string, number> = {};
  
  // Calculate total counts
  let total = 0;
  for (const count of Object.values(categoryCounts)) {
    total += count as number;
  }
  
  // Calculate proportions for each category
  for (const category of allCategories) {
    const featureName = `${String(category).toLowerCase()}_prop`;
    result[featureName] = total > 0 ? (categoryCounts[category] || 0) / total : 0;
  }
  
  return result;
} 