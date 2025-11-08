# Transaction Risk Mitigation Layer

The Transaction Risk Mitigation Layer is designed to minimize failed, stuck, or reverted transactions and ensure capital protection during high-risk blocks. It includes the following components:

## Components

### TransactionGuard

The core service responsible for:
1. **Pre-Transaction Validation** - Simulates transactions before sending to ensure they will succeed
2. **Reversion Pattern Analysis** - Tracks historical revertion patterns to predict risk
3. **Protective Wrappers** - Uses protective strategies for high-risk transactions
4. **Rate Limiting** - Prevents back-to-back failed trades with an adaptive cooldown
5. **Logging & Telemetry** - Provides detailed reporting of all risk-related activities

### ProtectiveWrapper

Provides various strategies for wrapping high-risk transactions:
1. **Fail-Silent** - Executes the transaction with try/catch to prevent failures from propagating
2. **Retry with Backoff** - Automatically retries failed transactions with increased gas
3. **Split-Trade** - Breaks large trades into smaller chunks to reduce risk
4. **Private-TX** - Uses flashbots or similar methods for high-urgency trades
5. **Surrogate Contract** - Uses on-chain safety wrapper contracts

## Integration

### With SmartOrderRouter

```typescript
// Create dependencies
const trustEngine = getTrustEngine();
const router = new SmartOrderRouter(venues, trustEngine);
const transactionGuard = getTransactionGuard(router, trustEngine);
const protectiveWrapper = new ProtectiveWrapper();

// Example trade execution flow
async function executeTrade(order: OrderIntent): Promise<ExecutedOrder | null> {
  // Step 1: Validate transaction
  const riskReport = await transactionGuard.validateTransaction(
    order, 
    "uniswap_v3" // Target venue
  );
  
  // Step 2: Check guard action
  switch (riskReport.guardAction) {
    case 'blocked':
      console.log(`Trade blocked: ${riskReport.reason}`);
      return null;
      
    case 'delayed':
      console.log(`Trade delayed: ${riskReport.reason}`);
      // Implement retry logic or schedule for later
      return null;
      
    case 'wrapped':
      console.log(`Using protective wrapper with risk score ${riskReport.riskScore.toFixed(2)}`);
      // Execute with protective wrapper
      const result = await protectiveWrapper.wrapExecution(
        (o) => router.execute(o),
        order
      );
      
      if (result.success) {
        transactionGuard.handleSuccessfulTransaction(result.executedOrder!);
        return result.executedOrder!;
      } else {
        transactionGuard.handleFailedTransaction(
          order,
          riskReport.venueId,
          result.error
        );
        return null;
      }
      
    case 'allowed':
    default:
      // Execute normally
      try {
        const executedOrder = await router.execute(order);
        transactionGuard.handleSuccessfulTransaction(executedOrder);
        return executedOrder;
      } catch (error) {
        transactionGuard.handleFailedTransaction(
          order,
          riskReport.venueId,
          error
        );
        return null;
      }
  }
}
```

## Example Usage

```typescript
import { getTransactionGuard } from './TransactionGuard';
import { ProtectiveWrapper } from './ProtectiveWrapper';
import { SmartOrderRouter } from '../../infra/router/SmartOrderRouter';
import { getTrustEngine } from '../../infra/risk/TrustEngine';

// Set up the risk mitigation layer
const trustEngine = getTrustEngine();
const router = new SmartOrderRouter(venues, trustEngine);
const transactionGuard = getTransactionGuard(router, trustEngine);
const protectiveWrapper = new ProtectiveWrapper();

// Example order to execute
const order = {
  asset: 'ETH/USDC',
  side: 'buy',
  quantity: 2.5,
  urgency: 'medium',
  maxSlippageBps: 100
};

// Execute with risk mitigation
async function executeSafely() {
  const riskReport = await transactionGuard.validateTransaction(order, 'uniswap_v3');
  console.log(`Transaction risk score: ${riskReport.riskScore.toFixed(2)}`);
  
  if (riskReport.guardAction !== 'blocked' && riskReport.guardAction !== 'delayed') {
    let executedOrder;
    
    if (riskReport.guardAction === 'wrapped') {
      // Use protective wrapper for high-risk transactions
      const result = await protectiveWrapper.wrapExecution(
        (o) => router.execute(o),
        order
      );
      
      if (result.success) {
        executedOrder = result.executedOrder;
        console.log(`Successfully executed with ${result.strategyUsed} strategy`);
      }
    } else {
      // Regular execution for low-risk transactions
      executedOrder = await router.execute(order);
      console.log('Successfully executed with standard execution');
    }
    
    if (executedOrder) {
      transactionGuard.handleSuccessfulTransaction(executedOrder);
      console.log(`Executed at price: ${executedOrder.executedPrice}`);
    }
  }
}

// Call the execution function
executeSafely().catch(console.error);
```

## Benefits

1. **Reduced Failure Rates** - Simulation and analysis prevent predictable failures
2. **Better Gas Efficiency** - Smart gas pricing based on historical data
3. **Improved Capital Efficiency** - No stuck transactions or frozen capital
4. **Enhanced Safety** - Protection against MEV and high-volatility conditions
5. **Adaptive Recovery** - Self-healing from network issues 