import { EventEmitter as NodeEventEmitter } from 'events';

/**
 * Custom EventEmitter that extends Node's EventEmitter with TypeScript support
 * This enables type-safe event handling across the application
 */
class EventEmitter extends NodeEventEmitter {
  constructor() {
    super();
    // Set higher max listeners limit to avoid memory leak warnings
    this.setMaxListeners(100);
  }
  
  /**
   * Emit an event with payload
   * @param eventName The name of the event to emit
   * @param args The arguments to pass to the event listeners
   * @returns Whether the event had listeners
   */
  override emit(eventName: string, ...args: any[]): boolean {
    return super.emit(eventName, ...args);
  }
  
  /**
   * Register an event listener
   * @param eventName The name of the event to listen for
   * @param listener The callback function
   * @returns This instance for chaining
   */
  override on(eventName: string, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
  }
  
  /**
   * Register a one-time event listener
   * @param eventName The name of the event to listen for
   * @param listener The callback function
   * @returns This instance for chaining
   */
  override once(eventName: string, listener: (...args: any[]) => void): this {
    return super.once(eventName, listener);
  }
  
  /**
   * Remove an event listener
   * @param eventName The name of the event
   * @param listener The callback function to remove
   * @returns This instance for chaining
   */
  override removeListener(eventName: string, listener: (...args: any[]) => void): this {
    return super.removeListener(eventName, listener);
  }
  
  /**
   * Remove all listeners for an event
   * @param eventName The name of the event
   * @returns This instance for chaining
   */
  override removeAllListeners(eventName?: string): this {
    return super.removeAllListeners(eventName);
  }
}

// Export as both default and named export to support different import styles
export default EventEmitter;
export { EventEmitter }; 