/**
 * Route Optimizer
 * 
 * Finds optimal execution routes by scoring and comparing multiple route candidates.
 */

import { createLogger } from '../common/logger.js';
import { RouteCandidate, RouteScore } from './types/route_scorer.types.js';
import { RouteScorer } from './route_scorer.js';

const logger = createLogger('RouteOptimizer');

/**
 * Route optimizer for finding best execution routes
 */
export class RouteOptimizer {
  private readonly routeScorer: RouteScorer;

  /**
   * Create a new route optimizer
   * @param routeScorer Route scorer instance
   */
  constructor(routeScorer: RouteScorer) {
    this.routeScorer = routeScorer;
    logger.info('Route Optimizer initialized');
  }

  /**
   * Find the best route from multiple candidates
   * @param routes Route candidates to evaluate
   * @returns Best route and its score
   */
  public findBestRoute(routes: RouteCandidate[]): { route: RouteCandidate; score: RouteScore } | null {
    if (routes.length === 0) {
      logger.warn('No routes provided for optimization');
      return null;
    }

    let bestRoute: RouteCandidate | null = null;
    let bestScore: RouteScore | null = null;
    let highestScore = -Infinity;

    // Score each route and track the best one
    for (const route of routes) {
      const score = this.routeScorer.scoreRoute(route);
      
      // Skip routes that don't meet requirements
      if (!score.meetsRequirements) {
        logger.debug(`Route ${route.exchange} disqualified:`, score.disqualificationReasons);
        continue;
      }

      // Update best route if this one scores higher
      if (score.totalScore > highestScore) {
        highestScore = score.totalScore;
        bestRoute = route;
        bestScore = score;
      }
    }

    if (!bestRoute || !bestScore) {
      logger.warn('No valid routes found after optimization');
      return null;
    }

    logger.info(`Best route found: ${bestRoute.exchange} with score ${bestScore.totalScore}`);
    return { route: bestRoute, score: bestScore };
  }

  /**
   * Get a ranked list of all valid routes
   * @param routes Route candidates to evaluate
   * @returns Ranked list of routes and their scores
   */
  public getRankedRoutes(routes: RouteCandidate[]): Array<{ route: RouteCandidate; score: RouteScore }> {
    const scoredRoutes = routes
      .map(route => ({
        route,
        score: this.routeScorer.scoreRoute(route)
      }))
      .filter(({ score }) => score.meetsRequirements)
      .sort((a, b) => b.score.totalScore - a.score.totalScore);

    logger.info(`Ranked ${scoredRoutes.length} valid routes out of ${routes.length} candidates`);
    return scoredRoutes;
  }
} 