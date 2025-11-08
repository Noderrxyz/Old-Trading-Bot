# Common Types

## Overview
This document describes the common types used throughout the Noderr Protocol API.

## Transaction Types

### Transaction
```typescript
interface Transaction {
  from: string;
  to: string;
  value: string;
  data?: string;
  gasLimit?: number;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  chainId?: number;
}
```

### TransactionResult
```typescript
interface TransactionResult {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  gasUsed?: number;
  confirmations?: number;
  timestamp?: number;
}
```

### TransactionStatus
```typescript
interface TransactionStatus {
  status: 'pending' | 'confirmed' | 'failed';
  confirmations: number;
  blockNumber?: number;
  timestamp?: number;
}
```

## Order Types

### Order
```typescript
interface Order {
  type: 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  amount: string;
  price?: string;
  sourceChain: string;
  targetChain: string;
  token: string;
  slippageTolerance: number;
  deadline: number;
}
```

### OrderResult
```typescript
interface OrderResult {
  orderId: string;
  status: 'pending' | 'executed' | 'failed';
  transactions: TransactionResult[];
  executedPrice?: string;
  executedAmount?: string;
  timestamp: number;
}
```

## Transfer Types

### CrossChainTransfer
```typescript
interface CrossChainTransfer {
  sourceChain: string;
  targetChain: string;
  amount: string;
  token: string;
  recipient: string;
  slippageTolerance: number;
  deadline: number;
}
```

### TransferResult
```typescript
interface TransferResult {
  transferId: string;
  status: 'pending' | 'completed' | 'failed';
  sourceTx?: TransactionResult;
  targetTx?: TransactionResult;
  bridgeTx?: TransactionResult;
  timestamp: number;
}
```

## Fee Types

### FeeEstimate
```typescript
interface FeeEstimate {
  sourceFee: string;
  targetFee: string;
  bridgeFee: string;
  totalFee: string;
  currency: string;
}
```

## Security Types

### ProtectedTransaction
```typescript
interface ProtectedTransaction {
  originalTx: Transaction;
  protectedTx: Transaction;
  protectionType: 'flashbots' | 'private' | 'bundle';
  estimatedSavings: string;
}
```

### SimulationResult
```typescript
interface SimulationResult {
  success: boolean;
  gasUsed: number;
  mevRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  warnings: string[];
  suggestions: string[];
}
```

### ValidationResult
```typescript
interface ValidationResult {
  valid: boolean;
  issues: string[];
  recommendations: string[];
}
```

### SignedTransaction
```typescript
interface SignedTransaction {
  transaction: Transaction;
  signature: string;
  securityMetadata: {
    timestamp: number;
    nonce: number;
    chainId: number;
  };
}
```

## Rate Limiting Types

### RateLimitResult
```typescript
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  limit: number;
  window: number;
}
```

## Error Types

### ChainAdapterError
```typescript
class ChainAdapterError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ChainAdapterError';
  }
}
```

### ExecutionError
```typescript
class ExecutionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}
```

### SecurityError
```typescript
class SecurityError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}
```

## Configuration Types

### AdapterConfig
```typescript
interface AdapterConfig {
  rpcUrl: string;
  privateKey?: string;
  timeout?: number;
  retries?: number;
  gasLimit?: number;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}
```

### SecurityConfig
```typescript
interface SecurityConfig {
  flashbotsProvider?: FlashbotsProvider;
  blocknativeProvider?: BlocknativeProvider;
  rateLimits?: {
    [operation: string]: {
      limit: number;
      window: number;
    };
  };
  validationRules?: {
    minConfirmations: number;
    maxSlippage: number;
    maxGasPrice: string;
  };
}
```

### ExecutionConfig
```typescript
interface ExecutionConfig {
  adapters: {
    [chain: string]: ChainAdapter;
  };
  securityLayer: SecurityLayer;
  defaultSlippage: number;
  defaultTimeout: number;
  retryConfig: {
    maxRetries: number;
    backoffFactor: number;
  };
}
```

## Usage Examples

### Creating a Transaction
```typescript
const tx: Transaction = {
  from: '0x123...',
  to: '0x456...',
  value: '1000000000000000000', // 1 ETH
  gasLimit: 21000,
  maxFeePerGas: '50000000000', // 50 gwei
  maxPriorityFeePerGas: '2000000000' // 2 gwei
};
```

### Creating an Order
```typescript
const order: Order = {
  type: 'MARKET',
  side: 'BUY',
  amount: '1.5',
  sourceChain: 'ethereum',
  targetChain: 'solana',
  token: 'USDC',
  slippageTolerance: 0.01, // 1%
  deadline: Date.now() + 3600000 // 1 hour
};
```

### Creating a Cross-Chain Transfer
```typescript
const transfer: CrossChainTransfer = {
  sourceChain: 'ethereum',
  targetChain: 'solana',
  amount: '1000',
  token: 'USDC',
  recipient: 'ABC123...',
  slippageTolerance: 0.01,
  deadline: Date.now() + 3600000
};
```

### Handling Errors
```typescript
try {
  const result = await adapter.executeTransaction(tx);
  console.log('Transaction hash:', result.hash);
} catch (error) {
  if (error instanceof ChainAdapterError) {
    console.error('Chain adapter error:', error.code, error.message);
  } else if (error instanceof ExecutionError) {
    console.error('Execution error:', error.code, error.message);
  } else if (error instanceof SecurityError) {
    console.error('Security error:', error.code, error.message);
  } else {
    console.error('Unknown error:', error);
  }
}
``` 