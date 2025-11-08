/**
 * A priority queue implementation for simulation events
 * Events are ordered by timestamp, with earlier events dequeued first
 */
export class EventQueue {
  private events: any[] = [];
  
  /**
   * Add an event to the queue
   * Events are automatically sorted by timestamp
   */
  enqueue(event: any): void {
    // Add the event
    this.events.push(event);
    
    // Sort the events by timestamp
    this.events.sort((a, b) => {
      // First compare timestamps
      const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
      
      if (timeDiff !== 0) {
        return timeDiff;
      }
      
      // If timestamps are equal, use priority based on event type
      return this.getEventTypePriority(a.type) - this.getEventTypePriority(b.type);
    });
  }
  
  /**
   * Remove and return the next event from the queue
   */
  dequeue(): any {
    if (this.isEmpty()) {
      throw new Error('Queue is empty');
    }
    
    return this.events.shift();
  }
  
  /**
   * Get the next event without removing it
   */
  peek(): any {
    if (this.isEmpty()) {
      throw new Error('Queue is empty');
    }
    
    return this.events[0];
  }
  
  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.events.length === 0;
  }
  
  /**
   * Get the number of events in the queue
   */
  size(): number {
    return this.events.length;
  }
  
  /**
   * Clear all events from the queue
   */
  clear(): void {
    this.events = [];
  }
  
  /**
   * Get priority for event types
   * Lower numbers = higher priority
   */
  private getEventTypePriority(eventType: string): number {
    switch (eventType) {
      case 'tick':
        return 1; // Highest priority
      case 'orderbook':
        return 2;
      case 'bar':
        return 3;
      case 'order_filled':
        return 4;
      case 'order_placed':
        return 5;
      case 'order_cancelled':
        return 6;
      case 'position_changed':
        return 7;
      case 'cash_changed':
        return 8;
      case 'custom':
        return 9; // Lowest priority
      default:
        return 10;
    }
  }
} 