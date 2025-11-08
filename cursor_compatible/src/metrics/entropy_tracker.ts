import { TelemetryBus } from '../telemetry/TelemetryBus';
import { logger } from '../utils/logger';

export class EntropyTracker {
  private static instance: EntropyTracker;
  private entropyHistory: number[] = [];
  private maxHistorySize = 100;
  private currentEntropy = 0;

  private constructor() {
    this.setupTelemetry();
  }

  public static getInstance(): EntropyTracker {
    if (!EntropyTracker.instance) {
      EntropyTracker.instance = new EntropyTracker();
    }
    return EntropyTracker.instance;
  }

  private setupTelemetry() {
    const telemetryBus = TelemetryBus.getInstance();
    telemetryBus.on('system_metrics', (event: any) => {
      if (event.entropy !== undefined) {
        this.updateEntropy(event.entropy);
      }
    });
  }

  private updateEntropy(entropy: number) {
    this.currentEntropy = entropy;
    this.entropyHistory.push(entropy);
    if (this.entropyHistory.length > this.maxHistorySize) {
      this.entropyHistory.shift();
    }
  }

  public async getCurrentEntropy(): Promise<number> {
    return this.currentEntropy;
  }

  public getEntropyHistory(): number[] {
    return [...this.entropyHistory];
  }

  public getEntropyAverage(): number {
    if (this.entropyHistory.length === 0) return 0;
    return this.entropyHistory.reduce((a, b) => a + b, 0) / this.entropyHistory.length;
  }

  public getEntropyVolatility(): number {
    if (this.entropyHistory.length < 2) return 0;
    const avg = this.getEntropyAverage();
    const variance = this.entropyHistory.reduce((sum, value) => 
      sum + Math.pow(value - avg, 2), 0) / this.entropyHistory.length;
    return Math.sqrt(variance);
  }
} 