import { TelemetryEvent } from './TelemetryBus';

// Medium: Pluggable metrics sink interface; default in-memory
export interface MetricsSink {
  writeBatch(events: TelemetryEvent[]): Promise<void>;
}

export class InMemorySink implements MetricsSink {
  private buffer: TelemetryEvent[] = [];
  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    this.buffer.push(...events);
  }
  get size(): number { return this.buffer.length; }
  clear(): void { this.buffer.length = 0; }
}


