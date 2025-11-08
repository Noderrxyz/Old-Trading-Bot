/**
 * Execution report for a paper trading order
 */
export interface ExecutionReport {
  /**
   * The order
   */
  order: PaperOrder;
  
  /**
   * The updated position (null if order was rejected)
   */
  position: Position | null;
  
  /**
   * Current cash balance
   */
  balance: number;
  
  /**
   * Total account value
   */
  accountValue: number;
  
  /**
   * Profit/loss from this execution
   */
  pnl: number;
  
  /**
   * Flag indicating if this was a simulation
   */
  isSimulation: boolean;
  
  /**
   * Timestamp
   */
  timestamp: Date;
  
  /**
   * Optional message list
   */
  messages: string[];
  
  /**
   * Optional signal that triggered this execution
   */
  signal?: any;
} 