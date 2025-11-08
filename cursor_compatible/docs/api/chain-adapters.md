# Chain Adapters

## Overview
Chain adapters provide a unified interface for interacting with different blockchain networks. Each adapter implements the `IChainAdapter` interface and handles chain-specific operations.

## IChainAdapter Interface

```typescript
interface IChainAdapter {
  executeTransaction(tx: Transaction): Promise<TransactionResult>;
  getBalance(address: string): Promise<number>;
  getGasPrice(): Promise<number>;
  estimateGas(tx: Transaction): Promise<number>;
}
```

## Ethereum Adapter

### Methods

#### executeTransaction
```typescript
async executeTransaction(tx: Transaction): Promise<TransactionResult>
```

Executes a transaction on the Ethereum network.

**Parameters:**
- `tx`: Transaction object containing:
  - `from`: Sender address
  - `to`: Recipient address
  - `value`: Amount in wei
  - `data`: Optional transaction data
  - `gasLimit`: Optional gas limit
  - `maxFeePerGas`: Optional max fee per gas
  - `maxPriorityFeePerGas`: Optional max priority fee per gas

**Returns:**
- `TransactionResult` object containing:
  - `hash`: Transaction hash
  - `status`: Transaction status
  - `blockNumber`: Block number where transaction was included
  - `gasUsed`: Gas used by transaction

**Example:**
```typescript
const adapter = new EthereumAdapter({
  rpcUrl: 'https://mainnet.infura.io/v3/YOUR-PROJECT-ID',
  privateKey: 'YOUR-PRIVATE-KEY'
});

const tx = {
  from: '0x123...',
  to: '0x456...',
  value: '1000000000000000000', // 1 ETH
  gasLimit: 21000
};

try {
  const result = await adapter.executeTransaction(tx);
  console.log('Transaction hash:', result.hash);
} catch (error) {
  console.error('Transaction failed:', error);
}
```

#### getBalance
```typescript
async getBalance(address: string): Promise<number>
```

Gets the ETH balance for an address.

**Parameters:**
- `address`: Ethereum address to check

**Returns:**
- Balance in wei as a number

**Example:**
```typescript
const balance = await adapter.getBalance('0x123...');
console.log('Balance:', balance / 1e18, 'ETH');
```

## Ethereum Adapter: Failure Modes & Recovery Procedures

### Failure Modes

- **Network/RPC Errors**: Loss of connectivity to Ethereum node, timeouts, or RPC errors.
- **Insufficient Funds**: Sender address does not have enough ETH to cover value + gas.
- **Invalid Parameters**: Malformed transaction data, invalid addresses, or unsupported gas settings.
- **Gas Estimation Failure**: Unable to estimate gas for the transaction (e.g., contract reverts).
- **Nonce Mismatch**: Nonce too low/high due to concurrent transactions or out-of-sync state.
- **Slippage Exceeded**: Actual execution price exceeds slippage tolerance.
- **Transaction Revert**: Smart contract execution fails (e.g., require/assert fails).
- **Flashbots/Private Relay Failure**: Submission to Flashbots or private relay fails or is not included.
- **Rate Limiting**: Exceeded rate limits on public/private RPC endpoints.

### Recovery Procedures

- **Automatic Retries**: On transient network or RPC errors, retry with exponential backoff.
- **Failover Providers**: Use fallback RPC endpoints if the primary is unavailable.
- **Nonce Management**: Query latest nonce before sending, and handle nonce gaps by resubmitting with correct nonce.
- **Gas Estimation Fallback**: Use static gas limits if estimation fails, or prompt for manual override.
- **Slippage Handling**: Abort transaction if slippage exceeds tolerance; optionally notify user and suggest new parameters.
- **Circuit Breaker**: Temporarily halt execution after repeated failures to prevent cascading issues.
- **Error Logging & Telemetry**: Log all errors with context for monitoring and post-mortem analysis.
- **Flashbots/Relay Fallback**: If private relay fails, optionally submit via public mempool as a last resort (if safe).
- **User Notification**: Surface actionable error messages to users and suggest recovery steps.

### Security Considerations

- **Private Key Management**: Never expose private keys; use secure signing modules.
- **Replay Protection**: Ensure correct chainId and nonce usage.
- **Slashing Protection**: Enforce slippage and gas price limits to avoid economic loss.
- **MEV Protection**: Prefer private relays for sensitive transactions.
- **Audit Logging**: Record all critical operations and failures for compliance and forensics.

## Solana Adapter

### Methods

#### executeTransaction
```typescript
async executeTransaction(tx: Transaction): Promise<TransactionResult>
```

Executes a transaction on the Solana network.

**Parameters:**
- `tx`: Transaction object containing:
  - `from`: Sender public key
  - `to`: Recipient public key
  - `value`: Amount in lamports
  - `data`: Optional transaction data
  - `feePayer`: Optional fee payer public key

**Returns:**
- `TransactionResult` object containing:
  - `signature`: Transaction signature
  - `status`: Transaction status
  - `slot`: Slot where transaction was included
  - `fee`: Transaction fee in lamports

**Example:**
```typescript
const adapter = new SolanaAdapter({
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  privateKey: 'YOUR-PRIVATE-KEY'
});

const tx = {
  from: 'ABC123...',
  to: 'DEF456...',
  value: '1000000000', // 1 SOL
};

try {
  const result = await adapter.executeTransaction(tx);
  console.log('Transaction signature:', result.signature);
} catch (error) {
  console.error('Transaction failed:', error);
}
```

## Solana Adapter: Failure Modes & Recovery Procedures

### Failure Modes

- **Network/RPC Errors**: Loss of connectivity to Solana RPC node, timeouts, or RPC errors.
- **Insufficient Funds**: Sender account does not have enough SOL to cover value + fees.
- **Invalid Parameters**: Malformed transaction data, invalid public keys, or unsupported instructions.
- **Blockhash Expiry**: Recent blockhash used in transaction has expired before confirmation.
- **Transaction Revert**: Program execution fails (e.g., failed instruction, account constraint violation).
- **Fee Payer Failure**: Fee payer account cannot cover transaction fees.
- **Nonce/Signature Errors**: Nonce or signature mismatch due to concurrent transactions or replay.
- **Rate Limiting**: Exceeded rate limits on public/private RPC endpoints.
- **Preflight Failure**: Transaction fails preflight checks (e.g., simulation error, account not found).

### Recovery Procedures

- **Automatic Retries**: On transient network or RPC errors, retry with exponential backoff.
- **Failover Providers**: Use fallback RPC endpoints if the primary is unavailable.
- **Blockhash Refresh**: Fetch a new recent blockhash and resubmit if expired.
- **Fee Payer Fallback**: Use alternate fee payer account if primary is depleted.
- **Preflight Simulation**: Simulate transaction before sending to catch errors early.
- **Error Logging & Telemetry**: Log all errors with context for monitoring and post-mortem analysis.
- **Circuit Breaker**: Temporarily halt execution after repeated failures to prevent cascading issues.
- **User Notification**: Surface actionable error messages to users and suggest recovery steps.

### Security Considerations

- **Key Management**: Never expose private keys; use secure keypair storage.
- **Replay Protection**: Use recent blockhash and unique signatures.
- **Slashing Protection**: Enforce slippage and fee limits to avoid economic loss.
- **Audit Logging**: Record all critical operations and failures for compliance and forensics.

## Cosmos Adapter

### Methods

#### executeTransaction
```typescript
async executeTransaction(tx: Transaction): Promise<TransactionResult>
```

Executes a transaction on the Cosmos network.

**Parameters:**
- `tx`: Transaction object containing:
  - `from`: Sender address
  - `to`: Recipient address
  - `value`: Amount in uatom
  - `data`: Optional transaction data
  - `memo`: Optional transaction memo
  - `gasLimit`: Optional gas limit

**Returns:**
- `TransactionResult` object containing:
  - `hash`: Transaction hash
  - `status`: Transaction status
  - `height`: Block height where transaction was included
  - `gasUsed`: Gas used by transaction

**Example:**
```typescript
const adapter = new CosmosAdapter({
  rpcUrl: 'https://rpc.cosmos.network',
  privateKey: 'YOUR-PRIVATE-KEY'
});

const tx = {
  from: 'cosmos1...',
  to: 'cosmos2...',
  value: '1000000', // 1 ATOM
  memo: 'Payment for services'
};

try {
  const result = await adapter.executeTransaction(tx);
  console.log('Transaction hash:', result.hash);
} catch (error) {
  console.error('Transaction failed:', error);
}
```

## Cosmos Adapter: Failure Modes & Recovery Procedures

### Failure Modes

- **Network/RPC Errors**: Loss of connectivity to Cosmos node, timeouts, or RPC errors.
- **Insufficient Funds**: Sender address does not have enough ATOM to cover value + gas.
- **Invalid Parameters**: Malformed transaction data, invalid addresses, or unsupported message types.
- **Gas Estimation Failure**: Unable to estimate gas for the transaction (e.g., contract/module reverts).
- **Nonce/Sequence Mismatch**: Sequence number too low/high due to concurrent transactions or out-of-sync state.
- **Slippage Exceeded**: Actual execution price exceeds slippage tolerance.
- **Transaction Revert**: Module or contract execution fails (e.g., failed assertion, insufficient permissions).
- **IBC/Bridge Failure**: Cross-chain (IBC) transfer fails or times out.
- **Rate Limiting**: Exceeded rate limits on public/private RPC endpoints.

### Recovery Procedures

- **Automatic Retries**: On transient network or RPC errors, retry with exponential backoff.
- **Failover Providers**: Use fallback RPC endpoints if the primary is unavailable.
- **Sequence Management**: Query latest sequence before sending, and handle sequence gaps by resubmitting with correct sequence.
- **Gas Estimation Fallback**: Use static gas limits if estimation fails, or prompt for manual override.
- **IBC Retry**: Retry IBC transfers with updated timeout or channel if initial attempt fails.
- **Slippage Handling**: Abort transaction if slippage exceeds tolerance; optionally notify user and suggest new parameters.
- **Circuit Breaker**: Temporarily halt execution after repeated failures to prevent cascading issues.
- **Error Logging & Telemetry**: Log all errors with context for monitoring and post-mortem analysis.
- **User Notification**: Surface actionable error messages to users and suggest recovery steps.

### Security Considerations

- **Private Key Management**: Never expose private keys; use secure signing modules.
- **Replay Protection**: Ensure correct chainId and sequence usage.
- **Slashing Protection**: Enforce slippage and gas price limits to avoid economic loss.
- **IBC Safety**: Monitor IBC channel health and handle timeouts securely.
- **Audit Logging**: Record all critical operations and failures for compliance and forensics.

## Error Handling

All adapters throw standardized errors:

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

Common error codes:
- `INVALID_ADDRESS`: Invalid blockchain address
- `INSUFFICIENT_FUNDS`: Not enough balance for transaction
- `GAS_ESTIMATION_FAILED`: Failed to estimate gas
- `TRANSACTION_FAILED`: Transaction execution failed
- `NETWORK_ERROR`: Network connectivity issues

## Security Considerations

1. **Private Key Management**
   - Never expose private keys in code
   - Use secure key management solutions
   - Implement proper key rotation

2. **Gas Optimization**
   - Use appropriate gas limits
   - Implement gas price strategies
   - Monitor gas usage

3. **Error Handling**
   - Implement proper error recovery
   - Log failed transactions
   - Monitor error rates

4. **Rate Limiting**
   - Implement request throttling
   - Use multiple RPC providers
   - Monitor API usage 