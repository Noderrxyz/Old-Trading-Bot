import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { DiscordWebhookManager } from '../notifications/DiscordWebhookManager.js';

/**
 * Risk configuration
 */
interface RiskConfig {
  maxPositionSizePct: number;
  maxLeverage: number;
  maxDrawdownPct: number;
  minTrustScore: number;
  maxExposurePerSymbol: number;
  maxExposurePerVenue: number;
  rebalanceIntervalMs: number;
  webhookUrl?: string;
}

/**
 * Default risk configuration
 */
const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizePct: 0.1, // 10% of portfolio
  maxLeverage: 3,
  maxDrawdownPct: 0.2, // 20% max drawdown
  minTrustScore: 0.7,
  maxExposurePerSymbol: 0.3, // 30% of portfolio per symbol
  maxExposurePerVenue: 0.4, // 40% of portfolio per venue
  rebalanceIntervalMs: 300000 // 5 minutes
};

/**
 * Position exposure
 */
interface PositionExposure {
  symbol: string;
  venue: string;
  size: number;
  value: number;
  leverage: number;
  trustScore: number;
}

/**
 * Venue exposure
 */
interface VenueExposure {
  venue: string;
  totalValue: number;
  trustScore: number;
}

/**
 * Risk Manager
 */
export class RiskManager {
  private static instance: RiskManager;
  private config: RiskConfig;
  private telemetryBus: TelemetryBus;
  private discordManager?: DiscordWebhookManager;
  private positions: Map<string, PositionExposure>;
  private venues: Map<string, VenueExposure>;
  private portfolioValue: number;
  private rebalanceInterval: NodeJS.Timeout;

  private constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.positions = new Map();
    this.venues = new Map();
    this.portfolioValue = 0;

    if (this.config.webhookUrl) {
      this.discordManager = new DiscordWebhookManager(this.config.webhookUrl);
    }

    this.rebalanceInterval = setInterval(
      () => this.rebalancePortfolio(),
      this.config.rebalanceIntervalMs
    );
  }

  public static getInstance(config?: Partial<RiskConfig>): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager(config);
    }
    return RiskManager.instance;
  }

  /**
   * Update portfolio value
   */
  public updatePortfolioValue(value: number): void {
    this.portfolioValue = value;
    this.telemetryBus.emit('portfolio_value_update', { value });
  }

  /**
   * Add position
   */
  public addPosition(position: PositionExposure): void {
    const positionId = `${position.symbol}-${position.venue}`;
    this.positions.set(positionId, position);
    this.updateVenueExposure(position);
    this.validatePosition(position);
  }

  /**
   * Remove position
   */
  public removePosition(symbol: string, venue: string): void {
    const positionId = `${symbol}-${venue}`;
    const position = this.positions.get(positionId);
    if (position) {
      this.positions.delete(positionId);
      this.updateVenueExposure(position, true);
    }
  }

  /**
   * Update venue exposure
   */
  private updateVenueExposure(position: PositionExposure, isRemoval: boolean = false): void {
    const venue = this.venues.get(position.venue) || {
      venue: position.venue,
      totalValue: 0,
      trustScore: position.trustScore
    };

    if (isRemoval) {
      venue.totalValue -= position.value;
    } else {
      venue.totalValue += position.value;
    }

    this.venues.set(position.venue, venue);
    this.validateVenueExposure(venue);
  }

  /**
   * Validate position
   */
  private validatePosition(position: PositionExposure): void {
    const positionSizePct = position.value / this.portfolioValue;
    const venueExposure = this.venues.get(position.venue);

    if (positionSizePct > this.config.maxPositionSizePct) {
      this.handleRiskViolation('position_size', {
        symbol: position.symbol,
        venue: position.venue,
        size: positionSizePct,
        limit: this.config.maxPositionSizePct
      });
    }

    if (position.leverage > this.config.maxLeverage) {
      this.handleRiskViolation('leverage', {
        symbol: position.symbol,
        venue: position.venue,
        leverage: position.leverage,
        limit: this.config.maxLeverage
      });
    }

    if (position.trustScore < this.config.minTrustScore) {
      this.handleRiskViolation('trust_score', {
        symbol: position.symbol,
        venue: position.venue,
        score: position.trustScore,
        limit: this.config.minTrustScore
      });
    }

    if (venueExposure && venueExposure.totalValue / this.portfolioValue > this.config.maxExposurePerVenue) {
      this.handleRiskViolation('venue_exposure', {
        venue: position.venue,
        exposure: venueExposure.totalValue / this.portfolioValue,
        limit: this.config.maxExposurePerVenue
      });
    }
  }

  /**
   * Validate venue exposure
   */
  private validateVenueExposure(venue: VenueExposure): void {
    const exposurePct = venue.totalValue / this.portfolioValue;
    if (exposurePct > this.config.maxExposurePerVenue) {
      this.handleRiskViolation('venue_exposure', {
        venue: venue.venue,
        exposure: exposurePct,
        limit: this.config.maxExposurePerVenue
      });
    }
  }

  /**
   * Handle risk violation
   */
  private handleRiskViolation(type: string, data: any): void {
    const message = `Risk violation detected: ${type}`;
    logger.warn(message, data);

    this.telemetryBus.emit('risk_violation', { type, ...data });

    if (this.discordManager) {
      this.discordManager.sendWarning(
        'Risk Violation',
        `${message}\n${JSON.stringify(data, null, 2)}`
      );
    }
  }

  /**
   * Rebalance portfolio
   */
  private rebalancePortfolio(): void {
    // Calculate current exposures
    const symbolExposures = new Map<string, number>();
    const venueExposures = new Map<string, number>();

    for (const position of this.positions.values()) {
      const symbolExposure = (symbolExposures.get(position.symbol) || 0) + position.value;
      const venueExposure = (venueExposures.get(position.venue) || 0) + position.value;

      symbolExposures.set(position.symbol, symbolExposure);
      venueExposures.set(position.venue, venueExposure);
    }

    // Check and handle overexposures
    for (const [symbol, exposure] of symbolExposures) {
      const exposurePct = exposure / this.portfolioValue;
      if (exposurePct > this.config.maxExposurePerSymbol) {
        this.handleRiskViolation('symbol_exposure', {
          symbol,
          exposure: exposurePct,
          limit: this.config.maxExposurePerSymbol
        });
      }
    }

    for (const [venue, exposure] of venueExposures) {
      const exposurePct = exposure / this.portfolioValue;
      if (exposurePct > this.config.maxExposurePerVenue) {
        this.handleRiskViolation('venue_exposure', {
          venue,
          exposure: exposurePct,
          limit: this.config.maxExposurePerVenue
        });
      }
    }

    this.telemetryBus.emit('portfolio_rebalance', {
      symbolExposures: Object.fromEntries(symbolExposures),
      venueExposures: Object.fromEntries(venueExposures)
    });
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    clearInterval(this.rebalanceInterval);
  }
} 