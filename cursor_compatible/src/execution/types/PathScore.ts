/**
 * Represents a score for a cross-chain path
 * Each component is normalized to a value between 0 and 1
 */
export interface PathScore {
  /**
   * Gas cost score (0 = highest cost, 1 = lowest cost)
   */
  gasCost: number;
  
  /**
   * Bridge fees score (0 = highest fees, 1 = lowest fees)
   */
  bridgeFees: number;
  
  /**
   * Price impact score (0 = highest impact, 1 = lowest impact)
   */
  priceImpact: number;
  
  /**
   * Path length score (0 = longest path, 1 = shortest path)
   */
  pathLength: number;
  
  /**
   * Liquidity score (0 = lowest liquidity, 1 = highest liquidity)
   */
  liquidity: number;
  
  /**
   * Total weighted score
   */
  total: number;
} 