# Trading Agent System

This directory contains the trading agent system, a framework for building algorithmic trading agents using TypeScript.

## Architecture

The system is built with a modular architecture:

- **Base Classes**: Abstract classes that define the core functionality
- **Agent Registry**: Central registry for tracking all agent instances
- **Agent Engine**: Orchestration engine that manages agent execution
- **Agent Implementations**: Concrete implementations of trading strategies

## Key Components

### TradingAgent

The `TradingAgent` abstract class is the foundation for all trading agents, providing:

- Position management
- Order execution
- Risk validation
- Performance tracking

### AgentContext

Each agent has an `AgentContext` which provides:

- Configuration (risk profile, market scope, execution settings)
- Lifecycle state management
- Metrics collection
- Logger instance

### Agent Lifecycle States

Agents can be in various states:
- `INITIALIZING` - Starting up
- `RUNNING` - Operating normally
- `PAUSED` - Temporarily stopped
- `RISK_REDUCED` - Operating with reduced risk after drawdown
- `DECAYING` - Performance degrading
- `DISABLED` - Not trading
- `ERROR` - Encountered issues

## Creating Your Own Agent

To create a custom trading agent:

1. Create a new file in `src/agents/implementations/` 
2. Define an interface for your agent's configuration
3. Create a class that extends `TradingAgent`
4. Implement the required abstract methods:
   - `processUpdate(marketData)`
   - `generateSignal(marketData)`
   - `processSignal(signal, marketData)`
   - `submitOrder(order)`
5. Create a factory class to instantiate your agent

### Example Structure

```typescript
// myStrategy.ts
import { TradingAgent, MarketData, Signal, Order } from '../base/TradingAgent.js';
import { AgentInitOptions } from '../base/TradingAgent.js';

// Define configuration interface
export interface MyStrategyConfig {
  // Strategy parameters
  parameter1: number;
  parameter2: number;
  // ...
}

// Set default configuration
const DEFAULT_CONFIG: MyStrategyConfig = {
  parameter1: 10,
  parameter2: 20,
  // ...
};

// Implement agent class
export class MyStrategyAgent extends TradingAgent {
  private config: MyStrategyConfig;
  
  constructor(options: AgentInitOptions) {
    super(options);
    
    // Parse configuration
    this.config = {
      ...DEFAULT_CONFIG,
      ...(options.strategyModel || {})
    };
  }
  
  // Process incoming market data
  public async processUpdate(marketData: MarketData): Promise<void> {
    // Update positions with current prices
    this.updatePositions(marketData);
    
    // Your strategy logic here
    
    // Generate trading signal
    const signal = await this.generateSignal(marketData);
    
    // Create order from signal if applicable
    if (signal) {
      const order = await this.processSignal(signal, marketData);
      if (order) {
        await this.submitOrder(order);
      }
    }
  }
  
  // Generate trading signal based on your strategy
  protected async generateSignal(marketData: MarketData): Promise<Signal | null> {
    // Your signal generation logic
    // Return null if no signal
  }
  
  // Convert signal to order
  protected async processSignal(signal: Signal, marketData: MarketData): Promise<Order | null> {
    // Your order creation logic
    // Make sure to validate against risk limits with this.validateRiskLimits(order)
  }
  
  // Submit order to execution service
  protected async submitOrder(order: Order): Promise<void> {
    // Submit order and handle result
  }
}

// Create factory for agent registration
export class MyStrategyAgentFactory {
  public async createAgent(agentId: string, config: any): Promise<TradingAgent> {
    return new MyStrategyAgent({
      agentId,
      redis: null as any, // This will be injected by the AgentEngine
      strategyModel: config
    });
  }
  
  public getAgentType(): string {
    return 'my_strategy_v1';
  }
}
```

## Available Trading Agents

### Mean Reversion Agent

The `MeanReversionAgent` implements a mean reversion strategy with Bollinger Bands:

- Buys when price falls below the lower band
- Sells when price rises above the upper band
- Features configurable entry/exit thresholds, stop loss, and take profit

### Momentum Agent

The `MomentumAgent` implements a momentum trading strategy:

- Uses EMA and Rate of Change (ROC) to identify trends
- Buys when price shows upward momentum
- Sells when price shows downward momentum
- Features configurable thresholds and risk management

## Running an Agent

See `examples/momentumAgentExample.ts` for a complete example of setting up and running an agent.

Basic steps:

1. Create an agent engine
2. Register your agent factory
3. Set up risk profile, market scope, and execution config
4. Spawn your agent with specific configuration
5. Start the engine to begin processing market data

## Best Practices

1. **Risk Management**: Always include proper risk controls including position sizing, stop-losses, and maximum drawdown settings.

2. **Signal Quality**: Focus on signal quality over quantity. Each signal should have a clear strength and confidence level.

3. **Testability**: Write strategies that can be easily tested with historical data.

4. **Performance**: Ensure your agent can process market data updates efficiently, as it may need to handle many updates per second.

5. **Metrics**: Track comprehensive metrics for your agent to understand its performance over time. 