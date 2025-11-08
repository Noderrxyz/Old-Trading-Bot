import { Path } from './Path';

export interface PathSimulationResult {
  /**
   * The path that was simulated
   */
  path: Path;

  /**
   * The input amount for the simulation
   */
  inputAmount: string;

  /**
   * The expected output amount after all hops and fees
   */
  expectedOutputAmount: string;

  /**
   * The total estimated fees (gas + bridge)
   */
  totalFees: string;

  /**
   * The estimated slippage (percentage)
   */
  slippage: number;

  /**
   * The estimated probability of failure (0 = no risk, 1 = certain failure)
   */
  failureProbability: number;

  /**
   * Any warnings or risk factors identified during simulation
   */
  warnings: string[];

  /**
   * Raw details per hop (optional, for debugging/telemetry)
   */
  hopDetails?: Array<{
    bridge: string;
    fromChain: string;
    toChain: string;
    input: string;
    output: string;
    fee: string;
    slippage: number;
    risk: string[];
  }>;
} 